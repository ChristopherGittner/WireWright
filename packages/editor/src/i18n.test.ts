import { afterEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { issueText, setUiLanguage, tr, trKeys, uiLanguage } from './i18n.js';
import { de } from './i18n/de.js';

describe('UI texts', () => {
  afterEach(() => setUiLanguage('en'));

  it('English is the key; German comes from the dictionary', () => {
    setUiLanguage('en');
    expect(tr('Project settings')).toBe('Project settings');
    setUiLanguage('de');
    expect(uiLanguage()).toBe('de');
    expect(tr('Project settings')).toBe('Projekteinstellungen');
    expect(tr('Close {name}', { name: 'Seiten' })).toBe('Seiten schließen');
  });

  it('missing translations and unknown languages fall back to English', () => {
    setUiLanguage('de');
    expect(tr('Siemens')).toBe('Siemens');
    setUiLanguage('xx');
    expect(uiLanguage()).toBe('en');
  });

  it('translations keep their placeholders', () => {
    for (const [key, value] of Object.entries(de)) {
      const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(names(value), key).toEqual(names(key));
    }
  });

  it('issues and command errors are translated from their template', () => {
    setUiLanguage('de');
    const issue = { message: 'x', text: { template: '{device}: {function} {pins} is not one of the device\'s contacts ({template})', values: { device: '-K1', function: 'NO contact', pins: '13/14', template: '11/12' }, translate: ['function'] } };
    expect(issueText(issue)).toBe('-K1: Schließer 13/14 ist keiner der Kontakte des Geräts (11/12)');
    expect(issueText({ message: 'Plain English' })).toBe('Plain English');
  });

  it('every issue and command error template of the core has a German text', () => {
    const dir = new URL('../../core/src/', import.meta.url);
    const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    const templates = new Set<string>();
    for (const file of files) {
      const source = readFileSync(new URL(file, dir), 'utf8');
      for (const m of source.matchAll(/(?:issueMessage|commandError)\(\s*(?:'((?:[^'\\]|\\.)*)'|"([^"]*)")/g)) templates.add((m[1] ?? m[2]!).replace(/\\'/g, "'"));
    }
    expect(templates.size).toBeGreaterThan(50);
    expect([...templates].filter((t) => !(t in de))).toEqual([]);
  });

  it('key names follow the UI language', () => {
    setUiLanguage('de');
    expect(trKeys('Ctrl+Z / Ctrl+Y')).toBe('Strg+Z / Strg+Y');
    expect(trKeys('Page Up / Page Down')).toBe('Bild↑ / Bild↓');
    expect(trKeys('? or F1')).toBe('? oder F1');
    setUiLanguage('en');
    expect(trKeys('Ctrl+Z')).toBe('Ctrl+Z');
  });
});
