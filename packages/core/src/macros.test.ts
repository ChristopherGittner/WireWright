import { describe, expect, it } from 'vitest';
import { macroFromItems } from './macros.js';
import type { SchematicPage } from './schema.js';
import { column, documentWithPage } from './test/fixtures.js';

describe('macros', () => {
  function source() {
    const { doc, pageId } = documentWithPage();
    doc.apply([
      // A self-holding circuit: coil -K1 with its contact, a button, a contact of an outside relay -K9 and a wire marker
      { type: 'placeSymbol', pageId, id: 'i_k', symbol: 'coil', x: column(2), y: 120, tag: { product: 'K1' } },
      { type: 'placeSymbol', pageId, id: 'i_c', symbol: 'no', x: column(3), y: 60, tag: { product: 'K1' } },
      { type: 'placeSymbol', pageId, id: 'i_s', symbol: 'button', x: column(2), y: 60 },
      { type: 'placeSymbol', pageId, id: 'i_ext', symbol: 'nc', x: column(2), y: 90, tag: { product: 'K9' } },
      { type: 'placeSymbol', pageId, id: 'i_w', symbol: 'marker', x: column(2), y: 80, props: { wire: { number: '5.2.1', color: 'BU' } } },
    ]);
    return { doc, pageId };
  }

  it('stores items relative to the top-left item without wire numbers', () => {
    const { doc, pageId } = source();
    const macro = macroFromItems(doc.state.pages[pageId] as SchematicPage, ['i_k', 'i_c', 'i_s', 'i_w'], { id: 'selfhold', name: 'Self-holding' });
    expect(Math.min(...macro.items.map((i) => i.x))).toBe(0);
    expect(Math.min(...macro.items.map((i) => i.y))).toBe(0);
    expect(macro.items.find((i) => i.id === 'i_w')?.props?.wire).toEqual({ color: 'BU' });
  });

  it('places a macro with new device names; contacts follow their coil, outside devices keep their tag', () => {
    const { doc, pageId } = source();
    const macro = macroFromItems(doc.state.pages[pageId] as SchematicPage, ['i_k', 'i_c', 'i_s', 'i_ext'], { id: 'selfhold', name: 'Self-holding' });
    doc.apply({ type: 'addToProjectLibrary', content: { macros: [macro] } });
    const { created } = doc.apply({ type: 'placeItems', pageId, macro: 'selfhold', x: column(6), y: 60 });
    expect(created).toHaveLength(4);
    const page = doc.state.pages[pageId] as SchematicPage;
    const placed = created.map((id) => page.items.find((i) => i.id === id)!);
    const products = Object.fromEntries(placed.map((i) => [i.symbol, i.tag?.product]));
    expect(products.coil).toBe('5K6');
    expect(products.no).toBe('5K6');
    expect(products.button).toBe('5S6');
    expect(products.nc).toBe('K9');
    const k6 = doc.devices().devices.get('=SG+10-5K6')!;
    expect(k6.functions.map((f) => f.function).sort()).toEqual(['contact.no', 'relay.coil']);
  });

  it('keeps names when asked to and reports unknown macros', () => {
    const { doc, pageId } = source();
    const items = (doc.state.pages[pageId] as SchematicPage).items.filter((i) => i.id === 'i_k');
    const { created } = doc.apply({ type: 'placeItems', pageId, items, x: 300, y: 200, renameDevices: false });
    const placed = (doc.state.pages[pageId] as SchematicPage).items.find((i) => i.id === created[0])!;
    expect([placed.x, placed.y, placed.tag?.product]).toEqual([300, 200, 'K1']);
    expect(() => doc.apply({ type: 'placeItems', pageId, macro: 'nope', x: 0, y: 0 })).toThrow(/Unknown macro/);
  });
});
