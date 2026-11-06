import './observation.css';

import { useEffect, useMemo, useRef, useState } from 'react';

import type {
  ActivityEntry,
  AgentObservation,
  HistoryEntry,
  HistorySession,
  ObservedStatus,
} from '../../../core/src/messages.js';
import {
  type Language,
  LANGUAGES,
  pluralForm,
  setLanguage,
  type Translate,
  translateAction,
  useLanguage,
  useT,
} from '../i18n/index.js';
import { transport } from '../transport/index.js';
import { matchesFilter, useFilter } from '../workspace/filterStore.js';
import { setPanel, togglePanel, usePanel } from '../workspace/uiStore.js';
import { entryText } from './entryText.js';
import {
  agentLabel,
  countStatuses,
  displayStatus,
  providerName,
  sessionLabel,
} from './observationStore.js';
import { delayToNext, REPLAY_SPEEDS, statusAt } from './replay.js';
import { type SessionRecording, useHistory } from './useHistory.js';
import { useObservation } from './useObservation.js';

const STATUS_COLOR: Record<ObservedStatus, string> = {
  working: 'var(--obs-working)',
  waiting_permission: 'var(--obs-waiting)',
  waiting_user: 'var(--obs-waiting-user)',
  idle: 'var(--obs-idle-soft)',
  completed: 'var(--obs-idle)',
  error: 'var(--obs-error)',
  disconnected: 'var(--obs-off)',
  unknown: 'var(--obs-unknown)',
};

export interface HooksControl {
  /** Actual install state; undefined until the server reported it. */
  installed: boolean | undefined;
  onInstall: () => void;
}

interface Props {
  selectedAgentId: number | null;
  onCloseCard: () => void;
  readOnly: boolean;
  hooks: HooksControl;
  /** Desktop workspace shell: the sidebar, top bar and right column replace the summary bar. */
  desktopShell?: boolean;
}

/** Summary bar, agent card, activity feed, hooks wizard, history and replay over the office. */
export function ObservationHud({
  selectedAgentId,
  onCloseCard,
  readOnly,
  hooks,
  desktopShell = false,
}: Props) {
  const t = useT();
  const lang = useLanguage();
  const { agents, feed, synced, connected } = useObservation();
  const panel = usePanel();
  const history = useHistory(panel === 'history', readOnly);
  const counts = useMemo(() => countStatuses(agents.values(), connected), [agents, connected]);
  const filter = useFilter();
  const candidate = selectedAgentId !== null ? agents.get(selectedAgentId) : undefined;
  // A card never shows for an agent the filter hides.
  const selected = candidate && matchesFilter(candidate, filter) ? candidate : undefined;
  const hooksOn =
    hooks.installed === true || [...agents.values()].some((a) => a.channel === 'hooks');
  const replaying = history.recording !== null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (selected) onCloseCard();
      else if (panel) setPanel(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, onCloseCard, panel]);

  const toggle = togglePanel;
  const n = (v: number) => (synced ? String(v) : '–');
  const fallback = (id: number) => t('card.agentFallback', { id });

  return (
    <>
      {!desktopShell && (
        <div className="obs-panel obs-bar" role="status" aria-label={t('bar.aria')}>
          <div className="obs-stat" title={t('bar.agentsTitle')}>
            <b>{n(counts.detected)}</b>
            <span>
              {synced
                ? t(`bar.agents.${pluralForm(lang, counts.detected)}` as const)
                : t('bar.agents')}
            </span>
          </div>
          <div className="obs-sep" />
          <Stat color={STATUS_COLOR.working} value={n(counts.working)} label={t('bar.working')} />
          <Stat
            color={STATUS_COLOR.waiting_permission}
            value={n(counts.waiting)}
            label={t('bar.waiting')}
          />
          <Stat color={STATUS_COLOR.idle} value={n(counts.idle)} label={t('bar.idle')} />
          {counts.problem > 0 && (
            <Stat color={STATUS_COLOR.error} value={n(counts.problem)} label={t('bar.problems')} />
          )}
          {counts.unknown > 0 && (
            <Stat color={STATUS_COLOR.unknown} value={n(counts.unknown)} label={t('bar.unknown')} />
          )}
          <div className="obs-sep" />
          <button
            type="button"
            className="obs-btn"
            aria-pressed={panel === 'feed'}
            onClick={() => toggle('feed')}
          >
            {t('bar.activity')}
          </button>
          <button
            type="button"
            className="obs-btn"
            aria-pressed={panel === 'history'}
            onClick={() => toggle('history')}
          >
            {t('bar.history')}
          </button>
          <button
            type="button"
            className={`obs-btn obs-channel ${hooksOn ? 'is-on' : 'is-off'}`}
            aria-pressed={panel === 'hooks'}
            title={hooksOn ? t('bar.hooksTitle') : t('bar.transcriptsTitle')}
            onClick={() => toggle('hooks')}
          >
            <i
              className="obs-dot"
              style={{ background: hooksOn ? 'var(--obs-idle)' : 'var(--obs-waiting)' }}
            />
            {hooksOn ? t('bar.hooks') : t('bar.transcripts')}
          </button>
          <div className="obs-sep" />
          <LanguageSwitch lang={lang} t={t} />
        </div>
      )}

      {replaying && history.recording && (
        <ReplayPlayer
          key={history.recording.sessionId}
          recording={history.recording}
          session={
            history.state.kind === 'ready'
              ? history.state.sessions.find((s) => s.sessionId === history.recording!.sessionId)
              : undefined
          }
          t={t}
          lang={lang}
          onExit={history.closeRecording}
        />
      )}

      {selected && !replaying && (
        <AgentCard
          agent={selected}
          connected={connected}
          readOnly={readOnly}
          onClose={onCloseCard}
          t={t}
          lang={lang}
          fallback={fallback}
        />
      )}

      {panel === 'feed' && (
        <ActivityFeed
          feed={feed}
          agents={agents}
          t={t}
          lang={lang}
          fallback={fallback}
          onClose={() => setPanel(null)}
        />
      )}

      {panel === 'hooks' && (
        <HooksPanel
          hooks={hooks}
          hooksOn={hooksOn}
          readOnly={readOnly}
          t={t}
          onClose={() => setPanel(null)}
        />
      )}

      {panel === 'history' && (
        <HistoryPanel
          readOnly={readOnly}
          state={history.state}
          pendingSession={history.pendingSession}
          onReplay={(id) => {
            history.loadSession(id);
            setPanel(null);
          }}
          t={t}
          lang={lang}
          onClose={() => setPanel(null)}
        />
      )}
    </>
  );
}

