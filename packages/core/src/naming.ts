// Automatic device names, e.g. `-5K3` (page 5, letter K, column 3).
// See docs/data-model.md, "Tags and device naming".
import type { Point } from './geometry.js';
import type { Library } from './library.js';
import { buildDeviceIndex, schematicPages, type Device } from './devices.js';
import type { FrameDefinition, Item, LocalizedText, ProjectSettings, ProjectState, SchematicPage, Tag } from './schema.js';
import { formatTag } from './tags.js';

/** Column number (1-based) of an x coordinate in the frame's column grid. */
export function columnAt(frame: FrameDefinition | undefined, x: number): number {
  if (!frame) return 1;
  const { count, x: start, width } = frame.columns;
  return clamp(Math.floor((x - start) / width) + 1, 1, count);
}

/** Row label of a y coordinate in the frame's row grid. */
export function rowAt(frame: FrameDefinition | undefined, y: number): string {
  if (!frame) return '';
  const { labels, y: start, height } = frame.rows;
  return labels[clamp(Math.floor((y - start) / height), 0, labels.length - 1)] ?? '';
}

export interface NameVariables {
  letter: string;
  page: string;
  column: number;
  row: string;
  counter: number;
}

/**
 * Fills a naming format. Placeholders: `{letter}`, `{page}`, `{column}`,
 * `{row}`, `{counter}`; numbers take a zero-padding width, e.g. `{column:2}`.
 */
export function formatDeviceName(format: string, vars: NameVariables): string {
  return format.replace(/\{(letter|page|column|row|counter)(?::(\d+))?\}/g, (_, name: keyof NameVariables, pad?: string) => {
    const value = String(vars[name]);
    return pad ? value.padStart(Number(pad), '0') : value;
  });
}

/** Page names can contain characters that are not allowed in tags; those are dropped. */
function pageNameForTag(name: string): string {
  return name.replace(/[^\p{L}\p{N}_.]/gu, '');
}

export function pageFrame(page: SchematicPage, settings: ProjectSettings, library: Library): FrameDefinition | undefined {
  return library.frame(page.frame ?? settings.defaultFrame);
}

export interface ProposeNameOptions {
  settings: ProjectSettings;
  library: Library;
  page: SchematicPage;
  /** Insertion point of the main function. */
  at: Point;
  letter: string;
  /** Function and location the device will have (from page and boxes). */
  context: Tag;
  /** Full tags (`formatTag`) that are already in use. */
  taken: ReadonlySet<string>;
}

/**
 * Proposes a free product name. With the page/column scheme the first device
 * gets `-5K3`, further ones in the same column `-5K3.1`, `-5K3.2`, …
 * With the counter scheme: `-K1`, `-K2`, … (lowest free number).
 */
