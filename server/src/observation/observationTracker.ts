import * as path from 'node:path';

import type { ActivityEntry, ActivityKind, AgentObservation } from '../../../core/src/messages.js';
import type { AgentStateStore } from '../agentStateStore.js';
import type { AgentState } from '../types.js';
import type { AgentIdentityStore } from './agentIdentity.js';
import { classifyTool } from './classify.js';
import { maskSecrets } from './maskSecrets.js';
import { readTranscriptMeta, TaskTracker, type TranscriptMeta } from './transcriptMeta.js';

export type {
  ActivityEntry,
  ActivityKind,
  AgentObservation,
  ObservedStatus,
  ObservedSubagent,
} from '../../../core/src/messages.js';

export interface ObservationOptions {
  now?: () => number;
  /** Coalescing window for per-agent update broadcasts. */
  flushDelayMs?: number;
  feedLimit?: number;
  readMeta?: (file: string | undefined) => TranscriptMeta;
  /** Called for every feed entry with the agent it belongs to (history journal). */
  onRecord?: (entry: ActivityEntry, agent: AgentObservation | undefined) => void;
  /** Session ordinals and user-given names. */
  identity?: AgentIdentityStore;
  /** "Completed" turns into "Idle" after this long without a new turn. */
  completedHoldMs?: number;
  /** A "working" agent with no events this long is shown as disconnected. */
  staleMs?: number;
  /** Interval of the status sweep (0 disables the timer; call sweep() manually). */
  sweepMs?: number;
  /** Latest user request for a transcript (default: incremental TaskTracker). */
  readTask?: (file: string | undefined) => string | null;
}

export const COMPLETED_HOLD_MS = 3 * 60 * 1000;
export const STALE_WORKING_MS = 30 * 60 * 1000;
const TASK_MAX = 100;

/** First meaningful line of a user request, masked and clipped. */
export function summarizeTask(text: string | null | undefined): string | null {
  if (!text) return null;
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('<') && !l.startsWith('#'));
  if (!line) return null;
  const masked = maskSecrets(line.replace(/\s+/g, ' '));
  return masked.length > TASK_MAX ? masked.slice(0, TASK_MAX) + '…' : masked;
}

const OWN_MESSAGE_TYPES = new Set([
  'observationSnapshot',
  'agentObservation',
  'agentObservationRemoved',
  'activityEvent',
]);

interface Internal {
  obs: AgentObservation;
  tools: Map<string, { name: string; status: string }>;
  subagents: Map<string, string>;
  permission: boolean;
  /** When the current status began (completed → idle decay). */
  statusSince: number;
}

/**
 * Derives an honest, per-agent observation model from the Pixel Agents event
 * stream (the same broadcasts the office already receives) and publishes it as
 * `agentObservation` / `activityEvent` messages. It never invents data: fields
 * stay null until a real event or the transcript states them.
 */
export class ObservationTracker {
  private readonly agents = new Map<number, Internal>();
  private readonly feed: ActivityEntry[] = [];
  private seq = 0;
  private readonly dirty = new Set<number>();
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly now: () => number;
  private readonly flushDelayMs: number;
  private readonly feedLimit: number;
  private readonly readMeta: (file: string | undefined) => TranscriptMeta;
  private readonly listeners: Array<() => void> = [];
  private readonly onRecord?: ObservationOptions['onRecord'];
  private readonly identity?: AgentIdentityStore;
  private readonly completedHoldMs: number;
  private readonly staleMs: number;
  private sweepTimer: ReturnType<typeof setInterval> | undefined;
  private readonly readTask: (file: string | undefined) => string | null;

  constructor(
    private readonly store: AgentStateStore,
    opts: ObservationOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.flushDelayMs = opts.flushDelayMs ?? 120;
    this.feedLimit = opts.feedLimit ?? 300;
    this.readMeta = opts.readMeta ?? readTranscriptMeta;
    this.onRecord = opts.onRecord;
    this.identity = opts.identity;
    if (opts.readTask) {
      this.readTask = opts.readTask;
    } else {
      const tasks = new TaskTracker();
      this.readTask = (file) => tasks.latest(file);
    }
    this.completedHoldMs = opts.completedHoldMs ?? COMPLETED_HOLD_MS;
    this.staleMs = opts.staleMs ?? STALE_WORKING_MS;
    const sweepMs = opts.sweepMs ?? 30_000;
    if (sweepMs > 0) {
      this.sweepTimer = setInterval(() => this.sweep(), sweepMs);
      this.sweepTimer.unref?.();
    }

    const onAdded = (id: number, agent: AgentState) => this.onAgentAdded(id, agent);
    const onRemoved = (id: number) => this.onAgentRemoved(id);
    const onBroadcast = (msg: Record<string, unknown>) => this.onBroadcast(msg);
    store.on('agentAdded', onAdded);
    store.on('agentRemoved', onRemoved);
    store.on('broadcast', onBroadcast);
    this.listeners.push(
      () => store.off('agentAdded', onAdded),
      () => store.off('agentRemoved', onRemoved),
      () => store.off('broadcast', onBroadcast),
    );
    for (const [id, agent] of store) this.onAgentAdded(id, agent, { silent: true });
  }

