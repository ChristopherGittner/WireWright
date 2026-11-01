// Cables and wires. See docs/data-model.md, "Cables" and "Wires".
//
// - A cable is a device; its definition lines (main function and further lines
//   on other pages) are drawn across the conductors that run in the cable.
//   The crossed conductors get the cable's cores in order; PE goes to the
//   green-yellow core; a wire marker on a conductor can name its core.
// - A wire is one conductor (a net with at least one drawn connection). Its
//   number is the one on a wire marker, or derived from where it is drawn:
//   page, column and a counter (`5.3.1`).
import type { Connectivity } from './connectivity.js';
import type { DeviceIndex } from './devices.js';
import { issueMessage, type Issue } from './issues.js';
import type { Library } from './library.js';
import { columnAt, pageFrame, rowAt } from './naming.js';
import type { Cable, CableCore, Item, ProjectState, SchematicPage, Wire } from './schema.js';
import { pinLabel } from './crossrefs.js';
import { cableLine, resolveSymbol } from './symbols.js';

// ---------------------------------------------------------------------------
// Cores from type designations

const HD308: Record<string, string[]> = {
  '2x': ['BN', 'BU'],
  '3x': ['BN', 'BK', 'GY'],
  '4x': ['BN', 'BK', 'GY', 'BU'],
  '5x': ['BN', 'BK', 'GY', 'BU', 'BK'],
  '3G': ['BN', 'BU', 'GNYE'],
  '4G': ['BN', 'BK', 'GY', 'GNYE'],
  '5G': ['BN', 'BK', 'GY', 'BU', 'GNYE'],
};

/**
 * Cores of a cable from its type designation: `5G1.5` (5 cores, one
 * green-yellow, 1.5 mm²) or `7x0.75` (no green-yellow core). Colors follow
 * HD 308 for up to 5 cores; otherwise, or when asked for, cores are numbered.
 */
export function coresFromType(type: string, identification: 'numbers' | 'colors' | 'both' = 'numbers'): { cores: CableCore[]; crossSection: number } | undefined {
  const m = /(\d+)\s*([xXgG])\s*(\d+(?:[.,]\d+)?)/.exec(type);
  if (!m) return undefined;
  const count = Number(m[1]);
  const withPe = m[2]!.toUpperCase() === 'G';
  const crossSection = Number(m[3]!.replace(',', '.'));
  if (count < 1 || count > 100 || !(crossSection > 0)) return undefined;
  const colors = identification !== 'numbers' ? HD308[`${count}${withPe ? 'G' : 'x'}`] : undefined;
  const cores: CableCore[] = [];
  const numbered = withPe ? count - 1 : count;
  for (let i = 0; i < numbered; i++) {
    const color = colors?.[i];
    cores.push({
      id: String(i + 1),
      ...(identification !== 'colors' || !color ? { number: String(i + 1) } : {}),
      ...(color ? { color } : identification === 'numbers' || !colors ? { color: 'BK' } : {}),
    });
  }
  if (withPe) cores.push({ id: 'PE', color: 'GNYE' });
  return { cores, crossSection };
}

// ---------------------------------------------------------------------------
// Cables

export interface CoreAssignment {
  core: CableCore;
  net: string;
  /** Set by a wire marker rather than by position. */
  explicit: boolean;
}

export interface CableInfo {
  device: string;
  pageId: string;
  itemId: string;
  cable: Cable;
  /** All definition lines (main function first). */
  lines: { pageId: string; itemId: string }[];
  assignments: CoreAssignment[];
}

export interface CableIndex {
  cables: CableInfo[];
  /** Net → cable and core. */
  byNet: Map<string, { cable: CableInfo; core: CableCore }>;
  issues: Issue[];
}

