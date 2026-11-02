// Autoconnect, nets and potentials (ADR-003, docs/data-model.md "Potentials").
//
// - Autoconnect: two connection points on a page connect when they face each
//   other on the same horizontal or vertical line with no other connection
//   point in between. Lines are computed, never stored.
// - Nets: what is joined by wires: autoconnect lines, connection symbols
//   (corner, T, cross …), interruption points and potential points with the
//   same name.
// - Potentials: nets joined through devices along their pin links, fed by
//   potential points, potential definition points and source pins.
import { schematicPages, itemRole } from './devices.js';
import { boxRect, containsPoint, transformDirection, transformPoint } from './geometry.js';
import { issueKey, issueMessage, type Issue } from './issues.js';
import type { Library } from './library.js';
import type { Direction, Item, ProjectState, SchematicPage, SymbolDefinition } from './schema.js';
import { channelPins, isPlcPoint, plcPointKind, resolveSymbol } from './symbols.js';
import { effectiveTag, formatTag } from './tags.js';

export interface ConnectionPointInfo {
  /** `itemId:pin`; the inner side of a device box border pin is `itemId:pin:in`. */
  key: string;
  pageId: string;
  itemId: string;
  pin: string;
  x: number;
  y: number;
  direction: Direction;
  designation?: string;
  /** Inner side of a device box border pin. */
  inner?: boolean;
  /** A pipe port (pneumatics, hydraulics): connects only to other pipe ports. */
  medium?: 'fluid';
}

export interface Segment {
  pageId: string;
  a: string;
  b: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PotentialState {
  /** The potential name, if exactly one source feeds this conductor. */
  name?: string;
  /** All potential names that meet here, when there is more than one (conflict). */
  conflict?: string[];
  /** Key of the `potential.conflict` issue of a conflict, to tell whether it is acknowledged. */
  conflictKey?: string;
}

export interface Connectivity {
  points: Map<string, ConnectionPointInfo>;
  segments: Segment[];
  /** Point key → net ID (all points joined by wires share one net). */
  netOf: Map<string, string>;
  /** Point key → potential. */
  potentialOf: Map<string, PotentialState>;
  /**
   * Point key → point keys joined to it by a conductor (wires, connection
   * symbols, interruption points), without the joins of same-named potential
   * points. Used to find the devices wired directly to a pin.
   */
  wiring: Map<string, string[]>;
  issues: Issue[];
}

const OPPOSITE: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };

/** All connection points of a page in absolute page coordinates. */
export function pageConnectionPoints(page: SchematicPage, library: Library): ConnectionPointInfo[] {
  const points: ConnectionPointInfo[] = [];
  for (const item of page.items) {
    const def = resolveSymbol(item, library);
    if (!def) continue;
    for (const c of def.connections) {
      const p = transformPoint(c, item.rotation, item.mirror);
      const designation = item.pins?.[c.id] ?? c.designation;
      points.push({
        key: `${item.id}:${c.id}`,
        pageId: page.id,
        itemId: item.id,
        pin: c.id,
        x: item.x + p.x,
        y: item.y + p.y,
        direction: transformDirection(c.direction, item.rotation, item.mirror),
        ...(designation !== undefined ? { designation } : {}),
        ...(c.medium ? { medium: c.medium } : {}),
      });
    }
    if (def.function === 'box.device') {
      for (const pin of item.borderPins ?? []) {
        const { x, y, direction } = borderPinPosition(item, pin.side, pin.offset);
        const base = { pageId: page.id, itemId: item.id, pin: pin.id, x, y, designation: pin.designation };
        points.push({ ...base, key: `${item.id}:${pin.id}`, direction });
        points.push({ ...base, key: `${item.id}:${pin.id}:in`, direction: OPPOSITE[direction], inner: true });
      }
    }
  }
  return points;
}

