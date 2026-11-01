// Language of the editor's own texts (menus, dialogs, tooltips). Texts are keyed by their
// English wording; a missing translation shows the English text. Placeholders in braces are
// filled from `values`: tr('Close {name}', { name }) .
// The language comes from Machine settings; without one, from the operating system.
import type { IssueText } from '@wirewright/core';
import { de } from './i18n/de.js';

export const UI_LANGUAGES: readonly { code: string; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'de', name: 'Deutsch' },
];

const dictionaries: Record<string, Record<string, string>> = { de };
let current = 'en';

/** The language used when Machine settings name none: the system language if it is available. */
export function systemUiLanguage(): string {
  const system = typeof navigator === 'undefined' ? 'en' : navigator.language.slice(0, 2).toLowerCase();
  return UI_LANGUAGES.some((l) => l.code === system) ? system : 'en';
}

export function setUiLanguage(language: string | undefined): void {
  const wanted = language ?? systemUiLanguage();
  current = UI_LANGUAGES.some((l) => l.code === wanted) ? wanted : 'en';
  // No DOM in unit tests.
  const page = (globalThis as { document?: { documentElement: { lang: string } } }).document;
  if (page) page.documentElement.lang = current;
}

export function uiLanguage(): string {
  return current;
}

/** Key names in the UI language: tr() for descriptions, otherwise key by key (Ctrl → Strg …). */
export function trKeys(keys: string): string {
  const whole = dictionaries[current]?.[keys];
  if (whole) return whole;
  const names = dictionaries[current] ? KEY_NAMES[current] : undefined;
  return names ? keys.replace(/Page Up|Page Down|Double-click|[A-Z][a-z]+(?:-[a-z]+)?/g, (key) => names[key] ?? key) : keys;
}

const KEY_NAMES: Record<string, Record<string, string>> = {
  de: { Ctrl: 'Strg', Shift: 'Umschalt', Delete: 'Entf', Insert: 'Einfg', 'Page Up': 'Bild↑', 'Page Down': 'Bild↓', Home: 'Pos1', 'Double-click': 'Doppelklick' },
};

export function tr(text: string, values?: Record<string, string | number>): string {
  const translated = dictionaries[current]?.[text] || text;
  return values ? translated.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match)) : translated;
}

/** An issue's message in the UI language (from its template; the English message otherwise). */
export function issueText(issue: { message: string; text?: IssueText }): string {
  if (!issue.text) return tr(issue.message);
  const values = { ...issue.text.values };
  for (const key of issue.text.translate ?? []) if (values[key] !== undefined) values[key] = tr(String(values[key]));
  return tr(issue.text.template, values);
}
