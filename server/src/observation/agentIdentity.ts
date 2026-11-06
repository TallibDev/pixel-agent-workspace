import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Stable, user-facing identity for agent sessions, kept apart from technical
 * ids: a per-provider ordinal ("Codex #1", "Claude #2") assigned the first
 * time a session is seen, and an optional user-chosen name. Keyed by
 * provider + session id, so renaming never touches session ids, agent ids or
 * history, and a reconnected session keeps its number and name.
 *
 * Stored in ~/.pixel-agent-workspace/agents.json (atomic tmp + rename).
 */

export interface SessionIdentity {
  ordinal: number;
  customName: string | null;
}

interface IdentityFile {
  version: 1;
  nextOrdinal: Record<string, number>;
  sessions: Record<string, { ordinal: number; customName?: string; seenAt: number }>;
}

export const MAX_NAME_LENGTH = 40;
const MAX_SESSIONS = 5000;

export function defaultIdentityFile(): string {
  return path.join(os.homedir(), '.pixel-agent-workspace', 'agents.json');
}

/** Trim, drop control characters, cap length. Empty → null (back to the default name). */
export function sanitizeAgentName(name: unknown): string | null {
  if (typeof name !== 'string') return null;

  const clean = name
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return null;
  return [...clean].slice(0, MAX_NAME_LENGTH).join('');
}

export class AgentIdentityStore {
  private data: IdentityFile;
  private readonly file: string | null;
  private readonly now: () => number;

  constructor(opts: { file?: string | null; now?: () => number } = {}) {
    this.file = opts.file === undefined ? defaultIdentityFile() : opts.file;
    this.now = opts.now ?? Date.now;
    this.data = this.load();
  }

  /** Identity for a session, assigning the next ordinal on first sight. */
  get(provider: string, sessionId: string): SessionIdentity {
    const key = `${provider}:${sessionId}`;
    let entry = this.data.sessions[key];
    if (!entry) {
      const ordinal = this.data.nextOrdinal[provider] ?? 1;
      this.data.nextOrdinal[provider] = ordinal + 1;
      entry = { ordinal, seenAt: this.now() };
      this.data.sessions[key] = entry;
      this.prune();
      this.save();
    }
    return { ordinal: entry.ordinal, customName: entry.customName ?? null };
  }

  /** Look up without assigning (history of sessions that may predate the store). */
  peek(provider: string, sessionId: string): SessionIdentity | null {
    const entry = this.data.sessions[`${provider}:${sessionId}`];
    return entry ? { ordinal: entry.ordinal, customName: entry.customName ?? null } : null;
  }

  /** Set or clear (null/empty) the user's name for a session. */
  rename(provider: string, sessionId: string, name: unknown): SessionIdentity {
    this.get(provider, sessionId);
    const entry = this.data.sessions[`${provider}:${sessionId}`];
    const clean = sanitizeAgentName(name);
    if (clean) entry.customName = clean;
    else delete entry.customName;
    this.save();
    return { ordinal: entry.ordinal, customName: entry.customName ?? null };
  }

  private load(): IdentityFile {
    const empty: IdentityFile = { version: 1, nextOrdinal: {}, sessions: {} };
    if (!this.file) return empty;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<IdentityFile>;
      if (parsed && parsed.version === 1 && parsed.sessions && parsed.nextOrdinal) {
        return { version: 1, nextOrdinal: parsed.nextOrdinal, sessions: parsed.sessions };
      }
    } catch {
      /* missing or unreadable: start fresh, never throw */
    }
    return empty;
  }

  private save(): void {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.warn('[Pixel Agent Workspace] Could not save agent names:', (err as Error).message);
    }
  }

  /** Keep the file bounded: drop the oldest unnamed sessions first. */
  private prune(): void {
    const keys = Object.keys(this.data.sessions);
    if (keys.length <= MAX_SESSIONS) return;
    const removable = keys
      .filter((k) => !this.data.sessions[k].customName)
      .sort((a, b) => this.data.sessions[a].seenAt - this.data.sessions[b].seenAt);
    for (const k of removable.slice(0, keys.length - MAX_SESSIONS)) delete this.data.sessions[k];
  }
}
