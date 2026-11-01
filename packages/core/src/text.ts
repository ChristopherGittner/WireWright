import type { LocalizedText } from './schema.js';

/**
 * The text in `language`. Falls back to the given languages in order, then to
 * any translation. Plain strings are the same in every language.
 */
export function localize(text: LocalizedText | undefined, language: string, fallbacks: readonly string[] = []): string {
  if (text === undefined) return '';
  if (typeof text === 'string') return text;
  for (const lang of [language, ...fallbacks]) {
    const value = text[lang];
    if (value !== undefined && value !== '') return value;
  }
  return Object.values(text).find((v) => v !== '') ?? '';
}

/** Project languages that have no (non-empty) translation. Plain strings are never missing. */
export function missingLanguages(text: LocalizedText | undefined, languages: readonly string[]): string[] {
  if (text === undefined || typeof text === 'string') return [];
  const hasAny = Object.values(text).some((v) => v !== '');
  if (!hasAny) return [];
  return languages.filter((lang) => !text[lang]);
}

/** Sets the text for one language, keeping the others. A plain string becomes a translation map. */
export function withTranslation(
  text: LocalizedText | undefined,
  language: string,
  value: string,
  languages: readonly string[],
): LocalizedText {
  if (text === undefined || typeof text === 'string') {
    const map: Record<string, string> = {};
    for (const lang of languages) map[lang] = typeof text === 'string' ? text : '';
    map[language] = value;
    return map;
  }
  return { ...text, [language]: value };
}
