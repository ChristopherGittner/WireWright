import type { Library } from './library.js';
import type { Direction, Item, Rotation, SchematicPage, SymbolDefinition } from './schema.js';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Applies an item's orientation to a point in symbol coordinates: mirror
 * horizontally first, then rotate clockwise (screen coordinates, y down).
 */
export function transformPoint(p: Point, rotation: Rotation, mirror: boolean): Point {
  const x = mirror ? -p.x : p.x;
  const y = p.y;
  switch (rotation) {
    case 0:
      return { x, y };
    case 90:
      return { x: -y, y: x };
    case 180:
      return { x: -x, y: -y };
    case 270:
      return { x: y, y: -x };
  }
}

const DIRECTION_VECTORS: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export function transformDirection(direction: Direction, rotation: Rotation, mirror: boolean): Direction {
  const v = transformPoint(DIRECTION_VECTORS[direction], rotation, mirror);
  if (v.x > 0) return 'right';
  if (v.x < 0) return 'left';
  return v.y > 0 ? 'down' : 'up';
}

export function addRotation(rotation: Rotation, delta: Rotation): Rotation {
  return ((rotation + delta) % 360) as Rotation;
}

export function isBoxSymbol(def: SymbolDefinition | undefined): boolean {
  return def?.function === 'box.structure' || def?.function === 'box.device';
}

export function boxRect(item: Item): Rect {
  return { x: item.x, y: item.y, width: item.width ?? 0, height: item.height ?? 0 };
}

export function containsPoint(rect: Rect, p: Point): boolean {
  return p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height;
}

/**
 * Boxes (structure and device boxes) whose rectangle contains the point,
 * innermost (smallest) first. `excludeId` skips the item itself.
 */
export function boxesContaining(
  page: SchematicPage,
  point: Point,
  library: Library,
  excludeId?: string,
): Item[] {
  const boxes = page.items.filter(
    (item) => item.id !== excludeId && isBoxSymbol(library.symbol(item.symbol)) && containsPoint(boxRect(item), point),
  );
  return boxes.sort((a, b) => area(a) - area(b));
}

function area(item: Item): number {
  return (item.width ?? 0) * (item.height ?? 0);
}
