import { describe, expect, it } from 'vitest';

import type { AgentObservation } from '../../core/src/messages.js';
import {
  ALL,
  filterOptions,
  getFilter,
  isFilterActive,
  matchesFilter,
  setFilter,
} from '../src/workspace/filterStore.js';

const a = (source: string, project: string | null) => ({ source, project }) as AgentObservation;

describe('agent filter', () => {
  it('matches by platform and project', () => {
    const f = { provider: 'codex', project: 'NEXORQ Bot' };
    expect(matchesFilter(a('codex', 'NEXORQ Bot'), f)).toBe(true);
    expect(matchesFilter(a('claude-code', 'NEXORQ Bot'), f)).toBe(false);
    expect(matchesFilter(a('codex', 'other'), f)).toBe(false);
    expect(matchesFilter(a('codex', null), { provider: 'codex', project: ALL })).toBe(true);
    expect(matchesFilter(a('codex', null), { provider: ALL, project: 'x' })).toBe(false);
  });

  it('lists distinct options and reports when a filter is active', () => {
    const opts = filterOptions([
      a('codex', 'b'),
      a('claude-code', 'a'),
      a('codex', 'b'),
      a('codex', null),
    ]);
    expect(opts).toEqual({ providers: ['claude-code', 'codex'], projects: ['a', 'b'] });
    expect(isFilterActive({ provider: ALL, project: ALL })).toBe(false);
    setFilter({ provider: 'codex' });
    expect(getFilter().provider).toBe('codex');
    expect(isFilterActive()).toBe(true);
    setFilter({ provider: ALL });
  });
});
