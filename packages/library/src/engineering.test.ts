import { createProjectState, currentPathCommands, issueKey, openIssues, minimumCrossSection, parseCurrent, parseVoltage, placeFunctionCommand, ProjectDocument, voltageBetween } from '@wirewright/core';
import { describe, expect, it } from 'vitest';
import { createStandardLibrary } from './index.js';

const library = createStandardLibrary();

function project() {
  const doc = new ProjectDocument(createProjectState({ name: 'Checks' }), library);
  doc.apply({ type: 'createPage', id: 'p_one', name: '1' });
  return doc;
}
const path = (doc: ProjectDocument, x: number, top: string, bottom: string, elements: Parameters<typeof currentPathCommands>[2]['elements']) =>
  doc.apply(currentPathCommands(doc.state, library, { pageId: 'p_one', x, top, bottom, elements }));
const found = (doc: ProjectDocument, prefix: string) => doc.check().filter((i) => i.code.startsWith(prefix)).map((i) => i.message);

describe('parsing ratings', () => {
  it('reads voltages and currents', () => {
    expect(parseVoltage('24 V DC')).toEqual({ value: 24, kind: 'DC' });
    expect(parseVoltage('230VAC')).toEqual({ value: 230, kind: 'AC' });
    expect(parseVoltage('Relais 2 W 24 V UC')).toEqual({ value: 24, kind: 'UC' });
    expect(parseVoltage('400 V AC 50 Hz')).toEqual({ value: 400, kind: 'AC' });
    expect(parseVoltage('Netzteil 230 V AC / 24 V DC')).toBeUndefined();
    expect(parseCurrent('C16')).toBe(16);
    expect(parseCurrent('4–6,3 A')).toBe(6.3);
    expect(parseCurrent('gG 20 A')).toBe(20);
    expect(minimumCrossSection(16)).toBe(2.5);
    const p = (name: string, type: 'L' | 'N' | '+' | '-', voltage?: string) => ({ name, type, ...(voltage ? { voltage } : {}) });
    expect(voltageBetween(p('L1', 'L', '400 V AC 50 Hz'), p('N', 'N'))).toEqual({ value: 231, kind: 'AC' });
    expect(voltageBetween(p('0V', '-', '0 V DC'), p('24V', '+', '24 V DC'))).toEqual({ value: 24, kind: 'DC' });
  });
});

describe('acknowledged issues', () => {
  it('stay listed, marked, and can be taken back', () => {
    const doc = project();
    doc.apply({ type: 'placeSymbol', pageId: 'p_one', symbol: 'iec60617.motor.3ph', x: 100, y: 200 });
    const issue = doc.check().find((i) => i.code === 'pe.notConnected')!;
    expect(issue.acknowledged).toBeUndefined();
    doc.apply({ type: 'acknowledgeIssues', keys: [issueKey(issue)], note: 'PE via mounting plate', date: '2026-11-01' });
    const after = doc.check().find((i) => i.code === 'pe.notConnected')!;
    expect(after.acknowledged).toEqual({ note: 'PE via mounting plate', date: '2026-11-01' });
    expect(openIssues(doc.check()).some((i) => i.code === 'pe.notConnected')).toBe(false);
    expect(doc.state.project.acknowledged).toEqual([{ key: issueKey(issue), note: 'PE via mounting plate', date: '2026-11-01' }]);
    doc.apply({ type: 'unacknowledgeIssues', keys: [issueKey(issue)] });
    expect(doc.check().find((i) => i.code === 'pe.notConnected')!.acknowledged).toBeUndefined();
    expect(doc.state.project.acknowledged).toBeUndefined();
  });
});

describe('engineering checks', () => {
  it('compares the rated voltage of coils and lamps with the supply', () => {
    const doc = project();
    path(doc, 60, '24V', '0V', [{ symbol: 'iec60617.lamp', props: { technicalData: '230 V AC' } }]);
    path(doc, 100, 'L1', 'N', [{ symbol: 'iec60617.valve.coil', props: { technicalData: '24 V DC' } }]);
    path(doc, 140, 'L1', 'N', [{ symbol: 'iec60617.lamp', props: { technicalData: '230 V AC' } }]);
    path(doc, 180, '24V', '0V', [{ symbol: 'iec60617.relay.coil', props: { parts: [{ manufacturer: 'Finder', partNumber: '40.52', quantity: 1 }] } }]);
    doc.apply({ type: 'addToProjectLibrary', content: { parts: [{ id: 'Finder:40.52', manufacturer: 'Finder', partNumber: '40.52', ratedVoltage: '24 V DC' }] } });
    expect(found(doc, 'voltage.')).toEqual([
      '-1P1 is rated 230 V AC but connected to 24V/0V (24 V DC)',
      '-1M3 is rated 24 V DC but connected to L1/N (231 V AC)',
    ]);
  });

  it('checks wires behind protective devices', () => {
    const doc = project();
    path(doc, 60, 'L1', 'N', [{ symbol: 'iec60617.mcb.1p', props: { technicalData: 'B16' } }, { symbol: 'iec60617.lamp' }]);
    expect(found(doc, 'wire.')).toEqual(['Wire 1.1.1 (1,5 mm²) at -1F1:1 is too thin for 16 A; at least 2,5 mm²', 'Wire 1.1.2 (1,5 mm²) at -1F1:2 is too thin for 16 A; at least 2,5 mm²']);
    const breaker = doc.state.pages.p_one!.type === 'schematic' ? doc.state.pages.p_one!.items.find((i) => i.symbol === 'iec60617.mcb.1p')! : undefined;
    doc.apply({ type: 'setItemProperties', pageId: 'p_one', itemId: breaker!.id, props: { technicalData: 'B10' } });
    expect(found(doc, 'wire.')).toEqual([]);
  });

  it('reports open PE connections and PE on another potential', () => {
    const doc = project();
    doc.apply({ type: 'placeSymbol', pageId: 'p_one', id: 'i_motor', symbol: 'iec60617.motor.3ph', x: 100, y: 200 });
    expect(found(doc, 'pe.')).toEqual(['-1M3: the PE connection is not connected']);
    doc.apply({ type: 'placeSymbol', pageId: 'p_one', symbol: 'wirewright.connection.potential', x: 116, y: 160, props: { name: 'N' } });
    expect(found(doc, 'pe.')).toEqual(['-1M3: the PE connection is on potential N']);
  });

  it('reports PLC channels wired to the wrong kind of device', () => {
    const doc = project();
    const card = library.device('wago.750-430')!;
    // DI point (function 3 = DI 2) with a relay coil above it
    doc.apply(placeFunctionCommand(card, 0, library, { pageId: 'p_one', x: 300, y: 80, tag: { product: 'A1' } }));
    doc.apply(placeFunctionCommand(card, 2, library, { pageId: 'p_one', x: 100, y: 120, tag: { product: 'A1' } }));
    doc.apply({ type: 'placeSymbol', pageId: 'p_one', symbol: 'iec60617.relay.coil', x: 100, y: 80 });
    expect(found(doc, 'plc.channelType')).toEqual([expect.stringMatching(/^-A1: input DI 2 is wired to -1K3, which is driven/)]);
    // A pushbutton switching the coil, wired to the same point (tee): the input reads the pushbutton.
    doc.apply([
      { type: 'placeSymbol', pageId: 'p_one', symbol: 'wirewright.connection.tee.up-right-down', x: 100, y: 100 },
      { type: 'placeSymbol', pageId: 'p_one', symbol: 'iec60617.pushbutton.no', x: 120, y: 100, rotation: 90 },
    ]);
    expect(found(doc, 'plc.channelType')).toEqual([]);
  });
});
