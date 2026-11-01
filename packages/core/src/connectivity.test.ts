import { describe, expect, it } from 'vitest';
import type { Command } from './commands/schema.js';
import type { ProjectDocument } from './document.js';
import { documentWithPage } from './test/fixtures.js';

type Place = Omit<Extract<Command, { type: 'placeSymbol' }>, 'type' | 'pageId'>;

function setup(...items: Place[]): { doc: ProjectDocument; pageId: string } {
  const ctx = documentWithPage();
  if (items.length > 0) ctx.doc.apply(items.map((i) => ({ type: 'placeSymbol' as const, pageId: ctx.pageId, autoName: false, ...i })));
  return ctx;
}

const potential = (doc: ProjectDocument, key: string) => doc.connectivity().potentialOf.get(key);
const codes = (doc: ProjectDocument) => doc.check().map((i) => i.code);

// A current path at x=100: L1 → NO contact → coil → N
const currentPath: Place[] = [
  { id: 'i_l1', symbol: 'potential', x: 100, y: 40, props: { name: 'L1' } },
  { id: 'i_s', symbol: 'no', x: 100, y: 60, tag: { product: 'K1' } },
  { id: 'i_k', symbol: 'coil', x: 100, y: 100, tag: { product: 'K1' } },
  { id: 'i_n', symbol: 'potential', x: 100, y: 140, rotation: 180, props: { name: 'N' } },
];

describe('autoconnect', () => {
  it('connects facing points on the same line', () => {
    const { doc } = setup(...currentPath);
    const pairs = doc.connectivity().segments.map((s) => [s.a, s.b].sort().join(' – ')).sort();
    expect(pairs).toEqual(['i_k:1 – i_s:2', 'i_k:2 – i_n:a', 'i_l1:a – i_s:1']);
    expect(doc.connectivity().segments.find((s) => s.a.startsWith('i_k:2') || s.b.startsWith('i_k:2'))).toMatchObject({
      x1: 100,
      x2: 100,
    });
  });

  it('does not connect points on different lines or facing away', () => {
    const { doc } = setup(
      { id: 'i_a', symbol: 'coil', x: 100, y: 100, tag: { product: 'K1' } },
      { id: 'i_b', symbol: 'coil', x: 104, y: 140, tag: { product: 'K2' } },
    );
    expect(doc.connectivity().segments).toEqual([]);
    expect(codes(doc).filter((c) => c === 'connection.open')).toHaveLength(4);
  });

  it('the nearest point blocks points further away', () => {
    const { doc } = setup(
      { id: 'i_a', symbol: 'no', x: 100, y: 60, tag: { product: 'K1' } },
      { id: 'i_b', symbol: 'no', x: 100, y: 100, tag: { product: 'K1' } },
      { id: 'i_c', symbol: 'no', x: 100, y: 140, tag: { product: 'K1' } },
    );
    const pairs = doc.connectivity().segments.map((s) => [s.a, s.b].sort().join(' – ')).sort();
    expect(pairs).toEqual(['i_a:2 – i_b:1', 'i_b:2 – i_c:1']);
  });

  it('turns corners with connection symbols', () => {
    // coil bottom (100,108) ↓ corner at (100,120) with pins up/right → contact rotated so its pin faces left
    const { doc } = setup(
      { id: 'i_k', symbol: 'coil', x: 100, y: 100, tag: { product: 'K1' } },
      { id: 'i_c', symbol: 'corner', x: 100, y: 120, rotation: 270 },
      { id: 'i_s', symbol: 'no', x: 160, y: 120, rotation: 90, tag: { product: 'K1' } },
    );
    const conn = doc.connectivity();
    expect(conn.netOf.get('i_k:2')).toBe(conn.netOf.get('i_s:2'));
  });

  it('reports points that face several partners at the same distance', () => {
    const { doc } = setup(
      { id: 'i_a', symbol: 'coil', x: 100, y: 100, tag: { product: 'K1' } },
      { id: 'i_b', symbol: 'no', x: 100, y: 140, tag: { product: 'K1' } },
      { id: 'i_c', symbol: 'no', x: 100, y: 140, tag: { product: 'K1' } },
    );
    expect(codes(doc)).toContain('autoconnect.ambiguous');
  });

  it('a break point ends a line without an open-point report', () => {
    const { doc } = setup(
      { id: 'i_k', symbol: 'coil', x: 100, y: 100, tag: { product: 'K1' } },
      { id: 'i_b', symbol: 'break', x: 100, y: 120 },
      { id: 'i_l1', symbol: 'potential', x: 100, y: 80, props: { name: 'L1' } },
    );
    expect(doc.check().filter((i) => i.code === 'connection.open')).toEqual([]);
  });
});

