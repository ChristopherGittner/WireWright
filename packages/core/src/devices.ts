// Devices are derived: all items with the same effective tag form one device.
// See docs/data-model.md and ADR-008.
import { devicePages } from './plcStore.js';
import { issueMessage, type Issue } from './issues.js';
import type { Library } from './library.js';
import type { Point } from './geometry.js';
import type { Item, ProjectState, SchematicPage, SymbolDefinition, Tag } from './schema.js';
import { effectiveTag, formatTag } from './tags.js';

export type FunctionRole = 'main' | 'auxiliary' | 'none';

export interface DeviceFunction {
  pageId: string;
  itemId: string;
  symbol: string;
  /** Function of the symbol definition, e.g. `relay.coil`, `contact.no`. */
  function: string;
  role: 'main' | 'auxiliary';
}

export interface Device {
  /** Full tag, e.g. `=A1+CAB1-5K3`. Unique per project. */
  key: string;
  tag: Tag;
  functions: DeviceFunction[];
  /** The main function, if there is exactly one. */
  main?: DeviceFunction;
}

export interface DeviceIndex {
  devices: Map<string, Device>;
  /** Item ID → device key, for items that are device functions. */
  byItem: Map<string, string>;
  issues: Issue[];
}

/** Role of an item: the item's own `main` flag wins over the symbol definition's default. */
export function itemRole(item: Item, def: SymbolDefinition | undefined): FunctionRole {
  if (!def || def.defaultRole === 'none') return 'none';
  if (item.main !== undefined) return item.main ? 'main' : 'auxiliary';
  return def.defaultRole;
}

/**
 * The device tag an auxiliary function placed at `at` without its own tag
 * takes: that of the nearest device symbol to its left at the same height,
 * at any distance. Connection symbols and boxes are skipped.
 */
export function tagFromLeftNeighbour(page: SchematicPage, at: Point, library: Library, excludeId?: string): Tag | undefined {
  let nearest: Item | undefined;
  for (const item of page.items) {
    if (item.id === excludeId || item.y !== at.y || item.x >= at.x) continue;
    const def = library.symbol(item.symbol);
    if (!def || def.resizable || itemRole(item, def) === 'none') continue;
    if (!nearest || item.x > nearest.x) nearest = item;
  }
  if (!nearest) return undefined;
  const tag = effectiveTag(page, nearest, library);
  return tag.product ? tag : undefined;
}

/** Schematic pages in project page order. */
export function schematicPages(state: ProjectState): SchematicPage[] {
  const pages: SchematicPage[] = [];
  for (const id of state.project.pages) {
    const page = state.pages[id];
    if (page?.type === 'schematic') pages.push(page);
  }
  return pages;
}

const DEVICE_DATA_KEYS = ['parts', 'technicalData', 'contacts'] as const;

export function buildDeviceIndex(state: ProjectState, library: Library): DeviceIndex {
  const devices = new Map<string, Device>();
  const byItem = new Map<string, string>();
  const issues: Issue[] = [];

  for (const page of devicePages(state)) {
    for (const item of page.items) {
      const def = library.symbol(item.symbol);
      if (!def) {
        issues.push({
          severity: 'error',
          code: 'symbol.unknown',
          ...issueMessage('Unknown symbol "{symbol}"', { symbol: item.symbol }),
          pageId: page.id,
          itemId: item.id,
        });
        continue;
      }
      const role = itemRole(item, def);
      if (role === 'none') continue;
      const tag = effectiveTag(page, item, library);
      if (!tag.product) {
        issues.push({
          severity: 'warning',
          code: 'device.missingProduct',
          ...issueMessage('Symbol "{symbol}" has no device tag (e.g. -K1)', { symbol: item.symbol }),
          pageId: page.id,
          itemId: item.id,
        });
        continue;
      }
      const key = formatTag(tag);
      let device = devices.get(key);
      if (!device) {
        device = { key, tag, functions: [] };
        devices.set(key, device);
      }
      device.functions.push({ pageId: page.id, itemId: item.id, symbol: item.symbol, function: def.function, role });
      byItem.set(item.id, key);

      if (role === 'auxiliary') {
        const keys = DEVICE_DATA_KEYS.filter((k) => item.props?.[k] !== undefined);
        if (keys.length > 0) {
          issues.push({
            severity: 'warning',
            code: 'device.dataOnAuxiliary',
            ...issueMessage('{device}: device data ({keys}) belongs on the main function, not on an auxiliary function', { device: key, keys: keys.join(', ') }),
            pageId: page.id,
            itemId: item.id,
            device: key,
          });
        }
      }
    }
  }

  for (const device of devices.values()) {
    const mains = device.functions.filter((f) => f.role === 'main');
    if (mains.length === 1) {
      device.main = mains[0];
    } else if (mains.length > 1) {
      for (const f of mains.slice(1)) {
        issues.push({
          severity: 'error',
          code: 'device.multipleMainFunctions',
          ...issueMessage('{device} has {count} main functions; only one may carry the device data', { device: device.key, count: mains.length }),
          pageId: f.pageId,
          itemId: f.itemId,
          device: device.key,
        });
      }
    } else if (!device.functions.every((f) => f.function === 'terminal')) {
      const first = device.functions[0];
      issues.push({
        severity: 'warning',
        code: 'device.noMainFunction',
        ...issueMessage('{device} has no main function (e.g. the coil of a relay)', { device: device.key }),
        pageId: first?.pageId,
        itemId: first?.itemId,
        device: device.key,
      });
    }
  }

  return { devices, byItem, issues };
}
