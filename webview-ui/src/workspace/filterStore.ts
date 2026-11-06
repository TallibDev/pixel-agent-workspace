import { useSyncExternalStore } from 'react';

import type { AgentObservation } from '../../../core/src/messages.js';

/**
 * Which agents the office shows: by platform and by project. A per-viewer
 * convenience (localStorage); 'all' means no filter on that axis.
 */
export interface AgentFilter {
  provider: string;
  project: string;
}

export const ALL = 'all';
const STORAGE_KEY = 'paw.agentFilter';
interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const env = globalThis as { localStorage?: KeyValueStorage };

function load(): AgentFilter {
  try {
    const raw = env.localStorage?.getItem(STORAGE_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<AgentFilter>;
      if (typeof v.provider === 'string' && typeof v.project === 'string') {
        return { provider: v.provider, project: v.project };
      }
    }
  } catch {
    /* storage unavailable or malformed */
  }
  return { provider: ALL, project: ALL };
}

let filter: AgentFilter = load();
const listeners = new Set<() => void>();

export function getFilter(): AgentFilter {
  return filter;
}

export function setFilter(next: Partial<AgentFilter>): void {
  filter = { ...filter, ...next };
  try {
    env.localStorage?.setItem(STORAGE_KEY, JSON.stringify(filter));
  } catch {
    /* applies for this page only */
  }
  for (const l of listeners) l();
}

export function subscribeFilter(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useFilter(): AgentFilter {
  return useSyncExternalStore(subscribeFilter, getFilter, getFilter);
}

/** Agents without a known project only match the "all projects" choice. */
export function matchesFilter(
  a: Pick<AgentObservation, 'source' | 'project'>,
  f: AgentFilter = filter,
): boolean {
  if (f.provider !== ALL && a.source !== f.provider) return false;
  if (f.project !== ALL && a.project !== f.project) return false;
  return true;
}

export function isFilterActive(f: AgentFilter = filter): boolean {
  return f.provider !== ALL || f.project !== ALL;
}

/** Distinct platforms and projects among the given agents (for the filter menus). */
export function filterOptions(agents: Iterable<AgentObservation>): {
  providers: string[];
  projects: string[];
} {
  const providers = new Set<string>();
  const projects = new Set<string>();
  for (const a of agents) {
    providers.add(a.source);
    if (a.project) projects.add(a.project);
  }
  return {
    providers: [...providers].sort(),
    projects: [...projects].sort((x, y) => x.localeCompare(y)),
  };
}
