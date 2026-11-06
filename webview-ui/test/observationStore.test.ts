import { describe, expect, it } from 'vitest';

import type { AgentObservation } from '../../core/src/messages.js';
import {
  agentLabel,
  countStatuses,
  displayStatus,
  FEED_LIMIT,
  ObservationStore,
  providerName,
  sessionLabel,
} from '../src/observation/observationStore.js';

function obs(id: number, over: Partial<AgentObservation> = {}): AgentObservation {
  return {
    id,
    source: 'claude-code',
    sessionId: `s-${id}`,
    isExternal: true,
    channel: 'transcript',
    project: null,
    cwd: null,
    gitBranch: null,
    model: null,
    status: 'unknown',
    activity: null,
    currentAction: null,
    lastAction: null,
    firstSeenAt: 0,
    lastEventAt: null,
    subagents: [],
    contextTokens: null,
    maxContextTokens: null,
    teamName: null,
    agentName: null,
    isTeamLead: false,
    leadAgentId: null,
    sessionOrdinal: null,
    customName: null,
    task: null,
    statusDetail: null,
    ...over,
  };
}

describe('ObservationStore', () => {
  it('is unsynced until a snapshot arrives', () => {
    const s = new ObservationStore();
    expect(s.getState().synced).toBe(false);
    s.handle({ type: 'observationSnapshot', agents: [obs(1)], activity: [], capturedAt: 1 });
    expect(s.getState().synced).toBe(true);
    expect(s.getState().agents.get(1)?.id).toBe(1);
  });

  it('applies updates and removals', () => {
    const s = new ObservationStore();
    s.handle({ type: 'observationSnapshot', agents: [obs(1)], activity: [], capturedAt: 1 });
    s.handle({ type: 'agentObservation', agent: obs(1, { status: 'working' }) });
    expect(s.getState().agents.get(1)?.status).toBe('working');
    s.handle({ type: 'agentObservationRemoved', id: 1 });
    expect(s.getState().agents.size).toBe(0);
  });

  it('drops feed entries already covered by the snapshot', () => {
    const s = new ObservationStore();
    const entry = { seq: 5, ts: 1, agentId: 1, kind: 'tool' as const, text: 'Reading a.ts' };
    s.handle({ type: 'observationSnapshot', agents: [], activity: [entry], capturedAt: 1 });
    s.handle({ type: 'activityEvent', entry });
    s.handle({ type: 'activityEvent', entry: { ...entry, seq: 6 } });
    expect(s.getState().feed.map((e) => e.seq)).toEqual([5, 6]);
  });

  it('caps the feed', () => {
    const s = new ObservationStore();
    for (let i = 1; i <= FEED_LIMIT + 10; i++) {
      s.handle({
        type: 'activityEvent',
        entry: { seq: i, ts: i, agentId: 1, kind: 'tool', text: 'x' },
      });
    }
    expect(s.getState().feed).toHaveLength(FEED_LIMIT);
    expect(s.getState().feed[0].seq).toBe(11);
  });

  it('ignores unrelated messages and notifies subscribers only on change', () => {
    const s = new ObservationStore();
    let calls = 0;
    s.subscribe(() => calls++);
    expect(s.handle({ type: 'agentClosed', id: 1 })).toBe(false);
    expect(calls).toBe(0);
    s.handle({ type: 'agentObservation', agent: obs(2) });
    expect(calls).toBe(1);
  });
});

describe('countStatuses', () => {
  it('groups waiting kinds, completed with idle, and problems apart', () => {
    const c = countStatuses([
      obs(1, { status: 'working' }),
      obs(2, { status: 'waiting_permission' }),
      obs(3, { status: 'waiting_user' }),
      obs(4, { status: 'idle' }),
      obs(5, { status: 'completed' }),
      obs(6, { status: 'error' }),
      obs(7, { status: 'disconnected' }),
      obs(8),
    ]);
    expect(c).toEqual({ detected: 8, working: 1, waiting: 2, idle: 2, problem: 2, unknown: 1 });
  });

  it('treats every agent as disconnected while the server link is down', () => {
    const c = countStatuses([obs(1, { status: 'working' }), obs(2, { status: 'idle' })], false);
    expect(c).toMatchObject({ working: 0, idle: 0, problem: 2 });
    expect(displayStatus(obs(1, { status: 'working' }), false)).toBe('disconnected');
    expect(displayStatus(obs(1, { status: 'working' }), true)).toBe('working');
  });

  it('tracks the connection flag', () => {
    const s = new ObservationStore();
    expect(s.getState().connected).toBe(true);
    s.setConnected(false);
    expect(s.getState().connected).toBe(false);
  });
});

describe('agentLabel / sessionLabel', () => {
  it('never uses the project as the agent name', () => {
    expect(agentLabel(obs(3, { project: 'NEXORQ Bot', source: 'codex', sessionOrdinal: 2 }))).toBe(
      'Codex #2',
    );
    expect(agentLabel(obs(3, { project: 'app' }))).toBe('Agent #3');
  });

  it('prefers the user name, then a reported role, then the session label', () => {
    const base = { source: 'claude-code', sessionOrdinal: 1 };
    expect(agentLabel(obs(1, { ...base, customName: 'Builder', agentName: 'r' }))).toBe('Builder');
    expect(agentLabel(obs(1, { ...base, agentName: 'researcher' }))).toBe('researcher');
    expect(agentLabel(obs(1, base))).toBe('Claude #1');
    expect(sessionLabel(obs(1, { source: 'codex', sessionOrdinal: null }))).toBeNull();
    expect(providerName('codex')).toBe('Codex');
    expect(providerName('claude-code')).toBe('Claude Code');
  });
});