describe('potentials', () => {
  it('spread along wires and through linked pins, and stop at consumers', () => {
    const { doc } = setup(...currentPath);
    expect(potential(doc, 'i_s:1')).toEqual({ name: 'L1' });
    expect(potential(doc, 'i_s:2')).toEqual({ name: 'L1' });
    expect(potential(doc, 'i_k:1')).toEqual({ name: 'L1' });
    expect(potential(doc, 'i_k:2')).toEqual({ name: 'N' });
    expect(codes(doc)).not.toContain('potential.conflict');
  });

  it('a symbol without defined links passes the potential between all pins: L1 to N is a conflict', () => {
    const { doc } = setup(
      { id: 'i_l1', symbol: 'potential', x: 100, y: 40, props: { name: 'L1' } },
      { id: 'i_x', symbol: 'blackbox', x: 100, y: 60, tag: { product: 'A1' } },
      { id: 'i_n', symbol: 'potential', x: 100, y: 80, rotation: 180, props: { name: 'N' } },
    );
    expect(potential(doc, 'i_x:1')).toEqual({ conflict: ['L1', 'N'] });
    const issue = doc.check().find((i) => i.code === 'potential.conflict');
    expect(issue?.message).toBe('Potentials L1 and N are connected (possible short circuit) via =SG+10-A1');
  });

  it('source pins start a new potential', () => {
    const { doc } = setup(
      { id: 'i_l1', symbol: 'potential', x: 96, y: 40, props: { name: 'L1' } },
      { id: 'i_p', symbol: 'psu', x: 100, y: 60, tag: { product: 'T1' } },
      { id: 'i_k', symbol: 'coil', x: 96, y: 100, tag: { product: 'K1' } },
    );
    doc.apply({ type: 'setItemProperties', pageId: 'p_five', itemId: 'i_p', pinPotentials: { '+': '24V', '-': '0V' } });
    expect(potential(doc, 'i_p:L')).toEqual({ name: 'L1' });
    expect(potential(doc, 'i_p:+')).toEqual({ name: '24V' });
    expect(potential(doc, 'i_k:1')).toEqual({ name: '24V' });
    expect(potential(doc, 'i_k:2')).toEqual({});
  });

  it('potential definition points set the potential of a wire', () => {
    const { doc } = setup(
      { id: 'i_k', symbol: 'coil', x: 100, y: 100, tag: { product: 'K1' } },
      { id: 'i_d', symbol: 'potentialDefinition', x: 100, y: 120, props: { name: '0V' } },
      { id: 'i_b', symbol: 'break', x: 100, y: 140 },
    );
    expect(potential(doc, 'i_k:2')).toEqual({ name: '0V' });
  });

  it('warns about potentials that are not defined in the project', () => {
    const { doc } = setup({ id: 'i_x', symbol: 'potential', x: 100, y: 40, props: { name: '48V' } });
    expect(codes(doc)).toContain('potential.undefined');
  });
});

describe('interruption points', () => {
  it('join nets across pages by name', () => {
    const { doc, pageId } = setup(
      { id: 'i_l1', symbol: 'potential', x: 100, y: 40, props: { name: 'L1' } },
      { id: 'i_s', symbol: 'no', x: 100, y: 60, tag: { product: 'K1' } },
      { id: 'i_u', symbol: 'interruption', x: 100, y: 80, props: { name: 'X1' } },
    );
    expect(codes(doc)).toContain('interruption.noPartner');
    doc.apply([
      { type: 'createPage', id: 'p_six', name: '6' },
      { type: 'placeSymbol', pageId: 'p_six', id: 'i_u2', symbol: 'interruption', x: 200, y: 40, rotation: 180, props: { name: 'X1' } },
      { type: 'placeSymbol', pageId: 'p_six', id: 'i_k', symbol: 'coil', x: 200, y: 60, tag: { product: 'K9' } },
    ]);
    expect(pageId).toBe('p_five');
    expect(potential(doc, 'i_k:1')).toEqual({ name: 'L1' });
    expect(codes(doc)).not.toContain('interruption.noPartner');
  });
});

describe('device boxes', () => {
  const box: Place = {
    id: 'i_box',
    symbol: 'deviceBox',
    x: 100,
    y: 40,
    width: 80,
    height: 80,
    tag: { product: 'A5' },
    borderPins: [
      { id: 'p1', side: 'left', offset: 20, designation: 'L' },
      { id: 'p2', side: 'right', offset: 20, designation: 'N' },
    ],
  };

  it('border pins connect outside and inside; with nothing inside they are not linked', () => {
    const { doc } = setup(
      box,
      { id: 'i_l1', symbol: 'potential', x: 60, y: 60, rotation: 270, props: { name: 'L1' } },
      { id: 'i_n', symbol: 'potential', x: 220, y: 60, rotation: 90, props: { name: 'N' } },
    );
    const conn = doc.connectivity();
    expect(conn.segments.map((s) => [s.a, s.b].sort().join(' – ')).sort()).toEqual(['i_box:p1 – i_l1:a', 'i_box:p2 – i_n:a']);
    expect(potential(doc, 'i_box:p1')).toEqual({ name: 'L1' });
    expect(potential(doc, 'i_box:p2')).toEqual({ name: 'N' });
    expect(codes(doc)).not.toContain('potential.conflict');
  });

  it('links set in the box properties pass the potential through', () => {
    const { doc, pageId } = setup(
      box,
      { id: 'i_l1', symbol: 'potential', x: 60, y: 60, rotation: 270, props: { name: 'L1' } },
    );
    doc.apply({ type: 'setItemProperties', pageId, itemId: 'i_box', links: [['p1', 'p2']] });
    expect(potential(doc, 'i_box:p2')).toEqual({ name: 'L1' });
  });
});
