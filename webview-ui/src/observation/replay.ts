import type { ActivityKind, HistoryEntry, ObservedStatus } from '../../../core/src/messages.js';

/**
 * Pure replay helpers. A replay walks recorded history entries in order; the
 * status shown at a point is what the latest entry up to that point implies.
 * Nothing here touches live state.
 */

const STATUS_AFTER: Partial<Record<ActivityKind, ObservedStatus>> = {
  joined: 'unknown',
  tool: 'working',
  subagentStart: 'working',
  subagentEnd: 'working',
  permission: 'waiting_permission',
  waitingInput: 'waiting_user',
  turnEnd: 'completed',
  error: 'error',
  disconnected: 'disconnected',
};

/** Status per agent id after applying entries[0..index]. 'left' removes the agent. */
export function statusAt(
  entries: readonly HistoryEntry[],
  index: number,
): Map<number, ObservedStatus> {
  const out = new Map<number, ObservedStatus>();
  for (let i = 0; i <= index && i < entries.length; i++) {
    const e = entries[i];
    if (e.kind === 'left') {
      out.delete(e.agentId);
      continue;
    }
    const s = STATUS_AFTER[e.kind];
    if (s) out.set(e.agentId, s);
  }
  return out;
}

/** Real gap to the next entry, scaled by speed and capped so idle stretches don't stall playback. */
export function delayToNext(
  entries: readonly HistoryEntry[],
  index: number,
  speed: number,
  maxDelayMs = 1500,
): number | null {
  if (index + 1 >= entries.length) return null;
  const gap = Math.max(0, entries[index + 1].ts - entries[index].ts);
  return Math.min(maxDelayMs, Math.max(60, gap / speed));
}

export const REPLAY_SPEEDS = [1, 4, 16, 64] as const;
