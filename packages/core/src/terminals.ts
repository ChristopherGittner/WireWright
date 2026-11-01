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
import { effectiveTag } from './tags.js';

export interface TerminalInfo {
  pageId: string;
  itemId: string;
  designation: string;
  bridge?: string;
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

export function terminalDesignation(item: Item, library: Library): string {
  return typeof item.props?.terminal === 'string' ? item.props.terminal : (designations(item, library)[0] ?? '');
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
  for (const device of devices.devices.values()) {
    const functions = device.functions.filter((f) => f.function === 'terminal');
    if (functions.length === 0) continue;
    const strip: TerminalStrip = { device: device.key, ...(device.tag.location ? { location: device.tag.location } : {}), terminals: [] };
    for (const f of functions) {
      const { page, item } = items.get(f.itemId)!;
      const info: TerminalInfo = {
        pageId: page.id,
        itemId: item.id,
        designation: terminalDesignation(item, library),
        ...(typeof item.props?.bridge === 'string' && item.props.bridge !== '' ? { bridge: item.props.bridge } : {}),
        external: [],
        internal: [],
        reference: formatReference(page, pagePosition(page, item, settings, library), settings),
      };
      const pins = library.symbol(item.symbol)?.connections ?? [];
      for (const pin of pins) {
        for (const key of wiredTo(`${item.id}:${pin.id}`, item.id)) {
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
    strip.terminals.sort((a, b) => naturalCompare(a.designation, b.designation));
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
    for (const t of strip.terminals) if (t.bridge) bridges.set(t.bridge, (bridges.get(t.bridge) ?? 0) + 1);
    for (const t of strip.terminals) {
      if (t.bridge && bridges.get(t.bridge) === 1) {
        issues.push({ severity: 'warning', code: 'terminal.lonelyBridge', ...issueMessage('{device}: bridge "{bridge}" has only terminal {terminal}', { device: device.key, bridge: t.bridge, terminal: t.designation }), pageId: t.pageId, itemId: t.itemId, device: device.key });
      }
    }
    strips.push(strip);
  }
  strips.sort((a, b) => naturalCompare(a.device, b.device));
  return { strips, issues };
}
