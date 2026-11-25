import { createProjectState, pinLabel, ProjectDocument, terminalStripItems, type SchematicPage } from '@wirewright/core';
import { describe, expect, it } from 'vitest';
import { createStandardLibrary } from './index.js';

const library = createStandardLibrary();
const X1 = { product: 'X1' };

function setup() {
  const doc = new ProjectDocument(createProjectState({ name: 'Levels' }), library);
  const pageId = doc.apply({ type: 'createPage', name: '1' }).created[0]!;
  return { doc, pageId };
}

/** A potential point above (x, 80): feeds the up pin of a terminal placed at y = 80. */
const feed = (pageId: string, x: number, name: string) => ({ type: 'placeSymbol' as const, pageId, symbol: 'wirewright.connection.potential', x, y: 40, props: { name } });
const potential = (doc: ProjectDocument, key: string) => doc.connectivity().potentialOf.get(key)?.name;
const rows = (doc: ProjectDocument) => doc.terminals().strips[0]!.terminals.map((t) => `${t.designation}${t.bridge ?? ''}`);

describe('multi-level terminals', () => {
  it('a double-level terminal has two levels with their own designation, targets and potential', () => {
    const { doc, pageId } = setup();
    doc.apply([
      feed(pageId, 80, '24V'),
      { type: 'placeSymbol', pageId, id: 'i_w', symbol: 'iec60617.terminal.2level', x: 80, y: 80, tag: X1, props: { terminal: '1' } },
    ]);
    expect(rows(doc)).toEqual(['1.1', '1.2']);
    expect(potential(doc, 'i_w:2')).toBe('24V');
    expect(potential(doc, 'i_w:4')).toBeUndefined();
    const page = doc.state.pages[pageId] as SchematicPage;
    const item = page.items.find((i) => i.id === 'i_w')!;
    expect(pinLabel(page, item, { pin: '4' }, library)).toBe('-X1:1.2');
    expect(doc.check().filter((i) => i.code.startsWith('terminal.'))).toEqual([]);
  });

  it.each(['iec60617.terminal.2level.connected', 'iec60617.terminal.2level.pe'])('%s: all four clamping points share the potential', (symbol) => {
    const { doc, pageId } = setup();
    doc.apply([feed(pageId, 80, '24V'), { type: 'placeSymbol', pageId, id: 'i_w', symbol, x: 80, y: 80, tag: X1, props: { terminal: '1' } }]);
    expect(['1', '2', '3', '4'].map((pin) => potential(doc, `i_w:${pin}`))).toEqual(['24V', '24V', '24V', '24V']);
  });

  it('levels drawn apart are one terminal; connected levels share the potential across pages', () => {
    for (const connected of [false, true]) {
      const { doc, pageId } = setup();
      const second = doc.apply({ type: 'createPage', name: '2' }).created[0]!;
      const suffix = connected ? '.connected' : '';
      doc.apply([
        feed(pageId, 80, '24V'),
        { type: 'placeSymbol', pageId, id: 'i_a', symbol: `iec60617.terminal.level.1${suffix}`, x: 80, y: 80, tag: X1, props: { terminal: '1' } },
        { type: 'placeSymbol', pageId: second, id: 'i_b', symbol: `iec60617.terminal.level.2${suffix}`, x: 80, y: 80, tag: X1, props: { terminal: '1' } },
      ]);
      expect(rows(doc)).toEqual(['1.1', '1.2']);
      expect(potential(doc, 'i_b:2')).toBe(connected ? '24V' : undefined);
    }
  });

  it('reports a level drawn twice and levels drawn as connected and as separate', () => {
    const { doc, pageId } = setup();
    doc.apply([
      { type: 'placeSymbol', pageId, symbol: 'iec60617.terminal.level.2', x: 80, y: 80, tag: X1, props: { terminal: '1' } },
      { type: 'placeSymbol', pageId, symbol: 'iec60617.terminal.level.2', x: 120, y: 80, tag: X1, props: { terminal: '1' } },
      { type: 'placeSymbol', pageId, symbol: 'iec60617.terminal.level.1.connected', x: 160, y: 80, tag: X1, props: { terminal: '1' } },
    ]);
    expect(doc.check().filter((i) => i.code.startsWith('terminal.')).map((i) => i.code).sort()).toEqual(['terminal.duplicate', 'terminal.levelMismatch']);
  });

  it('renumbering keeps the levels of a terminal together', () => {
    const { doc, pageId } = setup();
    doc.apply([
      { type: 'placeSymbol', pageId, symbol: 'iec60617.terminal.level.1', x: 80, y: 80, tag: X1, props: { terminal: '7' } },
      { type: 'placeSymbol', pageId, symbol: 'iec60617.terminal.2level', x: 120, y: 80, tag: X1, props: { terminal: '3' } },
      { type: 'placeSymbol', pageId, symbol: 'iec60617.terminal.level.2', x: 200, y: 80, tag: X1, props: { terminal: '7' } },
      { type: 'placeSymbol', pageId, symbol: 'iec60617.terminal', x: 240, y: 80, tag: X1, props: { terminal: '9' } },
    ]);
    doc.apply({ type: 'renumberTerminals', strip: '-X1' });
    expect(rows(doc)).toEqual(['1.1', '1.2', '2.1', '2.2', '3']);
  });

  it('bridges per level: level 2 of three terminals bridged, level 1 separate, each clamping point its own wire', () => {
    const { doc, pageId } = setup();
    doc.apply([
      feed(pageId, 88, '0V'),
      ...[0, 1, 2].map((i) => ({
        type: 'placeSymbol' as const,
        pageId,
        id: `i_w${i}`,
        symbol: 'iec60617.terminal.2level',
        x: 80 + 16 * i,
        y: 80,
        tag: X1,
        props: { terminal: String(i + 1), bridges: { '2': 'B' } },
      })),
    ]);
    expect(rows(doc)).toEqual(['1.1', '1.2B', '2.1', '2.2B', '3.1', '3.2B']);
    expect([0, 1, 2].map((i) => potential(doc, `i_w${i}:4`))).toEqual(['0V', '0V', '0V']);
    expect([0, 1, 2].map((i) => potential(doc, `i_w${i}:2`))).toEqual([undefined, undefined, undefined]);
    const nets = doc.connectivity().netOf;
    expect(nets.get('i_w0:4')).not.toBe(nets.get('i_w1:4'));
  });

  it('the same bridge label on level 1 and level 2 never joins the levels', () => {
    const { doc, pageId } = setup();
    doc.apply([
      feed(pageId, 80, '24V'),
      ...[0, 1].map((i) => ({
        type: 'placeSymbol' as const,
        pageId,
        id: `i_w${i}`,
        symbol: 'iec60617.terminal.2level',
        x: 80 + 16 * i,
        y: 80,
        tag: X1,
        props: { terminal: String(i + 1), bridges: { '1': 'A', '2': 'A' } },
      })),
    ]);
    expect([0, 1].map((i) => potential(doc, `i_w${i}:2`))).toEqual(['24V', '24V']);
    expect([0, 1].map((i) => potential(doc, `i_w${i}:4`))).toEqual([undefined, undefined]);
    expect(doc.check().filter((i) => i.code.startsWith('terminal.'))).toEqual([]);
  });

  it('a macro of double-level terminals continues the numbering of the strip', () => {
    const { doc, pageId } = setup();
    doc.apply([
      { type: 'placeSymbol', pageId, symbol: 'iec60617.terminal', x: 40, y: 80, tag: X1, props: { terminal: '7' } },
      { type: 'placeItems', pageId, macro: 'wirewright.macro.terminals2level.4', x: 80, y: 80 },
    ]);
    expect(rows(doc)).toEqual(['7', '8.1', '8.2', '9.1', '9.2', '10.1', '10.2', '11.1', '11.2']);
  });

  it('the terminal strip configurator places a strip with bridged levels; a second one gets free bridge labels', () => {
    const { doc, pageId } = setup();
    const items = terminalStripItems({ strip: 'X1', count: 3, levels: 2, bridged: [true, true] });
    doc.apply([feed(pageId, 80, '24V'), { type: 'placeItems', pageId, items, x: 80, y: 80 }]);
    expect(rows(doc)).toEqual(['1.1A', '1.2B', '2.1A', '2.2B', '3.1A', '3.2B']);
    const ids = (doc.state.pages[pageId] as SchematicPage).items.filter((i) => i.symbol === 'iec60617.terminal.2level').map((i) => i.id);
    expect(ids.map((id) => potential(doc, `${id}:2`))).toEqual(['24V', '24V', '24V']);
    doc.apply({ type: 'placeItems', pageId, items, x: 80, y: 160 });
    expect(rows(doc).slice(6)).toEqual(['4.1C', '4.2D', '5.1C', '5.2D', '6.1C', '6.2D']);
  });

  it('configures single-level strips with 2 … 6 connections', () => {
    expect(terminalStripItems({ strip: '-X2', count: 2, levels: 1, pins: 4, bridged: [true] })).toMatchObject([
      { symbol: 'iec60617.terminal.multi.4', x: 0, tag: { product: 'X2' }, props: { terminal: '1', bridge: 'A' } },
      { symbol: 'iec60617.terminal.multi.4', x: 12, props: { terminal: '2', bridge: 'A' } },
    ]);
    expect(terminalStripItems({ strip: 'X1', count: 1, levels: 1, pins: 2 })[0]).toMatchObject({ symbol: 'iec60617.terminal', props: { terminal: '1' } });
    expect(terminalStripItems({ strip: 'X1', count: 1, levels: 2, pe: true })[0]!.symbol).toBe('iec60617.terminal.2level.pe');
    for (const n of [3, 4, 5, 6]) expect(library.symbol(`iec60617.terminal.multi.${n}`)?.connections, String(n)).toHaveLength(n);
  });
});
