// 2D cabinet layout: mounting plates drawn to scale (layout pages) with DIN rails, wire ducts and
// device footprints. Footprints come from the parts database (width × height), else from the
// layout item or a default. See docs/data-model.md, "Cabinet layout".
import { plcStorePage } from './plcStore.js';
import type { DeviceIndex } from './devices.js';
import { issueMessage, type Issue } from './issues.js';
import { findPart, type Library } from './library.js';
import type { LayoutItem, LayoutPage, LocalizedText, Page, ProjectState, SchematicPage } from './schema.js';
import { localize } from './text.js';

/** Footprint of a device without dimensions (mm). */
export const DEFAULT_FOOTPRINT = { width: 45, height: 90 };
/** Front of a door device without dimensions (round, diameter in mm). */
export const DOOR_FOOTPRINT = 30;
/** Mounting hole of 22 mm command devices (pushbuttons, lamps, selector switches) in mm. */
export const DOOR_HOLE = 22.5;
/** Height of DIN rails (mm). */
export const RAIL_HEIGHT = { TS35: 35, TS15: 15 } as const;

export function isLayoutPage(page: Page | undefined): page is LayoutPage {
  return page?.type === 'layout';
}

export interface Footprint {
  width: number;
  height: number;
  /** Device tag (full), or undefined when the main function no longer exists. */
  device?: string;
  /** Manufacturer and part number of the first part. */
  part?: string;
  /** The size comes from the parts database. */
  fromPart: boolean;
  /** Outline: round (diameter = width) or rectangular. */
  shape: 'rect' | 'round';
  /** Function text of the device's main function (for door legends). */
  functionText?: LocalizedText;
}

function mainItem(state: ProjectState, itemId: string) {
  for (const page of [...Object.values(state.pages), plcStorePage(state)]) {
    if (page.type !== 'schematic') continue;
    const item = page.items.find((i) => i.id === itemId);
    if (item) return { page: page as SchematicPage, item };
  }
  return undefined;
}

/**
 * Size of a device item: part dimensions, the item's own size, or the default (45 × 90 mm on a
 * plate, round Ø 30 mm on a door).
 */
export function layoutFootprint(state: ProjectState, library: Library, devices: DeviceIndex, item: Extract<LayoutItem, { kind: 'device' }>, surface: 'plate' | 'door' = 'plate'): Footprint {
  const main = mainItem(state, item.itemId);
  const part = main?.item.props?.parts?.[0];
  const known = part ? findPart(library, part.manufacturer, part.partNumber) : undefined;
  const fromPart = known?.width !== undefined && known.height !== undefined;
  const door = surface === 'door';
  const fallback = door ? { width: DOOR_FOOTPRINT, height: DOOR_FOOTPRINT } : DEFAULT_FOOTPRINT;
  const width = known?.width ?? item.width ?? fallback.width;
  const height = known?.height ?? item.height ?? (item.width !== undefined && door ? item.width : fallback.height);
  const shape = item.shape ?? (door && !fromPart && item.height === undefined ? 'round' : 'rect');
  const device = main ? devices.byItem.get(main.item.id) : undefined;
  const functionText = main?.item.props?.functionText;
  return {
    width: shape === 'round' ? width : item.turned ? height : width,
    height: shape === 'round' ? width : item.turned ? width : height,
    ...(device ? { device } : {}),
    ...(part ? { part: `${part.manufacturer} ${part.partNumber}`.trim() } : {}),
    fromPart,
    shape,
    ...(functionText !== undefined ? { functionText } : {}),
  };
}

/** Size of a rail, duct or cutout on the plate. */
export function layoutSize(item: Exclude<LayoutItem, { kind: 'device' }>): { width: number; height: number } {
  if (item.kind === 'cutout') return { width: item.width, height: item.height };
  const across = item.kind === 'rail' ? RAIL_HEIGHT[item.profile ?? 'TS35'] : item.width;
  return item.vertical ? { width: across, height: item.length } : { width: item.length, height: across };
}

