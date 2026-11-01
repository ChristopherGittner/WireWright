import { describe, expect, it } from 'vitest';
import { column, documentWithPage } from './test/fixtures.js';

describe('terminal strips', () => {
  function project() {
    const { doc, pageId } = documentWithPage();
    doc.apply([
      { type: 'placeSymbol', pageId, id: 'i_l1', symbol: 'potential', x: column(2), y: 20, props: { name: 'L1' } },
      // -X1 in the cabinet: terminal 2 (bridged with 3) above a contact in the cabinet, a button in the field below
      { type: 'placeSymbol', pageId, id: 'i_x2', symbol: 'terminal', x: column(2), y: 40, tag: { location: 'CAB', product: 'X1' }, props: { terminal: '2', bridge: 'A' } },
      { type: 'placeSymbol', pageId, id: 'i_s', symbol: 'button', x: column(2), y: 60, tag: { location: 'FIELD', product: 'S1' } },
      { type: 'placeSymbol', pageId, id: 'i_x3', symbol: 'terminal', x: column(4), y: 40, tag: { location: 'CAB', product: 'X1' }, props: { terminal: '3', bridge: 'A' } },
      { type: 'placeSymbol', pageId, id: 'i_k', symbol: 'coil', x: column(4), y: 60, tag: { location: 'CAB', product: 'K1' } },
      { type: 'placeSymbol', pageId, id: 'i_pe', symbol: 'terminal', x: column(6), y: 40, tag: { location: 'CAB', product: 'X1' }, props: { terminal: 'PE' } },
    ]);
    return { doc, pageId };
  }

  it('splits targets into internal and external and sorts the terminals', () => {
    const { doc } = project();
    const strip = doc.terminals().strips[0]!;
    expect(strip.device).toBe('=SG+CAB-X1');
    expect(strip.terminals.map((t) => [t.designation, t.bridge, t.internal, t.external])).toEqual([
      ['2', 'A', [], ['=SG+FIELD-S1:1']],
      ['3', 'A', ['=SG+CAB-K1:1'], []],
      ['PE', undefined, [], []],
    ]);
  });

  it('bridged terminals share their potential', () => {
    const { doc } = project();
    expect(doc.connectivity().potentialOf.get('i_k:1')).toEqual({ name: 'L1' });
    expect(doc.check().find((i) => i.code.startsWith('terminal.'))).toBeUndefined();
  });

  it('reports duplicate designations and bridges with one terminal', () => {
    const { doc } = project();
    doc.apply([
      { type: 'setItemProperties', pageId: doc.state.project.pages[0]!, itemId: 'i_x3', props: { terminal: '2', bridge: 'B' } },
    ]);
    expect(doc.check().filter((i) => i.code.startsWith('terminal.')).map((i) => i.code).sort()).toEqual([
      'terminal.duplicate', 'terminal.lonelyBridge', 'terminal.lonelyBridge',
    ]);
  });

  it('renumbers numeric terminals in drawing order and keeps PE', () => {
    const { doc } = project();
    doc.apply({ type: 'renumberTerminals', strip: '=SG+CAB-X1', start: 10 });
    expect(doc.terminals().strips[0]!.terminals.map((t) => `${t.itemId}=${t.designation}`)).toEqual(['i_x2=10', 'i_x3=11', 'i_pe=PE']);
    doc.apply({ type: 'renumberTerminals', strip: '=SG+CAB-X1', start: 10, step: 10 });
    expect(doc.terminals().strips[0]!.terminals.map((t) => t.designation)).toEqual(['10', '20', 'PE']);
    expect(() => doc.apply({ type: 'renumberTerminals', strip: '-X9' })).toThrow(/not found/);
  });
});
