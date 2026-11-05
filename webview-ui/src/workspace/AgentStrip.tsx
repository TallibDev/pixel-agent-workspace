import './workspace.css';

import { CharacterMugShot } from '../components/CharacterMugShot.js';
import { useT } from '../i18n/index.js';
import { agentLabel } from '../observation/observationStore.js';
import { useObservation } from '../observation/useObservation.js';
import { STATUS_DOT } from './status.js';

interface Props {
  focusedAgentId: number | null;
  onSelect: (id: number) => void;
  /** Character appearance for the mug shot (palette, hue), if the office has one. */
  getAppearance: (id: number) => { palette: number; hueShift: number } | null;
}

/** Bottom strip of agent cards: portrait, name, live status. */
export function AgentStrip({ focusedAgentId, onSelect, getAppearance }: Props) {
  const t = useT();
  const { agents, synced } = useObservation();
  const list = [...agents.values()].sort((a, b) => a.id - b.id);
  const fallback = (id: number) => t('card.agentFallback', { id });

  return (
    <div className="paw-strip" role="list" aria-label={t('strip.aria')}>
      {synced && list.length === 0 && <p className="paw-strip-empty">{t('strip.empty')}</p>}
      {list.map((a) => {
        const look = getAppearance(a.id);
        const waiting = a.status === 'waiting_permission' || a.status === 'waiting_user';
        return (
          <button
            key={a.id}
            type="button"
            role="listitem"
            className="paw-agent-card"
            aria-pressed={focusedAgentId === a.id}
            data-status={a.status}
            onClick={() => onSelect(a.id)}
          >
            <span className="paw-mug">
              {look ? (
                <CharacterMugShot palette={look.palette} hueShift={look.hueShift} size={40} />
              ) : null}
            </span>
            <span className="paw-agent-meta">
              <b title={agentLabel(a, fallback)}>{agentLabel(a, fallback)}</b>
              <span className="paw-agent-status">
                <i
                  className={waiting ? 'is-ring' : undefined}
                  style={{
                    background: waiting ? 'transparent' : STATUS_DOT[a.status],
                    borderColor: STATUS_DOT[a.status],
                  }}
                />
                {t(`short.${a.status}` as const)}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
