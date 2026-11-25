// Terminal strips. A strip (`-X1`) is a device whose functions are its
// terminals; each terminal has a designation (`props.terminal`) and may be
// bridged to other terminals of the strip (`props.bridge`, same label =
// bridged). Targets are split into internal (same location as the strip, e.g.
// in the cabinet) and external (other locations, e.g. in the field).
import type { Connectivity } from './connectivity.js';
import { designations, pinLabel } from './crossrefs.js';
import type { DeviceIndex } from './devices.js';
import { issueMessage, type Issue } from './issues.js';
import type { Library } from './library.js';
import { formatReference, pagePosition } from './references.js';
import { naturalCompare } from './reports.js';
import type { Item, ProjectState, SchematicPage } from './schema.js';
import { effectiveTag, formatTag } from './tags.js';

export interface TerminalInfo {
  pageId: string;
  itemId: string;
  /** Level of a multi-level terminal (`2` of `1.2`). */
  level?: number;
  designation: string;
  bridge?: string;
  /**
   * The bridge as shown in lists and the terminal diagram: the label, or for terminals bridged
   * only with their neighbours `~1`, `~2` … (one per group of bridged terminals).
   */
  bridged?: string;
  /** Device pins in other locations (field side). */
  external: string[];
  /** Device pins in the strip's location (cabinet side). */
  internal: string[];
  /** Where the terminal is drawn (`/5.3`). */
  reference: string;
}

export interface TerminalStrip {
  device: string;
  location?: string;
  terminals: TerminalInfo[];
}

export interface TerminalIndex {
  strips: TerminalStrip[];
  issues: Issue[];
}

export function isTerminal(item: Item, library: Library): boolean {
  return library.symbol(item.symbol)?.function === 'terminal';
}

/** Designation of a terminal; of a multi-level terminal its number without the level (`1` of `1.2`). */
export function terminalDesignation(item: Item, library: Library): string {
  return typeof item.props?.terminal === 'string' ? item.props.terminal : (designations(item, library)[0] ?? '');
}

/** One level of a terminal: its designation (`1`, or `1.2` on a multi-level terminal), pins and bridge label. */
export interface TerminalLevel {
  level?: number;
  designation: string;
  pins: string[];
  bridge?: string;
}

/** Designation of a level of a multi-level terminal: `1.2`; without a number only the level. */
export function levelDesignation(base: string, level: number): string {
  return base === '' ? '' : `${base}.${level}`;
}

/** The levels of a placed terminal: one for an ordinary terminal, one per level for a multi-level terminal. */
export function terminalLevels(item: Item, library: Library): TerminalLevel[] {
  const def = library.symbol(item.symbol);
  const base = terminalDesignation(item, library);
  const bridgeOf = (b: unknown) => (typeof b === 'string' && b !== '' ? { bridge: b } : {});
  if (!def?.terminalLevels) return [{ designation: base, pins: (def?.connections ?? []).map((c) => c.id), ...bridgeOf(item.props?.bridge) }];
  const combined = def.terminalLevels.length > 1;
  return def.terminalLevels.map(({ level, pins }) => ({
    level,
    designation: levelDesignation(base, level),
    pins,
    ...bridgeOf(combined ? item.props?.bridges?.[String(level)] : item.props?.bridge),
  }));
}

/** The level of a terminal a pin belongs to. */
export function terminalLevelOfPin(item: Item, library: Library, pin: string): TerminalLevel | undefined {
  return terminalLevels(item, library).find((l) => l.pins.includes(pin));
}

/** All bridge labels of a terminal (of all its levels). */
export function terminalBridges(item: Item): string[] {
  const labels = [item.props?.bridge, ...Object.values(item.props?.bridges ?? {})];
  return labels.filter((b): b is string => typeof b === 'string' && b !== '');
}

/** Props that set the bridge label of one level of a terminal. */
export function levelBridgeProps(item: Item, library: Library, level: number | undefined, bridge: string | null): Record<string, unknown> {
  const def = library.symbol(item.symbol);
  if (level === undefined || !def?.terminalLevels || def.terminalLevels.length < 2) return { bridge };
  const bridges = { ...item.props?.bridges };
  if (bridge) bridges[String(level)] = bridge;
  else delete bridges[String(level)];
  return { bridges: Object.keys(bridges).length > 0 ? bridges : null };
}