function borderPinPosition(box: Item, side: 'left' | 'right' | 'top' | 'bottom', offset: number): { x: number; y: number; direction: Direction } {
  const r = boxRect(box);
  switch (side) {
    case 'left':
      return { x: r.x, y: r.y + offset, direction: 'left' };
    case 'right':
      return { x: r.x + r.width, y: r.y + offset, direction: 'right' };
    case 'top':
      return { x: r.x + offset, y: r.y, direction: 'up' };
    case 'bottom':
      return { x: r.x + offset, y: r.y + r.height, direction: 'down' };
  }
}

export interface PageSegments {
  segments: Segment[];
  /** Points that face several partners at the same distance. */
  ambiguous: ConnectionPointInfo[];
}

/** Autoconnect for one page. */
export function pageSegments(page: SchematicPage, library: Library, points = pageConnectionPoints(page, library)): PageSegments {
  // Inner sides of device box border pins only see items inside the box.
  const insideBox = new Map<string, (p: ConnectionPointInfo) => boolean>();
  for (const item of page.items) {
    if (item.borderPins && library.symbol(item.symbol)?.function === 'box.device') {
      const rect = boxRect(item);
      const items = new Map(page.items.map((i) => [i.id, i]));
      insideBox.set(item.id, (p) => {
        const other = items.get(p.itemId);
        return other !== undefined && other.id !== item.id && containsPoint(rect, other);
      });
    }
  }
  const visible = (from: ConnectionPointInfo, to: ConnectionPointInfo): boolean => {
    if (from.itemId === to.itemId) return false;
    if (from.inner && !insideBox.get(from.itemId)?.(to)) return false;
    if (to.inner && !insideBox.get(to.itemId)?.(from)) return false;
    return true;
  };

  const rows = groupBy(points, (p) => p.y);
  const columns = groupBy(points, (p) => p.x);
  const partner = new Map<string, ConnectionPointInfo | null>();
  const ambiguous: ConnectionPointInfo[] = [];

  for (const p of points) {
    const horizontal = p.direction === 'left' || p.direction === 'right';
    const sign = p.direction === 'right' || p.direction === 'down' ? 1 : -1;
    const line = horizontal ? rows.get(p.y) : columns.get(p.x);
    let best = Infinity;
    let nearest: ConnectionPointInfo[] = [];
    for (const q of line ?? []) {
      // Pipes and wires do not see each other: they neither connect nor stand in the way.
      if (!visible(p, q) || q.medium !== p.medium) continue;
      const distance = sign * (horizontal ? q.x - p.x : q.y - p.y);
      if (distance < 0) continue;
      if (distance < best) {
        best = distance;
        nearest = [q];
      } else if (distance === best) {
        nearest.push(q);
      }
    }
    const facing = nearest.filter((q) => q.direction === OPPOSITE[p.direction]);
    if (facing.length > 1) ambiguous.push(p);
    partner.set(p.key, facing.length === 1 ? facing[0]! : null);
  }

  const segments: Segment[] = [];
  for (const p of points) {
    const q = partner.get(p.key);
    if (!q || partner.get(q.key)?.key !== p.key || p.key > q.key) continue;
    segments.push({ pageId: page.id, a: p.key, b: q.key, x1: p.x, y1: p.y, x2: q.x, y2: q.y });
  }
  return { segments, ambiguous };
}

/**
 * Connection points and autoconnect segments of a page. Cached for frozen pages (the document's
 * pages are immutable): after an edit only the changed pages are laid out again.
 */
const geometryCache = new WeakMap<SchematicPage, WeakMap<Library, { points: ConnectionPointInfo[]; result: PageSegments }>>();

function pageGeometry(page: SchematicPage, library: Library): { points: ConnectionPointInfo[]; result: PageSegments } {
  const frozen = Object.isFrozen(page);
  const cached = frozen ? geometryCache.get(page)?.get(library) : undefined;
  if (cached) return cached;
  const points = pageConnectionPoints(page, library);
  const value = { points, result: pageSegments(page, library, points) };
  if (frozen) {
    let byLibrary = geometryCache.get(page);
    if (!byLibrary) geometryCache.set(page, (byLibrary = new WeakMap()));
    byLibrary.set(library, value);
  }
  return value;
}

