import * as fs from 'node:fs';

export interface TranscriptMeta {
  cwd: string | null;
  gitBranch: string | null;
  model: string | null;
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
  const meta: TranscriptMeta = { cwd: null, gitBranch: null, model: null };
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
  if ((!meta.cwd || !meta.gitBranch || !meta.model) && tailStart > 0) {
    const head = readRange(file, 0, Math.min(CHUNK_BYTES, size));
    if (head !== null) {
      const lines = head.split('\n');
      lines.pop(); // last line may be cut by the byte limit
      apply(meta, lines);
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
    if (meta.cwd && meta.gitBranch && meta.model) return;
    if (!line.trim()) continue;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (rec.isSidechain === true) continue;
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
