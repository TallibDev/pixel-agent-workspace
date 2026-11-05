import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AgentObservation } from '../../core/src/messages.js';
import { createAgentState } from '../src/agentState.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { HistoryJournal } from '../src/observation/historyJournal.js';
import { attachObservation, handleObservationMessage } from '../src/observation/service.js';

const agent = (sessionId: string, project: string | null = 'app') =>
  ({ sessionId, source: 'claude-code', project }) as AgentObservation;

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paw-history-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('HistoryJournal', () => {
  it('records entries and lists sessions newest first', () => {
    const j = new HistoryJournal({ dir });
    const t0 = Date.parse('2026-11-05T10:00:00');
    j.record({ seq: 1, ts: t0, agentId: 1, kind: 'joined', text: 'Detected session' }, agent('a'));
    j.record({ seq: 2, ts: t0 + 1000, agentId: 1, kind: 'tool', text: 'Reading x.ts' }, agent('a'));
    j.record(
      { seq: 3, ts: t0 + 5000, agentId: 2, kind: 'tool', text: 'Running: ls' },
      agent('b', 'api'),
    );
    const sessions = j.listSessions(new Set(['b']));
    expect(sessions.map((s) => s.sessionId)).toEqual(['b', 'a']);
    expect(sessions[0]).toMatchObject({ project: 'api', events: 1, live: true });
    expect(sessions[1]).toMatchObject({ events: 2, live: false, firstTs: t0, lastTs: t0 + 1000 });
  });

  it('reads one session in time order', () => {
    const j = new HistoryJournal({ dir });
    const t0 = Date.parse('2026-11-05T10:00:00');
    j.record({ seq: 1, ts: t0 + 2000, agentId: 1, kind: 'tool', text: 'second' }, agent('a'));
    j.record({ seq: 2, ts: t0 + 1000, agentId: 1, kind: 'tool', text: 'first' }, agent('a'));
    j.record({ seq: 3, ts: t0, agentId: 2, kind: 'tool', text: 'other' }, agent('b'));
    const { entries, truncated } = j.readSession('a');
    expect(entries.map((e) => e.text)).toEqual(['first', 'second']);
    expect(truncated).toBe(false);
  });

  it('writes one file per day and survives a torn line', () => {
    const j = new HistoryJournal({ dir });
    j.record(
      { seq: 1, ts: Date.parse('2026-11-04T23:59:00'), agentId: 1, kind: 'tool', text: 'late' },
      agent('a'),
    );
    j.record(
      { seq: 2, ts: Date.parse('2026-11-05T00:01:00'), agentId: 1, kind: 'tool', text: 'early' },
      agent('a'),
    );
    j.flush();
    expect(fs.readdirSync(dir).sort()).toEqual(['2026-11-04.jsonl', '2026-11-05.jsonl']);
    fs.appendFileSync(path.join(dir, '2026-11-05.jsonl'), '{"v":1,"sessionId":"a","ts":');
    expect(j.readSession('a').entries.map((e) => e.text)).toEqual(['late', 'early']);
  });

  it('prunes days past retention on start', () => {
    fs.writeFileSync(path.join(dir, '2026-10-01.jsonl'), '');
    fs.writeFileSync(path.join(dir, '2026-11-04.jsonl'), '');
    new HistoryJournal({ dir, retentionDays: 14, now: () => Date.parse('2026-11-05T12:00:00') });
    expect(fs.readdirSync(dir)).toEqual(['2026-11-04.jsonl']);
  });
});

describe('observation service', () => {
  it('journals live feed entries and answers history requests', () => {
    const store = new AgentStateStore();
    const { tracker, history } = attachObservation(store, { history: { dir } });
    store.set(
      1,
      createAgentState({
        id: 1,
        sessionId: 'sess-1',
        projectDir: '/p',
        jsonlFile: '',
        isExternal: true,
      }),
    );
    store.broadcast({
      type: 'agentToolStart',
      id: 1,
      toolId: 't',
      toolName: 'Read',
      status: 'Reading a.ts',
    });
    store.delete(1);
    history!.flush();
    tracker.flush();

    const out: Array<Record<string, unknown>> = [];
    expect(
      handleObservationMessage({ type: 'requestHistorySessions' }, (m) => out.push(m), store),
    ).toBe(true);
    expect(out[0]).toMatchObject({ type: 'historySessions' });
    const sessions = out[0].sessions as Array<{ sessionId: string; events: number; live: boolean }>;
    expect(sessions).toEqual([
      expect.objectContaining({ sessionId: 'sess-1', events: 3, live: false }),
    ]);

    handleObservationMessage(
      { type: 'requestSessionHistory', sessionId: 'sess-1' },
      (m) => out.push(m),
      store,
    );
    const entries = out[1].entries as Array<{ kind: string }>;
    expect(entries.map((e) => e.kind)).toEqual(['joined', 'tool', 'left']);
  });

  it('ignores unrelated messages', () => {
    const store = new AgentStateStore();
    attachObservation(store, { history: false });
    expect(handleObservationMessage({ type: 'saveLayout' }, () => {}, store)).toBe(false);
  });
});
