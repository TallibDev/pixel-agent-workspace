import './workspace.css';

import { CharacterMugShot } from '../components/CharacterMugShot.js';
import { useT } from '../i18n/index.js';
import { agentLabel, displayStatus, providerName } from '../observation/observationStore.js';
import { useObservation } from '../observation/useObservation.js';
import {
  ALL,
  filterOptions,
  isFilterActive,
  matchesFilter,
  setFilter,
  useFilter,
} from './filterStore.js';
import { STATUS_DOT } from './status.js';

interface Props {
  focusedAgentId: number | null;
  onSelect: (id: number) => void;
  /** Character appearance for the mug shot (palette, hue), if the office has one. */
  getAppearance: (id: number) => { palette: number; hueShift: number } | null;
}

/** Bottom strip: platform/project filter, then one card per agent (name + live status). */
export function AgentStrip({ focusedAgentId, onSelect, getAppearance }: Props) {
  const t = useT();
  const { agents, synced, connected } = useObservation();
  const filter = useFilter();
  const all = [...agents.values()].sort((a, b) => a.id - b.id);
  const list = all.filter((a) => matchesFilter(a, filter));
  const hidden = all.length - list.length;
  const { providers, projects } = filterOptions(all);
  const fallback = (id: number) => t('card.agentFallback', { id });
  const showFilter = providers.length > 1 || projects.length > 1 || isFilterActive(filter);

  return (
    <div className="paw-strip" aria-label={t('strip.aria')}>
      {showFilter && (
        <div className="paw-filter" role="group" aria-label={t('filter.aria')}>
          <select
            aria-label={t('filter.provider')}
            value={filter.provider}
            onChange={(e) => setFilter({ provider: e.target.value })}
          >
            <option value={ALL}>{t('filter.allProviders')}</option>
            {providers.map((p) => (
              <option key={p} value={p}>
                {providerName(p)}
              </option>
            ))}
          </select>
          <select
            aria-label={t('filter.project')}
            value={filter.project}
            onChange={(e) => setFilter({ project: e.target.value })}
          >
            <option value={ALL}>{t('filter.allProjects')}</option>
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          {hidden > 0 && (
            <button
              type="button"
              className="paw-filter-reset"
              onClick={() => setFilter({ provider: ALL, project: ALL })}
            >
              {t('filter.hidden', { n: hidden })} · {t('filter.reset')}
            </button>
          )}
        </div>
      )}
      <div className="paw-strip-cards" role="list">
        {synced && all.length === 0 && <p className="paw-strip-empty">{t('strip.empty')}</p>}
        {list.map((a) => {
          const look = getAppearance(a.id);
          const status = displayStatus(a, connected);
          const waiting = status === 'waiting_permission' || status === 'waiting_user';
          const name = agentLabel(a, fallback);
          return (
            <button
              key={a.id}
              type="button"
              role="listitem"
              className="paw-agent-card"
              aria-pressed={focusedAgentId === a.id}
              data-status={status}
              title={`${name} · ${providerName(a.source)}${a.project ? ` · ${a.project}` : ''}`}
              onClick={() => onSelect(a.id)}
            >
              <span className="paw-mug">
                {look ? (
                  <CharacterMugShot palette={look.palette} hueShift={look.hueShift} size={40} />
                ) : null}
              </span>
              <span className="paw-agent-meta">
                <b>{name}</b>
                <span className="paw-agent-status">
                  <i
                    style={{
                      background: waiting ? 'transparent' : STATUS_DOT[status],
                      borderColor: STATUS_DOT[status],
                    }}
                  />
                  {t(`short.${status}` as const)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
