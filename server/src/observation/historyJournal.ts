import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type {
  ActivityEntry,
  AgentObservation,
  HistoryEntry,
  HistorySession,
} from '../../../core/src/messages.js';

/**
 * Append-only observation history: one JSONL file per local day under
 * `~/.pixel-agent-workspace/history/`. Each row is self-contained (session,
 * source, project) so files can be pruned independently. Text is already
 * secret-masked by the tracker before it reaches here.
 */

export interface HistoryOptions {
  dir?: string;
  retentionDays?: number;
  maxTotalBytes?: number;
  flushDelayMs?: number;
  now?: () => number;
}

interface Row extends HistoryEntry {
  v: 1;
}

export const MAX_SESSION_ENTRIES = 5000;

export function defaultHistoryDir(): string {
  return path.join(os.homedir(), '.pixel-agent-workspace', 'history');
}

export class HistoryJournal {
  readonly dir: string;
  private readonly retentionDays: number;
  private readonly maxTotalBytes: number;
  private readonly flushDelayMs: number;
  private readonly now: () => number;
  private pending: string[] = [];
  private pendingFile: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disabled = false;

  constructor(opts: HistoryOptions = {}) {
    this.dir = opts.dir ?? defaultHistoryDir();
    this.retentionDays = opts.retentionDays ?? 14;
    this.maxTotalBytes = opts.maxTotalBytes ?? 50 * 1024 * 1024;
    this.flushDelayMs = opts.flushDelayMs ?? 500;
    this.now = opts.now ?? Date.now;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      this.prune();
    } catch (err) {
      this.disabled = true;
      console.warn('[Pixel Agent Workspace] History disabled:', (err as Error).message);
    }
  }

  get enabled(): boolean {
    return !this.disabled;
  }

  record(entry: ActivityEntry, agent: AgentObservation | undefined): void {
    if (this.disabled) return;
    const row: Row = {
      v: 1,
      ts: entry.ts,
      kind: entry.kind,
      text: entry.text,
      agentId: entry.agentId,
      sessionId: agent?.sessionId ?? `agent-${entry.agentId}`,
      source: agent?.source ?? 'unknown',
      project: agent?.project ?? null,
    };
    const file = this.fileFor(entry.ts);
    if (this.pendingFile && this.pendingFile !== file) this.flush();
    this.pendingFile = file;
    this.pending.push(JSON.stringify(row));
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.flushDelayMs);
      this.timer.unref?.();
    }
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (!this.pendingFile || this.pending.length === 0) return;
    const data = this.pending.join('\n') + '\n';
    const file = this.pendingFile;
    this.pending = [];
    try {
      fs.appendFileSync(file, data, { encoding: 'utf8', mode: 0o600 });
    } catch (err) {
      console.warn('[Pixel Agent Workspace] Could not write history:', (err as Error).message);
    }
  }

  /** Sessions seen in the retained history, newest activity first. */
  listSessions(liveSessionIds: ReadonlySet<string>, limit = 100): HistorySession[] {
    this.flush();
    const byId = new Map<string, HistorySession>();
    for (const row of this.readAll()) {
      let s = byId.get(row.sessionId);
      if (!s) {
        s = {
          sessionId: row.sessionId,
          source: row.source,
          project: row.project,
          firstTs: row.ts,
          lastTs: row.ts,
          events: 0,
          live: liveSessionIds.has(row.sessionId),
        };
        byId.set(row.sessionId, s);
      }
      s.events++;
      if (row.ts < s.firstTs) s.firstTs = row.ts;
      if (row.ts > s.lastTs) s.lastTs = row.ts;
      if (row.project) s.project = row.project;
    }
    return [...byId.values()].sort((a, b) => b.lastTs - a.lastTs).slice(0, limit);
  }

  /** All retained events of one session, oldest first (capped). */
  readSession(sessionId: string): { entries: HistoryEntry[]; truncated: boolean } {
    this.flush();
    const entries: HistoryEntry[] = [];
    for (const row of this.readAll()) {
      if (row.sessionId !== sessionId) continue;
      const { v: _v, ...entry } = row;
      entries.push(entry);
    }
    entries.sort((a, b) => a.ts - b.ts);
    const truncated = entries.length > MAX_SESSION_ENTRIES;
    return { entries: truncated ? entries.slice(-MAX_SESSION_ENTRIES) : entries, truncated };
  }

  dispose(): void {
    this.flush();
  }

  // ── Internals ────────────────────────────────────────────────

  private fileFor(ts: number): string {
    const d = new Date(ts);
    const name = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.jsonl`;
    return path.join(this.dir, name);
  }

  private files(): string[] {
    try {
      return fs
        .readdirSync(this.dir)
        .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
        .sort()
        .map((f) => path.join(this.dir, f));
    } catch {
      return [];
    }
  }

  private *readAll(): Generator<Row> {
    for (const file of this.files()) {
      let text: string;
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      for (const line of text.split('\n')) {
        if (!line) continue;
        try {
          const row = JSON.parse(line) as Row;
          if (row && row.v === 1 && typeof row.sessionId === 'string') yield row;
        } catch {
          /* a torn last line after a crash is skipped */
        }
      }
    }
  }

  private prune(): void {
    const cutoff = this.now() - this.retentionDays * 24 * 60 * 60 * 1000;
    const files = this.files();
    let total = 0;
    const sizes: Array<[string, number]> = [];
    for (const file of files) {
      const day = Date.parse(path.basename(file, '.jsonl') + 'T23:59:59');
      if (Number.isFinite(day) && day < cutoff) {
        fs.rmSync(file, { force: true });
        continue;
      }
      const size = fs.statSync(file).size;
      sizes.push([file, size]);
      total += size;
    }
    // Over the size budget: drop the oldest days first.
    for (const [file, size] of sizes) {
      if (total <= this.maxTotalBytes) break;
      fs.rmSync(file, { force: true });
      total -= size;
    }
  }
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
