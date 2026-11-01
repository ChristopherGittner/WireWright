import { describe, expect, it } from 'vitest';
import type { Item, SchematicPage } from './schema.js';
import { effectiveTag, formatTag, parseTag, relativeTag } from './tags.js';
import { library } from './test/fixtures.js';

function item(id: string, symbol: string, x: number, y: number, extra: Partial<Item> = {}): Item {
  return { id, symbol, x, y, rotation: 0, mirror: false, ...extra };
}

function page(items: Item[]): SchematicPage {
  return { id: 'p_a', type: 'schematic', name: '1', structure: { function: 'SG', location: '10' }, items };
}

const tagOf = (p: SchematicPage, id: string) => formatTag(effectiveTag(p, p.items.find((i) => i.id === id)!, library));

describe('formatTag / parseTag', () => {
  it('formats and parses all aspects', () => {
    expect(formatTag({ function: 'A1', location: 'CAB1', product: 'K1' })).toBe('=A1+CAB1-K1');
    expect(parseTag('=A1+CAB1-5K3.1')).toEqual({ function: 'A1', location: 'CAB1', product: '5K3.1' });
    expect(parseTag('-K1')).toEqual({ product: 'K1' });
    expect(parseTag(' +FIELD-S1 ')).toEqual({ location: 'FIELD', product: 'S1' });
  });

  it('rejects invalid tags', () => {
    expect(() => parseTag('K1')).toThrow();
    expect(() => parseTag('-K1-K2')).toThrow(/twice/);
    expect(() => parseTag('-K 1')).toThrow();
    expect(() => parseTag('=')).toThrow();
  });
});

describe('effectiveTag', () => {
  it('inherits function and location from the page', () => {
    const p = page([item('i_coil', 'coil', 100, 100, { tag: { product: 'K1' } })]);
    expect(tagOf(p, 'i_coil')).toBe('=SG+10-K1');
  });

  it('own aspects override the page', () => {
    const p = page([item('i_s', 'button', 100, 100, { tag: { location: 'FIELD', product: 'S1' } })]);
    expect(tagOf(p, 'i_s')).toBe('=SG+FIELD-S1');
  });

  it('a structure box sets = and + for its contents (=SG+10 page, =AA+20 box, -K10 → =AA+20-K10)', () => {
    const p = page([
      item('i_box', 'structureBox', 80, 40, { width: 100, height: 80, tag: { function: 'AA', location: '20' } }),
      item('i_in', 'coil', 120, 80, { tag: { product: 'K10' } }),
      item('i_out', 'coil', 300, 80, { tag: { product: 'K11' } }),
    ]);
    expect(tagOf(p, 'i_in')).toBe('=AA+20-K10');
    expect(tagOf(p, 'i_out')).toBe('=SG+10-K11');
  });

  it('a structure box that sets only + keeps = from the page; the innermost box wins', () => {
    const p = page([
      item('i_outer', 'structureBox', 0, 0, { width: 300, height: 200, tag: { function: 'AA', location: '20' } }),
      item('i_inner', 'structureBox', 50, 50, { width: 100, height: 100, tag: { location: '30' } }),
      item('i_coil', 'coil', 100, 100, { tag: { product: 'K1' } }),
    ]);
    expect(tagOf(p, 'i_coil')).toBe('=AA+30-K1');
  });

  it('components inside a device box take the box device tag', () => {
    const p = page([
      item('i_box', 'deviceBox', 80, 40, { width: 100, height: 80, tag: { product: 'A5' } }),
      item('i_contact', 'no', 120, 80),
      item('i_own', 'coil', 140, 80, { tag: { product: 'K7' } }),
    ]);
    expect(tagOf(p, 'i_box')).toBe('=SG+10-A5');
    expect(tagOf(p, 'i_contact')).toBe('=SG+10-A5');
    expect(tagOf(p, 'i_own')).toBe('=SG+10-K7');
  });
});

describe('relativeTag', () => {
  it('keeps only the aspects that differ from the context', () => {
    expect(relativeTag({ function: 'SG', location: '10', product: 'K1' }, { function: 'SG', location: '10' })).toEqual({ product: 'K1' });
    expect(relativeTag({ function: 'AA', location: '10', product: 'K1' }, { function: 'SG', location: '10' })).toEqual({
      function: 'AA',
      product: 'K1',
    });
  });
});