export function buildCableIndex(state: ProjectState, library: Library, devices: DeviceIndex, connectivity: Connectivity): CableIndex {
  const items = itemIndex(state);
  const pageOrder = new Map(state.project.pages.map((id, i) => [id, i]));
  const potentials = state.project.potentials;
  const markers = markersByNet(state, library, connectivity);
  const potentialOfNet = netPotentials(connectivity);
  const isPe = (net: string) => {
    const type = potentials.find((p) => p.name === potentialOfNet.get(net))?.type;
    return type === 'PE' || type === 'PEN';
  };
  const cables: CableInfo[] = [];
  const byNet = new Map<string, { cable: CableInfo; core: CableCore }>();
  const issues: Issue[] = [];

  for (const device of devices.devices.values()) {
    const lines = device.functions.filter((f) => library.symbol(f.symbol)?.generator === 'cable');
    if (lines.length === 0) continue;
    const main = device.main ? items.get(device.main.itemId) : undefined;
    const cable = main?.item.props?.cable;
    if (!main || !cable) {
      const first = lines[0]!;
      issues.push({ severity: 'warning', code: 'cable.noData', ...issueMessage('{device}: cable without cores (set the cable type)', { device: device.key }), pageId: first.pageId, itemId: first.itemId, device: device.key });
      continue;
    }
    lines.sort((a, b) => (pageOrder.get(a.pageId) ?? 0) - (pageOrder.get(b.pageId) ?? 0) || Number(b.role === 'main') - Number(a.role === 'main'));
    const crossed: string[] = [];
    for (const f of lines) {
      const { page, item } = items.get(f.itemId)!;
      for (const net of crossedNets(page, item, connectivity)) if (!crossed.includes(net)) crossed.push(net);
    }

    const info: CableInfo = { device: device.key, pageId: main.page.id, itemId: main.item.id, cable, lines: lines.map((f) => ({ pageId: f.pageId, itemId: f.itemId })), assignments: [] };
    const used = new Set<string>();
    const pending: string[] = [];
    // Explicit cores first (wire markers naming a core of this cable).
    for (const net of crossed) {
      const coreId = markers.get(net)?.find((m) => m.wire?.core)?.wire?.core;
      const core = coreId !== undefined ? cable.cores.find((c) => c.id === coreId || c.number === coreId) : undefined;
      if (coreId !== undefined && !core) {
        issues.push({ severity: 'error', code: 'cable.unknownCore', ...issueMessage('{device} has no core "{core}"', { device: device.key, core: coreId }), pageId: main.page.id, itemId: main.item.id, device: device.key });
      }
      if (!core) {
        pending.push(net);
        continue;
      }
      if (used.has(core.id)) {
        issues.push({ severity: 'error', code: 'cable.coreUsedTwice', ...issueMessage('{device}: core {core} is used twice', { device: device.key, core: core.id }), pageId: main.page.id, itemId: main.item.id, device: device.key });
      }
      used.add(core.id);
      info.assignments.push({ core, net, explicit: true });
    }
    // Then by position: PE conductors to the green-yellow core, the others in order.
    for (const net of pending) {
      const pe = isPe(net);
      const core = cable.cores.find((c) => !used.has(c.id) && (pe ? isGnye(c) : !isGnye(c)));
      if (!core) {
        issues.push({
          severity: 'error',
          code: pe ? 'cable.noPeCore' : 'cable.tooFewCores',
          ...(pe ? issueMessage('{device}: no free green-yellow core for PE', { device: device.key }) : issueMessage('{device}: more conductors than free cores ({count} cores)', { device: device.key, count: cable.cores.length })),
          pageId: main.page.id,
          itemId: main.item.id,
          device: device.key,
        });
        continue;
      }
      used.add(core.id);
      info.assignments.push({ core, net, explicit: false });
    }
    for (const a of info.assignments) {
      if (a.explicit && isGnye(a.core) !== isPe(a.net)) {
        issues.push({ severity: 'warning', code: 'cable.peCore', ...issueMessage('{device}: the green-yellow core must carry PE and only PE', { device: device.key }), pageId: main.page.id, itemId: main.item.id, device: device.key });
      }
      byNet.set(a.net, { cable: info, core: a.core });
    }
    cables.push(info);
  }
  return { cables, byNet, issues };
}

/** Nets of the connection lines a cable definition line crosses, in order along the line. */
export function crossedNets(page: SchematicPage, item: Item, connectivity: Connectivity): string[] {
  return [...new Set(cableCrossings(page, item, connectivity).map((h) => h.net))];
}

