import { elementBox, type Box, type SceneElement } from '@wirewright/render';

export type { Box };
export const elementBounds = elementBox;

export function union(a: Box | undefined, b: Box): Box {
  if (!a) return b;
  return { x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2) };
}

export function pad(b: Box, d: number): Box {
  return { x1: b.x1 - d, y1: b.y1 - d, x2: b.x2 + d, y2: b.y2 + d };
}

export function inside(inner: Box, outer: Box): boolean {
  return inner.x1 >= outer.x1 && inner.y1 >= outer.y1 && inner.x2 <= outer.x2 && inner.y2 <= outer.y2;
}

export function intersects(a: Box, b: Box): boolean {
  return a.x1 <= b.x2 && b.x1 <= a.x2 && a.y1 <= b.y2 && b.y1 <= a.y2;
}

/**
 * Band selection like in CAD programs: dragged from left to right (window) it takes what lies
 * completely inside; from right to left (crossing) everything it touches. A frame (device box)
 * counts as touched only where the band crosses its border, not when the band lies inside it.
 */
export function bandHits(bounds: ReadonlyMap<string, Box>, band: Box, crossing: boolean, isFrame: (id: string) => boolean = () => false): string[] {
  return [...bounds]
    .filter(([id, b]) => (crossing ? intersects(b, band) && !(isFrame(id) && inside(band, b)) : inside(b, band)))
    .map(([id]) => id);
}

/** A band dragged to the left of its start point selects crossing. */
export function isCrossing(start: { x: number }, band: Box): boolean {
  return band.x1 < start.x;
}

/** Bounding boxes of the graphics of each item (without its texts). */
export function itemBounds(elements: readonly SceneElement[]): Map<string, Box> {
  const map = new Map<string, Box>();
  for (const e of elements) {
    const id = e.meta?.itemId;
    if (!id || (e.meta?.role !== 'symbol' && e.meta?.role !== 'box')) continue;
    map.set(id, union(map.get(id), elementBounds(e)));
  }
  return map;
}
