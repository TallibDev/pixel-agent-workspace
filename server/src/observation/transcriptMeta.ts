import * as fs from 'node:fs';

export interface TranscriptMeta {
  cwd: string | null;
  gitBranch: string | null;
  model: string | null;
  /** The user's latest request, raw (callers summarize and mask it). */
  task?: string | null;
}

const CHUNK_BYTES = 256 * 1024;

/**
 * Reads facts the transcript itself states (working directory, git branch,
 * model) from a Claude Code JSONL transcript. The newest values win: the tail
 * of the file is read first (branch and model change during a session), the
 * head fills whatever the tail did not mention. Never throws; any field it
 * cannot find stays null so the UI shows "Unknown".
 */
export function readTranscriptMeta(file: string | undefined): TranscriptMeta {
  const meta: TranscriptMeta = { cwd: null, gitBranch: null, model: null, task: null };
  if (!file) return meta;
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return meta;
  }
  const tailStart = Math.max(0, size - CHUNK_BYTES);
  const tail = readRange(file, tailStart, size - tailStart);
  if (tail !== null) {
    const lines = tail.split('\n');
    if (tailStart > 0) lines.shift(); // first line may start mid-record
    apply(meta, lines.reverse());
  }
  // The project is where the session STARTED. Claude stamps every record with
  // the shell's current directory, so the newest cwd follows every `cd` the
  // agent makes (webview-ui/src, server, …) — never use it as the project.
  const head = tailStart > 0 ? readRange(file, 0, Math.min(CHUNK_BYTES, size)) : tail;
  if (head !== null) {
    const lines = head.split('\n');
    if (tailStart > 0) lines.pop(); // last line may be cut by the byte limit
    const first: TranscriptMeta = { cwd: null, gitBranch: 'x', model: 'x', task: 'x' };
    apply(first, lines);
    if (first.cwd) meta.cwd = first.cwd;
    if ((!meta.gitBranch || !meta.model) && tailStart > 0) {
      // The head holds the session's FIRST request; never report it as the current task.
      const latestTask = meta.task;
      apply(meta, lines);
      meta.task = latestTask;
    }
  }
  return meta;
}

function readRange(file: string, start: number, length: number): string | null {
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

/** Fills still-null fields from records, in the order given. */
function apply(meta: TranscriptMeta, lines: string[]): void {
  for (const line of lines) {
    if (meta.cwd && meta.gitBranch && meta.model && meta.task) return;
    if (!line.trim()) continue;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (rec.isSidechain === true) continue;
    // Latest user request: Claude's last-prompt record, Codex's UserMessage item.
    if (!meta.task) {
      if (rec.type === 'last-prompt' && typeof rec.lastPrompt === 'string') {
        meta.task = rec.lastPrompt;
      } else if (rec.type === 'event_msg') {
        const ev = (rec.payload ?? {}) as Record<string, unknown>;
        const item = (ev.item ?? {}) as Record<string, unknown>;
        if (
          ev.type === 'item_completed' &&
          item.type === 'UserMessage' &&
          Array.isArray(item.content)
        ) {
          const text = (item.content as Array<Record<string, unknown>>)
            .map((c) => (typeof c.text === 'string' ? c.text : ''))
            .join('\n')
            .trim();
          if (text) meta.task = text;
        }
      }
    }
    // Codex rollouts: facts live in the payload of session_meta / turn_context.
    if (rec.type === 'session_meta' || rec.type === 'turn_context') {
      const p = (rec.payload ?? {}) as Record<string, unknown>;
      if (!meta.cwd && typeof p.cwd === 'string' && p.cwd) meta.cwd = p.cwd;
      const git = (p.git ?? {}) as Record<string, unknown>;
      if (!meta.gitBranch && typeof git.branch === 'string' && git.branch)
        meta.gitBranch = git.branch;
      if (!meta.model && typeof p.model === 'string' && p.model) meta.model = p.model;
      continue;
    }
    if (!meta.cwd && typeof rec.cwd === 'string' && rec.cwd) meta.cwd = rec.cwd;
    if (!meta.gitBranch && typeof rec.gitBranch === 'string' && rec.gitBranch) {
      meta.gitBranch = rec.gitBranch;
    }
    if (!meta.model && rec.type === 'assistant') {
      const msg = rec.message as Record<string, unknown> | undefined;
      if (msg && typeof msg.model === 'string' && msg.model && msg.model !== '<synthetic>') {
        meta.model = msg.model;
      }
    }
  }
}

// ── Latest user request, tracked incrementally ───────────────────

/** Records that can carry the user's request. Lines without these are never parsed. */
const TASK_MARKERS = ['"last-prompt"', '"UserMessage"'];
/** First look at a session already in progress: at most this many bytes back. */
export const TASK_FIRST_SCAN_BYTES = 32 * 1024 * 1024;
const TASK_READ_CHUNK = 1024 * 1024;
const TASK_CACHE_LIMIT = 500;

/**
 * Keeps the latest user request per transcript without rereading the file:
 * each call reads only bytes appended since the previous call (every byte is
 * read once in the life of a session), skips lines that cannot be a request
 * with a cheap substring test, and parses JSON only for candidate lines. A
 * request far behind a long turn's tool output is still found, at the cost of
 * one bounded first scan (TASK_FIRST_SCAN_BYTES) when a session is adopted.
 */
export class TaskTracker {
  private readonly cache = new Map<string, { scanned: number; task: string | null }>();

  latest(file: string | undefined): string | null {
    if (!file) return null;
    let size: number;
    try {
      size = fs.statSync(file).size;
    } catch {
      return this.cache.get(file)?.task ?? null;
    }
    let entry = this.cache.get(file);
    if (!entry || size < entry.scanned) {
      // New to us, or rewritten: start from a bounded window before the end.
      entry = { scanned: Math.max(0, size - TASK_FIRST_SCAN_BYTES), task: null };
      this.cache.delete(file);
      this.cache.set(file, entry);
      if (this.cache.size > TASK_CACHE_LIMIT) {
        this.cache.delete(this.cache.keys().next().value as string);
      }
    }
    const startedMidFile = entry.scanned > 0 && !this.lineStartsAt(file, entry.scanned);
    let pos = entry.scanned;
    let carry = '';
    let skipFirst = startedMidFile;
    while (pos < size) {
      const len = Math.min(TASK_READ_CHUNK, size - pos);
      const chunk = readRange(file, pos, len);
      if (chunk === null) break;
      pos += len;
      const lines = (carry + chunk).split('\n');
      carry = lines.pop() ?? '';
      if (skipFirst) {
        lines.shift();
        skipFirst = false;
      }
      for (const line of lines) {
        if (!TASK_MARKERS.some((m) => line.includes(m))) continue;
        const probe: TranscriptMeta = { cwd: 'x', gitBranch: 'x', model: 'x', task: null };
        apply(probe, [line]);
        if (probe.task) entry.task = probe.task;
      }
    }
    // Stop before an unterminated last line; it is read again once complete.
    entry.scanned = pos - Buffer.byteLength(carry, 'utf8');
    return entry.task;
  }

  private lineStartsAt(file: string, offset: number): boolean {
    return readRange(file, offset - 1, 1) === '\n';
  }
}
