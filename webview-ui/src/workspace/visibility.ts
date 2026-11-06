import { observationStore } from '../observation/useObservation.js';
import { getFilter, isFilterActive, matchesFilter } from './filterStore.js';

/**
 * Whether the office should hide a character because of the platform/project
 * filter. Sub-agents follow their parent. Characters with no observation (the
 * intro greeter, a just-created agent) are never hidden.
 */
export function isCharacterHidden(ch: {
  id: number;
  isSubagent?: boolean;
  parentAgentId?: number | null;
}): boolean {
  const f = getFilter();
  if (!isFilterActive(f)) return false;
  const id =
    ch.isSubagent && ch.parentAgentId !== null && ch.parentAgentId !== undefined
      ? ch.parentAgentId
      : ch.id;
  const obs = observationStore.getState().agents.get(id);
  return obs ? !matchesFilter(obs, f) : false;
}