/** Where a cable definition line crosses connection lines: position along the line (x or y) and net. */
export function cableCrossings(page: SchematicPage, item: Item, connectivity: Connectivity): { at: number; net: string }[] {
  const { vertical, length } = cableLine(item);
  const hits: { at: number; net: string }[] = [];
  for (const s of connectivity.segments) {
    if (s.pageId !== page.id) continue;
    const net = connectivity.netOf.get(s.a);
    // A cable crossing a pipe has no core there.
    if (net === undefined || connectivity.points.get(s.a)?.medium === 'fluid') continue;
    if (!vertical && s.x1 === s.x2) {
      const [y1, y2] = [Math.min(s.y1, s.y2), Math.max(s.y1, s.y2)];
      if (s.x1 > item.x && s.x1 < item.x + length && y1 < item.y && y2 > item.y) hits.push({ at: s.x1, net });
    }
    if (vertical && s.y1 === s.y2) {
      const [x1, x2] = [Math.min(s.x1, s.x2), Math.max(s.x1, s.x2)];
      if (s.y1 > item.y && s.y1 < item.y + length && x1 < item.x && x2 > item.x) hits.push({ at: s.y1, net });
    }
  }
  return hits.sort((a, b) => a.at - b.at);
}

function isGnye(core: CableCore): boolean {
  return core.color?.toUpperCase() === 'GNYE' || core.id.toUpperCase() === 'PE';
}