export function buildTerminalStrips(state: ProjectState, library: Library, devices: DeviceIndex, connectivity: Connectivity): TerminalIndex {
  const { settings } = state.project;
  const items = new Map<string, { page: SchematicPage; item: Item }>();
  for (const page of Object.values(state.pages)) {
    if (page.type === 'schematic') for (const item of page.items) items.set(item.id, { page, item });
  }
  const isDevice = (itemId: string) => {
    const entry = items.get(itemId);
    const def = entry && library.symbol(entry.item.symbol);
    return def !== undefined && def.defaultRole !== 'none';
  };
  /** Device pins reached from a terminal pin along conductors, through connection symbols. */
  const wiredTo = (start: string, itemId: string): string[] => {
    const seen = new Set([start]);
    const queue = [start];
    const found: string[] = [];
    while (queue.length > 0) {
      for (const next of connectivity.wiring.get(queue.shift()!) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        const point = connectivity.points.get(next);
        if (!point || point.itemId === itemId) continue;
        if (isDevice(point.itemId)) {
          if (!point.inner) found.push(next);
        } else queue.push(next);
      }
    }
    return found;
  };

  const strips: TerminalStrip[] = [];
  const issues: Issue[] = [];
  const neighbourPairs = Object.values(state.pages).flatMap((page) => (page.type === 'schematic' ? pageTerminalBridges(page, library) : []));
  for (const device of devices.devices.values()) {
    const functions = device.functions.filter((f) => f.function === 'terminal');
    if (functions.length === 0) continue;
    const strip: TerminalStrip = { device: device.key, ...(device.tag.location ? { location: device.tag.location } : {}), terminals: [] };
    // Multi-level terminals by number: whether their levels are connected inside.
    const connectedLevels = new Map<string, Set<boolean>>();
    for (const f of functions) {
      const { page, item } = items.get(f.itemId)!;
      const def = library.symbol(item.symbol);
      if (def?.terminalLevels) {
        const base = terminalDesignation(item, library);
        if (base !== '') connectedLevels.set(base, (connectedLevels.get(base) ?? new Set()).add(def.levelsConnected === true));
      }
      const reference = formatReference(page, pagePosition(page, item, settings, library), settings);
      for (const level of terminalLevels(item, library)) {
        const info: TerminalInfo = {
          pageId: page.id,
          itemId: item.id,
          ...(level.level !== undefined ? { level: level.level } : {}),
          designation: level.designation,
          ...(level.bridge !== undefined ? { bridge: level.bridge } : {}),
          external: [],
          internal: [],
          reference,
        };
        for (const pin of level.pins) {
          for (const key of wiredTo(`${item.id}:${pin}`, item.id)) {
            const point = connectivity.points.get(key)!;
            const target = items.get(point.itemId)!;
            const label = pinLabel(target.page, target.item, point, library);
            const location = effectiveTag(target.page, target.item, library).location;
            const side = location === strip.location ? info.internal : info.external;
            if (!side.includes(label)) side.push(label);
          }
        }
        strip.terminals.push(info);
      }
    }
    for (const [base, kinds] of connectedLevels) {
      if (kinds.size < 2) continue;
      const t = strip.terminals.find((t) => t.level !== undefined && t.designation.startsWith(`${base}.`))!;
      issues.push({ severity: 'info', code: 'terminal.levelMismatch', ...issueMessage('{device}: the levels of terminal {terminal} are drawn as connected and as separate levels', { device: device.key, terminal: base }), pageId: t.pageId, itemId: t.itemId, device: device.key });
    }
    strip.terminals.sort((a, b) => naturalCompare(a.designation, b.designation));
    // Bridge groups: same label, or bridged with the neighbour.
    const parent = new Map<string, string>();
    const find = (k: string): string => {
      const p = parent.get(k) ?? k;
      if (p === k) return k;
      const root = find(p);
      parent.set(k, root);
      return root;
    };
    const union = (a: string, b: string) => parent.set(find(a), find(b));
    const levelKey = (t: { itemId: string; level?: number | undefined }) => `${t.itemId}\u0000${t.level ?? 1}`;
    const byLabel = new Map<string, string>();
    for (const t of strip.terminals) {
      if (!t.bridge) continue;
      const k = `${t.level ?? 1}\u0000${t.bridge}`;
      if (byLabel.has(k)) union(levelKey(t), byLabel.get(k)!);
      else byLabel.set(k, levelKey(t));
    }
    const members = new Set(strip.terminals.map(levelKey));
    for (const { a, b, level, neighbour } of neighbourPairs) {
      const [ka, kb] = [levelKey({ itemId: a.id, level }), levelKey({ itemId: b.id, level })];
      if (neighbour && members.has(ka) && members.has(kb)) union(ka, kb);
    }
    const groups = new Map<string, TerminalInfo[]>();
    for (const t of strip.terminals) groups.set(find(levelKey(t)), [...(groups.get(find(levelKey(t))) ?? []), t]);
    let unnamed = 0;
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const name = group.find((t) => t.bridge)?.bridge ?? `~${++unnamed}`;
      for (const t of group) t.bridged = name;
    }
    const seen = new Map<string, TerminalInfo>();
    for (const t of strip.terminals) {
      if (t.designation === '') {
        issues.push({ severity: 'info', code: 'terminal.noDesignation', ...issueMessage('{device}: terminal without designation', { device: device.key }), pageId: t.pageId, itemId: t.itemId, device: device.key });
      } else if (seen.has(t.designation)) {
        issues.push({ severity: 'warning', code: 'terminal.duplicate', ...issueMessage('{device}: terminal {terminal} exists twice', { device: device.key, terminal: t.designation }), pageId: t.pageId, itemId: t.itemId, device: device.key });
      }
      seen.set(t.designation, t);
    }
    const bridges = new Map<string, number>();
    // Bridges join terminals on one level (ordinary terminals count as level 1).
    const bridgeKey = (t: TerminalInfo) => `${t.level ?? 1}\u0000${t.bridge}`;
    for (const t of strip.terminals) if (t.bridge) bridges.set(bridgeKey(t), (bridges.get(bridgeKey(t)) ?? 0) + 1);
    for (const t of strip.terminals) {
      if (t.bridge && bridges.get(bridgeKey(t)) === 1) {
        issues.push({ severity: 'warning', code: 'terminal.lonelyBridge', ...issueMessage('{device}: bridge "{bridge}" has only terminal {terminal}', { device: device.key, bridge: t.bridge, terminal: t.designation }), pageId: t.pageId, itemId: t.itemId, device: device.key });
      }
    }
    strips.push(strip);
  }
  strips.sort((a, b) => naturalCompare(a.device, b.device));
  return { strips, issues };
}