// ── Pieces ─────────────────────────────────────────────────────

function Stat({ color, value, label }: { color: string; value: string; label: string }) {
  return (
    <div className="obs-stat">
      <i className="obs-dot" style={{ background: color }} />
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

function LanguageSwitch({ lang, t }: { lang: Language; t: Translate }) {
  return (
    <div className="obs-lang" role="group" aria-label={t('lang.label')}>
      {LANGUAGES.map((l) => (
        <button
          key={l}
          type="button"
          className="obs-btn"
          aria-pressed={lang === l}
          title={t(l === 'en' ? 'lang.en' : 'lang.ru')}
          onClick={() => setLanguage(l)}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function PanelHeader({
  title,
  closeLabel,
  onClose,
}: {
  title: string;
  closeLabel: string;
  onClose: () => void;
}) {
  return (
    <header>
      {title}
      <button type="button" className="obs-close" aria-label={closeLabel} onClick={onClose}>
        ×
      </button>
    </header>
  );
}

function Field({
  label,
  value,
  mono,
  t,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
  t: Translate;
}) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={value === null ? 'obs-na' : mono ? 'obs-mono' : undefined}>
        {value ?? t('card.unknown')}
      </dd>
    </>
  );
}

function AgentCard({
  agent,
  connected,
  readOnly,
  onClose,
  t,
  lang,
  fallback,
}: {
  agent: AgentObservation;
  connected: boolean;
  readOnly: boolean;
  onClose: () => void;
  t: Translate;
  lang: Language;
  fallback: (id: number) => string;
}) {
  const now = useNow(15_000);
  const name = agentLabel(agent, fallback);
  const status = displayStatus(agent, connected);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setEditing(false);
  }, [agent.id]);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  // Role only from the source (a named teammate / lead); never guessed.
  const role = agent.agentName
    ? agent.agentName
    : agent.isTeamLead
      ? t('card.roleLead')
      : agent.leadAgentId !== null
        ? t('card.roleTeammate')
        : null;
  const session = sessionLabel(agent);
  const pct =
    agent.contextTokens !== null && agent.maxContextTokens
      ? Math.min(100, Math.round((agent.contextTokens / agent.maxContextTokens) * 100))
      : null;
  const action = agent.currentAction ?? agent.lastAction;

  const save = () => {
    transport.send({ type: 'renameAgent', id: agent.id, name: draft.trim() || null });
    setEditing(false);
  };

  return (
    <section className="obs-panel obs-card" aria-label={t('card.aria', { name })}>
      <div className="obs-card-head">
        <div className="obs-card-title">
          {editing ? (
            <form
              className="obs-rename"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <input
                ref={inputRef}
                value={draft}
                maxLength={40}
                placeholder={t('card.renamePlaceholder')}
                aria-label={t('card.rename')}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    setEditing(false);
                  }
                }}
              />
              <button type="submit" className="obs-btn">
                {t('card.renameSave')}
              </button>
              <button type="button" className="obs-btn" onClick={() => setEditing(false)}>
                {t('card.renameCancel')}
              </button>
              <small>{t('card.renameHint')}</small>
            </form>
          ) : (
            <h2 title={name}>
              {name}
              <button
                type="button"
                className="obs-edit"
                aria-label={t('card.rename')}
                title={readOnly ? t('card.renameNeedsToken') : t('card.rename')}
                disabled={readOnly}
                onClick={() => {
                  setDraft(agent.customName ?? '');
                  setEditing(true);
                }}
              >
                ✎
              </button>
            </h2>
          )}
          <span className="obs-status">
            <i className="obs-dot" style={{ background: STATUS_COLOR[status] }} />
            {t(`status.${status}` as const)}
            {agent.activity && status === 'working'
              ? ` · ${t(`activity.${agent.activity}` as const)}`
              : ''}
          </span>
        </div>
        <button type="button" className="obs-close" aria-label={t('card.close')} onClick={onClose}>
          ×
        </button>
      </div>

      {!connected && <p className="obs-offline">{t('card.offline')}</p>}

      <dl className="obs-fields">
        <Field t={t} label={t('card.platform')} value={providerName(agent.source)} />
        <Field t={t} label={t('card.project')} value={agent.project} />
        <Field
          t={t}
          label={t('card.session')}
          value={`${session ?? ''}${session ? ' · ' : ''}${agent.sessionId.slice(0, 8)}`}
          mono={!session}
        />
        <Field t={t} label={t('card.roleField')} value={role} />
        <Field t={t} label={t('card.task')} value={agent.task} />
        {agent.statusDetail && (status === 'error' || status === 'disconnected') && (
          <Field t={t} label={t('card.detail')} value={agent.statusDetail} />
        )}
      </dl>

      {action && (
        <p className="obs-now">
          <small>{agent.currentAction ? t('card.now') : t('card.lastAction')}</small>
          {translateAction(lang, action)}
        </p>
      )}

      <dl className="obs-fields">
        <Field t={t} label={t('card.branch')} value={agent.gitBranch} mono />
        <Field t={t} label={t('card.model')} value={agent.model} mono />
        <Field
          t={t}
          label={t('card.lastActivity')}
          value={agent.lastEventAt !== null ? relativeTime(agent.lastEventAt, now, t) : null}
        />
        <Field
          t={t}
          label={t('card.subagents')}
          value={
            agent.subagents.length > 0
              ? agent.subagents.map((s) => translateAction(lang, s.label)).join(', ')
              : t('card.noSubagents')
          }
        />
        <dt>{t('card.context')}</dt>
        <dd className={pct === null ? 'obs-na' : undefined}>
          {pct === null ? (
            t('card.unknown')
          ) : (
            <>
              {formatTokens(agent.contextTokens!)} / ~{formatTokens(agent.maxContextTokens!)} ({pct}
              %)
              <div className="obs-gauge">
                <i style={{ width: `${pct}%` }} />
              </div>
            </>
          )}
        </dd>
      </dl>

      <p className="obs-note">
        {agent.channel === 'hooks' ? t('card.fromHooks') : t('card.fromTranscript')} ·{' '}
        {t('card.observingOnly')}
      </p>
    </section>
  );
}

