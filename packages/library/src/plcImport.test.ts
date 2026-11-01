import { codesysGvl, gxWorks3Labels, planPlcTagImport, plcTagImportCommands, ProjectDocument, readPlcTags, readXlsx, tiaTagTable, type SchematicPage } from '@wirewright/core';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createDemoProject } from './demo.js';
import { createStandardLibrary } from './index.js';

const library = createStandardLibrary();
const demo = (family?: 'codesys' | 'mitsubishi') => {
  const doc = new ProjectDocument(createDemoProject(library), library);
  if (family) doc.apply({ type: 'setPlcs', plcs: doc.state.project.plcs.map((p) => ({ ...p, family, ...(family === 'mitsubishi' ? { mitsubishiSeries: 'fx' as const } : {}) })) });
  return doc;
};
const plan = (doc: ProjectDocument, content: string | Uint8Array, comments = false) =>
  planPlcTagImport(doc.state, doc.plc(), 'PLC1', readPlcTags(content), { comments, language: 'de' });

describe('PLC tag import', () => {
  it('reads its own TIA export back without changes', () => {
    const doc = demo();
    const result = plan(doc, tiaTagTable(doc.reportContext(), doc.state.project.plcs[0]!, 'de'), true);
    expect(result.changes).toEqual([]);
    expect(result.unchanged).toBe(16);
  });

  it('reads a TIA tag table with shared strings; German mnemonics match; names and comments change', () => {
    const doc = demo();
    const strings = ['Name', 'Logical Address', 'Comment', 'B_Endlage', '%E10.0', 'Endlage Band', 'Y_Oel', '%Q10.0', 'Unbekannt', '%I99.0'];
    const shared = `<sst>${strings.map((t) => `<si><t>${t}</t></si>`).join('')}</sst>`;
    const cell = (ref: string, i: number) => `<c r="${ref}" t="s"><v>${i}</v></c>`;
    const sheet = `<worksheet><sheetData><row r="1">${cell('A1', 0)}${cell('D1', 1)}${cell('E1', 2)}</row><row r="2">${cell('A2', 3)}${cell('D2', 4)}${cell('E2', 5)}</row><row r="3">${cell('A3', 6)}${cell('D3', 7)}</row><row r="4">${cell('A4', 8)}${cell('D4', 9)}</row></sheetData></worksheet>`;
    const xlsx = zipSync({ 'xl/sharedStrings.xml': strToU8(shared), 'xl/worksheets/sheet1.xml': strToU8(sheet) });
    expect(readXlsx(xlsx)[1]).toEqual(['B_Endlage', '', '', '%E10.0', 'Endlage Band']);
    const result = plan(doc, xlsx, true);
    expect(result.unmatched.map((r) => r.name)).toEqual(['Unbekannt']);
    expect(result.changes.map((c) => [c.address, c.name?.to, c.comment?.to])).toEqual([
      ['I10.0', 'B_Endlage', 'Endlage Band'],
      ['Q10.0', 'Y_Oel', undefined],
    ]);
    // written into the card masters; the overview views follow
    doc.apply(plcTagImportCommands(doc.state, result.changes, 'de'));
    const card = (doc.state.pages.p_plc as SchematicPage).items.find((i) => i.id === 'i_dicard')!;
    expect(card.props!.plc!.channels[0]).toMatchObject({ name: 'B_Endlage', function: { de: 'Endlage Band' } });
    expect(plan(doc, xlsx, true).changes).toEqual([]);
  });

  it('reads a Codesys GVL (comments without the card note)', () => {
    const doc = demo('codesys');
    const gvl = codesysGvl(doc.reportContext(), doc.state.project.plcs[0]!, 'de');
    expect(plan(doc, gvl, true).changes).toEqual([]);
    const renamed = gvl.replace(/^\t(\w+) AT %IX10\.1/m, '\tStoerung_Quitt AT %IX10.1');
    expect(plan(doc, renamed).changes.map((c) => [c.address, c.name?.to])).toEqual([['%IX10.1', 'Stoerung_Quitt']]);
  });

  it('reads GX Works3 global labels (tab separated)', () => {
    const doc = demo('mitsubishi');
    const labels = gxWorks3Labels(doc.reportContext(), doc.state.project.plcs[0]!, 'de');
    expect(plan(doc, labels).changes).toEqual([]);
    const first = labels.split('\r\n')[1]!.split('\t');
    const edited = labels.replace(first.join('\t'), ['X_Band_Endlage', ...first.slice(1)].join('\t'));
    expect(plan(doc, edited).changes.map((c) => c.name?.to)).toEqual(['X_Band_Endlage']);
  });

  it('needs a header with name and address', () => {
    expect(() => readPlcTags('a;b\n1;2\n')).toThrow(/header/);
  });
});