/** A terminal strip to be placed at once (terminal strip configurator). */
export interface TerminalStripConfig {
  /** Strip name without the dash (`X1`). */
  strip: string;
  /** Number of terminals. */
  count: number;
  /** Levels per terminal: 1 (ordinary or multi-connection terminal), 2 or 3 (multi-level terminal). */
  levels: 1 | 2 | 3;
  /** Clamping points of a single-level terminal: 2 … 6 (multi-level terminals have 2 per level). */
  pins?: number;
  /** The levels of each terminal are connected inside it (PE double-level terminals …). */
  levelsConnected?: boolean;
  /** Protective earth terminals (multi-level: levels connected). */
  pe?: boolean;
  /** Per level: all terminals of the strip bridged on that level (cross-connectors). */
  bridged?: boolean[];
  /** First terminal number (default 1). */
  start?: number;
}

/** Symbol and pitch (mm) of the terminals of a configured strip. */
export function terminalStripSymbol(config: TerminalStripConfig): { symbol: string; pitch: number } {
  if (config.levels === 1) {
    const pins = Math.min(6, Math.max(2, Math.trunc(config.pins ?? 2)));
    const pe = config.pe ? '.pe' : '';
    return pins === 2 ? { symbol: `iec60617.terminal${pe}`, pitch: 8 } : { symbol: `iec60617.terminal.multi.${pins}${pe}`, pitch: 4 * Math.ceil(pins / 2) + 4 };
  }
  const kind = config.pe ? '.pe' : config.levelsConnected ? '.connected' : '';
  // The housing is as wide as the pitch (4 mm per level + 4): side by side, the housings touch.
  return { symbol: `iec60617.terminal.${config.levels}level${kind}`, pitch: 4 * config.levels + 4 };
}