/** Potential name per net (all points of a net carry the same potential). */
function netPotentials(connectivity: Connectivity): Map<string, string | undefined> {
  const map = new Map<string, string | undefined>();
  for (const [key, net] of connectivity.netOf) {
    if (!map.has(net)) map.set(net, connectivity.potentialOf.get(key)?.name);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Wires

export interface WireInfo {
  net: string;
  number: string;
  /** From a wire marker, or derived from page, column and counter. */
  numberSource: 'marker' | 'derived';
  /** Where the wire is drawn first (for its number). */
  pageId: string;
  column: number;
  /** Device pins on this conductor, e.g. `-3K2:13`. */
  ends: string[];
  color: string;
  crossSection: number;
  potential?: string;
  cable?: { device: string; core: string };
  /** Wire markers (connection definition points) on this conductor. */
  markers: { pageId: string; itemId: string }[];
}

export interface WireIndex {
  wires: WireInfo[];
  byNet: Map<string, WireInfo>;
  issues: Issue[];
}

type Marker = { pageId: string; itemId: string; wire?: Wire };

function markersByNet(state: ProjectState, library: Library, connectivity: Connectivity): Map<string, Marker[]> {
  const map = new Map<string, Marker[]>();
  for (const page of Object.values(state.pages)) {
    if (page.type !== 'schematic') continue;
    for (const item of page.items) {
      if (library.symbol(item.symbol)?.function !== 'connection.definition') continue;
      const def = resolveSymbol(item, library);
      const net = def?.connections[0] && connectivity.netOf.get(`${item.id}:${def.connections[0].id}`);
      if (net === undefined || net === '') continue;
      map.set(net, [...(map.get(net) ?? []), { pageId: page.id, itemId: item.id, ...(item.props?.wire ? { wire: item.props.wire } : {}) }]);
    }
  }
  return map;
}

/**
 * All wires with their numbers. Numbers on wire markers are kept; the other
 * wires get `{page}.{column}.{counter}` (format in the project settings), with
 * the counter skipping numbers that are already taken.
 */
export function buildWireIndex(state: ProjectState, library: Library, connectivity: Connectivity, cables: CableIndex): WireIndex {
  const { settings, potentials } = state.project;
  const items = itemIndex(state);
  const pageOrder = new Map(state.project.pages.map((id, i) => [id, i]));
  const markers = markersByNet(state, library, connectivity);
  const potentialOfNet = netPotentials(connectivity);
  const issues: Issue[] = [];

  // First drawn position of each conductor.
  const first = new Map<string, { pageId: string; x: number; y: number }>();
  for (const s of connectivity.segments) {
    const net = connectivity.netOf.get(s.a);
    // Pipes have no wire numbers.
    if (net === undefined || connectivity.points.get(s.a)?.medium === 'fluid') continue;
    const here = [
      { pageId: s.pageId, x: s.x1, y: s.y1 },
      { pageId: s.pageId, x: s.x2, y: s.y2 },
    ];
    for (const p of here) {
      const current = first.get(net);
      const before = (a: typeof p, b: typeof p) =>
        (pageOrder.get(a.pageId) ?? 0) - (pageOrder.get(b.pageId) ?? 0) || a.x - b.x || a.y - b.y;
      if (!current || before(p, current) < 0) first.set(net, p);
    }
  }

  const ends = new Map<string, Set<string>>();
  for (const [key, net] of connectivity.netOf) {
    if (!first.has(net)) continue;
    const point = connectivity.points.get(key);
    const entry = point && !point.inner ? items.get(point.itemId) : undefined;
    const def = entry && resolveSymbol(entry.item, library);
    if (!entry || !def || def.defaultRole === 'none') continue;
    const label = pinLabel(entry.page, entry.item, point!, library);
    const list = ends.get(net);
    if (list) list.add(label);
    else ends.set(net, new Set([label]));
  }

  const taken = new Set<string>();
  const stored = new Map<string, string>();
  for (const net of first.keys()) {
    const numbers = [...new Set((markers.get(net) ?? []).flatMap((m) => (m.wire?.number ? [m.wire.number] : [])))];
    if (numbers.length > 1) {
      const m = markers.get(net)![0]!;
      issues.push({ severity: 'error', code: 'wire.numberConflict', ...issueMessage('One conductor has several wire numbers: {numbers}', { numbers: numbers.join(', ') }), pageId: m.pageId, itemId: m.itemId });
    }
    if (numbers[0] !== undefined) {
      if (taken.has(numbers[0])) {
        const m = markers.get(net)![0]!;
        issues.push({ severity: 'error', code: 'wire.duplicateNumber', ...issueMessage('Wire number {number} is used for two conductors', { number: numbers[0]! }), pageId: m.pageId, itemId: m.itemId });
      }
      taken.add(numbers[0]);
      stored.set(net, numbers[0]);
    }
  }

  const ordered = [...first].map(([net, p]) => {
    const page = state.pages[p.pageId] as SchematicPage;
    const frame = pageFrame(page, settings, library);
    return { net, p, page, column: columnAt(frame, p.x), row: rowAt(frame, p.y) };
  });
  ordered.sort((a, b) => (pageOrder.get(a.p.pageId) ?? 0) - (pageOrder.get(b.p.pageId) ?? 0) || a.column - b.column || a.p.y - b.p.y || a.p.x - b.p.x);

  const wires: WireInfo[] = [];
  const byNet = new Map<string, WireInfo>();
  const counters = new Map<string, number>();
  for (const { net, p, page, column, row } of ordered) {
    let number = stored.get(net);
    if (number === undefined) {
      const key = `${page.id}:${column}`;
      let counter = counters.get(key) ?? 0;
      do {
        counter++;
        number = settings.wireNumbering.format
          .replace('{page}', page.name)
          .replace('{column}', String(column))
          .replace('{row}', row)
          .replace('{counter}', String(counter));
      } while (taken.has(number));
      counters.set(key, counter);
      taken.add(number);
    }
    const marker = (markers.get(net) ?? []).find((m) => m.wire?.color || m.wire?.crossSection)?.wire;
    const inCable = cables.byNet.get(net);
    const potential = potentialOfNet.get(net);
    const potentialWire = potentials.find((x) => x.name === potential)?.wire;
    const info: WireInfo = {
      net,
      number,
      numberSource: stored.has(net) ? 'marker' : 'derived',
      pageId: p.pageId,
      column,
      ends: [...(ends.get(net) ?? [])],
      color: marker?.color ?? inCable?.core.color ?? potentialWire?.color ?? settings.defaultWire.color,
      crossSection: marker?.crossSection ?? inCable?.core.crossSection ?? inCable?.cable.cable.crossSection ?? potentialWire?.crossSection ?? settings.defaultWire.crossSection,
      ...(potential ? { potential } : {}),
      ...(inCable ? { cable: { device: inCable.cable.device, core: inCable.core.id } } : {}),
      markers: (markers.get(net) ?? []).map((m) => ({ pageId: m.pageId, itemId: m.itemId })),
    };
    wires.push(info);
    byNet.set(net, info);
  }
  return { wires, byNet, issues };
}

function itemIndex(state: ProjectState): Map<string, { page: SchematicPage; item: Item }> {
  const map = new Map<string, { page: SchematicPage; item: Item }>();
  for (const page of Object.values(state.pages)) {
    if (page.type === 'schematic') for (const item of page.items) map.set(item.id, { page, item });
  }
  return map;
}