/** Checks: placed devices that no longer exist, devices placed twice, devices not on any plate. */
export function checkLayouts(state: ProjectState, devices: DeviceIndex): Issue[] {
  const issues: Issue[] = [];
  const layouts = state.project.pages.map((id) => state.pages[id]).filter(isLayoutPage);
  if (layouts.length === 0) return issues;
  const placed = new Map<string, { pageId: string; itemId: string }>();
  for (const page of layouts) {
    for (const item of page.items) {
      if (item.kind !== 'device') continue;
      const device = devices.byItem.get(item.itemId);
      if (!device) {
        issues.push({ severity: 'warning', code: 'layout.unknownDevice', ...issueMessage('A device on the mounting plate no longer exists in the schematic'), pageId: page.id, itemId: item.id });
        continue;
      }
      if (placed.has(device)) {
        issues.push({ severity: 'warning', code: 'layout.placedTwice', ...issueMessage('{device} is placed on the mounting plate twice', { device }), pageId: page.id, itemId: item.id, device });
      }
      placed.set(device, { pageId: page.id, itemId: item.id });
    }
  }
  // Devices of the locations the plates are for (all devices when a plate has no location).
  const locations = layouts.some((p) => !p.structure?.location) ? undefined : new Set(layouts.map((p) => p.structure!.location));
  for (const device of devices.devices.values()) {
    if (!device.main || placed.has(device.key)) continue;
    if (locations && !locations.has(device.tag.location)) continue;
    // Only devices with a part are expected in the cabinet (not terminals of the field, cables …).
    const main = mainItem(state, device.main.itemId);
    if (!main?.item.props?.parts?.length) continue;
    issues.push({ severity: 'info', code: 'layout.notPlaced', ...issueMessage('{device} is not placed on a mounting plate', { device: device.key }), pageId: device.main.pageId, itemId: device.main.itemId, device: device.key });
  }
  return issues;
}

/** Rows of the mounting plate report: per plate or door the rails and ducts (total length), cutouts and devices. */
export function mountingPlateRows(state: ProjectState, library: Library, devices: DeviceIndex, pageName: (page: Page) => string): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  const { displayLanguage } = state.project.settings;
  const word = (text: { de: string; en: string }) => localize(text, displayLanguage, ['en']);
  const mm = (value: number) => String(Math.round(value * 10) / 10).replace('.', displayLanguage === 'de' ? ',' : '.');
  for (const page of state.project.pages.map((id) => state.pages[id]).filter(isLayoutPage)) {
    const where = pageName(page);
    const door = page.surface === 'door';
    rows.push({ page: where, kind: door ? word({ de: 'Tür', en: 'Door' }) : word({ de: 'Montageplatte', en: 'Mounting plate' }), designation: `1:${page.scale}`, size: `${page.plate.width} × ${page.plate.height} mm`, quantity: '1' });
    const lengths = new Map<string, { kind: string; designation: string; length: number; count: number }>();
    for (const item of page.items) {
      if (item.kind !== 'rail' && item.kind !== 'duct') continue;
      const designation = item.kind === 'rail' ? (item.profile ?? 'TS35') : `${item.width} mm`;
      const key = `${item.kind}\u0000${designation}`;
      const entry = lengths.get(key) ?? { kind: item.kind === 'rail' ? word({ de: 'Hutschiene', en: 'DIN rail' }) : word({ de: 'Kabelkanal', en: 'Wire duct' }), designation, length: 0, count: 0 };
      entry.length += item.length;
      entry.count++;
      lengths.set(key, entry);
    }
    for (const e of lengths.values()) rows.push({ page: where, kind: e.kind, designation: e.designation, size: `${Math.round(e.length)} mm`, quantity: String(e.count) });
    for (const item of page.items) {
      if (item.kind !== 'cutout') continue;
      rows.push({ page: where, kind: word({ de: 'Ausschnitt', en: 'Cutout' }), designation: item.label ?? '', size: `${mm(item.width)} × ${mm(item.height)} mm`, quantity: '1' });
    }
    for (const item of page.items) {
      if (item.kind !== 'device') continue;
      const f = layoutFootprint(state, library, devices, item, page.surface);
      const size =
        f.shape === 'round'
          ? `Ø ${mm(f.width)} mm${door ? `, ${word({ de: 'Bohrung', en: 'hole' })} Ø ${mm(DOOR_HOLE)} mm` : ''}`
          : `${mm(f.width)} × ${mm(f.height)} mm`;
      rows.push({ page: where, kind: f.device ?? '?', designation: f.part ?? '', size: `${size}${f.fromPart ? '' : ' *'}`, quantity: '1' });
    }
  }
  return rows;
}
