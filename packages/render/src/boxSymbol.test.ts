import { createProjectState, ProjectDocument, symbolDefinitionSchema } from '@wirewright/core';
import { createStandardLibrary } from '@wirewright/library';
import { describe, expect, it } from 'vitest';
import { symbolFromDeviceBox } from './boxSymbol.js';
import { renderContext } from './render.js';

describe('device box → library symbol', () => {
  it('takes the outline, inner graphics, border pins (outward) and links', () => {
    const library = createStandardLibrary();
    const doc = new ProjectDocument(createProjectState({ name: 'T' }), library);
    doc.apply([
      { type: 'createPage', id: 'p_box0000001', name: '1' },
      { type: 'placeSymbol', pageId: 'p_box0000001', id: 'i_box0000001', symbol: 'wirewright.box.device', x: 100, y: 60, width: 40, height: 32, tag: { product: 'U1' } },
      {
        type: 'setItemProperties',
        pageId: 'p_box0000001',
        itemId: 'i_box0000001',
        borderPins: [
          { id: 'p1', side: 'top', offset: 8, designation: 'L' },
          { id: 'p2', side: 'bottom', offset: 8, designation: 'N' },
          { id: 'p3', side: 'right', offset: 16, designation: 'OUT' },
        ],
        links: [['p1', 'p3']],
      },
      { type: 'placeSymbol', pageId: 'p_box0000001', id: 'i_coil000001', symbol: 'iec60617.relay.coil', x: 120, y: 76 },
    ]);
    const symbol = symbolFromDeviceBox(renderContext(doc), 'p_box0000001', 'i_box0000001');
    expect(symbolDefinitionSchema.safeParse(symbol).success).toBe(true);
    // origin in the middle of the box (120, 76)
    expect(symbol.graphics[0]).toEqual({ type: 'rect', x: -20, y: -16, width: 40, height: 32 });
    expect(symbol.graphics.length).toBeGreaterThan(1);
    expect(symbol.connections).toEqual([
      { id: 'p1', x: -12, y: -16, direction: 'up', designation: 'L' },
      { id: 'p2', x: -12, y: 16, direction: 'down', designation: 'N' },
      { id: 'p3', x: 20, y: 0, direction: 'right', designation: 'OUT' },
    ]);
    expect(symbol.links).toEqual([['p1', 'p3']]);
    expect(symbol).toMatchObject({ id: 'own.u1', letterCode: 'U', defaultRole: 'main' });

    // saved to the project library, it can be placed and connects at its pins
    doc.apply([
      { type: 'addToProjectLibrary', content: { symbols: [symbol] } },
      { type: 'placeSymbol', pageId: 'p_box0000001', id: 'i_new0000001', symbol: 'own.u1', x: 300, y: 100 },
    ]);
    const points = [...doc.connectivity().points.values()].filter((p) => p.itemId === 'i_new0000001');
    expect(points.map((p) => [p.pin, p.x, p.y])).toEqual([
      ['p1', 288, 84],
      ['p2', 288, 116],
      ['p3', 320, 100],
    ]);
  });
});
