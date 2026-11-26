import { describe, expect, it } from 'vitest';
import { macroFromItems } from './macros.js';
import { nextGroupLevel, withOutermostGroups } from './groups.js';
import { itemSchema, type SchematicPage } from './schema.js';
import { column, documentWithPage } from './test/fixtures.js';

describe('groups', () => {
  function source() {
    const { doc, pageId } = documentWithPage();
    doc.apply([
      { type: 'placeSymbol', pageId, id: 'i_k', symbol: 'coil', x: column(2), y: 120, tag: { product: 'K1' } },
      { type: 'placeSymbol', pageId, id: 'i_c', symbol: 'no', x: column(3), y: 60, tag: { product: 'K1' } },
      { type: 'placeSymbol', pageId, id: 'i_s', symbol: 'button', x: column(2), y: 60 },
      { type: 'placeSymbol', pageId, id: 'i_x', symbol: 'nc', x: column(4), y: 60, tag: { product: 'K9' } },
    ]);
    const page = () => doc.state.pages[pageId] as SchematicPage;
    const groupOf = (id: string) => page().items.find((i) => i.id === id)?.groups?.[0];
    const chain = (id: string) => page().items.find((i) => i.id === id)?.groups;
    return { doc, pageId, page, groupOf, chain };
  }

  it('groups items under a new group ID and ungroups all members', () => {
    const { doc, pageId, groupOf } = source();
    const { created } = doc.apply({ type: 'groupItems', pageId, itemIds: ['i_k', 'i_c', 'i_s'] });
    expect(created[0]).toMatch(/^g_/);
    expect([groupOf('i_k'), groupOf('i_c'), groupOf('i_s'), groupOf('i_x')]).toEqual([created[0], created[0], created[0], undefined]);
    // Ungrouping one member dissolves the whole group.
    doc.apply({ type: 'ungroupItems', pageId, itemIds: ['i_c'] });
    expect([groupOf('i_k'), groupOf('i_c'), groupOf('i_s')]).toEqual([undefined, undefined, undefined]);
    doc.undo();
    expect(groupOf('i_s')).toBe(created[0]);
  });

  it('an item of a partly selected group leaves it; a group of one is dissolved', () => {
    const { doc, pageId, groupOf } = source();
    const first = doc.apply({ type: 'groupItems', pageId, itemIds: ['i_k', 'i_c'] }).created[0];
    const second = doc.apply({ type: 'groupItems', pageId, itemIds: ['i_c', 'i_s'] }).created[0];
    expect(groupOf('i_c')).toBe(second);
    expect(groupOf('i_k')).toBeUndefined(); // -K1 was left alone in the first group
    expect(first).not.toBe(second);
    doc.apply({ type: 'deleteItems', pageId, itemIds: ['i_s'] });
    expect(groupOf('i_c')).toBeUndefined();
    expect(() => doc.apply({ type: 'groupItems', pageId, itemIds: ['i_k', 'i_k'] })).toThrow(/at least two/);
  });

  it('grouping changes nothing else: devices and tags stay', () => {
    const { doc, pageId, page } = source();
    const before = page().items.map(({ groups: _, ...rest }) => rest);
    doc.apply({ type: 'groupItems', pageId, itemIds: ['i_k', 'i_x'] });
    expect(page().items.map(({ groups: _, ...rest }) => rest)).toEqual(before);
    expect(doc.devices().devices.get('=SG+10-K1')?.functions).toHaveLength(2);
  });

  it('a copy (paste, macro) becomes a new group of its own', () => {
    const { doc, pageId, page, groupOf } = source();
    const group = doc.apply({ type: 'groupItems', pageId, itemIds: ['i_k', 'i_c', 'i_s'] }).created[0]!;
    const items = page().items.filter((i) => ['i_k', 'i_c', 'i_x'].includes(i.id));
    const { created } = doc.apply({ type: 'placeItems', pageId, items, x: column(6), y: 60 });
    const groups = created.map(groupOf);
    // -K1 and its contact were copied together: a new group; the ungrouped -K9 contact stays ungrouped
    const copiedGroup = groups.find((g) => g !== undefined)!;
    expect(copiedGroup).toMatch(/^g_/);
    expect(copiedGroup).not.toBe(group);
    expect(groups.filter((g) => g === copiedGroup)).toHaveLength(2);
    expect(groups.filter((g) => g === undefined)).toHaveLength(1);
    // A single copied member of a group is not grouped.
    const one = doc.apply({ type: 'placeItems', pageId, items: page().items.filter((i) => i.id === 'i_s'), x: column(8), y: 60 }).created[0]!;
    expect(groupOf(one)).toBeUndefined();
    // Macros keep the grouping and place it as a new group each time.
    const macro = macroFromItems(page(), ['i_k', 'i_c', 'i_s'], { id: 'grouped', name: 'Grouped' });
    doc.apply({ type: 'addToProjectLibrary', content: { macros: [macro] } });
    const a = doc.apply({ type: 'placeItems', pageId, macro: 'grouped', x: column(2), y: 200 }).created.map(groupOf);
    const b = doc.apply({ type: 'placeItems', pageId, macro: 'grouped', x: column(6), y: 200 }).created.map(groupOf);
    expect(new Set(a).size).toBe(1);
    expect(new Set(b).size).toBe(1);
    expect(a[0]).not.toBe(b[0]);
  });

  it('moving members moves only what the command names (the editor selects the whole group)', () => {
    const { doc, pageId, page } = source();
    doc.apply({ type: 'groupItems', pageId, itemIds: ['i_k', 'i_s'] });
    doc.apply({ type: 'moveItems', pageId, itemIds: ['i_k', 'i_s'], dx: 0, dy: 8 });
    expect(page().items.filter((i) => i.groups).map((i) => i.y)).toEqual([128, 68]);
  });

  it('groups in groups: whole groups become inner groups; ungroup opens one level', () => {
    const { doc, pageId, chain, page } = source();
    const inner = doc.apply({ type: 'groupItems', pageId, itemIds: ['i_k', 'i_c'] }).created[0]!;
    const outer = doc.apply({ type: 'groupItems', pageId, itemIds: ['i_k', 'i_c', 'i_s'] }).created[0]!;
    expect(chain('i_k')).toEqual([outer, inner]);
    expect(chain('i_s')).toEqual([outer]);
    // A group made of one group only is nothing new.
    expect(() => doc.apply({ type: 'groupItems', pageId, itemIds: ['i_k', 'i_c', 'i_s'] })).toThrow(/at least two/);
    // Three levels: the outer group and -K9 into a new one.
    const top = doc.apply({ type: 'groupItems', pageId, itemIds: ['i_k', 'i_c', 'i_s', 'i_x'] }).created[0]!;
    expect(chain('i_k')).toEqual([top, outer, inner]);
    expect(withOutermostGroups(page().items, ['i_x']).sort()).toEqual(['i_c', 'i_k', 'i_s', 'i_x']);
    // Alt+click steps inwards: outer group, inner group, the symbol itself.
    const all = ['i_k', 'i_c', 'i_s', 'i_x'];
    const l1 = nextGroupLevel(page().items, 'i_k', all);
    expect(l1.sort()).toEqual(['i_c', 'i_k', 'i_s']);
    const l2 = nextGroupLevel(page().items, 'i_k', l1);
    expect(l2.sort()).toEqual(['i_c', 'i_k']);
    expect(nextGroupLevel(page().items, 'i_k', l2)).toEqual(['i_k']);
    expect(nextGroupLevel(page().items, 'i_k', ['i_k'])).toEqual(['i_k']);
    // Ungroup dissolves only the outermost level.
    doc.apply({ type: 'ungroupItems', pageId, itemIds: ['i_x'] });
    expect(chain('i_k')).toEqual([outer, inner]);
    expect(chain('i_x')).toBeUndefined();
    doc.apply({ type: 'ungroupItems', pageId, itemIds: ['i_s'] });
    expect(chain('i_k')).toEqual([inner]);
  });

  it('copies keep the nesting with new IDs; removing members drops empty levels', () => {
    const { doc, pageId, chain, page } = source();
    const inner = doc.apply({ type: 'groupItems', pageId, itemIds: ['i_k', 'i_c'] }).created[0]!;
    const outer = doc.apply({ type: 'groupItems', pageId, itemIds: ['i_k', 'i_c', 'i_s'] }).created[0]!;
    const items = page().items.filter((i) => ['i_k', 'i_c', 'i_s'].includes(i.id));
    const { created } = doc.apply({ type: 'placeItems', pageId, items, x: column(6), y: 60 });
    const chains = created.map(chain);
    const copiedOuter = chains[0]![0]!;
    expect(copiedOuter).not.toBe(outer);
    expect(chains.every((c) => c![0] === copiedOuter)).toBe(true);
    expect(chains.filter((c) => c!.length === 2 && c![1] !== inner)).toHaveLength(2);
    // Deleting -S: the outer group would have the same members as the inner one: one level is left.
    doc.apply({ type: 'deleteItems', pageId, itemIds: ['i_s'] });
    expect(chain('i_k')).toEqual([outer]);
  });

  it('reads files from before groups in groups ("group": "g_…")', () => {
    const item = itemSchema.parse({ id: 'i_a', symbol: 'coil', x: 0, y: 0, rotation: 0, mirror: false, group: 'g_old' });
    expect(item.groups).toEqual(['g_old']);
    expect('group' in item).toBe(false);
  });
});
