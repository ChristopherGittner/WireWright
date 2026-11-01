import { createProjectState, placePlcCommand, ProjectDocument, resolveSymbol, type SchematicPage } from '@wirewright/core';
import { describe, expect, it } from 'vitest';
import { createStandardLibrary } from './index.js';

const library = createStandardLibrary();

describe('I/O points with several terminals per channel', () => {
  it('a safety input with clock and input: two connections, each joined to its card terminal', () => {
    const doc = new ProjectDocument(createProjectState({ name: 'Safety' }), library);
    doc.apply([
      { type: 'createPage', id: 'p_one', name: '1' },
      {
        type: 'placeSymbol',
        pageId: 'p_one',
        id: 'i_card',
        symbol: 'wirewright.plc.card',
        x: 300,
        y: 40,
        tag: { product: 'A1' },
        props: {
          plc: {
            channels: [
              { channel: 1, kind: 'DI', pin: 'I1', extraPins: [{ pin: 'T1', label: 'Takt' }] },
              { channel: 2, kind: 'DI', pin: 'I2' },
            ],
          },
        },
      },
    ]);
    const card = doc.plc().cards[0]!;
    const command = placePlcCommand(doc.state, library, card, { pageId: 'p_one', x: 100, y: 120 }, 0);
    expect(command).toMatchObject({ symbol: 'wirewright.plc.di.2', pins: { '1': 'T1', '2': 'I1' }, props: { channel: 1 } });
    expect(placePlcCommand(doc.state, library, card, { pageId: 'p_one', x: 200, y: 120 }, 1)).toMatchObject({ symbol: 'wirewright.plc.di', pins: { '1': 'I2' } });
    const point = doc.apply(command).created[0]!;
    const c = doc.connectivity();
    expect(c.netOf.get(`${point}:1`)).toBe(c.netOf.get('i_card:T1'));
    expect(c.netOf.get(`${point}:2`)).toBe(c.netOf.get('i_card:I1'));
    expect(c.netOf.get(`${point}:1`)).not.toBe(c.netOf.get(`${point}:2`));
    // the card master: the first channel takes two rows (clock, input)
    const page = doc.state.pages.p_one as SchematicPage;
    const def = resolveSymbol(page.items.find((i) => i.id === 'i_card')!, library)!;
    expect(def.connections.map((k) => [k.id, k.y])).toEqual([['T1', 12], ['I1', 20], ['I2', 28]]);
  });
});
