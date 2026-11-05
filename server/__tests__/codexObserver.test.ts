import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import { ObservationTracker } from '../src/observation/observationTracker.js';
import { readTranscriptMeta } from '../src/observation/transcriptMeta.js';
import {
  CODEX_IDLE_LEAVE_MS,
  CODEX_PROVIDER_ID,
  CodexObserver,
} from '../src/providers/codex/codexObserver.js';
import { formatCodexToolStatus, parseRolloutLine } from '../src/providers/codex/rolloutParser.js';

// Synthetic records shaped like Codex Desktop 0.166 rollouts (no real content).
const rec = (type: string, payload: Record<string, unknown>) =>
  JSON.stringify({ timestamp: '2026-11-06T10:00:00.000Z', type, payload }) + '\n';
const meta = (id: string, extra: Record<string, unknown> = {}) =>
  rec('session_meta', {
    id,
    cwd: 'D:\\Work\\shop-api',
    cli_version: '0.166.0',
    originator: 'Codex Desktop',
    source: 'vscode',
    git: { branch: 'main' },
    ...extra,
  });
const turnCtx = rec('turn_context', { model: 'gpt-5.5-codex', cwd: 'D:\\Work\\shop-api' });
const taskStarted = rec('event_msg', { type: 'task_started', turn_id: 't1' });
const taskComplete = rec('event_msg', { type: 'task_complete', turn_id: 't1' });
const exec = (callId: string, cmd: string) =>
  rec('response_item', {
    type: 'custom_tool_call',
    call_id: callId,
    name: 'exec',
    input: `const r = await tools.exec_command({cmd:"${cmd}", workdir:"."});`,
  });
const execOut = (callId: string) =>
  rec('response_item', { type: 'custom_tool_call_output', call_id: callId, output: 'ok' });
const tokens = rec('event_msg', {
  type: 'token_count',
  info: {
    last_token_usage: { input_tokens: 12000, output_tokens: 800 },
    model_context_window: 400000,
  },
});

describe('parseRolloutLine', () => {
  it('reads identity, turns, tools and tokens', () => {
    expect(parseRolloutLine(meta('th-1'))[0]).toMatchObject({
      kind: 'meta',
      threadId: 'th-1',
      cwd: 'D:\\Work\\shop-api',
      subagentKind: null,
      branch: 'main',
    });
    expect(parseRolloutLine(taskStarted)).toEqual([{ kind: 'turnStart' }]);
    expect(parseRolloutLine(taskComplete)).toEqual([{ kind: 'turnEnd', aborted: false }]);
    expect(parseRolloutLine(exec('c1', 'npm test'))).toEqual([
      { kind: 'toolStart', callId: 'c1', toolName: 'exec', status: 'Running: npm test' },
    ]);
    expect(parseRolloutLine(execOut('c1'))).toEqual([{ kind: 'toolEnd', callId: 'c1' }]);
    expect(parseRolloutLine(tokens)).toEqual([
      { kind: 'tokens', contextTokens: 12800, window: 400000 },
    ]);
  });

  it('marks sub-agent sessions and ignores junk', () => {
    const sub = meta('th-2', {
      source: { subagent: { other: 'guardian' } },
      parent_thread_id: 'th-1',
    });
    expect(parseRolloutLine(sub)[0]).toMatchObject({
      subagentKind: 'guardian',
      parentThreadId: 'th-1',
    });
    expect(parseRolloutLine('not json')).toEqual([]);
    expect(parseRolloutLine(rec('world_state', {}))).toEqual([]);
    expect(
      parseRolloutLine(rec('event_msg', { type: 'token_count', info: { last_token_usage: {} } })),
    ).toEqual([]);
  });

  it('formats tool statuses in the shared shapes', () => {
    expect(formatCodexToolStatus('exec', 'await tools.apply_patch({patch:"x"})', null)).toBe(
      'Editing files',
    );
    expect(
      formatCodexToolStatus('spawn_agent', '{"task_name":"audit deps"}', 'collaboration'),
    ).toBe('Subtask: audit deps');
    expect(formatCodexToolStatus('js', '{}', 'mcp__cua_repl')).toBe('Using mcp__cua_repl__js');
  });
});