function ActivityFeed({
  feed,
  agents,
  onClose,
  t,
  lang,
  fallback,
}: {
  feed: readonly ActivityEntry[];
  agents: ReadonlyMap<number, AgentObservation>;
  onClose: () => void;
  t: Translate;
  lang: Language;
  fallback: (id: number) => string;
}) {
  const items = [...feed].reverse();
  return (
    <section className="obs-panel obs-feed" aria-label={t('feed.aria')}>
      <PanelHeader title={t('feed.title')} closeLabel={t('feed.close')} onClose={onClose} />
      <ol>
        {items.length === 0 && <span className="obs-empty">{t('feed.empty')}</span>}
        {items.map((e) => {
          const a = agents.get(e.agentId);
          return (
            <li key={e.seq}>
              <time dateTime={new Date(e.ts).toISOString()}>{clock(e.ts, lang)}</time>
              <span>
                <span className="obs-who">{a ? agentLabel(a, fallback) : fallback(e.agentId)}</span>
                {entryText(e, t, lang)}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function HooksPanel({
  hooks,
  hooksOn,
  readOnly,
  t,
  onClose,
}: {
  hooks: HooksControl;
  hooksOn: boolean;
  readOnly: boolean;
  t: Translate;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<'idle' | 'installing' | 'failed'>('idle');
  useEffect(() => {
    if (phase !== 'installing' || hooks.installed === undefined) return;
    // The server answers every install request with the ACTUAL state.
    if (!hooks.installed) setPhase('failed');
  }, [hooks.installed, phase]);
  useEffect(() => {
    if (phase !== 'installing') return;
    const timer = setTimeout(() => setPhase((p) => (p === 'installing' ? 'failed' : p)), 8000);
    return () => clearTimeout(timer);
  }, [phase]);

  return (
    <section className="obs-panel obs-side" aria-label={t('hooks.title')}>
      <PanelHeader title={t('hooks.title')} closeLabel={t('hooks.close')} onClose={onClose} />
      <div className="obs-body">
        {hooksOn ? (
          <p className="obs-ok">{t('hooks.on')}</p>
        ) : (
          <>
            <p>{t('hooks.off')}</p>
            <ul className="obs-facts">
              <li>{t('hooks.what')}</li>
              <li>{t('hooks.data')}</li>
              <li>{t('hooks.undo')}</li>
              <li>{t('hooks.sessions')}</li>
            </ul>
            {readOnly ? (
              <p className="obs-hint">{t('hooks.needToken')}</p>
            ) : hooks.installed === undefined ? (
              <p className="obs-hint">{t('hooks.unknown')}</p>
            ) : (
              <>
                <button
                  type="button"
                  className="obs-primary"
                  disabled={phase === 'installing'}
                  onClick={() => {
                    setPhase('installing');
                    hooks.onInstall();
                  }}
                >
                  {phase === 'installing' ? t('hooks.installing') : t('hooks.enable')}
                </button>
                {phase === 'failed' && <p className="obs-warn">{t('hooks.failed')}</p>}
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function HistoryPanel({
  readOnly,
  state,
  pendingSession,
  onReplay,
  t,
  lang,
  onClose,
}: {
  readOnly: boolean;
  state: ReturnType<typeof useHistory>['state'];
  pendingSession: string | null;
  onReplay: (sessionId: string) => void;
  t: Translate;
  lang: Language;
  onClose: () => void;
}) {
  return (
    <section className="obs-panel obs-side" aria-label={t('history.title')}>
      <PanelHeader title={t('history.title')} closeLabel={t('history.close')} onClose={onClose} />
      {readOnly ? (
        <p className="obs-body obs-hint">{t('history.needToken')}</p>
      ) : state.kind === 'unavailable' ? (
        <p className="obs-body obs-hint">{t('history.unavailable')}</p>
      ) : state.kind !== 'ready' ? (
        <p className="obs-body obs-hint">{t('history.loading')}</p>
      ) : state.sessions.length === 0 ? (
        <p className="obs-body obs-hint">{t('history.empty')}</p>
      ) : (
        <ol className="obs-sessions">
          {state.sessions.map((s) => (
            <li key={s.sessionId}>
              <div className="obs-session-main">
                <b>{s.customName ?? sessionLabel(s) ?? s.sessionId.slice(0, 8)}</b>
                {s.live && <span className="obs-live">{t('history.live')}</span>}
                <small>
                  {providerName(s.source)}
                  {s.project ? ` · ${s.project}` : ''} · {dateRange(s, lang)} ·{' '}
                  {t('history.events', { n: s.events })}
                </small>
              </div>
              <button
                type="button"
                className="obs-btn"
                disabled={pendingSession !== null}
                onClick={() => onReplay(s.sessionId)}
              >
                {t('history.replay')}
              </button>
            </li>
          ))}
        </ol>
      )}
      <p className="obs-note obs-footnote">{t('history.retention')}</p>
    </section>
  );
}

function ReplayPlayer({
  recording,
  session,
  t,
  lang,
  onExit,
}: {
  recording: SessionRecording;
  session: HistorySession | undefined;
  t: Translate;
  lang: Language;
  onExit: () => void;
}) {
  const entries: HistoryEntry[] = recording.entries;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(entries.length > 1);
  const [speed, setSpeed] = useState<number>(16);

  useEffect(() => {
    if (!playing) return;
    const delay = delayToNext(entries, index, speed);
    if (delay === null) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setIndex((i) => i + 1), delay);
    return () => clearTimeout(timer);
  }, [playing, index, speed, entries]);

  const current = entries[index];
  const statuses = statusAt(entries, index);
  const title =
    (session && (session.customName ?? sessionLabel(session))) ??
    session?.project ??
    entries[0]?.project ??
    recording.sessionId.slice(0, 8);

  return (
    <>
      <div className="obs-replay-banner" role="status">
        <b>{t('replay.badge')}</b>
        <span>
          {title} · {t('replay.notice')}
        </span>
      </div>
      <div className="obs-replay-dim" aria-hidden="true" />
      <section className="obs-panel obs-player" aria-label={t('replay.badge')}>
        {entries.length === 0 ? (
          <p className="obs-hint">{t('replay.empty')}</p>
        ) : (
          <>
            <div className="obs-player-now">
              <time>{fullClock(current.ts, lang)}</time>
              <span>{entryText(current, t, lang)}</span>
            </div>
            <div className="obs-player-status">
              <small>{t('replay.statusAt')}:</small>
              {[...statuses].map(([agentId, s]) => (
                <span key={agentId} className="obs-status">
                  <i className="obs-dot" style={{ background: STATUS_COLOR[s] }} />
                  {t(`status.${s}` as const)}
                </span>
              ))}
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(0, entries.length - 1)}
              value={index}
              aria-label={t('replay.position', { i: index + 1, n: entries.length })}
              onChange={(e) => {
                setPlaying(false);
                setIndex(Number(e.target.value));
              }}
            />
            <div className="obs-player-controls">
              <button type="button" className="obs-btn" onClick={() => setPlaying((p) => !p)}>
                {playing ? t('replay.pause') : t('replay.play')}
              </button>
              <button
                type="button"
                className="obs-btn"
                onClick={() => {
                  setIndex(0);
                  setPlaying(true);
                }}
              >
                {t('replay.restart')}
              </button>
              <span className="obs-speed" role="group" aria-label={t('replay.speed')}>
                {REPLAY_SPEEDS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="obs-btn"
                    aria-pressed={speed === s}
                    onClick={() => setSpeed(s)}
                  >
                    ×{s}
                  </button>
                ))}
              </span>
              <span className="obs-player-pos">
                {t('replay.position', { i: index + 1, n: entries.length })}
              </span>
              <button type="button" className="obs-btn obs-exit" onClick={onExit}>
                {t('replay.exit')}
              </button>
            </div>
            {recording.truncated && <p className="obs-note">{t('replay.truncated')}</p>}
          </>
        )}
      </section>
    </>
  );
}

// ── Formatting ─────────────────────────────────────────────────

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function relativeTime(ts: number, now: number, t: Translate): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 10) return t('time.justNow');
  if (s < 60) return t('time.seconds', { n: s });
  const m = Math.round(s / 60);
  if (m < 60) return t('time.minutes', { n: m });
  return t('time.hours', { n: Math.round(m / 60) });
}

function clock(ts: number, lang: Language): string {
  return new Date(ts).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
}

function fullClock(ts: number, lang: Language): string {
  return new Date(ts).toLocaleString(lang, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function dateRange(s: HistorySession, lang: Language): string {
  const d = new Date(s.firstTs).toLocaleDateString(lang, { day: '2-digit', month: 'short' });
  return `${d} ${clock(s.firstTs, lang)}–${clock(s.lastTs, lang)}`;
}

function formatTokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}
