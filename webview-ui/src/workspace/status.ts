import type { ObservedStatus } from '../../../core/src/messages.js';

/** Status dot colours (CSS variables defined in workspace.css). */
export const STATUS_DOT: Record<ObservedStatus, string> = {
  working: 'var(--paw-ok)',
  waiting_permission: 'var(--paw-warn)',
  waiting_user: 'var(--paw-warn)',
  idle: 'var(--paw-idle)',
  completed: 'var(--paw-done)',
  error: 'var(--paw-error)',
  disconnected: 'var(--paw-unknown)',
  unknown: 'var(--paw-unknown)',
};