export function proposeDeviceName(options: ProposeNameOptions): string {
  const { settings, library, page, at, letter, context, taken } = options;
  const naming = settings.deviceNaming;
  const frame = pageFrame(page, settings, library);
  const vars: NameVariables = {
    letter,
    page: pageNameForTag(page.name),
    column: columnAt(frame, at.x),
    row: rowAt(frame, at.y),
    counter: 1,
  };
  const isFree = (product: string) => !taken.has(formatTag({ ...context, product }));

  if (naming.scheme === 'counter') {
    for (let n = 1; ; n++) {
      const name = formatDeviceName(naming.format, { ...vars, counter: n });
      if (isFree(name)) return name;
    }
  }

  const base = formatDeviceName(naming.format, vars);
  if (isFree(base)) return base;
  for (let n = 1; ; n++) {
    const name = base + naming.duplicateSuffix.replace('{n}', String(n));
    if (isFree(name)) return name;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export interface RenumberChange {
  /** Current full tag (device key). */
  from: string;
  /** New full tag. */
  to: string;
  tag: Tag;
  /** Where the main function is. */
  pageId: string;
  itemId: string;
}

/**
 * The renaming of "renumber devices": devices on the given pages (default all)
 * get names by page and column in drawing order. Excluded devices keep their
 * names, which stay taken. Only devices whose name changes are returned.
 */
export function planRenumbering(state: ProjectState, library: Library, options: { pageIds?: readonly string[]; exclude?: readonly string[] } = {}): RenumberChange[] {
  const index = buildDeviceIndex(state, library);
  const pages = schematicPages(state);
  const pageOrder = new Map(pages.map((p, i) => [p.id, i]));
  const scope = new Set(options.pageIds ?? pages.map((p) => p.id));
  const exclude = new Set(options.exclude ?? []);
  const settings = state.project.settings;

  const targets: { device: Device; page: SchematicPage; item: Item; column: number }[] = [];
  for (const device of index.devices.values()) {
    const main = device.main;
    if (!main || !scope.has(main.pageId) || exclude.has(device.key)) continue;
    const page = state.pages[main.pageId] as SchematicPage;
    const item = page.items.find((i) => i.id === main.itemId)!;
    // Devices whose name comes from a device box are renamed with the box.
    if (!item.tag?.product) continue;
    targets.push({ device, page, item, column: columnAt(pageFrame(page, settings, library), item.x) });
  }
  targets.sort(
    (a, b) =>
      (pageOrder.get(a.page.id) ?? 0) - (pageOrder.get(b.page.id) ?? 0) ||
      a.column - b.column ||
      a.item.y - b.item.y ||
      a.item.x - b.item.x,
  );

  const renamed = new Set(targets.map((t) => t.device.key));
  const taken = new Set([...index.devices.keys()].filter((key) => !renamed.has(key)));
  const changes: RenumberChange[] = [];
  for (const { device, page, item } of targets) {
    const context = { function: device.tag.function, location: device.tag.location };
    const product = proposeDeviceName({ settings, library, page, at: item, letter: library.symbol(item.symbol)?.letterCode ?? 'A', context, taken });
    const tag = { ...context, product };
    const to = formatTag(tag);
    taken.add(to);
    if (to !== device.key) changes.push({ from: device.key, to, tag, pageId: page.id, itemId: item.id });
  }
  return changes;
}

export interface PageRenumberOptions {
  /** Pages to rename (any order; they are numbered in project order). */
  pageIds: readonly string[];
  /** Text before the number, e.g. `1.` for 1.1, 1.2 … */
  prefix?: string;
  /** First number (default 1). */
  start?: number;
  /** Increment (default 1), e.g. 10 for 10, 20, 30 … */
  step?: number;
}

export interface PageRenameChange {
  pageId: string;
  from: string;
  to: string;
}

/** New page names: prefix + start, start + step, … in project page order. Unchanged pages are included. */
export function planPageNames(state: ProjectState, options: PageRenumberOptions): PageRenameChange[] {
  const selected = new Set(options.pageIds);
  const start = options.start ?? 1;
  const step = options.step ?? 1;
  return state.project.pages
    .filter((id) => selected.has(id))
    .map((id, i) => ({ pageId: id, from: state.pages[id]!.name, to: `${options.prefix ?? ''}${start + i * step}` }));
}

/** Function and location codes used in the project (pages and symbol tags), in order of appearance. */
export function usedStructureCodes(state: ProjectState): { function: string[]; location: string[] } {
  const result = { function: [] as string[], location: [] as string[] };
  const add = (aspect: 'function' | 'location', code: string | undefined) => {
    if (code !== undefined && code !== '' && !result[aspect].includes(code)) result[aspect].push(code);
  };
  for (const id of state.project.pages) {
    const page = state.pages[id];
    if (!page) continue;
    add('function', page.structure?.function);
    add('location', page.structure?.location);
    if (page.type !== 'schematic') continue;
    for (const item of page.items) {
      add('function', item.tag?.function);
      add('location', item.tag?.location);
    }
  }
  return result;
}

/** A suggestion for an input field: the value and an optional label (e.g. a description). */
export interface Suggestion {
  value: string;
  label?: string;
}

/** IEC 60757 color codes for wires and cores. */
export const WIRE_COLORS: readonly Suggestion[] = [
  { value: 'BK', label: 'black' },
  { value: 'BN', label: 'brown' },
  { value: 'RD', label: 'red' },
  { value: 'OG', label: 'orange' },
  { value: 'YE', label: 'yellow' },
  { value: 'GN', label: 'green' },
  { value: 'BU', label: 'blue' },
  { value: 'VT', label: 'violet' },
  { value: 'GY', label: 'grey' },
  { value: 'WH', label: 'white' },
  { value: 'PK', label: 'pink' },
  { value: 'GNYE', label: 'green-yellow' },
  { value: 'WHBU', label: 'white-blue' },
  { value: 'RDBU', label: 'red-blue' },
];

/** Common conductor cross-sections in mm². */
export const CROSS_SECTIONS: readonly number[] = [0.14, 0.25, 0.34, 0.5, 0.75, 1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120];

/**
 * Values to suggest while typing: functions and locations (with descriptions), device names
 * (product part and full tag), potential and interruption point names, terminal bridge labels.
 */
export type SuggestionLists = Record<'functions' | 'locations' | 'products' | 'devices' | 'potentials' | 'names' | 'bridges' | 'wireColors' | 'crossSections', readonly Suggestion[]>;

export function suggestionLists(state: ProjectState, library: Library, language: string): SuggestionLists {
  const used = usedStructureCodes(state);
  const describe = (list: readonly { code: string; description?: LocalizedText }[] | undefined, code: string): Suggestion => {
    const entry = list?.find((e) => e.code === code);
    const description = entry?.description === undefined ? '' : typeof entry.description === 'string' ? entry.description : (entry.description[language] ?? Object.values(entry.description)[0] ?? '');
    return description ? { value: code, label: description } : { value: code };
  };
  const ordered = (list: readonly { code: string }[] | undefined, codes: string[]) => [...new Set([...(list ?? []).map((e) => e.code), ...codes])];
  const structures = state.project.structures;
  const index = buildDeviceIndex(state, library);
  const devices = [...index.devices.values()];
  const names = new Set<string>();
  const bridges = new Set<string>();
  for (const page of Object.values(state.pages)) {
    if (page.type !== 'schematic') continue;
    for (const item of page.items) {
      if (typeof item.props?.name === 'string' && item.props.name) names.add(item.props.name);
      if (typeof item.props?.bridge === 'string' && item.props.bridge) bridges.add(item.props.bridge);
    }
  }
  const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
  return {
    functions: ordered(structures?.function, used.function).map((c) => describe(structures?.function, c)),
    locations: ordered(structures?.location, used.location).map((c) => describe(structures?.location, c)),
    products: [...new Set(devices.map((d) => d.tag.product).filter((p): p is string => !!p))].sort(byName).map((value) => ({ value })),
    devices: devices.map((d) => d.key).sort(byName).map((value) => ({ value })),
    potentials: state.project.potentials.map((p) => (p.voltage ? { value: p.name, label: p.voltage } : { value: p.name })),
    names: [...new Set([...state.project.potentials.map((p) => p.name), ...names])].sort(byName).map((value) => ({ value })),
    bridges: [...bridges].sort(byName).map((value) => ({ value })),
    wireColors: WIRE_COLORS,
    crossSections: CROSS_SECTIONS.map((n) => ({ value: String(n), label: `${n} mm²` })),
  };
}
