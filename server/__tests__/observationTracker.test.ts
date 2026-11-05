import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAgentState } from '../src/agentState.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { classifyTool } from '../src/observation/classify.js';
import { maskSecrets } from '../src/observation/maskSecrets.js';
import {
  attachObservationTracker,
  ObservationTracker,
  resendObservation,
} from '../src/observation/observationTracker.js';
import { readTranscriptMeta } from '../src/observation/transcriptMeta.js';

const noMeta = () => ({ cwd: null, gitBranch: null, model: null });

function setup() {
  const store = new AgentStateStore();
  const sent: Array<Record<string, unknown>> = [];
  store.on('broadcast', (m) => sent.push(m));
  let clock = 1_000;
  const tracker = new ObservationTracker(store, {
    now: () => clock,
    readMeta: noMeta,
    flushDelayMs: 10_000,
  });
  const add = (id: number) =>
    store.set(
      id,
      createAgentState({
        id,
        sessionId: `s-${id}`,
        projectDir: '/p',
        jsonlFile: '',
        isExternal: true,
      }),
    );
  const tick = (ms: number) => {
    clock += ms;
  };
  return { store, sent, tracker, add, tick };
}

describe('ObservationTracker', () => {
  it('starts an agent as unknown, with no invented details', () => {
    const { tracker, add } = setup();
    add(1);
    const o = tracker.get(1)!;
    expect(o.status).toBe('unknown');
    expect(o.currentAction).toBeNull();
    expect(o.lastAction).toBeNull();
    expect(o.project).toBeNull();
    expect(o.model).toBeNull();
    expect(o.contextTokens).toBeNull();
    expect(o.subagents).toEqual([]);
    expect(o.source).toBe('claude-code');
    expect(o.channel).toBe('transcript');
  });

  it('follows a tool start and its activity', () => {
    const { tracker, add, store } = setup();
    add(1);
    store.broadcast({
      type: 'agentToolStart',
      id: 1,
      toolId: 't1',
      toolName: 'Edit',
      status: 'Editing app.ts',
    });
    const o = tracker.get(1)!;
    expect(o.status).toBe('working');
    expect(o.activity).toBe('writing');
    expect(o.currentAction).toBe('Editing app.ts');
    expect(o.lastAction).toBe('Editing app.ts');
    expect(o.lastEventAt).toBe(1_000);
  });

  it('marks permission waits and clears them', () => {
    const { tracker, add, store } = setup();
    add(1);
    store.broadcast({
      type: 'agentToolStart',
      id: 1,
      toolId: 't1',
      toolName: 'Bash',
      status: 'Running: ls',
    });
    store.broadcast({ type: 'agentToolPermission', id: 1 });
    expect(tracker.get(1)!.status).toBe('waiting_permission');
    store.broadcast({ type: 'agentToolPermissionClear', id: 1 });
    expect(tracker.get(1)!.status).toBe('working');
  });

  it('distinguishes a finished turn from waiting for input', () => {
    const { tracker, add, store } = setup();
    add(1);
    add(2);
    store.broadcast({ type: 'agentStatus', id: 1, status: 'waiting' });
    store.broadcast({ type: 'agentStatus', id: 2, status: 'waiting', awaitingInput: true });
    expect(tracker.get(1)!.status).toBe('idle');
    expect(tracker.get(1)!.activity).toBeNull();
    expect(tracker.get(2)!.status).toBe('waiting_user');
  });

  it('clears tools when the turn ends, so no stale action is shown', () => {
    const { tracker, add, store } = setup();
    add(1);
    store.broadcast({
      type: 'agentToolStart',
      id: 1,
      toolId: 't1',
      toolName: 'Read',
      status: 'Reading a.ts',
    });
    store.broadcast({ type: 'agentStatus', id: 1, status: 'waiting' });
    const o = tracker.get(1)!;
    expect(o.currentAction).toBeNull();
    expect(o.lastAction).toBe('Reading a.ts');
  });

  it('tracks sub-agents only from real sub-agent events', () => {
    const { tracker, add, store } = setup();
    add(1);
    store.broadcast({
      type: 'agentToolStart',
      id: 1,
      toolId: 'task-1',
      toolName: 'Agent',
      status: 'Subtask: audit deps',
    });
    expect(tracker.get(1)!.subagents).toEqual([]);
    store.broadcast({
      type: 'subagentToolStart',
      id: 1,
      parentToolId: 'task-1',
      toolId: 'x',
      status: 'Reading',
    });
    expect(tracker.get(1)!.subagents).toEqual([{ toolId: 'task-1', label: 'Subtask: audit deps' }]);
    store.broadcast({ type: 'subagentClear', id: 1, parentToolId: 'task-1' });
    expect(tracker.get(1)!.subagents).toEqual([]);
  });

  it('records context usage only when reported', () => {
    const { tracker, add, store } = setup();
    add(1);
    store.broadcast({
      type: 'agentContextUsage',
      id: 1,
      contextTokens: 5000,
      maxContextTokens: 200000,
    });
    expect(tracker.get(1)!.contextTokens).toBe(5000);
    expect(tracker.get(1)!.maxContextTokens).toBe(200000);
  });

  it('masks secrets in actions before they reach the feed', () => {
    const { tracker, add, store, sent } = setup();
    add(1);
    store.broadcast({
      type: 'agentToolStart',
      id: 1,
      toolId: 't1',
      toolName: 'Bash',
      status: 'Running: curl -H "Authorization: Bearer abcdefghijklmnop123" https://x',
    });
    expect(tracker.get(1)!.currentAction).not.toContain('abcdefghijklmnop123');
    const feed = sent.filter((m) => m.type === 'activityEvent');
    expect(JSON.stringify(feed)).not.toContain('abcdefghijklmnop123');
  });

  it('writes a bounded activity feed with increasing sequence numbers', () => {
    const store = new AgentStateStore();
    const tracker = new ObservationTracker(store, {
      readMeta: noMeta,
      feedLimit: 3,
      flushDelayMs: 10_000,
    });
    store.set(
      1,
      createAgentState({
        id: 1,
        sessionId: 's',
        projectDir: '/p',
        jsonlFile: '',
        isExternal: true,
      }),
    );
    for (let i = 0; i < 5; i++) {
      store.broadcast({
        type: 'agentToolStart',
        id: 1,
        toolId: `t${i}`,
        toolName: 'Read',
        status: `Reading ${i}`,
      });
    }
    const { activity } = tracker.snapshot();
    expect(activity).toHaveLength(3);
    expect(activity.map((a) => a.text)).toEqual(['Reading 2', 'Reading 3', 'Reading 4']);
    expect(activity[0].seq).toBeLessThan(activity[2].seq);
  });

  it('does not repeat a feed entry when the same tool is re-announced', () => {
    const { tracker, add, store } = setup();
    add(1);
    const m = {
      type: 'agentToolStart',
      id: 1,
      toolId: 't1',
      toolName: 'Read',
      status: 'Reading a.ts',
    };
    store.broadcast(m);
    store.broadcast(m);
    expect(tracker.snapshot().activity.filter((a) => a.kind === 'tool')).toHaveLength(1);
  });

  it('coalesces updates and broadcasts agentObservation on flush', () => {
    const { tracker, add, store, sent } = setup();
    add(1);
    store.broadcast({
      type: 'agentToolStart',
      id: 1,
      toolId: 't1',
      toolName: 'Read',
      status: 'Reading a.ts',
    });
    store.broadcast({ type: 'agentToolDone', id: 1, toolId: 't1' });
    expect(sent.filter((m) => m.type === 'agentObservation')).toHaveLength(0);
    tracker.flush();
    expect(sent.filter((m) => m.type === 'agentObservation')).toHaveLength(1);
  });

  it('announces removal and drops the agent', () => {
    const { tracker, add, store, sent } = setup();
    add(1);
    store.delete(1);
    expect(tracker.get(1)).toBeUndefined();
    expect(sent).toContainEqual({ type: 'agentObservationRemoved', id: 1 });
  });

  it('reports the hooks channel once hooks delivered', () => {
    const { tracker, add, store } = setup();
    add(1);
    store.get(1)!.hookDelivered = true;
    expect(tracker.get(1)!.channel).toBe('hooks');
  });

  it('resends a snapshot through the registry', () => {
    const store = new AgentStateStore();
    attachObservationTracker(store, { readMeta: noMeta });
    store.set(
      1,
      createAgentState({
        id: 1,
        sessionId: 's',
        projectDir: '/p',
        jsonlFile: '',
        isExternal: true,
      }),
    );
    const out: Array<Record<string, unknown>> = [];
    resendObservation((m) => out.push(m), store);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('observationSnapshot');
    expect((out[0].agents as unknown[]).length).toBe(1);
  });
});