/**
 * The items of a configured terminal strip, side by side from (0, 0), numbered from `start`.
 * A bridged level is bridged from each terminal to its right neighbour (`bridgeRight`).
 */
export function terminalStripItems(config: TerminalStripConfig): Item[] {
  const { symbol, pitch } = terminalStripSymbol(config);
  const count = Math.max(1, Math.trunc(config.count));
  const start = Math.trunc(config.start ?? 1);
  // Bridged levels: each terminal bridged to its right neighbour (the last one has none).
  const bridged = (config.bridged ?? []).slice(0, config.levels).flatMap((on, i) => (on ? [i + 1] : []));
  return Array.from({ length: count }, (_, i) => ({
    id: `i_t${i + 1}`,
    symbol,
    x: i * pitch,
    y: 0,
    rotation: 0,
    mirror: false,
    tag: { product: config.strip.replace(/^-/, '') || 'X1' },
    props: { terminal: String(start + i), ...(i < count - 1 && bridged.length > 0 ? { bridgeRight: bridged } : {}) },
  })) as Item[];
}

/** Two terminal levels of a strip drawn side by side and bridged: by a bridge label or as neighbours. */
export interface TerminalBridgePair {
  a: Item;
  b: Item;
  level: number;
  /** Bridged with the neighbour (bridgeLeft / bridgeRight), not (only) by a label. */
  neighbour: boolean;
}

/**
 * Bridges between terminals drawn side by side on a page: per row (same strip, same height,
 * not turned by 90°) and level, from left to right, each pair of neighbouring terminals that is
 * bridged (`bridgeRight` of the left one or `bridgeLeft` of the right one), and each pair of
 * consecutive terminals with the same bridge label.
 */
export function pageTerminalBridges(page: SchematicPage, library: Library): TerminalBridgePair[] {
  const rows = new Map<string, Item[]>();
  for (const item of page.items) {
    if (item.rotation % 180 !== 0 || library.symbol(item.symbol)?.function !== 'terminal') continue;
    const key = `${formatTag(effectiveTag(page, item, library))}\u0000${item.y}`;
    rows.set(key, [...(rows.get(key) ?? []), item]);
  }
  const pairs: TerminalBridgePair[] = [];
  for (const row of rows.values()) {
    row.sort((a, b) => a.x - b.x);
    const levels = new Map(row.map((item) => [item.id, terminalLevels(item, library)]));
    const all = new Set(row.flatMap((item) => levels.get(item.id)!.map((l) => l.level ?? 1)));
    for (const level of all) {
      const members = row.filter((item) => levels.get(item.id)!.some((l) => (l.level ?? 1) === level));
      const label = (item: Item) => levels.get(item.id)!.find((l) => (l.level ?? 1) === level)?.bridge;
      const found = new Map<string, TerminalBridgePair>();
      members.forEach((a, i) => {
        const b = members[i + 1];
        if (b && (a.props?.bridgeRight?.includes(level) || b.props?.bridgeLeft?.includes(level))) found.set(`${a.id}\u0000${b.id}`, { a, b, level, neighbour: true });
        // The next terminal with the same label (others may lie between).
        const own = label(a);
        const next = own === undefined ? undefined : members.slice(i + 1).find((m) => label(m) === own);
        if (next && !found.has(`${a.id}\u0000${next.id}`)) found.set(`${a.id}\u0000${next.id}`, { a, b: next, level, neighbour: false });
      });
      pairs.push(...found.values());
    }
  }
  return pairs;
}
