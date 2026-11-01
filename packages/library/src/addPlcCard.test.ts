import { createProjectState, ProjectDocument, type SchematicPage } from '@wirewright/core';
import { describe, expect, it } from 'vitest';
import { createStandardLibrary } from './index.js';

const library = createStandardLibrary();

describe('appending PLC cards', () => {
  it('adds cards to the PLC without drawing them: next slot, next tag; one undo step per card', () => {
    const doc = new ProjectDocument(createProjectState({ name: 'Rack' }), library);
    doc.apply({ type: 'setPlcs', plcs: [{ name: 'PLC1', family: 'codesys' }] });
    doc.apply({ type: 'addPlcCard', station: 'PLC1', device: 'wago.750-375', structure: { location: 'CAB1' } });
    doc.apply({ type: 'addPlcCard', station: 'PLC1', device: 'wago.750-430' });
    doc.apply({ type: 'addPlcCard', station: 'PLC1', device: 'wago.750-530' });
    const cards = doc.plc().cards.filter((c) => c.station?.name === 'PLC1');
    expect(cards.map((c) => [c.device, c.slot, c.channels.length, c.stored])).toEqual([
      ['+CAB1-A1', 0, 0, true], // the coupler: a card without channels
      ['+CAB1-A2', 1, 8, true],
      ['+CAB1-A3', 2, 8, true],
    ]);
    // nothing drawn yet: no pages, no errors
    expect(doc.state.project.pages).toEqual([]);
    expect(doc.state.library?.devices?.map((d) => d.id)).toEqual(['wago.750-375', 'wago.750-430', 'wago.750-530']);
    expect(doc.check().filter((i) => i.severity === 'error')).toEqual([]);
    doc.undo();
    expect(doc.plc().cards).toHaveLength(2);
    // the overview draws them, stacked in columns
    for (let i = 0; i < 6; i++) doc.apply({ type: 'addPlcCard', station: 'PLC1', device: 'wago.750-1405' });
    doc.apply({ type: 'generatePlcOverview', station: 'PLC1' });
    const pages = Object.values(doc.state.pages).filter((p): p is SchematicPage => p.type === 'schematic' && p.properties?.plcOverview === 'PLC1');
    expect(pages.flatMap((p) => p.items)).toHaveLength(8);
    expect(doc.plc().cards.every((c) => !c.stored && c.drawings.length === 1)).toBe(true);
    expect(() => doc.apply({ type: 'addPlcCard', station: 'PLC1', device: 'relay.2co' })).toThrow(/not a PLC card/);
    expect(() => doc.apply({ type: 'addPlcCard', station: 'NOPE', device: 'wago.750-430' })).toThrow(/not found/);
  });
});
