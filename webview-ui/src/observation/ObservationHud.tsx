import './observation.css';

import { useEffect, useMemo, useState } from 'react';

import type { AgentObservation, ObservedStatus } from '../../../core/src/messages.js';
import { agentLabel, countStatuses, STATUS_LABEL } from './observationStore.js';
import { useObservation } from './useObservation.js';

const STATUS_COLOR: Record<ObservedStatus, string> = {
  working: 'var(--obs-working)',
  waiting_permission: 'var(--obs-waiting)',
  waiting_user: 'var(--obs-waiting-user)',
  idle: 'var(--obs-idle)',
  unknown: 'var(--obs-unknown)',
};

const ACTIVITY_LABEL: Record<string, string> = {
  reading: 'Reading',
  searching: 'Searching',
  writing: 'Writing code',
  running: 'Running a command',
  browsing: 'Browsing the web',
  delegating: 'Delegating',
  planning: 'Planning',
  asking: 'Asking you',
  other: 'Using a tool',
};

const SOURCE_LABEL: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
};

interface Props {
  selectedAgentId: number | null;
  onCloseCard: () => void;
}

/** Summary bar, agent card and activity feed over the office. */
export function ObservationHud({ selectedAgentId, onCloseCard }: Props) {
  const { agents, feed, synced } = useObservation();
  const [feedOpen, setFeedOpen] = useState(false);
  const counts = useMemo(() => countStatuses(agents.values()), [agents]);
  const selected = selectedAgentId !== null ? agents.get(selectedAgentId) : undefined;
  const hooksOn = [...agents.values()].some((a) => a.channel === 'hooks');

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseCard();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, onCloseCard]);

  const n = (v: number) => (synced ? String(v) : '–');

  return (
    <>
      <div className="obs-panel obs-bar" role="status" aria-label="Agent summary">
        <div className="obs-stat" title="Agent sessions detected on this machine">
          <b>{n(counts.detected)}</b>
          <span>agents</span>
        </div>
        <div className="obs-sep" />
        <Stat color={STATUS_COLOR.working} value={n(counts.working)} label="working" />
        <Stat color={STATUS_COLOR.waiting_permission} value={n(counts.waiting)} label="waiting" />
        <Stat color={STATUS_COLOR.idle} value={n(counts.idle)} label="idle" />
        {counts.unknown > 0 && (
          <Stat color={STATUS_COLOR.unknown} value={n(counts.unknown)} label="unknown" />
        )}
        <div className="obs-sep" />
        <button
          type="button"
          className="obs-btn"
          aria-pressed={feedOpen}
          onClick={() => setFeedOpen((v) => !v)}
        >
          Activity
        </button>
        {synced && counts.detected > 0 && (
          <span
            className="obs-stat obs-channel"
            title={
              hooksOn
                ? 'Instant events from Claude Code hooks'
                : 'Read from session transcripts; waiting states are less precise without hooks'
            }
          >
            {hooksOn ? 'hooks' : 'transcripts'}
          </span>
        )}
      </div>

      {selected && <AgentCard agent={selected} onClose={onCloseCard} />}
      {feedOpen && <ActivityFeed feed={feed} agents={agents} onClose={() => setFeedOpen(false)} />}
    </>
  );
}

function Stat({ color, value, label }: { color: string; value: string; label: string }) {
  return (
    <div className="obs-stat">
      <i className="obs-dot" style={{ background: color }} />
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={value === null ? 'obs-na' : mono ? 'obs-mono' : undefined}>
        {value ?? 'Unknown'}
      </dd>
    </>
  );
}

function AgentCard({ agent, onClose }: { agent: AgentObservation; onClose: () => void }) {
  const now = useNow(15_000);
  const role = agent.isTeamLead
    ? 'Team lead'
    : agent.teamName
      ? `Teammate in ${agent.teamName}`
      : agent.leadAgentId !== null
        ? 'Teammate'
        : 'Main agent';
  const pct =
    agent.contextTokens !== null && agent.maxContextTokens
      ? Math.min(100, Math.round((agent.contextTokens / agent.maxContextTokens) * 100))
      : null;

  return (
    <section className="obs-panel obs-card" aria-label={`Agent ${agentLabel(agent)}`}>
      <div className="obs-card-head">
        <div className="obs-card-title">
          <h2 title={agentLabel(agent)}>{agentLabel(agent)}</h2>
          <span className="obs-status">
            <i className="obs-dot" style={{ background: STATUS_COLOR[agent.status] }} />
            {STATUS_LABEL[agent.status]}
            {agent.activity && agent.status === 'working'
              ? ` · ${ACTIVITY_LABEL[agent.activity]}`
              : ''}
          </span>
        </div>
        <button type="button" className="obs-close" aria-label="Close card" onClick={onClose}>
          ×
        </button>
      </div>

      {(agent.currentAction || agent.lastAction) && (
        <p className="obs-now">
          <small>{agent.currentAction ? 'Now' : 'Last action'}</small>
          {agent.currentAction ?? agent.lastAction}
        </p>
      )}

      <dl className="obs-fields">
        <Field label="Role" value={role} />
        <Field label="Environment" value={SOURCE_LABEL[agent.source] ?? agent.source} />
        <Field label="Project" value={agent.project} />
        <Field label="Branch" value={agent.gitBranch} mono />
        <Field label="Model" value={agent.model} mono />
        <Field label="Session" value={agent.sessionId.slice(0, 8)} mono />
        <Field
          label="Last activity"
          value={agent.lastEventAt !== null ? relativeTime(agent.lastEventAt, now) : null}
        />
        <Field
          label="Sub-agents"
          value={
            agent.subagents.length > 0
              ? agent.subagents.map((s) => s.label.replace(/^Subtask:\s*/, '')).join(', ')
              : 'None active'
          }
        />
        <dt>Context</dt>
        <dd className={pct === null ? 'obs-na' : undefined}>
          {pct === null ? (
            'Unknown'
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
        {agent.channel === 'hooks' ? 'Live from hooks' : 'From the session transcript'} · observing
        only
      </p>
    </section>
  );
}

function ActivityFeed({
  feed,
  agents,
  onClose,
}: {
  feed: readonly { seq: number; ts: number; agentId: number; text: string }[];
  agents: ReadonlyMap<number, AgentObservation>;
  onClose: () => void;
}) {
  const items = [...feed].reverse();
  return (
    <section className="obs-panel obs-feed" aria-label="Activity feed">
      <header>
        Activity
        <button type="button" className="obs-close" aria-label="Close activity" onClick={onClose}>
          ×
        </button>
      </header>
      <ol>
        {items.length === 0 && <span className="obs-empty">No activity observed yet.</span>}
        {items.map((e) => {
          const a = agents.get(e.agentId);
          return (
            <li key={e.seq}>
              <time dateTime={new Date(e.ts).toISOString()}>{clock(e.ts)}</time>
              <span>
                <span className="obs-who">{a ? agentLabel(a) : `Agent #${e.agentId}`}</span>
                {e.text}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function relativeTime(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return `${h} h ago`;
}

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatTokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}
