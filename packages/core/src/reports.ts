// Report pages and sheets. A report page stores only its definition; its rows
// are generated from the project and are always up to date. A page whose rows
// do not fit on one sheet expands to sheets `2.1`, `2.2`, …
// See docs/data-model.md, "pages/<id>.json — report page".
import { plcStorePage } from './plcStore.js';
import type { Connectivity } from './connectivity.js';
import type { CrossReferences } from './crossrefs.js';
import { channelLabel, defaultDataType, type PlcIndex } from './plc.js';
import type { CableIndex, WireIndex } from './cables.js';
import type { TerminalIndex } from './terminals.js';
import type { DeviceIndex } from './devices.js';
import { issueMessage, type Issue } from './issues.js';
import { findPart, type Library } from './library.js';
import { mountingPlateRows } from './layout.js';
import { formatReference, pageFullName, pagePosition } from './references.js';
import type { FormDefinition, Item, LocalizedText, Page, ProjectState, ReportKind, ReportPage, SchematicPage } from './schema.js';
import { localize } from './text.js';
import { usedStructureCodes } from './naming.js';

export type ReportRow = Record<string, string>;

export interface Sheet {
  pageId: string;
  /** 0-based sheet of its page. */
  sheet: number;
  sheetCount: number;
  /** `2` for a single sheet, `2.1`, `2.2` … for several. */
  name: string;
  /** Full name with structure, e.g. `=DOC/2.1`. */
  fullName: string;
  /** 1-based position in the whole project. */
  number: number;
  /** Rows on this sheet (report pages only). */
  rows?: ReportRow[];
}

export interface ReportContext {
  state: ProjectState;
  library: Library;
  devices: DeviceIndex;
  connectivity: Connectivity;
  crossReferences: CrossReferences;
  plc: PlcIndex;
  cables: CableIndex;
  wires: WireIndex;
  terminals: TerminalIndex;
}

export interface SheetList {
  sheets: Sheet[];
  issues: Issue[];
}

const FALLBACK_ROWS = 30;

export function defaultFormId(kind: ReportKind): string {
  return `iec.form.${kind}`;
}

export function reportForm(page: ReportPage, library: Library): FormDefinition | undefined {
  return library.form(page.report.form ?? defaultFormId(page.report.kind));
}

/**
 * All sheets of the project in page order. The page index lists every sheet,
 * including its own, so its length is computed until it no longer changes.
 */
export function buildSheets(ctx: ReportContext): SheetList {
  const { state, library } = ctx;
  const issues: Issue[] = [];
  const pages = state.project.pages.flatMap((id) => (state.pages[id] ? [state.pages[id]] : []));
  const rowsByPage = new Map<string, ReportRow[]>();
  const rowsPerSheet = new Map<string, number>();

  for (const page of pages) {
    if (page.type !== 'report') continue;
    const form = reportForm(page, library);
    if (!form) {
      issues.push({ severity: 'warning', code: 'report.unknownForm', ...issueMessage('Unknown report form "{form}"', { form: page.report.form ?? defaultFormId(page.report.kind) }), pageId: page.id });
    }
    rowsPerSheet.set(page.id, form?.table.rows ?? FALLBACK_ROWS);
    if (page.report.kind !== 'pageIndex') rowsByPage.set(page.id, reportRows(page.report.kind, ctx));
  }

  let sheets = expand(pages, rowsByPage, rowsPerSheet);
  for (let pass = 0; pass < 5; pass++) {
    const indexRows = pageIndexRows(state, sheets);
    for (const page of pages) if (page.type === 'report' && page.report.kind === 'pageIndex') rowsByPage.set(page.id, indexRows);
    const next = expand(pages, rowsByPage, rowsPerSheet);
    const stable = next.length === sheets.length;
    sheets = next;
    if (stable && pass > 0) break;
  }
  return { sheets, issues };
}

