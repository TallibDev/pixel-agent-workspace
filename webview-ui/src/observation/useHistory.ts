import { useCallback, useEffect, useState } from 'react';

import type { HistoryEntry, HistorySession } from '../../../core/src/messages.js';
import { transport } from '../transport/index.js';

export interface SessionRecording {
  sessionId: string;
  entries: HistoryEntry[];
  truncated: boolean;
}

export type HistoryState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; sessions: HistorySession[] };

/** Requests the session list while `open`, and recordings on demand. */
export function useHistory(open: boolean, readOnly: boolean) {
  const [state, setState] = useState<HistoryState>({ kind: 'idle' });
  const [recording, setRecording] = useState<SessionRecording | null>(null);
  const [pendingSession, setPendingSession] = useState<string | null>(null);

  useEffect(() => {
    return transport.onMessage((msg) => {
      if (msg.type === 'historySessions') setState({ kind: 'ready', sessions: msg.sessions });
      else if (msg.type === 'historyUnavailable') setState({ kind: 'unavailable' });
      else if (msg.type === 'sessionHistory') {
        setPendingSession((p) => (p === msg.sessionId ? null : p));
        setRecording({ sessionId: msg.sessionId, entries: msg.entries, truncated: msg.truncated });
      }
    });
  }, []);

  useEffect(() => {
    if (!open || readOnly) return;
    setState((s) => (s.kind === 'ready' ? s : { kind: 'loading' }));
    transport.send({ type: 'requestHistorySessions' });
  }, [open, readOnly]);

  const loadSession = useCallback(
    (sessionId: string) => {
      if (readOnly) return;
      setPendingSession(sessionId);
      transport.send({ type: 'requestSessionHistory', sessionId });
    },
    [readOnly],
  );

  const closeRecording = useCallback(() => setRecording(null), []);

  return { state, recording, pendingSession, loadSession, closeRecording };
}
