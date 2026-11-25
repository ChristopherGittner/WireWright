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
      feed(pageId, 84, '0V'),
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

  it('the terminal strip configurator bridges each level to the right neighbour; levels stay apart', () => {
    const { doc, pageId } = setup();
    const items = terminalStripItems({ strip: 'X1', count: 3, levels: 2, bridged: [true, true] });
    doc.apply([feed(pageId, 80, '24V'), { type: 'placeItems', pageId, items, x: 80, y: 80 }]);
    const strip = doc.terminals().strips[0]!;
    expect(strip.terminals.map((t) => `${t.designation}${t.bridged}`)).toEqual(['1.1~1', '1.2~2', '2.1~1', '2.2~2', '3.1~1', '3.2~2']);
    const ids = (doc.state.pages[pageId] as SchematicPage).items.filter((i) => i.symbol === 'iec60617.terminal.2level').map((i) => i.id);
    expect(ids.map((id) => potential(doc, `${id}:2`))).toEqual(['24V', '24V', '24V']);
    expect(ids.map((id) => potential(doc, `${id}:4`))).toEqual([undefined, undefined, undefined]);
    // A second strip beside it is not bridged to the first (its last terminal has no bridge to the right).
    doc.apply({ type: 'placeItems', pageId, items, x: 116, y: 80 });
    expect(doc.terminals().strips[0]!.terminals.slice(6).map((t) => `${t.designation}${t.bridged}`)).toEqual(['4.1~3', '4.2~4', '5.1~3', '5.2~4', '6.1~3', '6.2~4']);
  });

  it('bridged to the left or right joins neighbouring terminals of one level only', () => {
    const { doc, pageId } = setup();
    doc.apply([
      feed(pageId, 80, '24V'),
      { type: 'placeSymbol', pageId, id: 'i_a', symbol: 'iec60617.terminal', x: 80, y: 80, tag: X1, props: { terminal: '1', bridgeRight: [1] } },
      { type: 'placeSymbol', pageId, id: 'i_b', symbol: 'iec60617.terminal.2level', x: 88, y: 80, tag: X1, props: { terminal: '2' } },
      { type: 'placeSymbol', pageId, id: 'i_c', symbol: 'iec60617.terminal', x: 100, y: 80, tag: X1, props: { terminal: '3', bridgeLeft: [1] } },
      { type: 'placeSymbol', pageId, id: 'i_d', symbol: 'iec60617.terminal', x: 108, y: 80, tag: X1, props: { terminal: '4' } },
    ]);
    // a → b level 1 (a's right), b level 1 → c (c's left); d not bridged; b level 2 not bridged
    expect(['i_a:2', 'i_b:2', 'i_b:4', 'i_c:2', 'i_d:2'].map((k) => potential(doc, k))).toEqual(['24V', '24V', undefined, '24V', undefined]);
  });

  it('configures single-level strips with 2 … 6 connections', () => {
    const multi = terminalStripItems({ strip: '-X2', count: 2, levels: 1, pins: 4, bridged: [true] });
    expect(multi).toMatchObject([
      { symbol: 'iec60617.terminal.multi.4', x: 0, tag: { product: 'X2' }, props: { terminal: '1', bridgeRight: [1] } },
      { symbol: 'iec60617.terminal.multi.4', x: 12, props: { terminal: '2' } },
    ]);
    expect(multi[1]!.props?.bridgeRight).toBeUndefined();
    expect(terminalStripItems({ strip: 'X1', count: 1, levels: 1, pins: 2 })[0]).toMatchObject({ symbol: 'iec60617.terminal', props: { terminal: '1' } });
    for (const [config, symbol] of [
      [{ levels: 1, pins: 2 }, 'iec60617.terminal.pe'],
      [{ levels: 1, pins: 5 }, 'iec60617.terminal.multi.5.pe'],
      [{ levels: 2 }, 'iec60617.terminal.2level.pe'],
      [{ levels: 3 }, 'iec60617.terminal.3level.pe'],
    ] as const) {
      const item = terminalStripItems({ strip: 'X1', count: 1, pe: true, ...config })[0]!;
      expect(item.symbol).toBe(symbol);
      expect(library.symbol(item.symbol), symbol).toBeDefined();
    }
    for (const n of [3, 4, 5, 6]) expect(library.symbol(`iec60617.terminal.multi.${n}`)?.connections, String(n)).toHaveLength(n);
  });
});
