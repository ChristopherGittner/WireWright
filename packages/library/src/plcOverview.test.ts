import { PLC_STORE_PAGE, ProjectDocument, type SchematicPage } from '@wirewright/core';
import { describe, expect, it } from 'vitest';
import { createDemoProject } from './demo.js';
import { createStandardLibrary } from './index.js';

describe('PLC cards in the project and generated overview pages', () => {
  const library = createStandardLibrary();
  const overviewPages = (doc: ProjectDocument) =>
    doc.state.project.pages.map((id) => doc.state.pages[id]!).filter((p): p is SchematicPage => p.type === 'schematic' && p.properties?.plcOverview === 'PLC1');
  const addCard = (doc: ProjectDocument, product: string, slot: number) =>
    doc.apply({ type: 'addPlcCard', device: 'wago.750-430', tag: { function: 'FB', location: 'CAB1', product }, station: 'PLC1', slot }).created[0]!;

  it('a card added in the PLC tab exists without a drawing; the overview draws it', () => {
    const doc = new ProjectDocument(createDemoProject(library), library);
    const id = addCard(doc, 'A20', 3);
    // a device with its channels, not drawn: a hint, no warning
    const card = doc.plc().byCard.get(id)!;
    expect(card).toMatchObject({ device: '=FB+CAB1-A20', stored: true, drawings: [], station: { name: 'PLC1' } });
    expect(card.channels).toHaveLength(8);
    expect(doc.devices().devices.get('=FB+CAB1-A20')?.main?.itemId).toBe(id);
    expect(doc.check().filter((i) => i.device === '=FB+CAB1-A20' && i.severity !== 'info')).toEqual([]);
    expect(doc.check().find((i) => i.code === 'plc.cardNotDrawn' && i.device === '=FB+CAB1-A20')).toBeDefined();
    // the definition is kept in the project; the tag is unique
    expect(doc.state.library?.devices?.map((d) => d.id)).toContain('wago.750-430');
    expect(() => addCard(doc, 'A20', 4)).toThrow(/already exists/);

    // the overview draws only cards not drawn yet: the new card moves onto a new page
    doc.apply({ type: 'generatePlcOverview', station: 'PLC1' });
    const [page] = overviewPages(doc);
    expect(page).toMatchObject({ structure: { function: 'FB', location: 'CAB1' }, description: { de: 'SPS-Übersicht PLC1' } });
    expect(page!.items.map((i) => [i.id, i.x, i.y, i.tag])).toEqual([[id, 36, 24, { product: 'A20' }]]);
    expect(doc.state.project.plcCards).toBeUndefined();
    expect(doc.plc().byCard.get(id)).toMatchObject({ stored: false, drawings: [{ pageId: page!.id, itemId: id }] });
    // again: nothing new
    doc.apply({ type: 'generatePlcOverview', station: 'PLC1' });
    expect(overviewPages(doc)).toHaveLength(1);

    // deleting its drawing keeps the card (full tag) in the PLC tab; removing it deletes it
    doc.apply({ type: 'deleteItems', pageId: page!.id, itemIds: [id] });
    expect(doc.state.project.plcCards?.map((i) => [i.id, i.tag])).toEqual([[id, { function: 'FB', location: 'CAB1', product: 'A20' }]]);
    expect(doc.plc().byCard.get(id)?.stored).toBe(true);
    doc.apply({ type: 'removePlcCards', itemIds: [id] });
    expect(doc.plc().byCard.get(id)).toBeUndefined();
  });

  it('dragging a card: first the card itself, then further drawings (reported)', () => {
    const doc = new ProjectDocument(createDemoProject(library), library);
    const id = addCard(doc, 'A21', 4);
    doc.apply({ type: 'placePlcCard', itemId: id, pageId: 'p_sensors', x: 300, y: 40 });
    expect((doc.state.pages.p_sensors as SchematicPage).items.find((i) => i.id === id)).toMatchObject({ x: 300, y: 40 });
    const view = doc.apply({ type: 'placePlcCard', itemId: id, pageId: 'p_plc', x: 300, y: 40 }).created[0]!;
    expect((doc.state.pages.p_plc as SchematicPage).items.find((i) => i.id === view)?.props?.plcView?.of).toBe(id);
    expect(doc.check().filter((i) => i.code === 'plc.cardDrawnTwice').map((i) => i.message)).toEqual(['=FB+CAB1-A21: the card is drawn 2 times']);
    // editing a card that is not drawn works through the card store
    const other = addCard(doc, 'A22', 5);
    doc.apply({ type: 'setItemProperties', pageId: PLC_STORE_PAGE, itemId: other, props: { functionText: { de: 'Reserve' } } });
    expect(doc.state.project.plcCards?.[0]?.props?.functionText).toEqual({ de: 'Reserve' });
  });

  it('starts a new column when the next card does not fit below', () => {
    const doc = new ProjectDocument(createDemoProject(library), library);
    for (let n = 3; n <= 8; n++) addCard(doc, `A${n + 20}`, n);
    doc.apply({ type: 'generatePlcOverview', station: 'PLC1' });
    const cards = overviewPages(doc)[0]!.items;
    // 8-channel cards are 72 mm high: two per column fit the 240 mm drawing area with gaps, the third goes right
    expect(cards.map((v) => v.x)).toEqual([36, 36, 128, 128, 220, 220]);
  });

  it('refuses an unknown PLC', () => {
    const doc = new ProjectDocument(createDemoProject(library), library);
    expect(() => doc.apply({ type: 'generatePlcOverview', station: 'NOPE' })).toThrow(/not found/);
  });
});
