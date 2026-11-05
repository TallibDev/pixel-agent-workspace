import * as path from 'node:path';

import type { ActivityEntry, ActivityKind, AgentObservation } from '../../../core/src/messages.js';
import type { AgentStateStore } from '../agentStateStore.js';
import type { AgentState } from '../types.js';
import { classifyTool } from './classify.js';
import { maskSecrets } from './maskSecrets.js';
import { readTranscriptMeta, type TranscriptMeta } from './transcriptMeta.js';

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

  constructor(
    private readonly store: AgentStateStore,
    opts: ObservationOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.flushDelayMs = opts.flushDelayMs ?? 120;
    this.feedLimit = opts.feedLimit ?? 300;
    this.readMeta = opts.readMeta ?? readTranscriptMeta;
    this.onRecord = opts.onRecord;

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
    this.agents.set(id, {
      obs: {
        id,
        source:
          agent.providerId === undefined || agent.providerId === 'claude'
            ? 'claude-code'
            : agent.providerId,
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
      },
      tools: new Map(),
      subagents: new Map(),
      permission: false,
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
        o.status =
          name === 'AskUserQuestion'
            ? 'waiting_user'
            : a.permission
              ? 'waiting_permission'
              : 'working';
        o.lastEventAt = now;
        if (msg.permissionActive === true) {
          a.permission = true;
          o.status = 'waiting_permission';
        }
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
        o.status = 'waiting_permission';
        o.lastEventAt = now;
        this.record(id, 'permission', 'Needs your permission');
        break;
      case 'agentToolPermissionClear':
        a.permission = false;
        if (o.status === 'waiting_permission') o.status = 'working';
        o.lastEventAt = now;
        break;
      case 'agentStatus': {
        if (msg.status === 'active') {
          if (!a.permission) o.status = 'working';
        } else if (msg.status === 'waiting') {
          a.permission = false;
          a.tools.clear();
          const awaiting = msg.awaitingInput === true;
          o.status = awaiting ? 'waiting_user' : 'idle';
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
