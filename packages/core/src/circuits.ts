// High-level circuit drawing (used by the MCP tools): a current path laid out in one column, and
// orthogonal routes between two pins with corner symbols. Both only place symbols; autoconnect
// makes the wires. See docs/mcp.md.
import type { Command } from './commands/schema.js';
import type { Connectivity } from './connectivity.js';
import type { Library } from './library.js';
import type { Direction, ProjectState, Tag } from './schema.js';

export interface PathElement {
  symbol: string;
  tag?: Partial<Tag>;
  /** Device template (contacts) for a main function. */
  template?: string;
  /** Further properties, e.g. `{ functionText: { de: 'Band ein' } }`. */
  props?: Record<string, unknown>;
}

export interface CurrentPathOptions {
  pageId: string;
  /** x of the path (the line through the pins), on the 4 mm grid. */
  x: number;
  /** y of the top end; default: just inside the drawing area. */
  y?: number;
  /** Potential point at the top (e.g. "24V"), none when omitted. */
  top?: string;
  /** Potential point at the bottom (e.g. "0V"), none when omitted. */
  bottom?: string;
  elements: readonly PathElement[];
  /** Wire length between neighbouring symbols (mm, default 8). */
  gap?: number;
}

const GRID = 4;
const up4 = (v: number) => Math.ceil(v / GRID) * GRID;

/**
 * Symbols of a vertical current path, top to bottom, with their up and down pins on one line:
 * a potential point, the elements (each needs a pin facing up and one facing down at the same
 * x), a potential point. Neighbours face each other, so autoconnect wires them.
 */
export function currentPathCommands(state: ProjectState, library: Library, options: CurrentPathOptions): Command[] {
  const page = state.pages[options.pageId];
  if (page?.type !== 'schematic') throw new Error(`Page ${options.pageId} is not a schematic page`);
  if (options.x % GRID !== 0) throw new Error(`x must be on the 4 mm grid (e.g. ${Math.round(options.x / GRID) * GRID})`);
  const frame = library.frame(page.frame ?? state.project.settings.defaultFrame);
  const area = frame?.drawingArea ?? { x: 0, y: 0, width: 420, height: 297 };
  const gap = options.gap ?? 8;
  const commands: Command[] = [];
  let cursor = up4(options.y ?? area.y + 8);
  if (options.top) {
    commands.push({ type: 'placeSymbol', pageId: page.id, symbol: 'wirewright.connection.potential', x: options.x, y: cursor, props: { name: options.top } });
    cursor = up4(cursor + gap);
  }
  options.elements.forEach((element, n) => {
    const def = library.symbol(element.symbol);
    if (!def) throw new Error(`Unknown symbol "${element.symbol}" (element ${n + 1}); use search_symbols`);
    const top = def.connections.find((c) => c.direction === 'up');
    const bottom = def.connections.find((c) => c.direction === 'down' && c.x === top?.x);
    if (!top || !bottom) throw new Error(`${element.symbol} (element ${n + 1}) has no pins facing up and down on one line; a current path needs two-pole symbols drawn vertically`);
    const y = cursor - top.y;
    commands.push({
      type: 'placeSymbol',
      pageId: page.id,
      symbol: element.symbol,
      x: options.x - top.x,
      y,
      ...(element.tag ? { tag: element.tag } : {}),
      ...(element.template ? { template: element.template } : {}),
      ...(element.props ? { props: element.props } : {}),
    });
    cursor = up4(y + bottom.y + gap);
  });
  if (options.bottom) {
    // Turned by 180°, the potential point's pin faces up to the last symbol.
    commands.push({ type: 'placeSymbol', pageId: page.id, symbol: 'wirewright.connection.potential', x: options.x, y: cursor, rotation: 180, props: { name: options.bottom } });
  }
  const end = options.bottom ? cursor : cursor - gap;
  if (end > area.y + area.height) throw new Error(`The path ends at y=${end}, below the drawing area (${area.y + area.height}); start higher, use a smaller gap or fewer elements`);
  return commands;
}

const STEP: Record<Direction, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPPOSITE: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };
const CORNERS: readonly [Direction, Direction][] = [
  ['up', 'right'],
  ['right', 'down'],
  ['down', 'left'],
  ['left', 'up'],
];

