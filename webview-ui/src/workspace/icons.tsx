/** Minimal line icons (24×24, currentColor) for the workspace chrome. */
import type { ReactNode } from 'react';

function Svg({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export type IconName =
  | 'office'
  | 'agents'
  | 'activity'
  | 'history'
  | 'terminal'
  | 'plug'
  | 'sun'
  | 'moon'
  | 'auto'
  | 'bell'
  | 'code'
  | 'hourglass'
  | 'pause'
  | 'check'
  | 'arrow'
  | 'play'
  | 'plus'
  | 'minus'
  | 'alert'
  | 'cat';

const PATHS: Record<IconName, ReactNode> = {
  office: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M10 21v-6h4v6" />
    </>
  ),
  agents: (
    <>
      <rect x="5" y="7" width="14" height="11" rx="3" />
      <path d="M12 3v4M9 12h.01M15 12h.01M9.5 15h5" />
    </>
  ),
  activity: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M8 16v-4M12 16V8M16 16v-6" />
    </>
  ),
  history: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  terminal: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="m8 10 3 2.5L8 15M13 15h3" />
    </>
  ),
  plug: (
    <>
      <path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0z" />
      <path d="M12 16v5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  auto: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v17" />
      <path d="M12 3.5a8.5 8.5 0 0 0 0 17" fill="currentColor" stroke="none" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
      <path d="M10 21h4" />
    </>
  ),
  code: <path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4M13.5 5.5l-3 13" />,
  hourglass: <path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9" />,
  pause: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M10 9v6M14 9v6" />
    </>
  ),
  check: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  arrow: <path d="M4 12h15M14 7l5 5-5 5" />,
  play: <path d="M7 5v14l11-7z" />,
  plus: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
  minus: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8 12h8" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3 2.5 20h19z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ),
  cat: (
    <>
      <path d="M4 20V8l3.5 2.5h9L20 8v12z" />
      <path d="M4 8 5.5 3 9 7M20 8l-1.5-5L15 7" />
      <path d="M9 14h.01M15 14h.01M10.5 17h3" />
    </>
  ),
};

export function Icon({ name, size }: { name: IconName; size?: number }) {
  return <Svg size={size}>{PATHS[name]}</Svg>;
}
