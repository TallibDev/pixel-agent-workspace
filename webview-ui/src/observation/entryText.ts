import type { ActivityEntry } from '../../../core/src/messages.js';
import { type Language, type Translate, translateAction } from '../i18n/index.js';

/** Human text of a feed / history entry in the chosen language. */
export function entryText(
  e: Pick<ActivityEntry, 'kind' | 'text'>,
  t: Translate,
  lang: Language,
): string {
  switch (e.kind) {
    case 'joined':
      return t('feed.joined');
    case 'left':
      return t('feed.left');
    case 'permission':
      return t('feed.permission');
    case 'turnEnd':
      return t('feed.turnEnd');
    case 'waitingInput':
      return t('feed.waitingInput');
    case 'error':
      return e.text.startsWith('Error: ')
        ? `${t('feed.error')}: ${e.text.slice('Error: '.length)}`
        : t('feed.error');
    case 'disconnected':
      return t('feed.disconnected');
    case 'subagentStart':
      return t('feed.subagentStart', {
        label: translateAction(lang, e.text.replace(/^Delegated:\s*/, '')),
      });
    case 'subagentEnd':
      return t('feed.subagentEnd', {
        label: translateAction(lang, e.text.replace(/^Subtask finished:\s*/, '')),
      });
    default:
      return translateAction(lang, e.text);
  }
}