  dispose(): void {
    for (const off of this.listeners) off();
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  /**
   * Time-based status rules, from real timestamps only: a finished turn reads
   * "Completed" for a while, then "Idle"; a "Working" agent that has gone
   * silent for a long time is shown as disconnected rather than still working.
   */
  sweep(): void {
    const now = this.now();
    for (const a of this.agents.values()) {
      const o = a.obs;
      if (o.status === 'completed' && now - a.statusSince >= this.completedHoldMs) {
        this.setStatus(a, 'idle');
        this.markDirty(o.id);
      } else if (
        (o.status === 'working' || o.status === 'waiting_permission') &&
        o.lastEventAt !== null &&
        now - o.lastEventAt >= this.staleMs
      ) {
        this.setStatus(a, 'disconnected', 'No events for a long time');
        this.record(o.id, 'disconnected', 'No events for a long time');
        this.markDirty(o.id);
      }
    }
  }

  /** A source reported an error for this agent (e.g. a failed Codex turn). */
  reportError(id: number, detail: string | null): void {
    const a = this.agents.get(id);
    if (!a) return;
    const clean = detail ? summarizeTask(detail) : null;
    this.setStatus(a, 'error', clean);
    a.obs.lastEventAt = this.now();
    this.record(id, 'error', clean ? `Error: ${clean}` : 'Error');
    this.markDirty(id);
  }

  /** A source lost contact with this agent's session. */
  reportDisconnected(id: number, detail: string | null): void {
    const a = this.agents.get(id);
    if (!a || a.obs.status === 'disconnected') return;
    this.setStatus(a, 'disconnected', detail);
    this.record(id, 'disconnected', detail ?? 'Disconnected');
    this.markDirty(id);
  }

  /** Give an agent a display name (null restores the default). Returns false if unknown. */
  rename(id: number, name: unknown): boolean {
    const a = this.agents.get(id);
    if (!a || !this.identity) return false;
    const ident = this.identity.rename(a.obs.source, a.obs.sessionId, name);
    a.obs.customName = ident.customName;
    a.obs.sessionOrdinal = ident.ordinal;
    this.markDirty(id);
    return true;
  }

  private setStatus(
    a: Internal,
    status: AgentObservation['status'],
    detail: string | null = null,
  ): void {
    if (a.obs.status !== status) a.statusSince = this.now();
    a.obs.status = status;
    a.obs.statusDetail = detail;
  }

  /** Full state for a (re)connecting client. */
  snapshot(): { agents: AgentObservation[]; activity: ActivityEntry[]; capturedAt: number } {
    return {
      agents: [...this.agents.values()].map((a) => this.materialize(a)),
      activity: [...this.feed],
      capturedAt: this.now(),
    };
  }

  /** Session ids of agents currently in the office. */
  liveSessionIds(): Set<string> {
    return new Set([...this.agents.values()].map((a) => a.obs.sessionId));
  }

  get(id: number): AgentObservation | undefined {
    const a = this.agents.get(id);
    return a ? this.materialize(a) : undefined;
  }

  /** Send pending updates immediately (tests, shutdown). */
  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    for (const id of this.dirty) {
      const a = this.agents.get(id);
      if (a) this.store.broadcast({ type: 'agentObservation', agent: this.materialize(a) });
    }
    this.dirty.clear();
  }

  // ── Store events ─────────────────────────────────────────────

