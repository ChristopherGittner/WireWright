// Cross-references and contact images (Kontaktspiegel).
// See docs/data-model.md, "Cross-references" and "Contact image".
import type { DeviceIndex } from './devices.js';
import { issueMessage, type Issue } from './issues.js';
import type { Library } from './library.js';
import { formatReference, pagePosition } from './references.js';
import { resolveSymbol } from './symbols.js';
import { effectiveTag, formatTag } from './tags.js';
import type { ContactTemplateEntry, Item, ProjectState, SchematicPage } from './schema.js';

export interface ReferenceTarget {
  pageId: string;
  itemId: string;
}

export interface Reference {
  /** e.g. `/5.3`, or `=AA+20/5.3` when the target page has another structure. */
  text: string;
  target: ReferenceTarget;
}

export interface ContactImageRow {
  function: string;
  pins: string[];
  /** Where this contact is used; absent when it is unused. */
  reference?: Reference;
  /** Symbol of the drawn contact (its mini symbol is shown). */
  symbol?: string;
  /** Drawn, but not one of the contacts of the device's template. */
  extra?: boolean;
}

export interface CrossReferenceInfo {
  /** References shown at the item (text field `xref`). */
  references: Reference[];
  /** Contact image of a main function: template contacts and the contacts drawn. */
  contactImage?: ContactImageRow[];
}

export interface CrossReferences {
  byItem: Map<string, CrossReferenceInfo>;
  issues: Issue[];
}

const CONTACT_FUNCTIONS = new Set(['contact.no', 'contact.nc', 'contact.co', 'contactor.main']);

export function buildCrossReferences(state: ProjectState, library: Library, devices: DeviceIndex): CrossReferences {
  const { settings } = state.project;
  const byItem = new Map<string, CrossReferenceInfo>();
  const issues: Issue[] = [];
  const items = indexItems(state);

  const reference = (from: ReferenceTarget, to: ReferenceTarget): Reference => {
    const fromPage = state.pages[from.pageId] as SchematicPage;
    const toPage = state.pages[to.pageId] as SchematicPage;
    const item = items.get(to.itemId)!;
    return { text: formatReference(toPage, pagePosition(toPage, item, settings, library), settings, fromPage.structure), target: { pageId: to.pageId, itemId: to.itemId } };
  };
  const info = (itemId: string): CrossReferenceInfo => {
    let entry = byItem.get(itemId);
    if (!entry) byItem.set(itemId, (entry = { references: [] }));
    return entry;
  };

  for (const device of devices.devices.values()) {
    const main = device.main;
    if (!main) continue;
    const auxiliaries = device.functions.filter((f) => f !== main);
    for (const f of auxiliaries) info(f.itemId).references.push(reference(f, main));

    // Contact image (Kontaktspiegel): the template's contacts (free ones without reference) plus
    // every contact actually drawn, so it grows with the drawing. Without a template and without
    // `hasContactImage` the main function lists plain references.
    const mainItem = items.get(main.itemId);
    const template = mainItem?.props?.contacts;
    const showsImage = template !== undefined || library.symbol(mainItem?.symbol ?? '')?.hasContactImage === true;
    if (!showsImage) {
      // A PLC card lists its I/O points per channel row; at the card itself only further overviews.
      const isCard = mainItem?.props?.plc !== undefined;
      const listed = isCard ? auxiliaries.filter((f) => items.get(f.itemId)?.props?.plcView !== undefined) : auxiliaries;
      info(main.itemId).references.push(...listed.map((f) => reference(main, f)));
      continue;
    }

    const rows: ContactImageRow[] = (template ?? []).map((entry) => ({ function: entry.function, pins: [...entry.pins] }));
    const grown: ContactImageRow[] = [];
    for (const f of auxiliaries) {
      const item = items.get(f.itemId)!;
      if (!CONTACT_FUNCTIONS.has(f.function) && library.symbol(item.symbol)?.contactImage === undefined) {
        info(main.itemId).references.push(reference(main, f));
        continue;
      }
      const pins = designations(item, library);
      const row = rows.find((r) => !r.reference && fits(r, f.function, pins));
      if (row) {
        row.reference = reference(main, f);
        row.symbol = item.symbol;
        continue;
      }
      if (template) {
        const usedTwice = rows.some((r) => fits(r, f.function, pins));
        issues.push({
          severity: 'warning',
          code: usedTwice ? 'contact.usedTwice' : 'contact.notInTemplate',
          ...(usedTwice
            ? issueMessage('{device}: contact {pins} is used more than once', { device: device.key, pins: pins.join('/') })
            : issueMessage("{device}: {function} {pins} is not one of the device's contacts ({template})", { device: device.key, function: describe(f.function), pins: pins.join('/'), template: describeTemplate(template) }, ['function'])),
          pageId: f.pageId,
          itemId: f.itemId,
          device: device.key,
        });
      }
      grown.push({ function: f.function, pins, reference: reference(main, f), symbol: item.symbol, ...(template ? { extra: true } : {}) });
    }
    grown.sort((a, b) => a.pins.join(' ').localeCompare(b.pins.join(' '), undefined, { numeric: true }));
    if (rows.length + grown.length > 0) info(main.itemId).contactImage = [...rows, ...grown];
  }

  // Interruption points show where their partners are.
  const interruptions = new Map<string, ReferenceTarget[]>();
  for (const page of Object.values(state.pages)) {
    if (page.type !== 'schematic') continue;
    for (const item of page.items) {
      const name = item.props?.name;
      if (library.symbol(item.symbol)?.function === 'connection.interruption' && typeof name === 'string' && name !== '') {
        const list = interruptions.get(name) ?? [];
        list.push({ pageId: page.id, itemId: item.id });
        interruptions.set(name, list);
      }
    }
  }
  for (const group of interruptions.values()) {
    for (const from of group) info(from.itemId).references.push(...group.filter((to) => to !== from).map((to) => reference(from, to)));
  }

  return { byItem, issues };
}

