import { describe, expect, it } from 'vitest';

import type { HistoryEntry } from '../../core/src/messages.js';
import { translate, translateAction } from '../src/i18n/index.js';
import { en, ru } from '../src/i18n/strings.js';
import { entryText } from '../src/observation/entryText.js';
import { delayToNext, statusAt } from '../src/observation/replay.js';

describe('dictionaries', () => {
  it('ru has exactly the keys of en, none empty', () => {
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
    for (const [k, v] of Object.entries(ru)) expect(v.trim(), k).not.toBe('');
  });

  it('keeps placeholders in translations', () => {
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      const want = (en[key].match(/\{\w+\}/g) ?? []).sort();
      const got = (ru[key].match(/\{\w+\}/g) ?? []).sort();
      expect(got, key).toEqual(want);
    }
  });
});

describe('translate', () => {
  it('fills placeholders', () => {
    expect(translate('ru', 'card.agentFallback', { id: 4 })).toBe('Агент №4');
    expect(translate('en', 'time.minutes', { n: 3 })).toBe('3 min ago');
  });
});

describe('translateAction', () => {
  it('translates known status shapes and keeps file names and commands', () => {
    expect(translateAction('ru', 'Reading app.ts')).toBe('Читает app.ts');
    expect(translateAction('ru', 'Running: npm test')).toBe('Выполняет: npm test');
    expect(translateAction('ru', 'Searching code')).toBe('Ищет в коде');
    expect(translateAction('ru', 'Subtask: audit deps')).toBe('Подзадача: audit deps');
    expect(translateAction('ru', 'Using mcp__fs__read')).toBe('Использует mcp__fs__read');
  });

  it('leaves English and unknown shapes untouched', () => {
    expect(translateAction('en', 'Reading app.ts')).toBe('Reading app.ts');
    expect(translateAction('ru', '-> researcher')).toBe('-> researcher');
  });
});

describe('entryText', () => {
  const t = (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) =>
    translate('ru', k, v);
  it('renders fixed kinds and sub-agent labels', () => {
    expect(entryText({ kind: 'turnEnd', text: 'Finished its turn' }, t, 'ru')).toBe('Завершил ход');
    expect(entryText({ kind: 'subagentStart', text: 'Delegated: audit deps' }, t, 'ru')).toBe(
      'Делегировал: audit deps',
    );
    expect(entryText({ kind: 'tool', text: 'Editing a.ts' }, t, 'ru')).toBe('Редактирует a.ts');
  });
});

describe('replay helpers', () => {
  const e = (ts: number, kind: HistoryEntry['kind'], agentId = 1): HistoryEntry => ({
    ts,
    kind,
    text: '',
    agentId,
    sessionId: 's',
    source: 'claude-code',
    project: null,
  });
  const entries = [
    e(0, 'joined'),
    e(1000, 'tool'),
    e(2000, 'permission'),
    e(9000, 'turnEnd'),
    e(9500, 'left'),
  ];

  it('derives status from recorded entries only', () => {
    expect(statusAt(entries, 0).get(1)).toBe('unknown');
    expect(statusAt(entries, 1).get(1)).toBe('working');
    expect(statusAt(entries, 2).get(1)).toBe('waiting_permission');
    expect(statusAt(entries, 3).get(1)).toBe('idle');
    expect(statusAt(entries, 4).has(1)).toBe(false);
  });

  it('scales gaps by speed with a cap', () => {
    expect(delayToNext(entries, 0, 1)).toBe(1000);
    expect(delayToNext(entries, 0, 4)).toBe(250);
    expect(delayToNext(entries, 2, 1)).toBe(1500);
    expect(delayToNext(entries, 4, 1)).toBeNull();
  });
});

describe('pluralForm', () => {
  it('follows Russian and English plural rules', async () => {
    const { pluralForm } = await import('../src/i18n/index.js');
    expect([1, 2, 5, 21, 22, 11].map((n) => pluralForm('ru', n))).toEqual([
      'one',
      'few',
      'many',
      'one',
      'few',
      'many',
    ]);
    expect([1, 2].map((n) => pluralForm('en', n))).toEqual(['one', 'many']);
  });
});
