import { describe, expect, it } from 'vitest';
import type { SchematicPage } from './schema.js';
import { column, documentWithPage } from './test/fixtures.js';
import { collectTexts, exportTranslations, groupTexts, parseCsv, planTranslationImport, readTranslationTable } from './translations.js';

function project() {
  const { doc, pageId } = documentWithPage();
  doc.apply([
    { type: 'setProjectSettings', settings: { languages: ['de', 'en'] } },
    { type: 'setPageProperties', pageId, description: { de: 'Steuerung' } },
    { type: 'placeSymbol', pageId, id: 'i_a', symbol: 'coil', x: column(2), y: 100, props: { functionText: { de: 'Band ein', en: 'Belt on' }, technicalData: '24 V' } },
    { type: 'placeSymbol', pageId, id: 'i_b', symbol: 'coil', x: column(5), y: 100, props: { functionText: { de: 'Band ein', en: 'Belt on' } } },
    { type: 'placeSymbol', pageId, id: 'i_c', symbol: 'button', x: column(7), y: 100, props: { functionText: { de: 'Störung; "quittieren"' } } },
  ]);
  return { doc, pageId };
}

describe('translations', () => {
  it('collects all multilingual texts and groups identical ones', () => {
    const { doc } = project();
    const entries = collectTexts(doc.state, doc.library);
    expect(entries.map((e) => `${e.field} ${e.where}`)).toEqual([
      'pageDescription =SG+10/5',
      'functionText =SG+10-5K2 (/5.2)',
      'technicalData =SG+10-5K2 (/5.2)',
      'functionText =SG+10-5K5 (/5.5)',
      'functionText =SG+10-5S7 (/5.7)',
    ]);
    // a language-neutral text counts for every language
    expect(entries[2]!.values).toEqual({ de: '24 V', en: '24 V' });
    const groups = groupTexts(entries, ['de', 'en']);
    expect(groups.map((g) => [g.values.de, g.entries.length])).toEqual([
      ['24 V', 1],
      ['Band ein', 2],
      ['Steuerung', 1],
      ['Störung; "quittieren"', 1],
    ]);
  });

  it('setTexts changes one language and keeps the others', () => {
    const { doc, pageId } = project();
    doc.apply({ type: 'setTexts', texts: [
      { key: 'item:' + pageId + ':i_c:functionText', language: 'en', value: 'Acknowledge fault' },
      { key: 'item:' + pageId + ':i_a:technicalData', language: 'en', value: '24 V DC' },
      { key: 'item:' + pageId + ':i_a:functionText', language: 'de', value: '' },
      { key: 'page:' + pageId + ':description', language: 'en', value: 'Control' },
    ] });
    const items = (doc.state.pages[pageId] as SchematicPage).items;
    expect(items.find((i) => i.id === 'i_c')?.props?.functionText).toEqual({ de: 'Störung; "quittieren"', en: 'Acknowledge fault' });
    expect(items.find((i) => i.id === 'i_a')?.props?.technicalData).toEqual({ de: '24 V', en: '24 V DC' });
    expect(items.find((i) => i.id === 'i_a')?.props?.functionText).toEqual({ en: 'Belt on' });
    expect(doc.state.pages[pageId]!.description).toEqual({ de: 'Steuerung', en: 'Control' });
    expect(() => doc.apply({ type: 'setTexts', texts: [{ key: 'nope', language: 'en', value: 'x' }] })).toThrow(/Unknown text/);
  });

  it.each(['csv', 'ods'] as const)('exports and imports %s: rows are matched by the source language', (format) => {
    const { doc } = project();
    const entries = collectTexts(doc.state, doc.library);
    const file = exportTranslations(groupTexts(entries, ['de', 'en']), ['de', 'en'], format);
    const table = readTranslationTable(file.content, format);
    expect(table[0]).toEqual(['de', 'en', 'Used at']);
    expect(table.find((r) => r[0] === 'Störung; "quittieren"')?.[1]).toBe('');
    // the translator fills in the English column
    for (const row of table) if (row[0] === 'Störung; "quittieren"') row[1] = 'Acknowledge fault';
    for (const row of table) if (row[0] === 'Band ein') row[1] = 'Conveyor on';
    table.push(['Unbekannt', 'Unknown']);
    const plan = planTranslationImport(table, entries, ['de', 'en']);
    expect(plan.unmatched).toEqual(['Unbekannt']);
    expect(plan.texts.map((t) => `${t.key.split(':')[2]} ${t.value}`).sort()).toEqual(['i_a Conveyor on', 'i_b Conveyor on', 'i_c Acknowledge fault']);
    doc.apply({ type: 'setTexts', texts: plan.texts });
    expect(planTranslationImport(table, collectTexts(doc.state, doc.library), ['de', 'en']).texts).toEqual([]);
  });

  it('a source text with two different translations: unchanged rows change nothing, a changed row only its own text', () => {
    const { doc, pageId } = project();
    doc.apply({ type: 'placeSymbol', pageId, id: 'i_d', symbol: 'button', x: column(9), y: 100, props: { functionText: { de: 'Band ein', en: 'Conveyor on' } } });
    const entries = collectTexts(doc.state, doc.library);
    const table = readTranslationTable(exportTranslations(groupTexts(entries, ['de', 'en']), ['de', 'en'], 'csv').content, 'csv');
    expect(planTranslationImport(table, entries, ['de', 'en']).texts).toEqual([]);
    for (const row of table) if (row[0] === 'Band ein' && row[1] === 'Conveyor on') row[1] = 'Start conveyor';
    expect(planTranslationImport(table, entries, ['de', 'en']).texts).toEqual([{ key: `item:${pageId}:i_d:functionText`, language: 'en', value: 'Start conveyor' }]);
  });

  it('free texts are translatable', () => {
    const { doc, pageId } = project();
    doc.apply({ type: 'placeSymbol', pageId, id: 'i_t', symbol: 'text', x: 40, y: 40, props: { text: { de: 'Achtung\nFremdspannung' } } });
    const entry = collectTexts(doc.state, doc.library).find((e) => e.field === 'freeText')!;
    expect(entry).toMatchObject({ key: `item:${pageId}:i_t:text`, values: { de: 'Achtung\nFremdspannung', en: '' } });
    doc.apply({ type: 'setTexts', texts: [{ key: entry.key, language: 'en', value: 'Caution\nexternal voltage' }] });
    expect((doc.state.pages[pageId] as SchematicPage).items.find((i) => i.id === 'i_t')?.props?.text).toEqual({ de: 'Achtung\nFremdspannung', en: 'Caution\nexternal voltage' });
  });

  it('parses CSV with commas, quotes and line breaks', () => {
    expect(parseCsv('\ufeffde,en\r\n"a, ""b""","line 1\nline 2"\n\nc,\n')).toEqual([['de', 'en'], ['a, "b"', 'line 1\nline 2'], ['c', '']]);
  });
});
