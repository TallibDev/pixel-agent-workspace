import './workspace.css';

import { useEffect, useState } from 'react';

import { LANGUAGES, setLanguage, useLanguage, useT } from '../i18n/index.js';
import { useObservation } from '../observation/useObservation.js';
import { setTimeMode, TIME_MODES, type TimeMode, useTimeMode } from '../office/life/timeOfDay.js';
import { Icon, type IconName } from './icons.js';

const MODE_ICON: Record<TimeMode, IconName> = { day: 'sun', night: 'moon', auto: 'auto' };

interface Props {
  onFocusAgent: (id: number) => void;
}

/** Top-right bar: clock, time-of-day switch, attention bell, language. */
export function TopBar({ onFocusAgent }: Props) {
  const t = useT();
  const lang = useLanguage();
  const mode = useTimeMode();
  const now = useClock();
  const { agents } = useObservation();
  const waiting = [...agents.values()].filter(
    (a) => a.status === 'waiting_permission' || a.status === 'waiting_user',
  );

  return (
    <div className="paw-topbar">
      <time className="paw-clock" dateTime={now.toISOString()}>
        {now.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}
      </time>

      <div className="paw-seg" role="radiogroup" aria-label={t('top.time')}>
        {TIME_MODES.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            title={t(m === 'day' ? 'top.day' : m === 'night' ? 'top.night' : 'top.auto')}
            onClick={() => setTimeMode(m)}
          >
            <Icon name={MODE_ICON[m]} size={17} />
          </button>
        ))}
      </div>

      <button
        type="button"
        className="paw-bell"
        title={waiting.length > 0 ? t('top.bell', { n: waiting.length }) : t('top.bellNone')}
        aria-label={waiting.length > 0 ? t('top.bell', { n: waiting.length }) : t('top.bellNone')}
        disabled={waiting.length === 0}
        onClick={() => waiting[0] && onFocusAgent(waiting[0].id)}
      >
        <Icon name="bell" size={19} />
        {waiting.length > 0 && <i className="paw-bell-dot">{waiting.length}</i>}
      </button>

      <div className="paw-seg paw-lang" role="radiogroup" aria-label={t('lang.label')}>
        {LANGUAGES.map((l) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={lang === l}
            title={t(l === 'en' ? 'lang.en' : 'lang.ru')}
            onClick={() => setLanguage(l)}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}

function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
