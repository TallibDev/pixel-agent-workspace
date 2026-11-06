import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAgentState } from '../src/agentState.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { AgentIdentityStore, sanitizeAgentName } from '../src/observation/agentIdentity.js';
import { ObservationTracker, summarizeTask } from '../src/observation/observationTracker.js';
import { attachObservation, handleObservationMessage } from '../src/observation/service.js';
import { CodexObserver } from '../src/providers/codex/codexObserver.js';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paw-ident-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const agent = (id: number, sessionId: string, providerId?: string) =>
  createAgentState({
    id,
    sessionId,
    projectDir: '/p',
    jsonlFile: '',
    isExternal: true,
    providerId,
  });

describe('AgentIdentityStore', () => {
  it('numbers sessions per provider, stably', () => {
    const s = new AgentIdentityStore({ file: path.join(dir, 'agents.json') });
    expect(s.get('codex', 'a').ordinal).toBe(1);
    expect(s.get('codex', 'b').ordinal).toBe(2);
    expect(s.get('claude-code', 'x').ordinal).toBe(1);
    expect(s.get('codex', 'a').ordinal).toBe(1);
  });

  it('keeps names and ordinals across restarts', () => {
    const file = path.join(dir, 'agents.json');
    const a = new AgentIdentityStore({ file });
    a.get('codex', 'a');
    a.rename('codex', 'a', '  Builder  ');
    const b = new AgentIdentityStore({ file });
    expect(b.get('codex', 'a')).toEqual({ ordinal: 1, customName: 'Builder' });
    expect(b.get('codex', 'new').ordinal).toBe(2);
  });

  it('clears a name back to the default and survives a broken file', () => {
    const file = path.join(dir, 'agents.json');
    const a = new AgentIdentityStore({ file });
    a.rename('codex', 'a', 'Tester');
    expect(a.rename('codex', 'a', '').customName).toBeNull();
    fs.writeFileSync(file, '{not json');
    expect(new AgentIdentityStore({ file }).get('codex', 'z').ordinal).toBe(1);
  });

  it('sanitizes names', () => {
    expect(sanitizeAgentName('  Re\u0007search   bot ')).toBe('Research bot');
    expect(sanitizeAgentName('x'.repeat(80))).toHaveLength(40);
    expect(sanitizeAgentName(42)).toBeNull();
  });
});

describe('tracker identity and statuses', () => {
  function setup() {
    const store = new AgentStateStore();
    let clock = 1_000;
    const identity = new AgentIdentityStore({ file: null });
    const tracker = new ObservationTracker(store, {
      now: () => clock,
      readMeta: () => ({ cwd: '/work/NEXORQ Bot', gitBranch: null, model: null, task: null }),
      identity,
      sweepMs: 0,
      completedHoldMs: 1000,
      staleMs: 5000,
    });
    return { store, tracker, tick: (ms: number) => (clock += ms) };
  }

  it('gives each session its own ordinal and never names it after the project', () => {
    const { store, tracker } = setup();
    store.set(1, agent(1, 's1', 'codex'));
    store.set(2, agent(2, 's2', 'codex'));
    store.set(3, agent(3, 's3'));
    expect(tracker.get(1)).toMatchObject({
      source: 'codex',
      sessionOrdinal: 1,
      customName: null,
      project: 'NEXORQ Bot',
    });
    expect(tracker.get(2)!.sessionOrdinal).toBe(2);
    expect(tracker.get(3)).toMatchObject({ source: 'claude-code', sessionOrdinal: 1 });
  });

  it('renames without touching ids', () => {
    const { store, tracker } = setup();
    store.set(1, agent(1, 's1', 'codex'));
    expect(tracker.rename(1, 'Builder')).toBe(true);
    expect(tracker.get(1)).toMatchObject({ id: 1, sessionId: 's1', customName: 'Builder' });
    tracker.rename(1, null);
    expect(tracker.get(1)!.customName).toBeNull();
    expect(tracker.rename(99, 'x')).toBe(false);
  });

  it('completed decays to idle; silent work becomes disconnected', () => {
    const { store, tracker, tick } = setup();
    store.set(1, agent(1, 's1'));
    store.set(2, agent(2, 's2'));
    store.broadcast({ type: 'agentStatus', id: 1, status: 'waiting' });
    store.broadcast({
      type: 'agentToolStart',
      id: 2,
      toolId: 't',
      toolName: 'Bash',
      status: 'Running: x',
    });
    expect(tracker.get(1)!.status).toBe('completed');
    tick(1500);
    tracker.sweep();
    expect(tracker.get(1)!.status).toBe('idle');
    expect(tracker.get(2)!.status).toBe('working');
    tick(5000);
    tracker.sweep();
    expect(tracker.get(2)).toMatchObject({
      status: 'disconnected',
      statusDetail: 'No events for a long time',
    });
    store.broadcast({ type: 'agentStatus', id: 2, status: 'active' });
    expect(tracker.get(2)!.status).toBe('working');
  });

  it('keeps a reported error through the end of the turn', () => {
    const { store, tracker } = setup();
    store.set(1, agent(1, 's1', 'codex'));
    store.broadcast({ type: 'agentStatus', id: 1, status: 'active' });
    tracker.reportError(1, 'Model overloaded');
    store.broadcast({ type: 'agentStatus', id: 1, status: 'waiting' });
    expect(tracker.get(1)).toMatchObject({ status: 'error', statusDetail: 'Model overloaded' });
    store.broadcast({ type: 'agentStatus', id: 1, status: 'active' });
    expect(tracker.get(1)!.status).toBe('working');
  });
});