/** A placed contact fits a template entry if its pins are a subset; a changeover contact can be used as NO or NC. */
function fits(row: ContactImageRow, fn: string, pins: string[]): boolean {
  const sameKind = row.function === fn || (row.function === 'contact.co' && (fn === 'contact.no' || fn === 'contact.nc'));
  return sameKind && pins.every((p) => row.pins.includes(p));
}

/**
 * How a connection point is named in wire and terminal lists: `-K1:A1`.
 * Terminals are named by their terminal designation (`-X1:3`), since all
 * terminals of a strip share the strip's tag.
 */
export function pinLabel(page: SchematicPage, item: Item, point: { pin: string; designation?: string }, library: Library): string {
  const tag = formatTag(effectiveTag(page, item, library));
  if (library.symbol(item.symbol)?.function === 'terminal') {
    const terminal = typeof item.props?.terminal === 'string' ? item.props.terminal : (point.designation ?? point.pin);
    return `${tag}:${terminal}`;
  }
  return `${tag}:${point.designation ?? point.pin}`;
}

/** Connection designations of a placed item (item overrides, then symbol defaults). */
export function designations(item: Item, library: Library): string[] {
  const def = resolveSymbol(item, library);
  return (def?.connections ?? []).map((c) => item.pins?.[c.id] ?? c.designation ?? c.id);
}

function describe(fn: string): string {
  return { 'contact.no': 'NO contact', 'contact.nc': 'NC contact', 'contact.co': 'changeover contact', 'contactor.main': 'main contacts' }[fn] ?? fn;
}

function describeTemplate(template: readonly ContactTemplateEntry[]): string {
  return template.map((e) => e.pins.join('/')).join(', ');
}

function indexItems(state: ProjectState): Map<string, Item> {
  const items = new Map<string, Item>();
  for (const page of Object.values(state.pages)) {
    if (page.type === 'schematic') for (const item of page.items) items.set(item.id, item);
  }
  return items;
}
