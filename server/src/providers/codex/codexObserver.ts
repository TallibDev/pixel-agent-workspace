/**
 * Observes OpenAI Codex sessions (CLI and Desktop) by reading their rollout
 * files under ~/.codex/sessions. Read-only: nothing under ~/.codex is written,
 * no hooks are installed, Codex's `notify` setting is left alone.
 *
 * Each live rollout becomes an office agent (providerId 'codex') in the shared
 * AgentStateStore, driven by the same messages the Claude runtime broadcasts
 * (agentToolStart / agentToolDone / agentStatus / agentContextUsage), so the
 * office, the observation model, the feed and the history all work unchanged.
 *
 * Limitations (documented in docs/CODEX.md):
 * - No approval/permission signal in rollouts → "needs permission" is never shown for Codex.
 * - No session-end record → an agent leaves after CODEX_IDLE_LEAVE_MS without writes.
 * - Guardian (approval-review) sub-sessions are internal to Codex and not shown.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { createAgentState } from '../../agentState.js';
import type { AgentStateStore } from '../../agentStateStore.js';
import { assignPaletteIfNeeded } from '../../paletteAssigner.js';
import type { AgentState } from '../../types.js';
import { type CodexEvent, parseRolloutLine } from './rolloutParser.js';

export const CODEX_PROVIDER_ID = 'codex';
/** Adopt rollouts written to within this window at startup / discovery. */
export const CODEX_ACTIVE_WINDOW_MS = 10 * 60 * 1000;
/** Remove an agent whose rollout has been silent this long. */
export const CODEX_IDLE_LEAVE_MS = 30 * 60 * 1000;
export const CODEX_POLL_MS = 1000;
/** Resumed sessions keep writing into the folder of the day they began. */
export const CODEX_LOOKBACK_DAYS = 14;
/** Discovery (directory listing) runs every N polls; known files are read every poll. */
const DISCOVERY_EVERY = 3;
/** Tail read on adoption to rebuild the current state of a running session. */
const ADOPT_TAIL_BYTES = 512 * 1024;
/** Sub-agent kinds that are Codex internals, not work the user delegated. */
const HIDDEN_SUBAGENT_KINDS = new Set(['guardian']);

export interface CodexObserverOptions {
  sessionsRoot?: string;
  now?: () => number;
  pollMs?: number;
  /** Directory discovery every N polls (default 3). */
  discoveryEvery?: number;
}

interface Tracked {
  file: string;
  offset: number;
  buffer: string;
  agentId: number | null;
  threadId: string | null;
  parentThreadId: string | null;
  hidden: boolean;
  lastWriteAt: number;
  openTools: Map<string, string>;
  active: boolean;
}

export function defaultCodexSessionsRoot(): string {
  return path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'sessions');
}

export class CodexObserver {
  private readonly root: string;
  private readonly now: () => number;
  private readonly pollMs: number;
  private readonly files = new Map<string, Tracked>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticks = 0;
  private readonly discoveryEvery: number;

  constructor(
    private readonly store: AgentStateStore,
    opts: CodexObserverOptions = {},
  ) {
    this.root = opts.sessionsRoot ?? defaultCodexSessionsRoot();
    this.now = opts.now ?? Date.now;
    this.pollMs = opts.pollMs ?? CODEX_POLL_MS;
    this.discoveryEvery = Math.max(1, opts.discoveryEvery ?? DISCOVERY_EVERY);
  }

  get available(): boolean {
    return fs.existsSync(this.root);
  }

