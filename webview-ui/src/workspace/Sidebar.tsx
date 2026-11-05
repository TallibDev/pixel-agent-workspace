import './workspace.css';

import type { ReactNode } from 'react';

import { useT } from '../i18n/index.js';
import { useObservation } from '../observation/useObservation.js';
import { Icon, type IconName } from './icons.js';
import { setPanel, togglePanel, usePanel } from './uiStore.js';

interface Props {
  /** Upstream tools (launch, layout editor, settings), kept intact. */
  tools: ReactNode;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  onOpenTerminal: () => void;
  hooksOn: boolean;
}

/** Left navigation column (desktop). */
export function Sidebar({
  tools,
  terminalAvailable,
  terminalOpen,
  onOpenTerminal,
  hooksOn,
}: Props) {
  const t = useT();
  const panel = usePanel();
  const { agents, synced } = useObservation();

  const item = (
    icon: IconName,
    label: string,
    active: boolean,
    onClick: () => void,
    extra?: ReactNode,
    disabled?: string,
  ) => (
    <button
      type="button"
      className="paw-nav-item"
      aria-current={active ? 'page' : undefined}
      disabled={disabled !== undefined}
      title={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
      <span>{label}</span>
      {extra}
    </button>
  );

  return (
    <nav className="paw-sidebar" aria-label={t('nav.aria')}>
      <div className="paw-brand">
        <span className="paw-logo">
          <Icon name="cat" size={22} />
        </span>
        <span className="paw-brand-text">
          Pixel Agent
          <br />
          Workspace
        </span>
      </div>

      <div className="paw-nav">
        {item('office', t('nav.office'), panel === null, () => setPanel(null))}
        {item(
          'agents',
          t('nav.agents'),
          false,
          () => setPanel(null),
          <b className="paw-badge">{synced ? agents.size : '–'}</b>,
        )}
        {item('activity', t('nav.activity'), panel === 'feed', () => togglePanel('feed'))}
        {item('history', t('nav.history'), panel === 'history', () => togglePanel('history'))}
        {item(
          'terminal',
          t('nav.terminal'),
          terminalOpen,
          onOpenTerminal,
          undefined,
          terminalAvailable ? undefined : t('nav.terminalOff'),
        )}
        {item(
          'plug',
          t('nav.hooks'),
          panel === 'hooks',
          () => togglePanel('hooks'),
          <i className={`paw-led ${hooksOn ? 'is-on' : 'is-off'}`} />,
        )}
      </div>

      <div className="paw-sidebar-tools">
        <small>{t('nav.tools')}</small>
        {tools}
      </div>
    </nav>
  );
}
