import { describe, expect, it } from 'vitest';
import { coresFromType } from './cables.js';
import { reportRows } from './reports.js';
import type { Command } from './commands/schema.js';
import type { SchematicPage } from './schema.js';
import { documentWithPage } from './test/fixtures.js';

describe('cores from the type designation', () => {
  it('numbers or colors cores; G means one green-yellow core', () => {
    expect(coresFromType('ÖLFLEX 5G1,5')).toEqual({
      crossSection: 1.5,
      cores: [
        { id: '1', number: '1', color: 'BK' },
        { id: '2', number: '2', color: 'BK' },
        { id: '3', number: '3', color: 'BK' },
        { id: '4', number: '4', color: 'BK' },
        { id: 'PE', color: 'GNYE' },
      ],
    });
    expect(coresFromType('4G2.5', 'colors')?.cores.map((c) => c.color)).toEqual(['BN', 'BK', 'GY', 'GNYE']);
    expect(coresFromType('3x0.75', 'both')?.cores).toEqual([
      { id: '1', number: '1', color: 'BN' },
      { id: '2', number: '2', color: 'BK' },
      { id: '3', number: '3', color: 'GY' },
    ]);
    expect(coresFromType('12G1', 'colors')?.cores[0]).toEqual({ id: '1', number: '1', color: 'BK' });
    expect(coresFromType('nonsense')).toBeUndefined();
  });
});

/** Three vertical conductors L1 (x=100), L2 (x=108), PE (x=124) from y=40 to y=120, crossed by cable -W1 at y=80. */
function cableProject(type = '4G1.5', extra: Command[] = []) {
  const { doc, pageId } = documentWithPage();
  const vertical = (x: number, name: string): Command[] => [
    { type: 'placeSymbol', pageId, symbol: 'potential', x, y: 40, props: { name } },
    { type: 'placeSymbol', pageId, symbol: 'break', x, y: 120 },
  ];
  doc.apply([
    ...vertical(100, 'L1'),
    ...vertical(108, 'L2'),
    ...vertical(124, 'PE'),
    { type: 'placeSymbol', pageId, id: 'i_w', symbol: 'cable', x: 90, y: 80, width: 50, tag: { product: 'W1' }, props: { cable: { type, ...coresFromType(type, 'colors')! } } },
    ...extra,
  ]);
  return { doc, pageId };
}

describe('cables', () => {
  it('assigns cores in order along the line, PE to the green-yellow core', () => {
    const { doc } = cableProject();
    const cable = doc.cables().cables[0]!;
    expect(cable.device).toBe('=SG+10-W1');
    expect(cable.assignments.map((a) => a.core.color)).toEqual(['BN', 'BK', 'GNYE']);
    expect(doc.check().filter((i) => i.code.startsWith('cable.'))).toEqual([]);
  });

  it('a wire marker can choose the core', () => {
    const { doc, pageId } = cableProject('4G1.5', []);
    doc.apply({ type: 'placeSymbol', pageId, symbol: 'marker', x: 108, y: 60, props: { wire: { core: '3' } } });
    expect(doc.cables().cables[0]!.assignments.map((a) => [a.core.id, a.explicit])).toEqual([
      ['3', true],
      ['1', false],
      ['PE', false],
    ]);
  });

  it('reports too few cores and a missing PE core', () => {
    const { doc } = cableProject('2x1.5');
    expect(doc.check().map((i) => i.code)).toEqual(expect.arrayContaining(['cable.noPeCore']));
    const { doc: small } = cableProject('1x1.5');
    expect(small.check().map((i) => i.code)).toEqual(expect.arrayContaining(['cable.tooFewCores']));
  });
});

describe('wires', () => {
  it('numbers conductors by page, column and counter; color and cross-section from the cable core', () => {
    const { doc } = cableProject();
    const wires = doc.wires().wires;
    expect(wires.map((w) => w.number)).toEqual(['5.3.1', '5.3.2', '5.3.3']);
    expect(wires.map((w) => [w.color, w.crossSection, w.potential, w.cable?.core])).toEqual([
      ['BN', 1.5, 'L1', '1'],
      ['BK', 1.5, 'L2', '2'],
      ['GNYE', 1.5, 'PE', 'PE'],
    ]);
  });

  it('keeps numbers written on wire markers and skips them when counting', () => {
    const { doc, pageId } = cableProject();
    doc.apply({ type: 'placeSymbol', pageId, symbol: 'marker', x: 124, y: 60, props: { wire: { number: '5.3.1' } } });
    expect(doc.wires().wires.map((w) => [w.number, w.numberSource])).toEqual([
      ['5.3.2', 'derived'],
      ['5.3.3', 'derived'],
      ['5.3.1', 'marker'],
    ]);
  });

  it('numberWires writes the numbers into the markers', () => {
    const { doc, pageId } = cableProject();
    doc.apply([
      { type: 'placeSymbol', pageId, id: 'i_m1', symbol: 'marker', x: 108, y: 60 },
      { type: 'placeSymbol', pageId, id: 'i_m2', symbol: 'marker', x: 124, y: 60, props: { wire: { number: '99' } } },
    ]);
    const marker = (id: string) => (doc.state.pages[pageId] as SchematicPage).items.find((i) => i.id === id)!.props?.wire?.number;
    doc.apply({ type: 'numberWires', onlyMissing: true });
    expect([marker('i_m1'), marker('i_m2')]).toEqual(['5.3.2', '99']);
    doc.apply({ type: 'numberWires' });
    expect([marker('i_m1'), marker('i_m2')]).toEqual(['5.3.2', '5.3.3']);
  });

  it('reports duplicate numbers', () => {
    const { doc, pageId } = cableProject();
    doc.apply([
      { type: 'placeSymbol', pageId, symbol: 'marker', x: 108, y: 60, props: { wire: { number: '7' } } },
      { type: 'placeSymbol', pageId, symbol: 'marker', x: 124, y: 60, props: { wire: { number: '7' } } },
    ]);
    expect(doc.check().map((i) => i.code)).toContain('wire.duplicateNumber');
  });

  it('wire list and cable diagram rows', () => {
    const { doc } = cableProject();
    const ctx = doc.reportContext();
    expect(reportRows('wireList', ctx)[0]).toEqual({ number: '5.3.1', from: '', to: '', color: 'BN', crossSection: '1,5 mm²', potential: 'L1', cable: '=SG+10-W1:1' });
    expect(reportRows('cableDiagram', ctx).map((r) => [r.core, r.color, r.wire, r.to])).toEqual([
      ['1', 'BN', '5.3.1', ''],
      ['2', 'BK', '5.3.2', ''],
      ['3', 'GY', '', 'spare'],
      ['PE', 'GNYE', '5.3.3', ''],
    ]);
    expect(reportRows('cableOverview', ctx)[0]).toMatchObject({ cable: '=SG+10-W1', type: '4G1.5', cores: '3/4', crossSection: '1,5 mm²' });
  });
});