/** Nets and potentials for the whole project. */
export function buildConnectivity(state: ProjectState, library: Library): Connectivity {
  const points = new Map<string, ConnectionPointInfo>();
  const segments: Segment[] = [];
  const issues: Issue[] = [];
  const nets = new UnionFind();
  const connected = new Set<string>();
  const byName = {
    interruption: new Map<string, ConnectionPointInfo[]>(),
    potential: new Map<string, ConnectionPointInfo[]>(),
    medium: new Map<string, ConnectionPointInfo[]>(),
  };
  // Edges used to explain potential conflicts: point → [neighbour, item passed through].
  const graph = new Map<string, { to: string; via?: string }[]>();
  const wiring = new Map<string, string[]>();
  const edge = (a: string, b: string, via?: string) => {
    push(graph, a, via === undefined ? { to: b } : { to: b, via });
    push(graph, b, via === undefined ? { to: a } : { to: a, via });
  };
  /** A conductor: an edge in both the net graph and the wiring graph. */
  const wire = (a: string, b: string) => {
    edge(a, b);
    push(wiring, a, b);
    push(wiring, b, a);
  };

  type Pending = { item: Item; def: SymbolDefinition; page: SchematicPage; keys: string[] };
  const devices: Pending[] = [];
  const sources: { key: string; name: string; fluid?: boolean }[] = [];
  const plcItems: { item: Item; def: SymbolDefinition; page: SchematicPage }[] = [];

  for (const page of schematicPages(state)) {
    const { points: pagePoints, result } = pageGeometry(page, library);
    for (const p of pagePoints) {
      points.set(p.key, p);
      nets.add(p.key);
    }
    for (const s of result.segments) {
      segments.push(s);
      nets.union(s.a, s.b);
      connected.add(s.a);
      connected.add(s.b);
      wire(s.a, s.b);
    }
    for (const p of result.ambiguous) {
      issues.push({
        severity: 'warning',
        code: 'autoconnect.ambiguous',
        ...issueMessage('Connection point at ({x}, {y}) faces several connection points at the same distance', { x: p.x, y: p.y }),
        pageId: page.id,
        itemId: p.itemId,
      });
    }

    const keysOf = new Map<string, string[]>();
    for (const p of pagePoints) push(keysOf, p.itemId, p.key);

    for (const item of page.items) {
      const def = resolveSymbol(item, library);
      if (!def) continue;
      const keys = keysOf.get(item.id) ?? [];
      if (def.generator === 'plcCard' || isPlcPoint(def)) plcItems.push({ item, def, page });
      const name = typeof item.props?.name === 'string' && item.props.name !== '' ? item.props.name : undefined;
      switch (def.function) {
        case 'connection.interruption':
          if (name === undefined) {
            issues.push({ severity: 'warning', code: 'interruption.unnamed', ...issueMessage('Interruption point has no name'), pageId: page.id, itemId: item.id });
          } else {
            // Pipe and wire interruption points of the same name are not partners.
            for (const key of keys) push(byName.interruption, `${points.get(key)!.medium ?? ''}\u0000${name}`, points.get(key)!);
          }
          continue;
        case 'connection.potential':
          if (name === undefined) {
            issues.push({ severity: 'warning', code: 'potential.unnamed', ...issueMessage('Potential point has no potential name'), pageId: page.id, itemId: item.id });
          } else {
            for (const key of keys) {
              push(byName.potential, name, points.get(key)!);
              sources.push({ key, name });
            }
          }
          continue;
        case 'connection.medium':
          // A pipe source names the medium of its pipes (like a potential point for wires).
          if (name === undefined) {
            issues.push({ severity: 'warning', code: 'medium.unnamed', ...issueMessage('Pipe source has no medium name'), pageId: page.id, itemId: item.id });
          } else {
            for (const key of keys) {
              push(byName.medium, name, points.get(key)!);
              sources.push({ key, name, fluid: true });
            }
          }
          continue;
        case 'connection.potentialDefinition':
          if (name !== undefined && keys[0]) sources.push({ key: keys[0], name });
          break;
      }
      if (def.defaultRole === 'none' && def.function.startsWith('connection.')) {
        // Connection symbols are pieces of wire: their pins are one net.
        for (const group of linkGroups(def, item)) {
          const groupKeys = group.map((pin) => `${item.id}:${pin}`).filter((k) => points.has(k));
          for (const k of groupKeys.slice(1)) {
            nets.union(groupKeys[0]!, k);
            wire(groupKeys[0]!, k);
          }
        }
      } else if (itemRole(item, def) !== 'none') {
        if (def.function === 'box.device') {
          for (const pin of item.borderPins ?? []) {
            nets.union(`${item.id}:${pin.id}`, `${item.id}:${pin.id}:in`);
            wire(`${item.id}:${pin.id}`, `${item.id}:${pin.id}:in`);
          }
        }
        for (const [pin, potential] of Object.entries(item.pinPotentials ?? {})) {
          if (points.has(`${item.id}:${pin}`)) sources.push({ key: `${item.id}:${pin}`, name: potential });
        }
        devices.push({ item, def, page, keys });
      }
    }
  }

  for (const [kind, groups] of Object.entries(byName)) {
    for (const [name, group] of groups) {
      for (const p of group.slice(1)) {
        nets.union(group[0]!.key, p.key);
        // Interruption points continue the conductor; potential points of the same name only share the potential.
        if (kind === 'interruption') wire(group[0]!.key, p.key);
        else edge(group[0]!.key, p.key);
      }
      for (const p of group) if (group.length > 1) connected.add(p.key);
      if (kind === 'interruption' && group.length === 1) {
        issues.push({
          severity: 'warning',
          code: 'interruption.noPartner',
          ...issueMessage('Interruption point "{name}" has no partner with the same name', { name: name.split('\u0000').at(-1)! }),
          pageId: group[0]!.pageId,
          itemId: group[0]!.itemId,
        });
      }
    }
  }

  // A PLC card pin and the I/O point symbols showing the same channel are one terminal.
  const cards = new Map<string, Item>();
  for (const { item, def, page } of plcItems) {
    if (def.generator === 'plcCard' && item.props?.plc) cards.set(formatTag(effectiveTag(page, item, library)), item);
  }
  // A further overview of a card (view) shows the same terminals as the card master.
  for (const { item } of plcItems) {
    const of = item.props?.plcView?.of;
    if (!of) continue;
    for (const channel of item.props!.plcView!.channels) {
      const [viewKey, cardKey] = [`${item.id}:${channel.pin}`, `${of}:${channel.pin}`];
      if (!points.has(viewKey) || !points.has(cardKey)) continue;
      nets.union(cardKey, viewKey);
      wire(cardKey, viewKey);
      connected.add(cardKey);
      connected.add(viewKey);
    }
  }
  for (const { item, def, page } of plcItems) {
    if (def.generator === 'plcCard' || item.props?.channel === undefined) continue;
    const card = cards.get(formatTag(effectiveTag(page, item, library)));
    const channel = card?.props?.plc?.channels.find((c) => c.channel === item.props?.channel && c.kind === plcPointKind(def));
    if (!card || !channel) continue;
    // Each terminal of the point joins the card's terminal of the same designation (clock, input …);
    // a point with one connection is the channel's pin.
    const terminals = new Set(channelPins(channel));
    for (const c of def.connections) {
      const key = `${item.id}:${c.id}`;
      const designation = item.pins?.[c.id] ?? c.designation;
      const cardKey = `${card.id}:${designation !== undefined && terminals.has(designation) ? designation : def.connections.length === 1 ? channel.pin : ''}`;
      if (!points.has(key) || !points.has(cardKey)) continue;
      nets.union(cardKey, key);
      wire(cardKey, key);
      connected.add(cardKey);
      connected.add(key);
    }
  }

  // Potentials: nets joined through devices along their pin links.
  const potentials = new UnionFind();
  for (const key of points.keys()) potentials.add(nets.find(key));
  for (const { item, def, page } of devices) {
    const sourcePins = new Set(Object.keys(item.pinPotentials ?? {}));
    const tag = formatTag(effectiveTag(page, item, library)) || item.symbol;
    for (const group of linkGroups(def, item)) {
      const keys = group
        .filter((pin) => !sourcePins.has(pin))
        .map((pin) => `${item.id}:${pin}`)
        .filter((k) => points.has(k));
      for (const k of keys.slice(1)) {
        potentials.union(nets.find(keys[0]!), nets.find(k));
        edge(keys[0]!, k, tag);
      }
    }
  }

  // Bridged terminals (same strip, same bridge label) carry the same potential.
  const bridges = new Map<string, string>();
  for (const { item, def, page } of devices) {
    const bridge = item.props?.bridge;
    const pin = def.connections[0];
    if (def.function !== 'terminal' || typeof bridge !== 'string' || bridge === '' || !pin) continue;
    const key = `${formatTag(effectiveTag(page, item, library))}\u0000${bridge}`;
    const net = nets.find(`${item.id}:${pin.id}`);
    const other = bridges.get(key);
    if (other === undefined) bridges.set(key, net);
    else potentials.union(other, net);
  }

  const namesByGroup = new Map<string, Set<string>>();
  const sourceByGroupName = new Map<string, string>();
  for (const { key, name } of sources) {
    const group = potentials.find(nets.find(key));
    let names = namesByGroup.get(group);
    if (!names) namesByGroup.set(group, (names = new Set()));
    names.add(name);
    sourceByGroupName.set(`${group}\u0000${name}`, key);
  }

  const defined = new Set(state.project.potentials.map((p) => p.name));
  const definedMedia = new Set((state.project.media ?? []).map((m) => m.name));
  const reported = new Set<string>();
  for (const { key, name, fluid } of sources) {
    if ((fluid ? definedMedia : defined).has(name) || reported.has(`${fluid}\u0000${name}`)) continue;
    reported.add(`${fluid}\u0000${name}`);
    const p = points.get(key)!;
    issues.push(
      fluid
        ? { severity: 'warning', code: 'medium.undefined', ...issueMessage('Medium "{name}" is not defined in the project', { name }), pageId: p.pageId, itemId: p.itemId }
        : { severity: 'warning', code: 'potential.undefined', ...issueMessage('Potential "{name}" is not defined in the project', { name }), pageId: p.pageId, itemId: p.itemId },
    );
  }

  const netOf = new Map<string, string>();
  const potentialOf = new Map<string, PotentialState>();
  // One potential state object per group, shared by its points.
  const stateOfGroup = new Map<string, PotentialState>();
  for (const key of points.keys()) {
    const net = nets.find(key);
    netOf.set(key, net);
    const group = potentials.find(net);
    let potential = stateOfGroup.get(group);
    if (!potential) {
      const names = namesByGroup.get(group);
      potential = !names ? {} : names.size === 1 ? { name: [...names][0]! } : { conflict: [...names].sort() };
      stateOfGroup.set(group, potential);
    }
    potentialOf.set(key, potential);
  }

  for (const [group, names] of namesByGroup) {
    if (names.size < 2) continue;
    const [first, second] = [...names].sort() as [string, string];
    const from = sourceByGroupName.get(`${group}\u0000${first}`)!;
    const to = sourceByGroupName.get(`${group}\u0000${second}`)!;
    const via = conflictPath(graph, from, to);
    const p = points.get(from)!;
    const issue: Issue = {
      severity: 'error',
      code: 'potential.conflict',
      ...(via.length > 0
        ? issueMessage('Potentials {names} and {last} are connected (possible short circuit) via {via}', { ...potentialNames(names), via: via.join(', ') })
        : issueMessage('Potentials {names} and {last} are connected (possible short circuit)', potentialNames(names))),
      pageId: p.pageId,
      itemId: p.itemId,
    };
    issues.push(issue);
    const state = stateOfGroup.get(group);
    if (state) state.conflictKey = issueKey(issue);
  }

  const itemsById = new Map<string, Item>();
  for (const page of schematicPages(state)) for (const item of page.items) itemsById.set(item.id, item);
  for (const p of points.values()) {
    if (connected.has(p.key) || p.inner) continue;
    const item = itemsById.get(p.itemId)!;
    const def = resolveSymbol(item, library)!;
    const isConnectionSymbol = def.defaultRole === 'none';
    issues.push({
      severity: isConnectionSymbol ? 'warning' : 'info',
      code: 'connection.open',
      ...(isConnectionSymbol
        ? issueMessage('Open connection point {pin} at ({x}, {y})', { pin: p.designation ?? p.pin, x: p.x, y: p.y })
        : issueMessage('Open connection point {pin} at ({x}, {y}); end it with a break point if intended', { pin: p.designation ?? p.pin, x: p.x, y: p.y })),
      pageId: p.pageId,
      itemId: p.itemId,
    });
  }

  return { points, segments, netOf, potentialOf, wiring, issues };
}

