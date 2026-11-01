import { describe, expect, it } from 'vitest';
import { DEFAULT_FOOTPRINT, layoutFootprint, layoutSize } from './layout.js';
import { reportRows } from './reports.js';
import type { LayoutPage } from './schema.js';
import { column, documentWithPage } from './test/fixtures.js';

describe('cabinet layout', () => {
  function project() {
    const { doc, pageId } = documentWithPage();
    doc.apply([
      { type: 'placeSymbol', pageId, id: 'i_k1', symbol: 'coil', x: column(3), y: 100, tag: { product: 'K1' }, props: { parts: [{ manufacturer: 'Finder', partNumber: '40.52', quantity: 1 }] } },
      { type: 'placeSymbol', pageId, id: 'i_k2', symbol: 'coil', x: column(5), y: 100, tag: { product: 'K2' }, props: { parts: [{ manufacturer: 'ACME', partNumber: 'X', quantity: 1 }] } },
      { type: 'addToProjectLibrary', content: { parts: [{ id: 'Finder:40.52', manufacturer: 'Finder', partNumber: '40.52', width: 15.5, height: 78 }] } },
      { type: 'createLayoutPage', id: 'p_plate', name: '10', plate: { width: 600, height: 800 }, scale: 5 },
    ]);
    return doc;
  }

  it('places rails, ducts and devices; footprints from the parts database', () => {
    const doc = project();
    const { created } = doc.apply([
      { type: 'setLayoutItem', pageId: 'p_plate', item: { kind: 'rail', x: 20, y: 100, length: 560 } },
      { type: 'setLayoutItem', pageId: 'p_plate', item: { kind: 'duct', x: 20, y: 40, length: 560, width: 40 } },
      { type: 'setLayoutItem', pageId: 'p_plate', item: { kind: 'device', itemId: 'i_k1', x: 40, y: 78.5 } },
      { type: 'setLayoutItem', pageId: 'p_plate', item: { kind: 'device', itemId: 'i_k2', x: 80, y: 78.5, turned: true } },
    ]);
    expect(created).toHaveLength(4);
    const page = doc.state.pages.p_plate as LayoutPage;
    const [rail, duct, k1, k2] = page.items as [any, any, any, any];
    expect(layoutSize(rail)).toEqual({ width: 560, height: 35 });
    expect(layoutSize({ ...duct, vertical: true })).toEqual({ width: 40, height: 560 });
    expect(layoutFootprint(doc.state, doc.library, doc.devices(), k1)).toMatchObject({ width: 15.5, height: 78, device: '=SG+10-K1', fromPart: true });
    expect(layoutFootprint(doc.state, doc.library, doc.devices(), k2)).toMatchObject({ width: DEFAULT_FOOTPRINT.height, height: DEFAULT_FOOTPRINT.width, fromPart: false });

    // moving and replacing keep the ID
    doc.apply({ type: 'moveLayoutItems', pageId: 'p_plate', itemIds: [k1.id], dx: 5, dy: 0 });
    doc.apply({ type: 'setLayoutItem', pageId: 'p_plate', item: { ...rail, length: 400 } });
    expect((doc.state.pages.p_plate as LayoutPage).items.map((i) => [i.id, i.x])).toEqual([[rail.id, 20], [duct.id, 20], [k1.id, 45], [k2.id, 80]]);

    expect(reportRows('mountingPlate', doc.reportContext())).toEqual([
      { page: '/10', kind: 'Montageplatte', designation: '1:5', size: '600 × 800 mm', quantity: '1' },
      { page: '/10', kind: 'Hutschiene', designation: 'TS35', size: '400 mm', quantity: '1' },
      { page: '/10', kind: 'Kabelkanal', designation: '40 mm', size: '560 mm', quantity: '1' },
      { page: '/10', kind: '=SG+10-K1', designation: 'Finder 40.52', size: '15,5 × 78 mm', quantity: '1' },
      { page: '/10', kind: '=SG+10-K2', designation: 'ACME X', size: '90 × 45 mm *', quantity: '1' },
    ]);
    // one sheet like a schematic page
    expect(doc.sheets().sheets.find((s) => s.pageId === 'p_plate')).toMatchObject({ sheetCount: 1 });

    doc.apply({ type: 'deleteLayoutItems', pageId: 'p_plate', itemIds: [duct.id] });
    expect((doc.state.pages.p_plate as LayoutPage).items).toHaveLength(3);
    expect(() => doc.apply({ type: 'setLayoutItem', pageId: Object.keys(doc.state.pages)[0]!, item: { kind: 'rail', x: 0, y: 0, length: 10 } })).toThrow(/not a cabinet layout/);
  });

  it('lays out a door: round command devices, cutouts, function texts', () => {
    const doc = project();
    doc.apply([
      { type: 'createLayoutPage', id: 'p_door', name: '11', plate: { width: 600, height: 800 }, scale: 5, surface: 'door' },
      { type: 'setLayoutItem', pageId: 'p_door', item: { kind: 'device', itemId: 'i_k2', x: 100, y: 100 } },
      { type: 'setLayoutItem', pageId: 'p_door', item: { kind: 'cutout', x: 200, y: 100, width: 192, height: 138, label: 'HMI' } },
    ]);
    const door = doc.state.pages.p_door as LayoutPage;
    expect(door.surface).toBe('door');
    const device = door.items[0] as Extract<LayoutPage['items'][number], { kind: 'device' }>;
    expect(layoutFootprint(doc.state, doc.library, doc.devices(), device, 'door')).toMatchObject({ width: 30, height: 30, shape: 'round' });
    // the plate's default stays rectangular
    expect(layoutFootprint(doc.state, doc.library, doc.devices(), device)).toMatchObject({ shape: 'rect' });
    const rows = reportRows('mountingPlate', doc.reportContext()).filter((r) => r.page === '/11');
    expect(rows).toEqual([
      { page: '/11', kind: 'Tür', designation: '1:5', size: '600 × 800 mm', quantity: '1' },
      { page: '/11', kind: 'Ausschnitt', designation: 'HMI', size: '192 × 138 mm', quantity: '1' },
      { page: '/11', kind: '=SG+10-K2', designation: 'ACME X', size: 'Ø 30 mm, Bohrung Ø 22,5 mm *', quantity: '1' },
    ]);
    doc.apply({ type: 'setLayoutPage', pageId: 'p_door', surface: 'plate' });
    expect((doc.state.pages.p_door as LayoutPage).surface).toBeUndefined();
  });

  it('reports devices not placed, placed twice, or gone', () => {
    const doc = project();
    const codes = () => doc.check().filter((i) => i.code.startsWith('layout.')).map((i) => `${i.code} ${i.device ?? ''}`.trim()).sort();
    expect(codes()).toEqual(['layout.notPlaced =SG+10-K1', 'layout.notPlaced =SG+10-K2']);
    doc.apply([
      { type: 'setLayoutItem', pageId: 'p_plate', item: { kind: 'device', itemId: 'i_k1', x: 0, y: 0 } },
      { type: 'setLayoutItem', pageId: 'p_plate', item: { kind: 'device', itemId: 'i_k1', x: 50, y: 0 } },
      { type: 'setLayoutItem', pageId: 'p_plate', item: { kind: 'device', itemId: 'i_gone', x: 100, y: 0 } },
    ]);
    expect(codes()).toEqual(['layout.notPlaced =SG+10-K2', 'layout.placedTwice =SG+10-K1', 'layout.unknownDevice']);
  });
});