function corner(pageId: string, x: number, y: number, a: Direction, b: Direction, fluid: boolean): Command {
  const pair = CORNERS.find(([p, q]) => (p === a && q === b) || (p === b && q === a));
  if (!pair) throw new Error(`No corner from ${a} to ${b}`);
  // Pipe ports get pipe corners, pins wire corners.
  return { type: 'placeSymbol', pageId, symbol: `wirewright.${fluid ? 'pipe' : 'connection'}.corner.${pair[0]}-${pair[1]}`, x, y };
}

/** Whether going from `from` in `direction` reaches `to`'s coordinate along that axis. */
function ahead(from: { x: number; y: number }, direction: Direction, to: { x: number; y: number }): boolean {
  const [dx, dy] = STEP[direction];
  return dx !== 0 ? Math.sign(to.x - from.x) === dx : Math.sign(to.y - from.y) === dy;
}

/**
 * Corner symbols that join two pins of a page orthogonally: none when they already face each
 * other on one line, one corner for an L route, two for a Z route (turning halfway, on the grid).
 * Each pin must point towards the route.
 */
export function connectPinsCommands(connectivity: Connectivity, pageId: string, a: { itemId: string; pin: string }, b: { itemId: string; pin: string }): Command[] {
  const pa = connectivity.points.get(`${a.itemId}:${a.pin}`);
  const pb = connectivity.points.get(`${b.itemId}:${b.pin}`);
  if (!pa || pa.pageId !== pageId) throw new Error(`Pin ${a.pin} of item ${a.itemId} not found on this page`);
  if (!pb || pb.pageId !== pageId) throw new Error(`Pin ${b.pin} of item ${b.itemId} not found on this page`);
  if (pa.medium !== pb.medium) throw new Error('A pipe port and an electrical pin cannot be connected');
  const fluid = pa.medium === 'fluid';
  const vertical = (d: Direction) => d === 'up' || d === 'down';
  const facing = (p: typeof pa, q: typeof pb) => ahead(p, p.direction, q);
  // Already on one line and facing each other: autoconnect joins them.
  if ((pa.x === pb.x && vertical(pa.direction) && vertical(pb.direction)) || (pa.y === pb.y && !vertical(pa.direction) && !vertical(pb.direction))) {
    if (pb.direction === OPPOSITE[pa.direction] && facing(pa, pb)) return [];
    throw new Error('The pins are on one line but do not face each other');
  }
  if (vertical(pa.direction) !== vertical(pb.direction)) {
    // L route: the corner where the two lines cross.
    const at = vertical(pa.direction) ? { x: pa.x, y: pb.y } : { x: pb.x, y: pa.y };
    if (!ahead(pa, pa.direction, at) || !ahead(pb, pb.direction, at)) throw new Error('A pin points away from the corner; route it differently (e.g. with place_symbol)');
    return [corner(pageId, at.x, at.y, OPPOSITE[pa.direction], OPPOSITE[pb.direction], fluid)];
  }
  // Z route: turn halfway between the pins.
  if (vertical(pa.direction)) {
    const mid = Math.round((pa.y + pb.y) / 2 / GRID) * GRID;
    const ca = { x: pa.x, y: mid };
    const cb = { x: pb.x, y: mid };
    if (!ahead(pa, pa.direction, ca) || !ahead(pb, pb.direction, cb)) throw new Error('The pins do not point towards each other; route it differently');
    const across: Direction = pb.x > pa.x ? 'right' : 'left';
    return [corner(pageId, ca.x, ca.y, OPPOSITE[pa.direction], across, fluid), corner(pageId, cb.x, cb.y, OPPOSITE[across], OPPOSITE[pb.direction], fluid)];
  }
  const mid = Math.round((pa.x + pb.x) / 2 / GRID) * GRID;
  const ca = { x: mid, y: pa.y };
  const cb = { x: mid, y: pb.y };
  if (!ahead(pa, pa.direction, ca) || !ahead(pb, pb.direction, cb)) throw new Error('The pins do not point towards each other; route it differently');
  const across: Direction = pb.y > pa.y ? 'down' : 'up';
  return [corner(pageId, ca.x, ca.y, OPPOSITE[pa.direction], across, fluid), corner(pageId, cb.x, cb.y, OPPOSITE[across], OPPOSITE[pb.direction], fluid)];
}