/**
 * Pin link groups: item override (device boxes), symbol definition, or all pins when undefined.
 * Pipe ports and electrical pins are never linked with each other (a valve with its solenoid).
 */
export function linkGroups(def: SymbolDefinition, item: Item): string[][] {
  const groups = def.function === 'box.device' ? (item.links ?? []) : (def.links ?? [def.connections.map((c) => c.id)]);
  const fluid = new Set(def.connections.filter((c) => c.medium === 'fluid').map((c) => c.id));
  if (fluid.size === 0) return groups;
  return groups.flatMap((g) => [g.filter((pin) => fluid.has(pin)), g.filter((pin) => !fluid.has(pin))]).filter((g) => g.length > 1);
}

/** Devices passed on the shortest path between two potential sources. */
function conflictPath(graph: Map<string, { to: string; via?: string }[]>, from: string, to: string): string[] {
  const previous = new Map<string, { from: string; via?: string }>([[from, { from }]]);
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === to) break;
    for (const next of graph.get(current) ?? []) {
      if (previous.has(next.to)) continue;
      previous.set(next.to, next.via === undefined ? { from: current } : { from: current, via: next.via });
      queue.push(next.to);
    }
  }
  const via: string[] = [];
  for (let node = to; node !== from; ) {
    const step = previous.get(node);
    if (!step) return [];
    if (step.via !== undefined && !via.includes(step.via)) via.unshift(step.via);
    node = step.from;
  }
  return via;
}

class UnionFind {
  readonly #parent = new Map<string, string>();

  add(key: string): void {
    if (!this.#parent.has(key)) this.#parent.set(key, key);
  }

  find(key: string): string {
    let root = key;
    while (this.#parent.get(root) !== root) {
      const parent = this.#parent.get(root);
      if (parent === undefined) {
        this.#parent.set(key, key);
        return key;
      }
      root = parent;
    }
    for (let node = key; node !== root; ) {
      const next = this.#parent.get(node)!;
      this.#parent.set(node, root);
      node = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.#parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  }
}

function groupBy<T, K>(values: readonly T[], key: (v: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const v of values) push(map, key(v), v);
  return map;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** "L1, L2" and "L3" for "Potentials L1, L2 and L3 …". */
function potentialNames(names: Set<string>): { names: string; last: string } {
  const sorted = [...names].sort();
  return { names: sorted.slice(0, -1).join(', '), last: sorted.at(-1)! };
}