describe('CodexObserver', () => {
  let root: string;
  let dayDir: string;
  let clock: number;
  const NOW = new Date(2026, 10, 6, 10, 0, 0).getTime();

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'paw-codex-'));
    clock = NOW;
    const d = new Date(NOW);
    dayDir = path.join(root, `${d.getFullYear()}`, '11', '06');
    fs.mkdirSync(dayDir, { recursive: true });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  function setup() {
    const store = new AgentStateStore();
    const sent: Array<Record<string, unknown>> = [];
    store.on('broadcast', (m) => sent.push(m));
    const observer = new CodexObserver(store, {
      sessionsRoot: root,
      now: () => clock,
      discoveryEvery: 1,
    });
    return { store, sent, observer };
  }
  const write = (name: string, text: string) => {
    const file = path.join(dayDir, name);
    fs.writeFileSync(file, text);
    const t = new Date(clock);
    fs.utimesSync(file, t, t);
    return file;
  };

  it('adopts a running session and rebuilds its current state from the tail', () => {
    const { store, sent, observer } = setup();
    write('rollout-a.jsonl', meta('th-1') + turnCtx + taskStarted + exec('c1', 'npm test'));
    observer.tick();
    const agents = [...store.values()];
    expect(agents).toHaveLength(1);
    expect(agents[0].providerId).toBe(CODEX_PROVIDER_ID);
    expect(agents[0].sessionId).toBe('th-1');
    expect(sent).toContainEqual({ type: 'agentStatus', id: agents[0].id, status: 'active' });
    expect(sent).toContainEqual(
      expect.objectContaining({
        type: 'agentToolStart',
        toolId: 'c1',
        status: 'Running: npm test',
      }),
    );
  });

  it('follows appended lines and ends the turn', () => {
    const { store, sent, observer } = setup();
    const file = write('rollout-a.jsonl', meta('th-1') + turnCtx);
    observer.tick();
    const id = [...store.keys()][0];
    fs.appendFileSync(file, taskStarted + exec('c1', 'git status') + execOut('c1') + tokens);
    observer.tick();
    fs.appendFileSync(file, taskComplete);
    observer.tick();
    const types = sent.filter((m) => m.id === id).map((m) => m.type);
    expect(types).toEqual(
      expect.arrayContaining([
        'agentToolStart',
        'agentToolDone',
        'agentContextUsage',
        'agentToolsClear',
      ]),
    );
    expect(sent.at(-1)).toEqual({ type: 'agentStatus', id, status: 'waiting' });
    expect(store.get(id)?.maxContextTokens).toBe(400000);
  });

  it('keeps a partial last line until it is complete', () => {
    const { sent, observer } = setup();
    const file = write('rollout-a.jsonl', meta('th-1'));
    observer.tick();
    const line = exec('c9', 'ls');
    fs.appendFileSync(file, line.slice(0, 20));
    observer.tick();
    expect(sent.some((m) => m.toolId === 'c9')).toBe(false);
    fs.appendFileSync(file, line.slice(20));
    observer.tick();
    expect(sent.some((m) => m.toolId === 'c9')).toBe(true);
  });

  it('ignores old rollouts and hides guardian sub-sessions', () => {
    const { store, observer } = setup();
    const old = write('rollout-old.jsonl', meta('th-old'));
    const past = new Date(NOW - 60 * 60 * 1000);
    fs.utimesSync(old, past, past);
    write(
      'rollout-g.jsonl',
      meta('th-g', { source: { subagent: { other: 'guardian' } }, parent_thread_id: 'th-1' }),
    );
    observer.tick();
    expect(store.size).toBe(0);
  });

  it('seats a delegated sub-agent as a teammate of its lead', () => {
    const { store, observer } = setup();
    write('rollout-a.jsonl', meta('th-1'));
    observer.tick();
    write(
      'rollout-b.jsonl',
      meta('th-2', {
        source: { subagent: { thread_spawn: {} } },
        parent_thread_id: 'th-1',
        agent_nickname: 'reviewer',
      }),
    );
    observer.tick();
    const [lead, child] = [...store.values()].sort((a, b) => a.id - b.id);
    expect(lead.isTeamLead).toBe(true);
    expect(child.leadAgentId).toBe(lead.id);
    expect(child.agentName).toBe('reviewer');
  });

  it('finds a resumed session still writing into an older day folder', () => {
    const { store, observer } = setup();
    const oldDir = path.join(path.dirname(path.dirname(dayDir)), '11', '01');
    fs.mkdirSync(oldDir, { recursive: true });
    const file = path.join(oldDir, 'rollout-resumed.jsonl');
    fs.writeFileSync(file, meta('th-old-but-live'));
    const t = new Date(clock);
    fs.utimesSync(file, t, t);
    observer.tick();
    expect([...store.values()].map((a) => a.sessionId)).toEqual(['th-old-but-live']);
  });

  it('removes a session after a long silence', () => {
    const { store, observer } = setup();
    write('rollout-a.jsonl', meta('th-1'));
    observer.tick();
    expect(store.size).toBe(1);
    clock += CODEX_IDLE_LEAVE_MS + 1000;
    observer.tick();
    expect(store.size).toBe(0);
  });

  it('feeds the observation model with source codex and rollout meta', () => {
    const { store, observer } = setup();
    const tracker = new ObservationTracker(store, { flushDelayMs: 10_000 });
    write('rollout-a.jsonl', meta('th-1') + turnCtx + taskStarted + exec('c1', 'npm test'));
    observer.tick();
    const o = tracker.get([...store.keys()][0])!;
    expect(o.source).toBe('codex');
    expect(o.status).toBe('working');
    expect(o.activity).toBe('running');
    expect(o.project).toBe('shop-api');
    expect(o.model).toBe('gpt-5.5-codex');
    expect(o.gitBranch).toBe('main');
  });

  it('is never persisted as a Claude agent', () => {
    const { store, observer } = setup();
    const saved: unknown[] = [];
    store.setAdapter({ saveAgents: (a: unknown[]) => saved.push(...a) } as never);
    write('rollout-a.jsonl', meta('th-1'));
    observer.tick();
    store.persist();
    expect(saved).toEqual([]);
  });
});

describe('readTranscriptMeta on Codex rollouts', () => {
  it('reads cwd, branch and model from the payloads', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paw-codexmeta-'));
    const file = path.join(dir, 'rollout-x.jsonl');
    fs.writeFileSync(file, meta('th-1') + turnCtx);
    expect(readTranscriptMeta(file)).toEqual({
      cwd: 'D:\\Work\\shop-api',
      gitBranch: 'main',
      model: 'gpt-5.5-codex',
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
