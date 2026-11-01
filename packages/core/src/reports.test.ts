import { describe, expect, it } from 'vitest';
import { reportRows, reportToCsv, naturalCompare } from './reports.js';
import { column, documentWithPage, library } from './test/fixtures.js';

describe('sheets', () => {
  it('expands report pages to several sheets and counts the page index itself', () => {
    const { doc } = documentWithPage();
    // 3 rows per sheet in the test forms
    doc.apply([
      { type: 'createReportPage', id: 'p_toc', name: '1', kind: 'pageIndex', structure: { function: 'DOC' }, index: 0 },
      ...['6', '7', '8', '9'].map((name) => ({ type: 'createPage' as const, name })),
    ]);
    const sheets = doc.sheets().sheets;
    // 5 schematic pages + 2 index sheets = 7 rows → needs 3 sheets → 8 rows → still 3 sheets
    expect(sheets.map((s) => s.name)).toEqual(['1.1', '1.2', '1.3', '5', '6', '7', '8', '9']);
    expect(sheets[0]).toMatchObject({ fullName: '=DOC/1.1', number: 1, sheetCount: 3 });
    expect(sheets[0]?.rows?.map((r) => r.page)).toEqual(['=DOC/1.1', '=DOC/1.2', '=DOC/1.3']);
    expect(sheets.at(-1)?.number).toBe(8);
  });

  it('an empty report still has one sheet', () => {
    const { doc } = documentWithPage();
    doc.apply({ type: 'createReportPage', name: '90', kind: 'bom' });
    expect(doc.sheets().sheets.map((s) => s.name)).toEqual(['5', '90']);
  });
});

describe('report rows', () => {
  function project() {
    const { doc, pageId } = documentWithPage();
    doc.apply([
      { type: 'placeSymbol', pageId, id: 'i_k', symbol: 'coil', x: column(3), y: 100, tag: { product: 'K10' },
        props: { functionText: { de: 'Band ein', en: 'Belt on' }, parts: [{ manufacturer: 'Finder', partNumber: '40.52', quantity: 1 }] } },
      { type: 'placeSymbol', pageId, id: 'i_k2', symbol: 'coil', x: column(4), y: 100, tag: { product: 'K2' },
        props: { parts: [{ manufacturer: 'Finder', partNumber: '40.52', quantity: 1 }] } },
      { type: 'placeSymbol', pageId, id: 'i_s', symbol: 'no', x: column(3), y: 60, tag: { product: 'K10' } },
      // Terminal -X1:1 between the potential point L1 and the contact
      { type: 'placeSymbol', pageId, id: 'i_l1', symbol: 'potential', x: column(3), y: 20, props: { name: 'L1' } },
      { type: 'placeSymbol', pageId, id: 'i_x', symbol: 'terminal', x: column(3), y: 40, tag: { product: 'X1' }, props: { terminal: '1' } },
    ]);
    return doc;
  }

  it('device directory: sorted naturally, with function text, part and placements', () => {
    const rows = reportRows('deviceIndex', project().reportContext());
    expect(rows.map((r) => r.tag)).toEqual(['=SG+10-K2', '=SG+10-K10', '=SG+10-X1']);
    expect(rows[1]).toEqual({ tag: '=SG+10-K10', functionText: 'Band ein', part: 'Finder 40.52', functions: '/5.3, NO /5.3' });
  });

  it('bill of materials: sums quantities per part', () => {
    expect(reportRows('bom', project().reportContext())).toEqual([
      { quantity: '2', manufacturer: 'Finder', partNumber: '40.52', description: '', devices: '=SG+10-K2, =SG+10-K10', unitPrice: '', total: '', supplier: '', erpNumber: '' },
    ]);
  });

  it('bill of materials: description, prices and supplier from the parts database, sum per currency', () => {
    const doc = project();
    doc.apply({
      type: 'addToProjectLibrary',
      content: {
        parts: [
          {
            id: 'Finder:40.52',
            manufacturer: 'Finder',
            partNumber: '40.52',
            description: { de: 'Relais 2 W', en: 'Relay 2 CO' },
            erpNumber: 'M-100',
            price: 125,
            priceUnit: 10,
            currency: 'EUR',
            suppliers: [{ name: 'Elektro AG', orderNumber: 'EA-4052' }],
          },
        ],
      },
    });
    const rows = reportRows('bom', doc.reportContext());
    expect(rows[0]).toMatchObject({ description: 'Relais 2 W', unitPrice: '12,50 EUR', total: '25,00 EUR', supplier: 'Elektro AG EA-4052', erpNumber: 'M-100' });
    expect(rows[1]).toMatchObject({ description: 'Summe', total: '25,00 EUR' });
    doc.apply({ type: 'removeFromProjectLibrary', kind: 'parts', ids: ['Finder:40.52'] });
    expect(doc.state.library?.parts).toBeUndefined();
    expect(reportRows('bom', doc.reportContext())).toHaveLength(1);
  });

  it('terminal list: internal and external targets of each terminal', () => {
    const rows = reportRows('terminalList', project().reportContext());
    expect(rows).toEqual([{ strip: '=SG+10-X1', terminal: '1', external: '', internal: '=SG+10-K10:13', bridge: '', page: '=SG+10/5.3' }]);
  });

  it('CSV export with localized headers', () => {
    const form = library.form('iec.form.bom')!;
    const csv = reportToCsv({ ...form, columns: [{ key: 'a', title: { de: 'Menge', en: 'Qty' }, width: 1 }, { key: 'b', title: 'Text', width: 1 }] }, [
      { a: '2', b: 'with ; and "quotes"' },
    ], 'de');
    expect(csv).toBe('﻿Menge;Text\r\n2;"with ; and ""quotes"""\r\n');
  });

  it('natural order', () => {
    expect(['-K10', '-K2', '-K1'].sort(naturalCompare)).toEqual(['-K1', '-K2', '-K10']);
  });
});

describe('title page and structure overview', () => {
  it('title page: known project properties first, empty ones left out', () => {
    const { doc } = documentWithPage();
    doc.apply({ type: 'setProjectProperties', properties: { site: 'Halle 3', customer: 'ACME', createdBy: '' } });
    expect(reportRows('titlePage', doc.reportContext())).toEqual([
      { label: 'Kunde', value: 'ACME' },
      { label: 'site', value: 'Halle 3' },
    ]);
  });

  it('structure overview: functions and locations in settings order, then unlisted codes', () => {
    const { doc } = documentWithPage();
    doc.apply({
      type: 'setStructures',
      structures: { function: [{ code: 'DOC', description: { de: 'Dokumentation', en: 'Documentation' } }], location: [{ code: '10', description: 'Schrank 1' }] },
    });
    expect(reportRows('structureOverview', doc.reportContext())).toEqual([
      { structure: '=DOC', kind: 'Funktion', description: 'Dokumentation', pages: '' },
      { structure: '=SG', kind: 'Funktion', description: '', pages: '1' },
      { structure: '+10', kind: 'Ort', description: 'Schrank 1', pages: '1' },
    ]);
  });
});
