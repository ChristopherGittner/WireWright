import { describe, expect, it } from 'vitest';
import { macroFromItems } from './macros.js';
import type { SchematicPage } from './schema.js';
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
    const groupOf = (id: string) => page().items.find((i) => i.id === id)?.group;
    return { doc, pageId, page, groupOf };
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

  it('regrouping moves items out of their old group; a group of one is dissolved', () => {
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
    const before = page().items.map(({ group: _, ...rest }) => rest);
    doc.apply({ type: 'groupItems', pageId, itemIds: ['i_k', 'i_x'] });
    expect(page().items.map(({ group: _, ...rest }) => rest)).toEqual(before);
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
    expect(page().items.filter((i) => i.group).map((i) => i.y)).toEqual([128, 68]);
  });
});