  private onAgentAdded(id: number, agent: AgentState, opts: { silent?: boolean } = {}): void {
    if (this.agents.has(id)) return;
    const meta = this.readMeta(agent.jsonlFile || undefined);
    const now = this.now();
    const source =
      agent.providerId === undefined || agent.providerId === 'claude'
        ? 'claude-code'
        : agent.providerId;
    const ident = this.identity?.get(source, agent.sessionId) ?? null;
    this.agents.set(id, {
      obs: {
        id,
        source,
        sessionId: agent.sessionId,
        isExternal: agent.isExternal,
        channel: 'transcript',
        project: meta.cwd ? path.basename(meta.cwd) : (agent.directoryName ?? null),
        cwd: meta.cwd,
        gitBranch: meta.gitBranch,
        model: meta.model,
        status: 'unknown',
        activity: null,
        currentAction: null,
        lastAction: null,
        firstSeenAt: now,
        lastEventAt: null,
        subagents: [],
        contextTokens: null,
        maxContextTokens: null,
        teamName: agent.teamName ?? null,
        agentName: agent.agentName ?? null,
        isTeamLead: agent.isTeamLead ?? false,
        leadAgentId: agent.leadAgentId ?? null,
        sessionOrdinal: ident?.ordinal ?? null,
        customName: ident?.customName ?? null,
        task: summarizeTask(this.readTask(agent.jsonlFile || undefined) ?? meta.task),
        statusDetail: null,
      },
      tools: new Map(),
      subagents: new Map(),
      permission: false,
      statusSince: now,
    });
    if (!opts.silent) this.record(id, 'joined', 'Detected session');
    this.markDirty(id);
  }

  private onAgentRemoved(id: number): void {
    const leaving = this.agents.get(id);
    if (!leaving) return;
    const last = this.materialize(leaving);
    this.agents.delete(id);
    this.dirty.delete(id);
    this.record(id, 'left', 'Session left the office', last);
    this.store.broadcast({ type: 'agentObservationRemoved', id });
  }

  private onBroadcast(msg: Record<string, unknown>): void {
    const type = msg.type;
    if (typeof type !== 'string' || OWN_MESSAGE_TYPES.has(type)) return;
    const id = msg.id;
    if (typeof id !== 'number') return;
    const a = this.agents.get(id);
    if (!a) return;
    const o = a.obs;
    const now = this.now();

    switch (type) {
      case 'agentToolStart': {
        const toolId = String(msg.toolId ?? '');
        const name = typeof msg.toolName === 'string' ? msg.toolName : '';
        const status = maskSecrets(typeof msg.status === 'string' ? msg.status : name);
        const isNew = !a.tools.has(toolId);
        a.tools.set(toolId, { name, status });
        if (msg.permissionActive === true) a.permission = true;
        this.setStatus(
          a,
          name === 'AskUserQuestion'
            ? 'waiting_user'
            : a.permission
              ? 'waiting_permission'
              : 'working',
        );
        o.lastEventAt = now;
        if (isNew && status) {
          o.lastAction = status;
          this.record(id, 'tool', status);
        }
        break;
      }
      case 'agentToolDone': {
        const tool = a.tools.get(String(msg.toolId ?? ''));
        if (tool) o.lastAction = tool.status;
        a.tools.delete(String(msg.toolId ?? ''));
        o.lastEventAt = now;
        break;
      }
      case 'agentToolsClear':
        a.tools.clear();
        break;
      case 'agentToolPermission':
      case 'subagentToolPermission':
        a.permission = true;
        this.setStatus(a, 'waiting_permission');
        o.lastEventAt = now;
        this.record(id, 'permission', 'Needs your permission');
        break;
      case 'agentToolPermissionClear':
        a.permission = false;
        if (o.status === 'waiting_permission') this.setStatus(a, 'working');
        o.lastEventAt = now;
        break;
      case 'agentStatus': {
        if (msg.status === 'active') {
          if (!a.permission) this.setStatus(a, 'working');
          this.refreshMeta(id); // a new turn: pick up the request that started it
        } else if (msg.status === 'waiting') {
          a.permission = false;
          a.tools.clear();
          const awaiting = msg.awaitingInput === true;
          // An error reported for this turn stays visible until the next turn.
          if (o.status !== 'error') this.setStatus(a, awaiting ? 'waiting_user' : 'completed');
          this.record(
            id,
            awaiting ? 'waitingInput' : 'turnEnd',
            awaiting ? 'Waiting for your input' : 'Finished its turn',
          );
          this.refreshMeta(id);
        }
        o.lastEventAt = now;
        break;
      }
      case 'subagentToolStart': {
        const parent = String(msg.parentToolId ?? '');
        if (!a.subagents.has(parent)) {
          const parentTool = a.tools.get(parent);
          const label = parentTool?.status ?? 'Subtask';
          a.subagents.set(parent, label);
          this.record(id, 'subagentStart', `Delegated: ${label.replace(/^Subtask:\s*/, '')}`);
        }
        o.lastEventAt = now;
        break;
      }
      case 'subagentClear': {
        const parent = String(msg.parentToolId ?? '');
        const label = a.subagents.get(parent);
        if (a.subagents.delete(parent)) {
          this.record(
            id,
            'subagentEnd',
            `Subtask finished: ${(label ?? '').replace(/^Subtask:\s*/, '')}`.trim(),
          );
        }
        o.lastEventAt = now;
        break;
      }
      case 'agentContextUsage':
        if (typeof msg.contextTokens === 'number') o.contextTokens = msg.contextTokens;
        if (typeof msg.maxContextTokens === 'number') o.maxContextTokens = msg.maxContextTokens;
        break;
      case 'agentTeamInfo':
        o.teamName = typeof msg.teamName === 'string' ? msg.teamName : null;
        o.agentName = typeof msg.agentName === 'string' ? msg.agentName : null;
        o.isTeamLead = msg.isTeamLead === true;
        o.leadAgentId = typeof msg.leadAgentId === 'number' ? msg.leadAgentId : null;
        break;
      default:
        return;
    }
    this.markDirty(id);
  }

