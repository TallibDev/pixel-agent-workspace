import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TaskTracker } from '../src/observation/transcriptMeta.js';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paw-task-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const prompt = (text: string) => JSON.stringify({ type: 'last-prompt', lastPrompt: text }) + '\n';
const codexPrompt = (text: string) =>
  JSON.stringify({
    type: 'event_msg',
    payload: {
      type: 'item_completed',
      item: { type: 'UserMessage', content: [{ type: 'text', text }] },
    },
  }) + '\n';
const filler = (n: number) =>
  (JSON.stringify({ type: 'assistant', message: { content: 'x'.repeat(2000) } }) + '\n').repeat(n);

describe('TaskTracker', () => {
  it('finds a request far behind a long turn', () => {
    const file = path.join(dir, 'a.jsonl');
    fs.writeFileSync(
      file,
      prompt('old request') + filler(50) + prompt('Build the Telegram bot') + filler(3000),
    );
    expect(fs.statSync(file).size).toBeGreaterThan(5 * 1024 * 1024);
    expect(new TaskTracker().latest(file)).toBe('Build the Telegram bot');
  });

  it('reads only what was appended and follows the newest request', () => {
    const file = path.join(dir, 'b.jsonl');
    fs.writeFileSync(file, prompt('first'));
    const t = new TaskTracker();
    expect(t.latest(file)).toBe('first');
    fs.appendFileSync(file, filler(10));
    expect(t.latest(file)).toBe('first');
    fs.appendFileSync(file, codexPrompt('Fix the login form'));
    expect(t.latest(file)).toBe('Fix the login form');
  });

  it('waits for an unterminated last line', () => {
    const file = path.join(dir, 'c.jsonl');
    const line = prompt('half written');
    fs.writeFileSync(file, line.slice(0, 20));
    const t = new TaskTracker();
    expect(t.latest(file)).toBeNull();
    fs.appendFileSync(file, line.slice(20));
    expect(t.latest(file)).toBe('half written');
  });

  it('starts over when a transcript is rewritten', () => {
    const file = path.join(dir, 'd.jsonl');
    fs.writeFileSync(file, prompt('before') + filler(5));
    const t = new TaskTracker();
    expect(t.latest(file)).toBe('before');
    fs.writeFileSync(file, prompt('after'));
    expect(t.latest(file)).toBe('after');
  });

  it('scans a 32 MB first look quickly and a later call almost for free', () => {
    const file = path.join(dir, 'big.jsonl');
    const block = filler(1000); // ~2 MB
    fs.writeFileSync(file, prompt('Deep request'));
    for (let i = 0; i < 15; i++) fs.appendFileSync(file, block);
    const t = new TaskTracker();
    let start = performance.now();
    expect(t.latest(file)).toBe('Deep request');
    const first = performance.now() - start;
    fs.appendFileSync(file, filler(5));
    start = performance.now();
    expect(t.latest(file)).toBe('Deep request');
    const second = performance.now() - start;
    expect(first).toBeLessThan(2000);
    expect(second).toBeLessThan(50);
  });

  it('is null for missing files', () => {
    expect(new TaskTracker().latest(path.join(dir, 'none.jsonl'))).toBeNull();
    expect(new TaskTracker().latest(undefined)).toBeNull();
  });
});

describe('readTranscriptMeta project root', () => {
  it('keeps the session start folder even after the agent cd-s elsewhere', async () => {
    const { readTranscriptMeta } = await import('../src/observation/transcriptMeta.js');
    const file = path.join(dir, 'cd.jsonl');
    const rec = (cwd: string) => JSON.stringify({ type: 'user', cwd, gitBranch: 'main' }) + '\n';
    fs.writeFileSync(file, rec('D:\Work\App') + filler(200) + rec('D:\Work\App\webview-ui\src'));
    expect(fs.statSync(file).size).toBeGreaterThan(300 * 1024);
    expect(readTranscriptMeta(file).cwd).toBe('D:\Work\App');
    const small = path.join(dir, 'cd-small.jsonl');
    fs.writeFileSync(small, rec('D:\Work\App') + rec('D:\Work\App\server'));
    expect(readTranscriptMeta(small).cwd).toBe('D:\Work\App');
  });
});