function expand(pages: Page[], rowsByPage: Map<string, ReportRow[]>, rowsPerSheet: Map<string, number>): Sheet[] {
  const sheets: Sheet[] = [];
  for (const page of pages) {
    // Schematic and layout pages are one sheet each.
    if (page.type !== 'report') {
      sheets.push({ pageId: page.id, sheet: 0, sheetCount: 1, name: page.name, fullName: pageFullName(page), number: sheets.length + 1 });
      continue;
    }
    const rows = rowsByPage.get(page.id) ?? [];
    const perSheet = rowsPerSheet.get(page.id) ?? FALLBACK_ROWS;
    const count = Math.max(1, Math.ceil(rows.length / perSheet));
    for (let i = 0; i < count; i++) {
      const name = count === 1 ? page.name : `${page.name}.${i + 1}`;
      sheets.push({
        pageId: page.id,
        sheet: i,
        sheetCount: count,
        name,
        fullName: pageFullName({ name, ...(page.structure ? { structure: page.structure } : {}) }),
        number: sheets.length + 1,
        rows: rows.slice(i * perSheet, (i + 1) * perSheet),
      });
    }
  }
  return sheets;
}

function pageIndexRows(state: ProjectState, sheets: Sheet[]): ReportRow[] {
  const { displayLanguage, languages } = state.project.settings;
  return sheets.map((sheet) => {
    const page = state.pages[sheet.pageId]!;
    return {
      page: sheet.fullName,
      description: localize(page.description, displayLanguage, languages),
      revision: page.properties?.revision ?? '',
      date: page.properties?.date ?? '',
    };
  });
}

/** Rows of a report kind (the page index needs the sheet list, see `buildSheets`). */
export function reportRows(kind: ReportKind, ctx: ReportContext): ReportRow[] {
  switch (kind) {
    case 'pageIndex':
      return pageIndexRows(ctx.state, buildSheets(ctx).sheets);
    case 'deviceIndex':
      return deviceIndexRows(ctx);
    case 'bom':
      return bomRows(ctx);
    case 'terminalList':
      return terminalRows(ctx);
    case 'terminalDiagram':
      return terminalDiagramRows(ctx);
    case 'plcIoList':
      return plcIoRows(ctx);
    case 'wireList':
      return wireRows(ctx);
    case 'cableOverview':
      return cableOverviewRows(ctx);
    case 'cableDiagram':
      return cableDiagramRows(ctx);
    case 'titlePage':
      return titlePageRows(ctx.state);
    case 'structureOverview':
      return structureOverviewRows(ctx.state);
    case 'revisions':
      return revisionRows(ctx.state);
    case 'mountingPlate':
      return mountingPlateRows(ctx.state, ctx.library, ctx.devices, (page) => pageFullName(page));
    default:
      // PLC and cable reports come with stage 2.
      return [];
  }
}

/** Labels of the project properties edited in Project settings. */
export const PROJECT_PROPERTY_LABELS: Record<string, LocalizedText> = {
  customer: { de: 'Kunde', en: 'Customer' },
  drawingNumber: { de: 'Zeichnungsnummer', en: 'Drawing number' },
  createdBy: { de: 'Erstellt von', en: 'Created by' },
};

/**
 * Title page: the project properties as label/value rows (known properties first). Project
 * name and description are drawn by the renderer above them.
 */
function titlePageRows(state: ProjectState): ReportRow[] {
  const { project } = state;
  const { displayLanguage, languages } = project.settings;
  const keys = [...Object.keys(PROJECT_PROPERTY_LABELS), ...Object.keys(project.properties).filter((k) => !(k in PROJECT_PROPERTY_LABELS))];
  return keys
    .filter((key) => (project.properties[key] ?? '') !== '')
    .map((key) => ({ label: PROJECT_PROPERTY_LABELS[key] ? localize(PROJECT_PROPERTY_LABELS[key], displayLanguage, [...languages, 'en']) : key, value: project.properties[key]! }));
}

