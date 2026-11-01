import { describe, expect, it } from 'vitest';
import { definitionFromDevice, placedFunctions, placeFunctionCommand } from './devicelib.js';
import { formatAddress, formatStart, parseStart } from './plc.js';
import { plcIoRows } from './reports.js';
import type { PlcStation, SchematicPage } from './schema.js';
import { MemoryProjectStorage, loadProject, saveProject } from './storage.js';
import { column, documentWithPage, library } from './test/fixtures.js';

const siemens: PlcStation = { name: 'PLC1', family: 'siemens' };
const wago = library.device('wago.750-430')!;

describe('addresses', () => {
  it('formats Siemens, Codesys and Mitsubishi addresses', () => {
    expect([0, 1, 7, 8].map((i) => formatAddress(siemens, 'DI', 4, i))).toEqual(['I4.0', 'I4.1', 'I4.7', 'I5.0']);
    expect(formatAddress({ ...siemens, mnemonic: 'german' }, 'DO', 2, 3)).toBe('A2.3');
    expect(formatAddress(siemens, 'AI', 64, 1)).toBe('IW66');
    const codesys: PlcStation = { name: 'C', family: 'codesys' };
    expect(formatAddress(codesys, 'DI', 4, 9)).toBe('%IX5.1');
    expect(formatAddress(codesys, 'AO', 64, 1)).toBe('%QW33');
    const fx: PlcStation = { name: 'M', family: 'mitsubishi', mitsubishiSeries: 'fx' };
    const iqr: PlcStation = { name: 'R', family: 'mitsubishi', mitsubishiSeries: 'iqr' };
    expect([0, 7, 8].map((i) => formatAddress(fx, 'DI', 0o40, i))).toEqual(['X40', 'X47', 'X50']);
    expect([0, 10, 16].map((i) => formatAddress(iqr, 'DO', 0x40, i))).toEqual(['Y40', 'Y4A', 'Y50']);
    expect(formatAddress(iqr, 'AI', 0, 0)).toBeUndefined();
  });

  it('parses start addresses in each notation', () => {
    expect(parseStart(siemens, 'DI', 'I4.0')).toBe(4);
    expect(parseStart(siemens, 'DI', 'E12')).toBe(12);
    expect(parseStart({ name: 'C', family: 'codesys' }, 'AI', '%IW32')).toBe(64);
    expect(parseStart({ name: 'M', family: 'mitsubishi', mitsubishiSeries: 'fx' }, 'DI', 'X40')).toBe(32);
    expect(parseStart({ name: 'R', family: 'mitsubishi', mitsubishiSeries: 'iqr' }, 'DI', 'X1F')).toBe(31);
    expect(parseStart(siemens, 'DI', 'nonsense')).toBeUndefined();
    expect(formatStart({ name: 'C', family: 'codesys' }, 'AI', 64)).toBe('%IW32');
  });
});

/** Page 5 with a WAGO 750-430 card master, PLC1 (Siemens) and a slave for channel 2 on page 6. */
function cardProject() {
  const { doc, pageId } = documentWithPage();
  doc.apply([
    { type: 'setPlcs', plcs: [siemens] },
    { ...placeFunctionCommand(wago, 0, library, { pageId, x: 200, y: 40, id: 'i_card' }) },
    { type: 'createPage', id: 'p_six', name: '6', structure: { function: 'SG', location: '10' } },
  ]);
  const page = doc.state.pages[pageId] as SchematicPage;
  const card = page.items.find((i) => i.id === 'i_card')!;
  doc.apply({ type: 'setItemProperties', pageId, itemId: 'i_card', props: { plc: { ...card.props!.plc!, station: 'PLC1', start: { DI: 4 } } } });
  const tag = { product: card.tag!.product! };
  return { doc, pageId, tag };
}

