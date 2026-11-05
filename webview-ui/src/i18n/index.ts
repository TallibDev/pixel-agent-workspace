import { useCallback, useSyncExternalStore } from 'react';

import { en, type MessageKey, ru } from './strings.js';

export type Language = 'en' | 'ru';
export type { MessageKey };

export const LANGUAGES: readonly Language[] = ['en', 'ru'];
const DICTIONARIES: Record<Language, Record<MessageKey, string>> = { en, ru };
const STORAGE_KEY = 'paw.language';

type Vars = Record<string, string | number>;

// Minimal shapes so this module also compiles in non-DOM builds (node tests).
interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const env = globalThis as {
  localStorage?: KeyValueStorage;
  navigator?: { language?: string };
  document?: { documentElement: { lang: string } };
};

function detectLanguage(): Language {
  try {
    const saved = env.localStorage?.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'ru') return saved;
  } catch {
    /* storage unavailable (private window, blocked site data) */
  }
  const nav = env.navigator?.language ?? '';
  return nav.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

let current: Language = detectLanguage();
const listeners = new Set<() => void>();

function applyDocumentLang(lang: Language): void {
  if (env.document) env.document.documentElement.lang = lang;
}
applyDocumentLang(current);

export function getLanguage(): Language {
  return current;
}

export function setLanguage(lang: Language): void {
  if (lang === current) return;
  current = lang;
  applyDocumentLang(lang);
  try {
    env.localStorage?.setItem(STORAGE_KEY, lang);
  } catch {
    /* the choice still applies for this page */
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function translate(lang: Language, key: MessageKey, vars?: Vars): string {
  const template = DICTIONARIES[lang][key] ?? en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) =>
    name in vars ? String(vars[name]) : m,
  );
}

/** Plural form key suffix for a count ('one' | 'few' | 'many'); 'other' maps to 'many'. */
export function pluralForm(lang: Language, n: number): 'one' | 'few' | 'many' {
  const cat = new Intl.PluralRules(lang).select(n);
  return cat === 'one' ? 'one' : cat === 'few' ? 'few' : 'many';
}

/** Translate with the current language (non-React callers). */
export function t(key: MessageKey, vars?: Vars): string {
  return translate(current, key, vars);
}

export type Translate = (key: MessageKey, vars?: Vars) => string;

/** Current language; components using it re-render when it changes. */
export function useLanguage(): Language {
  return useSyncExternalStore(subscribe, getLanguage, getLanguage);
}

/** `t` bound to the current language, re-rendering on change. */
export function useT(): Translate {
  const lang = useLanguage();
  return useCallback((key: MessageKey, vars?: Vars) => translate(lang, key, vars), [lang]);
}

// ── Tool status lines ─────────────────────────────────────────
// The server formats tool activity in English ("Reading app.ts",
// "Running: npm test"). Translate the known shapes, keep file names and
// commands verbatim, and leave anything unrecognised untouched.

const EXACT: Record<string, MessageKey> = {
  'Searching files': 'action.searchingFiles',
  'Searching code': 'action.searchingCode',
  'Fetching web content': 'action.fetchingWeb',
  'Searching the web': 'action.searchingWeb',
  'Running subtask': 'action.runningSubtask',
  'Waiting for your answer': 'action.waitingAnswer',
  Planning: 'action.planning',
  'Editing notebook': 'action.editingNotebook',
  'Creating team': 'action.creatingTeam',
  'Sending message': 'action.sendingMessage',
};

const PREFIX: Array<[string, MessageKey]> = [
  ['Running: ', 'action.running'],
  ['Subtask: ', 'action.subtask'],
  ['Creating team: ', 'action.creatingTeamNamed'],
  ['Reading ', 'action.reading'],
  ['Editing ', 'action.editing'],
  ['Writing ', 'action.writing'],
  ['Using ', 'action.using'],
];

export function translateAction(lang: Language, text: string): string {
  if (lang === 'en') return text;
  const exact = EXACT[text];
  if (exact) return translate(lang, exact);
  for (const [prefix, key] of PREFIX) {
    if (text.startsWith(prefix)) return translate(lang, key, { rest: text.slice(prefix.length) });
  }
  return text;
}

/** Hook form of translateAction. */
export function useTranslateAction(): (text: string) => string {
  const lang = useLanguage();
  return useCallback((text: string) => translateAction(lang, text), [lang]);
}