/** Revisions, newest first, with the pages that carry each one in their title block. */
function revisionRows(state: ProjectState): ReportRow[] {
  return [...(state.project.revisions ?? [])].reverse().map((r) => ({
    revision: r.name,
    date: r.date,
    author: r.author ?? '',
    description: r.description ?? '',
    pages: state.project.pages
      .flatMap((id) => {
        const page = state.pages[id];
        return page?.properties?.revision === r.name ? [pageFullName(page)] : [];
      })
      .join(', '),
  }));
}

/**
 * Functions (=) and locations (+) in their sort order from Project settings, followed by
 * codes that are used in the project but not listed there.
 */
function structureOverviewRows(state: ProjectState): ReportRow[] {
  const { project } = state;
  const { displayLanguage, languages } = project.settings;
  const used = usedStructureCodes(state);
  const rows: ReportRow[] = [];
  for (const aspect of ['function', 'location'] as const) {
    const prefix = aspect === 'function' ? '=' : '+';
    const kind = localize(aspect === 'function' ? { de: 'Funktion', en: 'Function' } : { de: 'Ort', en: 'Location' }, displayLanguage, [...languages, 'en']);
    const entries = [...(project.structures?.[aspect] ?? [])];
    for (const code of used[aspect]) if (!entries.some((e) => e.code === code)) entries.push({ code });
    for (const entry of entries) {
      const pages = project.pages.filter((id) => state.pages[id]?.structure?.[aspect] === entry.code).length;
      rows.push({
        structure: prefix + entry.code,
        kind,
        description: localize(entry.description, displayLanguage, languages),
        pages: pages > 0 ? String(pages) : '',
      });
    }
  }
  return rows;
}

/** Short names of auxiliary functions in the device directory; main functions are listed by reference only. */
const FUNCTION_NAMES: Record<string, string> = {
  'contact.no': 'NO',
  'contact.nc': 'NC',
  'contact.co': 'CO',
  'contactor.main': 'main',
};

function deviceIndexRows(ctx: ReportContext): ReportRow[] {
  const { state, library, devices } = ctx;
  const { settings } = state.project;
  const items = itemIndex(state);
  const rows: ReportRow[] = [];
  for (const device of [...devices.devices.values()].sort((a, b) => naturalCompare(a.key, b.key))) {
    const main = device.main ? items.get(device.main.itemId)?.item : undefined;
    rows.push({
      tag: device.key,
      functionText: localize(main?.props?.functionText, settings.displayLanguage, settings.languages),
      part: (main?.props?.parts ?? []).map((p) => `${p.manufacturer} ${p.partNumber}`.trim()).join(', '),
      // Main function first; references relative to the device's own structure.
      functions: [...device.functions]
        .sort((a, b) => Number(b.role === 'main') - Number(a.role === 'main'))
        .map((f) => {
          const { page, item } = items.get(f.itemId)!;
          const ref = formatReference(page, pagePosition(page, item, settings, library), settings, { function: device.tag.function, location: device.tag.location });
          const name = f.role === 'main' ? undefined : FUNCTION_NAMES[f.function];
          return name ? `${name} ${ref}` : ref;
        })
        .join(', '),
    });
  }
  return rows;
}