  // ── Internals ────────────────────────────────────────────────

  /** Re-read branch / model / cwd from the transcript (they change mid-session). */
  private refreshMeta(id: number): void {
    const a = this.agents.get(id);
    const agent = this.store.get(id);
    if (!a || !agent?.jsonlFile) return;
    const meta = this.readMeta(agent.jsonlFile);
    if (meta.cwd) {
      a.obs.cwd = meta.cwd;
      a.obs.project = path.basename(meta.cwd);
    }
    if (meta.gitBranch) a.obs.gitBranch = meta.gitBranch;
    if (meta.model) a.obs.model = meta.model;
    const task = summarizeTask(this.readTask(agent.jsonlFile) ?? meta.task);
    if (task) a.obs.task = task;
  }

  private materialize(a: Internal): AgentObservation {
    const agent = this.store.get(a.obs.id);
    const current = [...a.tools.values()].pop();
    const working = a.obs.status === 'working' || a.obs.status === 'waiting_permission';
    return {
      ...a.obs,
      channel: agent?.hookDelivered ? 'hooks' : 'transcript',
      activity: working && current ? classifyTool(current.name) : null,
      currentAction: working || a.obs.status === 'waiting_user' ? (current?.status ?? null) : null,
      subagents: [...a.subagents].map(([toolId, label]) => ({ toolId, label })),
    };
  }

  private record(
    agentId: number,
    kind: ActivityKind,
    text: string,
    agent: AgentObservation | undefined = this.get(agentId),
  ): void {
    const entry: ActivityEntry = { seq: ++this.seq, ts: this.now(), agentId, kind, text };
    try {
      this.onRecord?.(entry, agent);
    } catch {
      /* history must never break live observation */
    }
    this.feed.push(entry);
    if (this.feed.length > this.feedLimit) this.feed.splice(0, this.feed.length - this.feedLimit);
    this.store.broadcast({ type: 'activityEvent', entry });
  }

  private markDirty(id: number): void {
    this.dirty.add(id);
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.flush();
    }, this.flushDelayMs);
    this.flushTimer.unref?.();
  }
}

// ── Registry: one tracker per store, so connection handlers can find it
//    without threading a new field through every upstream context type. ──

const trackers = new WeakMap<AgentStateStore, ObservationTracker>();

/** The tracker attached to a store, if any (sources report errors through it). */
export function getObservationTracker(store: AgentStateStore): ObservationTracker | undefined {
  return trackers.get(store);
}

export function attachObservationTracker(
  store: AgentStateStore,
  opts?: ObservationOptions,
): ObservationTracker {
  const existing = trackers.get(store);
  if (existing) return existing;
  const tracker = new ObservationTracker(store, opts);
  trackers.set(store, tracker);
  return tracker;
}

/** Sends the observation snapshot to one connecting client (no-op without a tracker). */
export function resendObservation(
  send: (message: Record<string, unknown>) => void,
  store: AgentStateStore,
): void {
  const tracker = trackers.get(store);
  if (!tracker) return;
  send({ type: 'observationSnapshot', ...tracker.snapshot() });
}