describe('I/O cards and points', () => {
  it('a card master gets one connection per channel at its terminal pin', () => {
    const { doc, pageId } = cardProject();
    const points = [...doc.connectivity().points.values()].filter((p) => p.itemId === 'i_card' && p.pageId === pageId);
    expect(points.map((p) => p.pin)).toEqual(['1', '5', '2', '6', '3', '7', '4', '8']);
    expect(points.every((p) => p.direction === 'left' && p.x === 196)).toBe(true);
  });

  it('derives addresses, names and cross-references of the slaves', () => {
    const { doc, tag } = cardProject();
    doc.apply(placeFunctionCommand(wago, 2, library, { pageId: 'p_six', x: column(4), y: 100, tag, id: 'i_di2' }));
    const card = doc.plc().byCard.get('i_card')!;
    expect(card.channels.map((c) => c.address)).toEqual(['I4.0', 'I4.1', 'I4.2', 'I4.3', 'I4.4', 'I4.5', 'I4.6', 'I4.7']);
    const slave = doc.plc().bySlave.get('i_di2')!;
    expect(slave.channel.channel).toMatchObject({ channel: 2, pin: '5' });
    expect(slave.channel.name).toBe(`DI2_${tag.product}`);
    expect(doc.crossReferences().byItem.get('i_di2')?.references.map((r) => r.text)).toEqual(['/5.5']);
    // The slave's pin and the card's pin 5 are the same terminal
    expect(doc.connectivity().netOf.get('i_di2:1')).toBe(doc.connectivity().netOf.get('i_card:5'));
  });

  it('a channel inherits the function of the wired device, through terminals', () => {
    const { doc, tag } = cardProject();
    doc.apply([
      { type: 'placeSymbol', pageId: 'p_six', id: 'i_b1', symbol: 'button', x: 100, y: 60, tag: { product: 'B1' }, props: { functionText: { de: 'Motor 1 rechts', en: 'Motor 1 right' } } },
      { type: 'placeSymbol', pageId: 'p_six', id: 'i_x', symbol: 'terminal', x: 100, y: 80, tag: { product: 'X2' } },
      placeFunctionCommand(wago, 2, library, { pageId: 'p_six', x: 100, y: 100, tag, id: 'i_di2' }),
    ]);
    const info = doc.plc().bySlave.get('i_di2')!.channel;
    expect(info).toMatchObject({ functionSource: 'wiring', function: { de: 'Motor 1 rechts', en: 'Motor 1 right' } });

    doc.apply({ type: 'setItemProperties', pageId: 'p_six', itemId: 'i_di2', props: { functionText: 'Eigene Funktion' } });
    expect(doc.plc().bySlave.get('i_di2')!.channel).toMatchObject({ functionSource: 'slave', function: 'Eigene Funktion' });
  });

  it('checks channels, stations and address overlaps', () => {
    const { doc, pageId, tag } = cardProject();
    doc.apply([
      placeFunctionCommand(wago, 2, library, { pageId: 'p_six', x: column(2), y: 100, tag }),
      placeFunctionCommand(wago, 2, library, { pageId: 'p_six', x: column(4), y: 100, tag }),
      { type: 'placeSymbol', pageId: 'p_six', symbol: 'di', x: column(6), y: 100, tag, props: { channel: 9 } },
      placeFunctionCommand(wago, 0, library, { pageId, x: 300, y: 40, id: 'i_card2' }),
    ]);
    const card2 = (doc.state.pages[pageId] as SchematicPage).items.find((i) => i.id === 'i_card2')!;
    doc.apply({ type: 'setItemProperties', pageId, itemId: 'i_card2', props: { plc: { ...card2.props!.plc!, station: 'PLC1', start: { DI: 4 } } } });
    const codes = doc.check().map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['plc.channelUsedTwice', 'plc.unknownChannel', 'plc.addressOverlap']));
  });

  it('numbers start addresses per PLC in slot order, keeping other cards', () => {
    const { doc, pageId } = cardProject();
    doc.apply([
      placeFunctionCommand(wago, 0, library, { pageId, x: 300, y: 40, id: 'i_card2' }),
      placeFunctionCommand(wago, 0, library, { pageId, x: 300, y: 160, id: 'i_card3' }),
    ]);
    const items = () => (doc.state.pages[pageId] as SchematicPage).items;
    const setPlc = (id: string, slot: number) => {
      const item = items().find((i) => i.id === id)!;
      doc.apply({ type: 'setItemProperties', pageId, itemId: id, props: { plc: { ...item.props!.plc!, station: 'PLC1', slot } } });
    };
    setPlc('i_card', 2);
    setPlc('i_card2', 1);
    setPlc('i_card3', 3);
    doc.apply({ type: 'setPlcs', plcs: [{ ...siemens, firstAddress: { DI: 10 } }] });
    doc.apply({ type: 'assignPlcAddresses' });
    const start = (id: string) => items().find((i) => i.id === id)!.props!.plc!.start?.DI;
    expect([start('i_card2'), start('i_card'), start('i_card3')]).toEqual([10, 11, 12]);

    const card3 = doc.devices().byItem.get('i_card3')!;
    doc.apply({ type: 'setItemProperties', pageId, itemId: 'i_card3', props: { plc: { ...items().find((i) => i.id === 'i_card3')!.props!.plc!, start: {} } } });
    doc.apply({ type: 'assignPlcAddresses', devices: [card3] });
    expect(start('i_card3')).toBe(12);
    // with a step: I10.0, I20.0, I30.0
    doc.apply({ type: 'assignPlcAddresses', step: 10 });
    expect([start('i_card2'), start('i_card'), start('i_card3')]).toEqual([10, 20, 30]);
    expect(() => doc.apply({ type: 'assignPlcAddresses', station: 'nope' })).toThrow(/not found/);
  });

  it('lists the I/O channels of a PLC', () => {
    const { doc, tag } = cardProject();
    doc.apply(placeFunctionCommand(wago, 2, library, { pageId: 'p_six', x: column(4), y: 100, tag }));
    const rows = plcIoRows(doc.reportContext(), 'PLC1');
    expect(rows).toHaveLength(8);
    expect(rows[1]).toMatchObject({ plc: 'PLC1', channel: 'DI 2', pin: '5', address: 'I4.1', dataType: 'BOOL', used: '=SG+10/6.4' });
  });
});