function bomRows(ctx: ReportContext): ReportRow[] {
  const { state, devices } = ctx;
  const items = itemIndex(state);
  const lines = new Map<string, { manufacturer: string; partNumber: string; quantity: number; devices: string[] }>();
  for (const device of devices.devices.values()) {
    const main = device.main ? items.get(device.main.itemId)?.item : undefined;
    for (const part of main?.props?.parts ?? []) {
      const key = `${part.manufacturer}\u0000${part.partNumber}`;
      const line = lines.get(key) ?? { manufacturer: part.manufacturer, partNumber: part.partNumber, quantity: 0, devices: [] };
      line.quantity += part.quantity;
      line.devices.push(device.key);
      lines.set(key, line);
    }
  }
  // Description, prices, supplier and ERP number from the parts database.
  const { displayLanguage, languages } = state.project.settings;
  const money = new Intl.NumberFormat(displayLanguage, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const totals = new Map<string, number>();
  const rows: ReportRow[] = [...lines.values()]
    .sort((a, b) => naturalCompare(a.manufacturer, b.manufacturer) || naturalCompare(a.partNumber, b.partNumber))
    .map((l) => {
      const part = findPart(ctx.library, l.manufacturer, l.partNumber);
      const supplier = part?.suppliers?.[0];
      const price = part?.price ?? supplier?.price;
      const currency = (part?.price !== undefined ? part.currency : supplier?.currency) ?? '';
      const unitPrice = price !== undefined ? price / (part?.priceUnit ?? 1) : undefined;
      const total = unitPrice !== undefined ? unitPrice * l.quantity : undefined;
      if (total !== undefined) totals.set(currency, (totals.get(currency) ?? 0) + total);
      const amount = (value: number | undefined) => (value === undefined ? '' : `${money.format(value)} ${currency}`.trim());
      return {
        quantity: part?.unit && part.unit !== 'pcs' ? `${l.quantity} ${part.unit}` : String(l.quantity),
        manufacturer: l.manufacturer,
        partNumber: l.partNumber,
        description: localize(part?.description, displayLanguage, languages),
        devices: l.devices.sort(naturalCompare).join(', '),
        unitPrice: amount(unitPrice),
        total: amount(total),
        supplier: supplier ? [supplier.name, supplier.orderNumber].filter(Boolean).join(' ') : '',
        erpNumber: part?.erpNumber ?? '',
      };
    });
  // One sum line per currency at the end.
  for (const [currency, sum] of [...totals].sort(([a], [b]) => a.localeCompare(b))) {
    rows.push({
      quantity: '',
      manufacturer: '',
      partNumber: '',
      description: localize({ de: 'Summe', en: 'Total' }, displayLanguage, ['en']),
      devices: '',
      unitPrice: '',
      total: `${money.format(sum)} ${currency}`.trim(),
      supplier: '',
      erpNumber: '',
    });
  }
  return rows;
}

function terminalRows(ctx: ReportContext): ReportRow[] {
  return ctx.terminals.strips.flatMap((strip) =>
    strip.terminals.map((t) => ({
      strip: strip.device,
      terminal: t.designation,
      external: t.external.join(', '),
      internal: t.internal.join(', '),
      bridge: t.bridge ?? '',
      page: t.reference,
    })),
  );
}

/**
 * Rows of the graphic terminal diagram: per strip a heading row (`kind: strip`), then one row per
 * terminal. The renderer draws the terminals as a strip with the targets on both sides.
 */
function terminalDiagramRows(ctx: ReportContext): ReportRow[] {
  return ctx.terminals.strips.flatMap((strip) => [
    { kind: 'strip', strip: strip.device, terminal: '', external: '', internal: '', bridge: '', page: '' },
    ...strip.terminals.map((t) => ({
      kind: 'terminal',
      strip: strip.device,
      terminal: t.designation,
      external: t.external.join(', '),
      internal: t.internal.join(', '),
      bridge: t.bridge ?? '',
      page: t.reference,
    })),
  ]);
}

/** All wires: number, from, to, color, cross-section, potential and cable core. */
function wireRows(ctx: ReportContext): ReportRow[] {
  return [...ctx.wires.wires]
    .sort((a, b) => naturalCompare(a.number, b.number))
    .map((w) => ({
      number: w.number,
      from: w.ends[0] ?? '',
      to: w.ends.slice(1).join(', '),
      color: w.color,
      crossSection: formatCrossSection(w.crossSection),
      potential: w.potential ?? '',
      cable: w.cable ? `${w.cable.device}:${w.cable.core}` : '',
    }));
}

function cableOverviewRows(ctx: ReportContext): ReportRow[] {
  return [...ctx.cables.cables]
    .sort((a, b) => naturalCompare(a.device, b.device))
    .map((c) => {
      const ends = c.assignments.flatMap((a) => ctx.wires.byNet.get(a.net)?.ends ?? []);
      const locations = [...new Set(ends.map((e) => /\+([^-:=]+)/.exec(e)?.[1]).filter((l): l is string => l !== undefined))];
      return {
        cable: c.device,
        type: c.cable.type ?? '',
        cores: `${c.assignments.length}/${c.cable.cores.length}`,
        crossSection: c.cable.crossSection !== undefined ? formatCrossSection(c.cable.crossSection) : '',
        route: locations.map((l) => `+${l}`).join(' – '),
        length: c.cable.lengthM !== undefined ? `${c.cable.lengthM} m` : '',
      };
    });
}

function cableDiagramRows(ctx: ReportContext): ReportRow[] {
  const rows: ReportRow[] = [];
  for (const c of [...ctx.cables.cables].sort((a, b) => naturalCompare(a.device, b.device))) {
    for (const core of c.cable.cores) {
      const assignment = c.assignments.find((a) => a.core.id === core.id);
      const wire = assignment ? ctx.wires.byNet.get(assignment.net) : undefined;
      rows.push({
        cable: c.device,
        core: core.number ?? core.id,
        color: core.color ?? '',
        crossSection: formatCrossSection(core.crossSection ?? c.cable.crossSection ?? 0),
        from: wire?.ends[0] ?? '',
        to: wire?.ends.slice(1).join(', ') ?? (assignment ? '' : 'spare'),
        wire: wire?.number ?? '',
      });
    }
  }
  return rows;
}

function formatCrossSection(value: number): string {
  return value > 0 ? `${String(value).replace('.', ',')} mm²` : '';
}

/** All I/O channels, per PLC (optionally one PLC), in slot and channel order. */
export function plcIoRows(ctx: ReportContext, station?: string): ReportRow[] {
  const { state, library } = ctx;
  const { settings } = state.project;
  const rows: (ReportRow & { sort: string })[] = [];
  for (const card of ctx.plc.cards) {
    const plc = card.station?.name ?? '';
    if (station !== undefined && plc !== station) continue;
    for (const c of card.channels) {
      const slaves = c.slaves.map((s) => {
        const page = state.pages[s.pageId] as SchematicPage;
        const item = page.items.find((i) => i.id === s.itemId)!;
        return formatReference(page, pagePosition(page, item, settings, library), settings);
      });
      rows.push({
        sort: `${plc}\u0000${String(card.slot ?? 9999).padStart(4, '0')}\u0000${card.device}\u0000${String(c.channel.channel).padStart(4, '0')}`,
        plc,
        card: card.device,
        slot: card.slot !== undefined ? String(card.slot) : '',
        channel: channelLabel(c.channel),
        kind: c.channel.kind,
        pin: c.channel.pin,
        address: c.address ?? '',
        name: c.name,
        dataType: c.channel.dataType ?? defaultDataType(c.channel.kind),
        function: localize(c.function, settings.displayLanguage, settings.languages),
        used: slaves.join(', '),
      });
    }
  }
  return rows.sort((a, b) => naturalCompare(a.sort, b.sort)).map(({ sort: _sort, ...row }) => row);
}

/** A report as CSV: header from the form's column titles, `;` separated, with a BOM so Excel reads UTF-8. */
export function reportToCsv(form: FormDefinition, rows: readonly ReportRow[], language: string, delimiter = ';'): string {
  const escape = (value: string) => (/["\r\n]/.test(value) || value.includes(delimiter) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = [
    form.columns.map((c) => escape(localize(c.title as LocalizedText, language, ['en']))).join(delimiter),
    ...rows.map((row) => form.columns.map((c) => escape(row[c.key] ?? '')).join(delimiter)),
  ];
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** Compares strings with numbers in numeric order: `-K2` before `-K10`. */
// One collator for all comparisons: `localeCompare` with options creates a new one per call.
const NATURAL = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function naturalCompare(a: string, b: string): number {
  return NATURAL.compare(a, b);
}

function itemIndex(state: ProjectState): Map<string, { page: SchematicPage; item: Item }> {
  const map = new Map<string, { page: SchematicPage; item: Item }>();
  for (const page of [...Object.values(state.pages), plcStorePage(state)]) {
    if (page.type === 'schematic') for (const item of page.items) map.set(item.id, { page, item });
  }
  return map;
}
