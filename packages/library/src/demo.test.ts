import { placePlcCommand, ProjectDocument, suggestionLists, type SchematicPage } from '@wirewright/core';
import { describe, expect, it } from 'vitest';
import { createDemoProject, createStandardLibrary } from './index.js';

describe('demo project', () => {
  const library = createStandardLibrary();
  const doc = new ProjectDocument(createDemoProject(library), library);

  it('has no errors or warnings', () => {
    expect(doc.check().filter((i) => i.severity !== 'info')).toEqual([]);
  });

  it('names devices by page and column', () => {
    expect([...doc.devices().devices.keys()].sort()).toEqual([
      '=FB+CAB1-2F2',
      '=FB+CAB1-2T7',
      '=FB+CAB1-2W2',
      '=FB+CAB1-3K7',
      '=FB+CAB1-3P5',
      '=FB+CAB1-3Q2',
      '=FB+CAB1-3S2',
      '=FB+CAB1-3S2.1',
      '=FB+CAB1-3S2.2',
      '=FB+CAB1-3S7',
      '=FB+CAB1-4A1',
      '=FB+CAB1-4A6',
      '=FB+CAB1-5S4',
      '=FB+CAB1-X1',
      '=FB+CAB1-X3',
    '=FB+CAB1-X4',
      '=FB+FIELD-2M2',
      '=FB+FIELD-3M9',
      '=FB+FIELD-5M6',
      '=FB+FIELD-5S2',
    ]);
  });

  it('feeds 24 V from the power supply to the control page', () => {
    const conn = doc.connectivity();
    const potentials = new Set([...conn.potentialOf.values()].map((p) => p.name ?? (p.conflict ? 'CONFLICT' : 'none')));
    // Unused PLC card pins carry no potential.
    expect(potentials).toEqual(new Set(['L1', 'L2', 'L3', 'N', 'PE', '24V', '0V', 'none']));
  });

  it('shows the contactor contacts in its contact image', () => {
    const coil = [...doc.devices().devices.values()].find((d) => d.key === '=FB+CAB1-3Q2')!.main!;
    const rows = doc.crossReferences().byItem.get(coil.itemId)?.contactImage;
    expect(rows?.map((r) => r.reference?.text ?? '')).toEqual(['/2.2', '/3.3', '/3.5']);
  });

  it('fills the report pages', () => {
    const sheets = doc.sheets().sheets;
    expect(sheets.map((s) => s.name)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    expect(sheets.find((s) => s.pageId === 'p_terminals')?.rows).toHaveLength(8);
    expect(sheets.find((s) => s.pageId === 'p_terminals')?.rows?.[4]?.internal).toBe('=FB+CAB1-4A1:1');
    expect(sheets.find((s) => s.pageId === 'p_terminals')?.rows?.slice(5).map((r) => r.bridge)).toEqual(['0V', '0V', '0V']);
    // The bridge carries 0V to the terminals not wired to the rail.
    // Terminal targets are the devices wired to the terminal, not the whole 0V rail.
    expect(sheets.find((s) => s.pageId === 'p_terminals')?.rows?.[5]).toMatchObject({ external: '', internal: '' });
    const x43 = doc.terminals().strips.find((s) => s.device === '=FB+CAB1-X4')!.terminals[2]!;
    expect(doc.connectivity().potentialOf.get(`${x43.itemId}:2`)).toMatchObject({ name: '0V' });
  });

  it('has a motor cable with colored cores and a numbered wire marker', () => {
    const cable = doc.cables().cables[0]!;
    expect(cable.device).toBe('=FB+CAB1-2W2');
    expect(cable.assignments.map((a) => a.core.color)).toEqual(['BN', 'BK', 'GY', 'GNYE']);
    const marker = (doc.state.pages.p_control as { items: { symbol: string; props?: { wire?: { number?: string } } }[] }).items.find((i) => i.symbol === 'wirewright.connection.definition');
    // The 24 V conductor starts at the power supply on page 2 (joined by the "24V" potential points).
    expect(marker?.props?.wire?.number).toBe('2.7.2');
    // Terminals are named by their terminal designation in wire lists
    const ends = doc.wires().wires.flatMap((w) => w.ends);
    expect(ends).toEqual(expect.arrayContaining(['=FB+CAB1-X1:1', '=FB+CAB1-X1:2', '=FB+CAB1-X1:3', '=FB+CAB1-X1:PE']));
  });

  it('assigns the WAGO cards to PLC1 with derived addresses and inherited functions', () => {
    const [di, dq] = doc.plc().cards;
    expect(di?.channels.slice(0, 2).map((c) => [c.address, c.name, c.functionSource])).toEqual([
      ['I10.0', 'DI1_4A1', 'wiring'],
      ['I10.1', 'DI2_4A1', 'wiring'],
    ]);
    expect(dq?.channels[0]).toMatchObject({ address: 'Q10.0', function: { de: 'Schmierventil', en: 'Lubrication valve' } });
    expect(doc.sheets().sheets.find((s) => s.pageId === 'p_io')?.rows).toHaveLength(16);
  });
});

describe('PLC tab placement', () => {
  it('places a further overview (view) of a card and a single channel; both join the card', () => {
    const library = createStandardLibrary();
    const doc = new ProjectDocument(createDemoProject(library), library);
    const card = { pageId: 'p_plc', itemId: 'i_dicard' };
    const before = doc.check().filter((i) => i.severity !== 'info').length;
    const view = doc.apply(placePlcCommand(doc.state, doc.library, card, { pageId: 'p_sensors', x: 300, y: 120 })).created[0]!;
    const point = doc.apply(placePlcCommand(doc.state, doc.library, card, { pageId: 'p_sensors', x: 380, y: 240 }, 2)).created[0]!;
    // a second drawing of the card is allowed, but reported
    expect(doc.check().filter((i) => i.severity !== 'info').map((i) => i.code)).toEqual(['plc.cardDrawnTwice']);
    expect(before).toBe(0);
    // the view is not a second card, but shows the same terminals
    expect(doc.plc().cards.filter((c) => c.itemId === 'i_dicard')).toHaveLength(1);
    const pin = (doc.state.pages['p_plc'] as SchematicPage).items.find((i) => i.id === 'i_dicard')!.props!.plc!.channels[0]!.pin;
    expect(doc.connectivity().netOf.get(`${view}:${pin}`)).toBe(doc.connectivity().netOf.get(`i_dicard:${pin}`));
    // view and master refer to each other; the point is DI 3 of the card
    expect(doc.crossReferences().byItem.get(view)?.references.map((r) => r.target.itemId)).toEqual(['i_dicard']);
    expect(doc.plc().bySlave.get(point)?.channel.channel.channel).toBe(3);
    // channels of the card change: the view follows
    const channels = (doc.state.pages['p_plc'] as SchematicPage).items.find((i) => i.id === 'i_dicard')!.props!.plc!.channels.slice(0, 4);
    doc.apply({ type: 'setItemProperties', pageId: 'p_plc', itemId: 'i_dicard', props: { plc: { ...(doc.state.pages['p_plc'] as SchematicPage).items.find((i) => i.id === 'i_dicard')!.props!.plc!, channels } } });
    expect((doc.state.pages['p_sensors'] as SchematicPage).items.find((i) => i.id === view)?.props?.plcView?.channels).toHaveLength(4);
  });
});

describe('suggestions', () => {
  it('lists structure codes with descriptions, devices, potentials, wire colors and cross-sections', () => {
    const library = createStandardLibrary();
    const doc = new ProjectDocument(createDemoProject(library), library);
    doc.apply({ type: 'setStructures', structures: { function: [{ code: 'FB', description: { de: 'Förderband' } }], location: [] } });
    const lists = suggestionLists(doc.state, doc.library, 'de');
    expect(lists.functions.slice(0, 2)).toEqual([{ value: 'FB', label: 'Förderband' }, { value: 'DOC' }]);
    expect(lists.locations.map((l) => l.value)).toEqual(['CAB1', 'FIELD']);
    expect(lists.products.map((p) => p.value)).toContain('3K7');
    expect(lists.devices.map((p) => p.value)).toContain('=FB+CAB1-3K7');
    expect(lists.names.map((n) => n.value)).toEqual(expect.arrayContaining(['24V', '0V', 'L1', 'PE']));
    expect(lists.wireColors.map((c) => c.value)).toContain('GNYE');
    expect(lists.crossSections.find((c) => c.value === '1.5')?.label).toBe('1.5 mm²');
  });
});
