// Corners and T-junctions exist once per direction set (`wirewright.connection.corner.up-right`,
// `wirewright.connection.tee.right-down-left` …) instead of one symbol that is rotated, so a
// placed junction always says which way it connects. Rotating or mirroring one switches to the
// symbol for the new directions.
import { transformDirection } from './geometry.js';
import type { Library } from './library.js';
import type { Direction, Item, Rotation } from './schema.js';

/** Clockwise order used in the symbol IDs. */
const CLOCKWISE: readonly Direction[] = ['up', 'right', 'down', 'left'];

/** Functions of the connection symbols that exist once per direction set. */
const ORIENTED = new Set(['connection.corner', 'connection.tee']);

/**
 * Directions in clockwise order, starting after a missing direction:
 * corners `up-right`, `right-down`, `down-left`, `left-up`; T-junctions
 * `up-right-down`, `right-down-left`, `down-left-up`, `left-up-right`.
 */
export function orderDirections(directions: readonly Direction[]): Direction[] {
  const set = new Set(directions);
  const start = CLOCKWISE.findIndex((d, i) => set.has(d) && !set.has(CLOCKWISE[(i + 3) % 4]!));
  if (start < 0) return [...CLOCKWISE];
  return [0, 1, 2, 3].map((k) => CLOCKWISE[(start + k) % 4]!).filter((d) => set.has(d));
}

/** The symbol with the same function as `symbolId` whose pins point in the given directions (after rotation/mirror). */
export function orientedSymbol(library: Library, symbolId: string, rotation: Rotation, mirror: boolean): string | undefined {
  const def = library.symbol(symbolId);
  if (!def || !ORIENTED.has(def.function) || (rotation === 0 && !mirror)) return undefined;
  const wanted = orderDirections(def.connections.map((c) => transformDirection(c.direction, rotation, mirror))).join('-');
  // The same kind of junction for the same medium (wire or pipe).
  const medium = def.connections[0]?.medium;
  return library
    .symbols()
    .find((s) => s.function === def.function && s.connections[0]?.medium === medium && orderDirections(s.connections.map((c) => c.direction)).join('-') === wanted)?.id;
}

/** Switches a rotated or mirrored corner/T-junction to the upright symbol for its directions. */
export function normalizeJunction(item: Pick<Item, 'symbol' | 'rotation' | 'mirror'>, library: Library): void {
  const symbol = orientedSymbol(library, item.symbol, item.rotation, item.mirror);
  if (!symbol) return;
  item.symbol = symbol;
  item.rotation = 0;
  item.mirror = false;
}

/** Symbols of earlier versions: one corner and one T-junction, rotated. */
const LEGACY_JUNCTIONS: Record<string, { kind: 'corner' | 'tee'; directions: Direction[] }> = {
  'wirewright.connection.corner': { kind: 'corner', directions: ['right', 'down'] },
  'wirewright.connection.tee': { kind: 'tee', directions: ['left', 'right', 'down'] },
};

/** Replaces an old rotated corner/T-junction (raw JSON item) by the symbol for its directions. */
export function migrateJunction(item: Record<string, unknown>): void {
  const legacy = typeof item.symbol === 'string' ? LEGACY_JUNCTIONS[item.symbol] : undefined;
  if (!legacy) return;
  const rotation = (typeof item.rotation === 'number' ? item.rotation : 0) as Rotation;
  const mirror = item.mirror === true;
  const directions = orderDirections(legacy.directions.map((d) => transformDirection(d, rotation, mirror)));
  item.symbol = `wirewright.connection.${legacy.kind}.${directions.join('-')}`;
  item.rotation = 0;
  item.mirror = false;
}
