// Groups of page items. An item's `groups` lists the groups it belongs to, from the outermost to
// the innermost (groups in groups). A group only affects selection: a click selects the members of
// the outermost group, Alt+click goes one level further in. See docs/data-model.md, "Groups".
import type { Item } from './schema.js';

type GroupedItem = Pick<Item, 'id' | 'groups'>;

/** Member item IDs of every group on the page. */
export function groupMembers(items: readonly GroupedItem[]): Map<string, string[]> {
  const members = new Map<string, string[]>();
  for (const item of items) for (const g of item.groups ?? []) members.set(g, [...(members.get(g) ?? []), item.id]);
  return members;
}

/** The outermost group of an item, if any. */
export function outermostGroup(item: GroupedItem): string | undefined {
  return item.groups?.[0];
}

/** The items plus all members of their outermost groups (what a click selects). */
export function withOutermostGroups(items: readonly GroupedItem[], itemIds: readonly string[]): string[] {
  const outer = new Set(items.filter((i) => itemIds.includes(i.id)).map(outermostGroup).filter((g): g is string => g !== undefined));
  if (outer.size === 0) return [...itemIds];
  return [...new Set([...itemIds, ...items.filter((i) => outer.has(outermostGroup(i)!)).map((i) => i.id)])];
}

/**
 * What Alt+click selects, level by level: the members of each of the item's groups from the
 * outermost inwards, then the item alone.
 */
export function groupLevels(items: readonly GroupedItem[], itemId: string): string[][] {
  const item = items.find((i) => i.id === itemId);
  if (!item) return [[itemId]];
  const members = groupMembers(items);
  return [...(item.groups ?? []).map((g) => members.get(g) ?? [itemId]), [itemId]];
}

/** Alt+click: one level further in than the current selection (from the outermost group: the next one). */
export function nextGroupLevel(items: readonly GroupedItem[], itemId: string, selection: readonly string[]): string[] {
  const levels = groupLevels(items, itemId);
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id) => b.includes(id));
  const current = levels.findIndex((level) => same(level, selection));
  // Not on one of the levels yet (or on the outermost one): the level inside the outermost group.
  const next = current < 0 ? Math.min(1, levels.length - 1) : Math.min(current + 1, levels.length - 1);
  return levels[next]!;
}

/**
 * Removes groups that no longer mean anything: groups with fewer than two items, and an inner
 * group with the same items as the group around it. Changes the items in place.
 */
export function normalizeGroups(items: Array<{ id: string; groups?: string[] | undefined }>): void {
  for (;;) {
    const members = groupMembers(items);
    const size = (g: string) => members.get(g)?.length ?? 0;
    let changed = false;
    for (const item of items) {
      if (!item.groups) continue;
      const kept = item.groups.filter((g, k) => size(g) >= 2 && !(k > 0 && sameMembers(members, g, item.groups![k - 1]!)));
      if (kept.length !== item.groups.length) {
        changed = true;
        if (kept.length > 0) item.groups = kept;
        else delete item.groups;
      }
    }
    if (!changed) return;
  }
}

function sameMembers(members: ReadonlyMap<string, string[]>, a: string, b: string): boolean {
  const ma = members.get(a) ?? [];
  const mb = members.get(b) ?? [];
  return ma.length === mb.length && ma.every((id) => mb.includes(id));
}

/**
 * Groups the items: groups completely among them stay as inner groups of the new one; items of a
 * group that is only partly selected leave it. Returns false when there is nothing to group (fewer
 * than two items or whole groups). Changes the items in place.
 */
export function addGroup(items: Array<{ id: string; groups?: string[] | undefined }>, itemIds: readonly string[], group: string): boolean {
  const ids = new Set(itemIds);
  const members = groupMembers(items);
  const selected = items.filter((i) => ids.has(i.id));
  // Each selected item keeps the part of its chain whose groups are completely selected.
  const chains = new Map(
    selected.map((item) => {
      const chain = item.groups ?? [];
      const firstWhole = chain.findIndex((g) => (members.get(g) ?? []).every((id) => ids.has(id)));
      return [item.id, firstWhole < 0 ? [] : chain.slice(firstWhole)] as const;
    }),
  );
  // Units at the top of the new group: whole groups and single items.
  const units = new Set(selected.map((item) => chains.get(item.id)![0] ?? item.id));
  if (units.size < 2) return false;
  for (const item of selected) item.groups = [group, ...chains.get(item.id)!];
  normalizeGroups(items);
  return true;
}

/** Dissolves the outermost group of each given item (one level). Changes the items in place. */
export function removeOutermostGroups(items: Array<{ id: string; groups?: string[] | undefined }>, itemIds: readonly string[]): boolean {
  const outer = new Set(items.filter((i) => itemIds.includes(i.id)).map((i) => i.groups?.[0]).filter((g): g is string => g !== undefined));
  if (outer.size === 0) return false;
  for (const item of items) {
    if (item.groups && outer.has(item.groups[0]!)) {
      const rest = item.groups.slice(1);
      if (rest.length > 0) item.groups = rest;
      else delete item.groups;
    }
  }
  normalizeGroups(items);
  return true;
}
