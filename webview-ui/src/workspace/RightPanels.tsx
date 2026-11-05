import './workspace.css';

import { useMemo } from 'react';

import type { ActivityKind } from '../../../core/src/messages.js';
import { translateAction, useLanguage, useT } from '../i18n/index.js';
import { entryText } from '../observation/entryText.js';
import { agentLabel, countStatuses } from '../observation/observationStore.js';
import { useObservation } from '../observation/useObservation.js';
import { Icon, type IconName } from './icons.js';
import { setPanel } from './uiStore.js';

const KIND_ICON: Record<ActivityKind, IconName> = {
  joined: 'play',
  left: 'minus',
  tool: 'code',
  permission: 'alert',
  turnEnd: 'check',
  waitingInput: 'hourglass',
  subagentStart: 'plus',
  subagentEnd: 'check',
};

interface Props {
  onFocusAgent: (id: number) => void;
}

/** Right column: agent summary, current tasks, recent activity. */
export function RightPanels({ onFocusAgent }: Props) {
  const t = useT();
  const lang = useLanguage();
  const { agents, feed, synced } = useObservation();
  const counts = useMemo(() => countStatuses(agents.values()), [agents]);
  const fallback = (id: number) => t('card.agentFallback', { id });
  const working = [...agents.values()].filter((a) => a.status === 'working');
  const recent = feed.slice(-6).reverse();
  const n = (v: number) => (synced ? String(v) : '–');

  return (
    <aside className="paw-right">
      <section className="paw-card">
        <header>
          <h2>
            {t('panel.agents')} <b className="paw-badge">{n(counts.detected)}</b>
          </h2>
          {counts.working > 0 && (
            <span className="paw-pill">{t('panel.activeCount', { n: counts.working })}</span>
          )}
        </header>
        <ul className="paw-rows">
          <li>
            <span className="paw-ic" style={{ color: 'var(--paw-ok)' }}>
              <Icon name="activity" size={16} />
            </span>
            {t('panel.working')}
            <b>{n(counts.working)}</b>
          </li>
          <li>
            <span className="paw-ic" style={{ color: 'var(--paw-warn)' }}>
              <Icon name="hourglass" size={16} />
            </span>
            {t('panel.waiting')}
            <b>{n(counts.waiting)}</b>
          </li>
          <li>
            <span className="paw-ic" style={{ color: 'var(--paw-idle)' }}>
              <Icon name="pause" size={16} />
            </span>
            {t('panel.idle')}
            <b>{n(counts.idle)}</b>
          </li>
          {counts.unknown > 0 && (
            <li>
              <span className="paw-ic">
                <Icon name="minus" size={16} />
              </span>
              {t('panel.unknown')}
              <b>{n(counts.unknown)}</b>
            </li>
          )}
        </ul>
      </section>

      <section className="paw-card">
        <header>
          <h2>{t('panel.tasks')}</h2>
        </header>
        {working.length === 0 ? (
          <p className="paw-empty">{t('panel.noTasks')}</p>
        ) : (
          <ul className="paw-tasks">
            {working.map((a) => {
              const action = a.currentAction ?? a.lastAction;
              return (
                <li key={a.id}>
                  <button type="button" onClick={() => onFocusAgent(a.id)}>
                    <span className="paw-task-ic">
                      <Icon name="code" size={16} />
                    </span>
                    <span className="paw-task-text">
                      <b>{agentLabel(a, fallback)}</b>
                      {' – '}
                      {action ? translateAction(lang, action) : t('panel.taskUnknown')}
                    </span>
                    {/* No percentages: agents don't report progress. This bar only says "in progress". */}
                    <span
                      className="paw-indeterminate"
                      role="progressbar"
                      aria-label={t('panel.inProgress')}
                    >
                      <i />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="paw-card">
        <header>
          <h2>{t('panel.recent')}</h2>
          <button type="button" className="paw-link" onClick={() => setPanel('feed')}>
            {t('panel.more')}
          </button>
        </header>
        {recent.length === 0 ? (
          <p className="paw-empty">{t('panel.noRecent')}</p>
        ) : (
          <ol className="paw-recent">
            {recent.map((e) => {
              const a = agents.get(e.agentId);
              return (
                <li key={e.seq} title={a ? agentLabel(a, fallback) : fallback(e.agentId)}>
                  <time>
                    {new Date(e.ts).toLocaleTimeString(lang, {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                  <span className="paw-ic">
                    <Icon name={KIND_ICON[e.kind]} size={16} />
                  </span>
                  <span className="paw-recent-text">{entryText(e, t, lang)}</span>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </aside>
  );
}
