import * as fs from 'node:fs';

export interface TranscriptMeta {
  cwd: string | null;
  gitBranch: string | null;
  model: string | null;
  /** The user's latest request, raw (callers summarize and mask it). */
  task?: string | null;
}

const CHUNK_BYTES = 256 * 1024;
/** How far back to look for the latest user request when the tail has none. */
const TASK_SCAN_BYTES = 4 * 1024 * 1024;

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
  // The request that started a long turn can lie far behind the tail (tool
  // output piles up after it): look further back for the task only.
  if (!meta.task && tailStart > 0) {
    const deepStart = Math.max(0, size - TASK_SCAN_BYTES);
    const deep = readRange(file, deepStart, tailStart + 1024 - deepStart);
    if (deep !== null) {
      const lines = deep.split('\n');
      if (deepStart > 0) lines.shift();
      lines.pop();
      const probe: TranscriptMeta = { cwd: 'x', gitBranch: 'x', model: 'x', task: null };
      apply(probe, lines.reverse());
      meta.task = probe.task ?? null;
    }
  }
  if ((!meta.cwd || !meta.gitBranch || !meta.model) && tailStart > 0) {
    const head = readRange(file, 0, Math.min(CHUNK_BYTES, size));
    if (head !== null) {
      const lines = head.split('\n');
      lines.pop(); // last line may be cut by the byte limit
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