describe('summarizeTask', () => {
  it('takes the first real line, masks and clips it', () => {
    expect(
      summarizeTask('<environment_context>x</environment_context>\nBuild the Telegram bot\nmore'),
    ).toBe('Build the Telegram bot');
    expect(summarizeTask('deploy with token=abcdef123456')).not.toContain('abcdef123456');
    expect(summarizeTask('a'.repeat(300))!.length).toBeLessThanOrEqual(101);
    expect(summarizeTask(null)).toBeNull();
  });
});

describe('rename over the wire and Codex errors', () => {
  it('renameAgent updates the observation; history lists the name', () => {
    const store = new AgentStateStore();
    const { tracker, history } = attachObservation(store, {
      history: { dir },
      identityFile: path.join(dir, 'agents.json'),
    });
    store.set(1, agent(1, 'sess-1', 'codex'));
    expect(
      handleObservationMessage({ type: 'renameAgent', id: 1, name: 'Researcher' }, () => {}, store),
    ).toBe(true);
    expect(tracker.get(1)!.customName).toBe('Researcher');
    history!.flush();
    const out: Array<Record<string, unknown>> = [];
    handleObservationMessage({ type: 'requestHistorySessions' }, (m) => out.push(m), store);
    expect((out[0].sessions as Array<Record<string, unknown>>)[0]).toMatchObject({
      sessionId: 'sess-1',
      sessionOrdinal: 1,
      customName: 'Researcher',
    });
  });

  it('a failed Codex turn shows as an error with its message', () => {
    const root = path.join(dir, 'sessions');
    const d = new Date();
    const day = path.join(
      root,
      `${d.getFullYear()}`,
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'),
    );
    fs.mkdirSync(day, { recursive: true });
    const line = (type: string, payload: Record<string, unknown>) =>
      JSON.stringify({ type, payload }) + '\n';
    const file = path.join(day, 'rollout-e.jsonl');
    fs.writeFileSync(file, line('session_meta', { id: 'th-e', cwd: '/w/app' }));
    const store = new AgentStateStore();
    const { tracker } = attachObservation(store, { history: false, identityFile: null });
    const observer = new CodexObserver(store, { sessionsRoot: root, discoveryEvery: 1 });
    observer.tick();
    fs.appendFileSync(
      file,
      line('event_msg', { type: 'task_started' }) +
        line('event_msg', {
          type: 'task_complete',
          error: { message: 'stream disconnected', codex_error_info: {} },
        }),
    );
    observer.tick();
    const id = [...store.keys()][0];
    expect(tracker.get(id)).toMatchObject({ status: 'error', statusDetail: 'stream disconnected' });
    fs.rmSync(file);
    observer.tick();
    expect(tracker.get(id)).toMatchObject({
      status: 'disconnected',
      statusDetail: 'Session file is gone',
    });
  });
});

describe('readTranscriptMeta task lookup', () => {
  it('finds the latest request even when a long turn pushed it past the tail', async () => {
    const { readTranscriptMeta } = await import('../src/observation/transcriptMeta.js');
    const file = path.join(dir, 'long.jsonl');
    const filler =
      JSON.stringify({ type: 'assistant', message: { content: 'x'.repeat(2000) } }) + '\n';
    fs.writeFileSync(
      file,
      JSON.stringify({ type: 'last-prompt', lastPrompt: 'old request' }) +
        '\n' +
        filler.repeat(50) +
        JSON.stringify({ type: 'last-prompt', lastPrompt: 'Build the Telegram bot' }) +
        '\n' +
        filler.repeat(400),
    );
    expect(fs.statSync(file).size).toBeGreaterThan(300 * 1024);
    expect(readTranscriptMeta(file).task).toBe('Build the Telegram bot');
  });
});