  start(): void {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), this.pollMs);
    this.timer.unref?.();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One scan: discover rollouts, read appended lines, retire silent sessions. */
  tick(): void {
    const now = this.now();
    if (this.ticks++ % this.discoveryEvery === 0) {
      for (const file of this.recentRollouts(now)) {
        if (!this.files.has(file)) this.adopt(file);
      }
    }
    for (const t of this.files.values()) this.readNew(t);
    for (const [file, t] of this.files) {
      if (now - t.lastWriteAt > CODEX_IDLE_LEAVE_MS) {
        if (t.agentId !== null) this.store.delete(t.agentId);
        this.files.delete(file);
      }
    }
  }

  // ── Discovery ────────────────────────────────────────────────

  /** Rollouts in the last CODEX_LOOKBACK_DAYS day folders (local and UTC) touched recently. */
  private recentRollouts(now: number): string[] {
    const days = new Set<string>();
    for (let offset = 0; offset > -CODEX_LOOKBACK_DAYS; offset--) {
      const d = new Date(now + offset * 86_400_000);
      days.add(path.join(this.root, `${d.getFullYear()}`, pad(d.getMonth() + 1), pad(d.getDate())));
      days.add(
        path.join(
          this.root,
          `${d.getUTCFullYear()}`,
          pad(d.getUTCMonth() + 1),
          pad(d.getUTCDate()),
        ),
      );
    }
    const out: string[] = [];
    for (const dir of days) {
      let names: string[];
      try {
        names = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!name.startsWith('rollout-') || !name.endsWith('.jsonl')) continue;
        const file = path.join(dir, name);
        if (this.files.has(file)) continue;
        try {
          if (now - fs.statSync(file).mtimeMs <= CODEX_ACTIVE_WINDOW_MS) out.push(file);
        } catch {
          /* raced with deletion */
        }
      }
    }
    return out;
  }

  private adopt(file: string): void {
    let size: number;
    let mtime: number;
    try {
      const st = fs.statSync(file);
      size = st.size;
      mtime = st.mtimeMs;
    } catch {
      return;
    }
    const t: Tracked = {
      file,
      offset: size,
      buffer: '',
      agentId: null,
      threadId: null,
      parentThreadId: null,
      hidden: false,
      lastWriteAt: mtime,
      openTools: new Map(),
      active: false,
    };
    this.files.set(file, t);
    // Identity comes from the first record; the current state from the tail.
    const head = readRange(file, 0, Math.min(size, 64 * 1024));
    const firstLine = head?.split('\n')[0] ?? '';
    for (const ev of parseRolloutLine(firstLine)) this.applyQuiet(t, ev);
    if (t.hidden || t.threadId === null) return;
    this.ensureAgent(t);
    const tailStart = Math.max(0, size - ADOPT_TAIL_BYTES);
    const tail = readRange(file, tailStart, size - tailStart) ?? '';
    const lines = tail.split('\n');
    if (tailStart > 0) lines.shift();
    if (!tail.endsWith('\n')) lines.pop();
    const replay: CodexEvent[] = lines.flatMap((l) => parseRolloutLine(l));
    this.replayState(t, replay);
  }

  /** Rebuild the present from history without flooding the feed with old tools. */
  private replayState(t: Tracked, events: CodexEvent[]): void {
    let active = false;
    const open = new Map<string, { toolName: string; status: string }>();
    let tokens: { contextTokens: number; window: number | null } | null = null;
    for (const ev of events) {
      if (ev.kind === 'meta' || ev.kind === 'model') continue;
      if (ev.kind === 'turnStart') {
        active = true;
        open.clear();
      } else if (ev.kind === 'turnEnd') {
        active = false;
        open.clear();
      } else if (ev.kind === 'toolStart') open.set(ev.callId, ev);
      else if (ev.kind === 'toolEnd') open.delete(ev.callId);
      else if (ev.kind === 'tokens') tokens = ev;
    }
    if (tokens) this.apply(t, { kind: 'tokens', ...tokens });
    if (active) {
      this.apply(t, { kind: 'turnStart' });
      for (const [callId, tool] of open) this.apply(t, { kind: 'toolStart', callId, ...tool });
    } else if (events.some((e) => e.kind === 'turnEnd')) {
      this.apply(t, { kind: 'turnEnd', aborted: false });
    }
  }

  // ── Reading ──────────────────────────────────────────────────

  private readNew(t: Tracked): void {
    let st: fs.Stats;
    try {
      st = fs.statSync(t.file);
    } catch {
      return;
    }
    if (st.size < t.offset) {
      // Rewritten (compaction/migration): start over from the new end.
      t.offset = st.size;
      t.buffer = '';
      return;
    }
    if (st.size === t.offset) return;
    const chunk = readRange(t.file, t.offset, st.size - t.offset);
    if (chunk === null) return;
    t.offset = st.size;
    t.lastWriteAt = this.now();
    const text = t.buffer + chunk;
    const lines = text.split('\n');
    t.buffer = lines.pop() ?? '';
    for (const line of lines) for (const ev of parseRolloutLine(line)) this.apply(t, ev);
  }

  // ── Store mutations ──────────────────────────────────────────

  /** Identity-only application used before the agent exists. */
  private applyQuiet(t: Tracked, ev: CodexEvent): void {
    if (ev.kind !== 'meta') return;
    t.threadId = ev.threadId;
    t.parentThreadId = ev.parentThreadId;
    t.hidden = ev.subagentKind !== null && HIDDEN_SUBAGENT_KINDS.has(ev.subagentKind);
    (t as Tracked & { meta?: CodexEvent }).meta = ev;
  }

  private ensureAgent(t: Tracked): AgentState | null {
    if (t.agentId !== null) return this.store.get(t.agentId) ?? null;
    if (t.hidden || !t.threadId) return null;
    const meta = (t as Tracked & { meta?: Extract<CodexEvent, { kind: 'meta' }> }).meta;
    const id = this.store.nextAgentId.current++;
    const cwd = meta?.cwd ?? '';
    const agent = createAgentState({
      id,
      sessionId: t.threadId,
      isExternal: true,
      projectDir: cwd,
      jsonlFile: t.file,
      providerId: CODEX_PROVIDER_ID,
      hookDelivered: false,
      lastDataAt: this.now(),
      directoryName: cwd ? path.basename(cwd) : undefined,
    });
    // A delegated Codex sub-agent sits as a teammate of the session that spawned it.
    const lead = t.parentThreadId ? this.findAgentByThread(t.parentThreadId) : null;
    if (lead && meta?.subagentKind) {
      agent.leadAgentId = lead.id;
      agent.agentName = meta.nickname ?? undefined;
      lead.isTeamLead = true;
    }
    assignPaletteIfNeeded(agent, this.store);
    this.store.set(id, agent);
    t.agentId = id;
    if (lead && agent.leadAgentId !== undefined) {
      this.store.broadcast({ type: 'agentTeamInfo', id: lead.id, isTeamLead: true });
      this.store.broadcast({
        type: 'agentTeamInfo',
        id,
        agentName: agent.agentName,
        leadAgentId: lead.id,
      });
    }
    return agent;
  }

  private findAgentByThread(threadId: string): AgentState | null {
    for (const t of this.files.values()) {
      if (t.threadId === threadId && t.agentId !== null) return this.store.get(t.agentId) ?? null;
    }
    return null;
  }

  private apply(t: Tracked, ev: CodexEvent): void {
    if (ev.kind === 'meta') {
      this.applyQuiet(t, ev);
      return;
    }
    const agent = this.ensureAgent(t);
    if (!agent) return;
    agent.lastDataAt = this.now();
    const id = agent.id;
    switch (ev.kind) {
      case 'model':
        return; // the observation model reads the model from the rollout itself
      case 'turnStart':
        t.active = true;
        agent.isWaiting = false;
        this.store.broadcast({ type: 'agentStatus', id, status: 'active' });
        return;
      case 'toolStart':
        if (!t.active) {
          t.active = true;
          this.store.broadcast({ type: 'agentStatus', id, status: 'active' });
        }
        t.openTools.set(ev.callId, ev.toolName);
        agent.activeToolIds.add(ev.callId);
        agent.activeToolStatuses.set(ev.callId, ev.status);
        agent.activeToolNames.set(ev.callId, ev.toolName);
        this.store.broadcast({
          type: 'agentToolStart',
          id,
          toolId: ev.callId,
          status: ev.status,
          toolName: ev.toolName,
        });
        return;
      case 'toolEnd':
        if (!t.openTools.delete(ev.callId)) return;
        agent.activeToolIds.delete(ev.callId);
        agent.activeToolStatuses.delete(ev.callId);
        agent.activeToolNames.delete(ev.callId);
        this.store.broadcast({ type: 'agentToolDone', id, toolId: ev.callId });
        return;
      case 'turnEnd':
        t.active = false;
        t.openTools.clear();
        agent.activeToolIds.clear();
        agent.activeToolStatuses.clear();
        agent.activeToolNames.clear();
        agent.isWaiting = true;
        this.store.broadcast({ type: 'agentToolsClear', id });
        this.store.broadcast({ type: 'agentStatus', id, status: 'waiting' });
        return;
      case 'tokens':
        agent.contextTokens = ev.contextTokens;
        if (ev.window) agent.maxContextTokens = ev.window;
        this.store.broadcast({
          type: 'agentContextUsage',
          id,
          contextTokens: ev.contextTokens,
          maxContextTokens: agent.maxContextTokens,
        });
        return;
    }
  }
}

function readRange(file: string, start: number, length: number): string | null {
  if (length <= 0) return '';
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(length);
      const read = fs.readSync(fd, buf, 0, length, start);
      return buf.subarray(0, read).toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