describe('device library', () => {
  it('places functions of a definition and knows which are placed', () => {
    const { doc, pageId } = documentWithPage();
    const relay = library.device('relay.2no')!;
    const { created } = doc.apply(placeFunctionCommand(relay, 0, library, { pageId, x: column(3), y: 100 }));
    const key = doc.devices().byItem.get(created[0]!)!;
    const coil = (doc.state.pages[pageId] as SchematicPage).items.find((i) => i.id === created[0])!;
    expect(coil.props?.contacts).toEqual([
      { function: 'contact.no', pins: ['13', '14'] },
      { function: 'contact.no', pins: ['23', '24'] },
    ]);
    doc.apply(placeFunctionCommand(relay, 2, library, { pageId, x: column(6), y: 140, tag: { product: coil.tag!.product! } }));
    expect([...placedFunctions(relay, doc.devices().devices.get(key), doc.state)].sort()).toEqual([0, 2]);
    expect(doc.crossReferences().byItem.get(coil.id)?.contactImage?.[1]?.reference?.text).toBe('/5.6');

    const def = definitionFromDevice(doc.devices().devices.get(key)!, doc.state, 'copy', 'Copy');
    expect(def.functions.map((f) => f.symbol)).toEqual(['coil', 'no']);
  });

  it('copies definitions into the project library, saved as library.json', async () => {
    const { doc } = documentWithPage();
    doc.apply({ type: 'addToProjectLibrary', content: { devices: [{ ...wago, id: 'custom.card', name: 'Custom card' }] } });
    expect(doc.library.device('custom.card')?.name).toBe('Custom card');
    expect(doc.library.device('wago.750-430')).toBeDefined();
    const storage = new MemoryProjectStorage();
    expect(doc.takeChanges().library).toBe(true);
    await saveProject(storage, doc.state);
    expect(storage.files.has('library.json')).toBe(true);
    const loaded = await loadProject(storage);
    expect(loaded?.library?.devices?.[0]?.id).toBe('custom.card');
    doc.undo();
    expect(doc.library.device('custom.card')).toBeUndefined();
  });
});