describe('classifyTool', () => {
  it('maps known tools and leaves unknown ones as other', () => {
    expect(classifyTool('Read')).toBe('reading');
    expect(classifyTool('Grep')).toBe('searching');
    expect(classifyTool('Write')).toBe('writing');
    expect(classifyTool('PowerShell')).toBe('running');
    expect(classifyTool('WebSearch')).toBe('browsing');
    expect(classifyTool('Agent')).toBe('delegating');
    expect(classifyTool('mcp__fs__read_file')).toBe('reading');
    expect(classifyTool('mcp__x__deploy')).toBe('other');
    expect(classifyTool('SomethingNew')).toBe('other');
    expect(classifyTool(undefined)).toBe('other');
  });
});

describe('maskSecrets', () => {
  it.each([
    ['curl -H "Authorization: Bearer abcdefghijklmnop123"', 'abcdefghijklmnop123'],
    ['export OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz', 'sk-proj-abcdef'],
    ['git push https://user:hunter2secret@github.com/x.git', 'hunter2secret'],
    ['echo ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'ghp_abcdefghijkl'],
    ['mysql --password=supersecret', 'supersecret'],
    ['AWS key AKIAABCDEFGHIJKLMNOP', 'AKIAABCDEFGHIJKLMNOP'],
  ])('redacts %s', (input, secret) => {
    expect(maskSecrets(input)).not.toContain(secret);
  });

  it('leaves ordinary commands alone', () => {
    expect(maskSecrets('Running: npm test -- --run')).toBe('Running: npm test -- --run');
    expect(maskSecrets('Editing tokenizer.ts')).toBe('Editing tokenizer.ts');
  });
});

describe('readTranscriptMeta', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paw-meta-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads cwd, branch and model from the main chain', () => {
    const file = path.join(dir, 's.jsonl');
    fs.writeFileSync(
      file,
      [
        JSON.stringify({ type: 'user', isSidechain: true, cwd: '/side', gitBranch: 'side' }),
        JSON.stringify({ type: 'user', cwd: 'D:\\Project\\App', gitBranch: 'main' }),
        'not json',
        JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-5-5' } }),
      ].join('\n') + '\n',
    );
    expect(readTranscriptMeta(file)).toEqual({
      cwd: 'D:\\Project\\App',
      gitBranch: 'main',
      model: 'claude-sonnet-5-5',
    });
  });

  it('returns nulls for a missing file', () => {
    expect(readTranscriptMeta(path.join(dir, 'nope.jsonl'))).toEqual(noMeta());
    expect(readTranscriptMeta(undefined)).toEqual(noMeta());
  });
});
