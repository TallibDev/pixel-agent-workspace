import type { AgentStateStore } from '../agentStateStore.js';
import { AgentIdentityStore } from './agentIdentity.js';
import { HistoryJournal, type HistoryOptions } from './historyJournal.js';
import { attachObservationTracker, type ObservationTracker } from './observationTracker.js';

/**
 * Composition root for Pixel Agent Workspace's observation layer: the live
 * tracker plus the on-disk history journal it feeds. One per store.
 */
interface Observation {
  tracker: ObservationTracker;
  history: HistoryJournal | null;
  identity: AgentIdentityStore;
}

const services = new WeakMap<AgentStateStore, Observation>();

export function attachObservation(
  store: AgentStateStore,
  opts: { history?: boolean | HistoryOptions; identityFile?: string | null } = {},
): Observation {
  const existing = services.get(store);
  if (existing) return existing;
  const history =
    opts.history === false
      ? null
      : new HistoryJournal(typeof opts.history === 'object' ? opts.history : {});
  const identity = new AgentIdentityStore({ file: opts.identityFile });
  const tracker = attachObservationTracker(store, {
    onRecord: history ? (entry, agent) => history.record(entry, agent) : undefined,
    identity,
  });
  const service = { tracker, history, identity };
  services.set(store, service);
  return service;
}

export function disposeObservation(store: AgentStateStore): void {
  const s = services.get(store);
  if (!s) return;
  s.tracker.dispose();
  s.history?.dispose();
  services.delete(store);
}

type Send = (message: Record<string, unknown>) => void;

/**
 * Handles observation requests from a (privileged) client. Returns true when
 * the message was ours. History reads are read-only and never touch agents.
 */
export function handleObservationMessage(
  msg: Record<string, unknown>,
  send: Send,
  store: AgentStateStore,
): boolean {
  if (msg.type === 'renameAgent') {
    const s = services.get(store);
    if (s && typeof msg.id === 'number') s.tracker.rename(msg.id, msg.name);
    return true;
  }
  if (msg.type !== 'requestHistorySessions' && msg.type !== 'requestSessionHistory') return false;
  const s = services.get(store);
  if (!s?.history?.enabled) {
    send({ type: 'historyUnavailable', reason: 'disabled' });
    return true;
  }
  if (msg.type === 'requestHistorySessions') {
    send({
      type: 'historySessions',
      sessions: s.history.listSessions(s.tracker.liveSessionIds(), 100, (source, id) =>
        s.identity.peek(source, id),
      ),
    });
    return true;
  }
  const sessionId = typeof msg.sessionId === 'string' ? msg.sessionId : '';
  if (!sessionId) return true;
  const { entries, truncated } = s.history.readSession(sessionId);
  send({ type: 'sessionHistory', sessionId, entries, truncated });
  return true;
}
