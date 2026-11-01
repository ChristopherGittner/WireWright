import {
  ARRANGED_TEXT_FIELDS,
  boxRect,
  cableCrossings,
  channelLabel,
  effectiveTag,
  formatReference,
  pagePosition,
  PLC_CARD,
  plcCardLayout,
  resolveSymbol,
  type CableIndex,
  type PlcIndex,
  type WireIndex,
  formatTag,
  itemRole,
  linkGroups,
  localize,
  pageConnectionPoints,
  relativeTag,
  tagFromLeftNeighbour,
  reportForm,
  tagContext,
  transformDirection,
  transformPoint,
  type Connectivity,
  type ContactImageRow,
  type CrossReferences,
  type DeviceIndex,
  type FormDefinition,
  type FrameDefinition,
  type Graphic,
  type Item,
  layoutFootprint,
  layoutSize,
  parseTag,
  type LayoutPage,
  type Library,
  type Page,
  type ProjectDocument,
  type ProjectState,
  type ReportPage,
  type SchematicPage,
  type Sheet,
  type SymbolDefinition,
  type TextField,
} from '@wirewright/core';
import { elementBox, estimateTextWidth, fitText, type ElementMeta, type Scene, type SceneElement, type Stroke, type TextAlign, type TextAngle } from './scene.js';
import { COLORS, connectionStroke, DASH, PIPE_COLOR, pipeStroke, TEXT_SIZE, WIDTH } from './style.js';

/** Everything a page is rendered from. Build it once per project state. */
export interface RenderContext {
  state: ProjectState;
  library: Library;
  devices: DeviceIndex;
  connectivity: Connectivity;
  crossReferences: CrossReferences;
  plc: PlcIndex;
  cables: CableIndex;
  wires: WireIndex;
  sheets: Sheet[];
}

export interface RenderOptions {
  /** Everything black, e.g. for printing (default false). */
  monochrome?: boolean;
  /** Draw pin links of all devices as an overlay (editor toggle L). */
  showLinks?: boolean;
  /** Display language (default: the project's). */
  language?: string;
  /**
   * Short red stubs in every direction of corners, T-junctions and crosses, under the
   * wires, so junctions are visible before they are connected (editor only, default false).
   */
  junctionStubs?: boolean;
  /** Grey placeholders for empty free texts, so they can be found and selected (editor only, default false). */
  placeholders?: boolean;
}

export function renderContext(doc: ProjectDocument): RenderContext {
  return {
    state: doc.state,
    library: doc.library,
    devices: doc.devices(),
    connectivity: doc.connectivity(),
    crossReferences: doc.crossReferences(),
    plc: doc.plc(),
    cables: doc.cables(),
    wires: doc.wires(),
    sheets: doc.sheets().sheets,
  };
}

const FALLBACK_SIZE = { width: 420, height: 297 };

/** Renders one sheet (a schematic page or one sheet of a report page). */
export function renderSheet(ctx: RenderContext, sheet: Sheet, options: RenderOptions = {}): Scene {
  const page = ctx.state.pages[sheet.pageId];
  if (!page) throw new Error(`Page "${sheet.pageId}" not found`);
  const r = new Renderer(ctx, page, sheet, options);
  if (page.type === 'schematic') return r.schematic(page);
  if (page.type === 'layout') return r.layout(page);
  return r.report(page);
}

/** Renders the first (or given) sheet of a page. */
export function renderPage(ctx: RenderContext, pageId: string, options: RenderOptions = {}, sheetIndex = 0): Scene {
  const sheet = ctx.sheets.find((s) => s.pageId === pageId && s.sheet === sheetIndex);
  if (!sheet) throw new Error(`Page "${pageId}" has no sheet ${sheetIndex + 1}`);
  return renderSheet(ctx, sheet, options);
}

/** Where the mounting plate of a layout page sits on the sheet: centered in the drawing area at 1:scale. */
export interface LayoutPlacement {
  /** Sheet position (mm) of the plate's top-left corner. */
  x: number;
  y: number;
  /** Sheet millimetres per real millimetre (1 / scale). */
  k: number;
}

export function layoutPlacement(library: Library, defaultFrame: string, page: LayoutPage): LayoutPlacement {
  const frame = library.frame(page.frame ?? defaultFrame);
  const area = frame?.drawingArea ?? { x: 10, y: 10, width: FALLBACK_SIZE.width - 20, height: FALLBACK_SIZE.height - 20 };
  const k = 1 / page.scale;
  return { x: area.x + (area.width - page.plate.width * k) / 2, y: area.y + (area.height - page.plate.height * k) / 2, k };
}

/** Table cells and card rows are one line: line breaks become spaces. */
function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ');
}

/** Connection symbols that get stubs in the editor. */
const JUNCTIONS = new Set(['connection.corner', 'connection.tee', 'connection.cross', 'connection.crossConnected']);
const STUB_LENGTH = 2.5;
const STUB: Record<'up' | 'down' | 'left' | 'right', [number, number]> = {
  up: [0, -STUB_LENGTH],
  down: [0, STUB_LENGTH],
  left: [-STUB_LENGTH, 0],
  right: [STUB_LENGTH, 0],
};

class Renderer {
  readonly elements: SceneElement[] = [];
  readonly language: string;
  readonly languages: string[];

  constructor(
    readonly ctx: RenderContext,
    readonly page: Page,
    readonly sheet: Sheet,
    readonly options: RenderOptions,
  ) {
    const { settings } = ctx.state.project;
    this.language = options.language ?? settings.displayLanguage;
    this.languages = settings.languages;
  }

  get settings() {
    return this.ctx.state.project.settings;
  }

  color(color: string): string {
    return this.options.monochrome ? '#000000' : color;
  }

  // -------------------------------------------------------------------------
  // Pages

  schematic(page: SchematicPage): Scene {
    const frame = this.ctx.library.frame(page.frame ?? this.settings.defaultFrame);
    if (frame) this.frame(frame);
    if (this.options.junctionStubs) this.junctionStubs(page);
    this.connections(page);
    // Boxes first, so symbols are drawn on top of them.
    const isBox = (item: Item) => this.ctx.library.symbol(item.symbol)?.resizable === true;
    for (const item of page.items.filter(isBox)) this.box(page, item);
    for (const item of page.items.filter((i) => !isBox(i))) this.item(page, item);
    this.bridges(page);
    if (this.options.showLinks) this.links(page);
    return this.scene(frame);
  }

  /**
   * Title page: project name and description centered above the form's table area, the project
   * properties as label/value lines in it (no table grid).
   */
  titlePage(form: FormDefinition): void {
    const { project } = this.ctx.state;
    const { table } = form;
    const size = table.textSize ?? 4;
    const meta: ElementMeta = { role: 'report' };
    const width = form.columns.reduce((sum, c) => sum + c.width, 0);
    const center = table.x + width / 2;
    if (this.sheet.sheet === 0) {
      this.text(center, table.y - 70, project.name, 10, 'center', meta, true);
      const description = localize(project.description, this.language, this.languages);
      if (description) this.text(center, table.y - 52, description, 6, 'center', meta);
      this.line(table.x, table.y - 20, table.x + width, table.y - 20, this.stroke(COLORS.frame, WIDTH.thin), meta);
    }
    const [label, value] = form.columns;
    (this.sheet.rows ?? []).forEach((row, i) => {
      const y = table.y + (i + 1) * table.rowHeight;
      if (label) this.text(table.x + 1, y - 2.5, fitText(oneLine(row[label.key] ?? ''), size, label.width - 2), size, 'left', meta, true);
      if (value && label) this.text(table.x + label.width + 1, y - 2.5, fitText(oneLine(row[value.key] ?? ''), size, value.width - 2), size, 'left', meta);
      this.line(table.x, y, table.x + width, y, this.stroke(COLORS.frame, WIDTH.thin), meta);
    });
  }

  report(page: ReportPage): Scene {
    const form = reportForm(page, this.ctx.library);
    const frame = this.ctx.library.frame(page.frame ?? form?.frame ?? this.settings.defaultFrame);
    if (frame) this.frame(frame);
    if (!form) return this.scene(frame);

    const { table } = form;
    const size = table.textSize ?? 2.5;
    const width = form.columns.reduce((sum, c) => sum + c.width, 0);
    const meta: ElementMeta = { role: 'report' };
    if (page.report.kind === 'titlePage') {
      this.titlePage(form);
      return this.scene(frame);
    }
    this.text(table.x, table.y - 3, localize(form.title, this.language, ['en']) + (this.sheet.sheetCount > 1 ? ` (${this.sheet.sheet + 1}/${this.sheet.sheetCount})` : ''), 5, 'left', meta, true);
    if (page.report.kind === 'terminalDiagram') {
      this.terminalDiagram(form);
      return this.scene(frame);
    }
    this.elements.push({ kind: 'rect', x: table.x, y: table.y, width, height: table.headerHeight, fill: this.color(COLORS.reportHeader), stroke: this.stroke(COLORS.frame, WIDTH.thin), meta });

    const rows = this.sheet.rows ?? [];
    const bottom = table.y + table.headerHeight + table.rows * table.rowHeight;
    let x = table.x;
    for (const column of form.columns) {
      const title = localize(column.title, this.language, ['en']);
      this.text(x + 1, table.y + table.headerHeight - 2.5, fitText(oneLine(title), size, column.width - 2), size, 'left', meta, true);
      rows.forEach((row, i) => {
        const y = table.y + table.headerHeight + (i + 1) * table.rowHeight - 1.8;
        this.text(x + 1, y, fitText(oneLine(row[column.key] ?? ''), size, column.width - 2), size, 'left', meta);
      });
      this.line(x, table.y, x, bottom, this.stroke(COLORS.frame, WIDTH.thin), meta);
      x += column.width;
    }
    this.line(x, table.y, x, bottom, this.stroke(COLORS.frame, WIDTH.thin), meta);
    for (let i = 0; i <= table.rows; i++) {
      const y = table.y + table.headerHeight + i * table.rowHeight;
      this.line(table.x, y, x, y, this.stroke(COLORS.frame, WIDTH.thin), meta);
    }
    return this.scene(frame);
  }

  /**
   * Terminal diagram: each strip drawn as a column of terminals, field-side targets on the left,
   * cabinet-side targets on the right, bridges as a line joining the bridged terminals. Column
   * widths come from the form (keys external, terminal, bridge, internal, page).
   */
  terminalDiagram(form: FormDefinition): void {
    const { table } = form;
    const size = Math.min(table.textSize ?? 2.5, table.rowHeight * 0.5);
    const meta: ElementMeta = { role: 'report' };
    const columns = new Map<string, { x: number; width: number }>();
    let cursor = table.x;
    for (const c of form.columns) {
      columns.set(c.key, { x: cursor, width: c.width });
      cursor += c.width;
    }
    const col = (key: string) => columns.get(key) ?? { x: cursor, width: 0 };
    const terminal = col('terminal');
    const bridge = col('bridge');
    const internal = col('internal');
    const external = col('external');
    const ref = col('page');
    const stroke = this.stroke(COLORS.symbol, WIDTH.symbol);
    const thin = this.stroke(COLORS.frame, WIDTH.thin);
    // Column titles above the strip.
    for (const c of form.columns) {
      const at = columns.get(c.key)!;
      const title = localize(c.title, this.language, ['en']);
      const align: TextAlign = c.key === 'external' ? 'right' : c.key === 'terminal' || c.key === 'bridge' ? 'center' : 'left';
      const x = align === 'right' ? at.x + at.width - 2 : align === 'center' ? at.x + at.width / 2 : at.x + 2;
      this.text(x, table.y + table.headerHeight - 2.5, fitText(oneLine(title), size, at.width - 2), size, align, meta, true);
    }
    this.line(table.x, table.y + table.headerHeight, cursor, table.y + table.headerHeight, thin, meta);

    const rows = this.sheet.rows ?? [];
    let lastBridge: { strip: string; label: string; y: number } | undefined;
    rows.forEach((row, i) => {
      const top = table.y + table.headerHeight + i * table.rowHeight;
      const mid = top + table.rowHeight / 2;
      const base = mid + size * 0.35;
      if (row.kind === 'strip') {
        lastBridge = undefined;
        this.text(terminal.x + terminal.width / 2, top + table.rowHeight - 1.5, row.strip ?? '', size * 1.1, 'center', meta, true);
        return;
      }
      this.elements.push({ kind: 'rect', x: terminal.x + 1, y: top, width: terminal.width - 2, height: table.rowHeight, fill: '#FFFFFF', stroke, meta });
      this.text(terminal.x + terminal.width / 2, base, fitText(row.terminal ?? '', size, terminal.width - 3), size, 'center', meta);
      if (row.external) {
        this.line(external.x + external.width - 6, mid, terminal.x + 1, mid, thin, meta);
        this.text(external.x + external.width - 7, base, fitText(oneLine(row.external), size, external.width - 9), size, 'right', meta);
      }
      if (row.internal) {
        this.line(terminal.x + terminal.width - 1, mid, internal.x + 6, mid, thin, meta);
        this.text(internal.x + 7, base, fitText(oneLine(row.internal), size, internal.width - 9), size, 'left', meta);
      }
      if (row.bridge) {
        const bx = bridge.x + bridge.width / 2;
        if (!row.internal) this.line(terminal.x + terminal.width - 1, mid, bx, mid, thin, meta);
        this.elements.push({ kind: 'circle', cx: bx, cy: mid, r: 0.6, fill: this.color(COLORS.symbol), meta });
        if (lastBridge && lastBridge.strip === row.strip && lastBridge.label === row.bridge) this.line(bx, lastBridge.y, bx, mid, stroke, meta);
        lastBridge = { strip: row.strip ?? '', label: row.bridge, y: mid };
      }
      if (row.page) this.text(ref.x + 2, base, fitText(row.page, size, ref.width - 3), size, 'left', meta);
    });
  }

  /** A mounting plate to scale: rails, ducts and device footprints (see core/layout.ts). */
  layout(page: LayoutPage): Scene {
    const frame = this.ctx.library.frame(page.frame ?? this.settings.defaultFrame);
    if (frame) this.frame(frame);
    const { x: px, y: py, k } = layoutPlacement(this.ctx.library, this.settings.defaultFrame, page);
    const at = (x: number, y: number): [number, number] => [px + x * k, py + y * k];
    const word = (de: string, en: string) => localize({ de, en }, this.language, ['en']);
    const plateMeta: ElementMeta = { role: 'layout' };
    const thin = this.stroke(COLORS.frame, WIDTH.thin);
    this.elements.push({ kind: 'rect', x: px, y: py, width: page.plate.width * k, height: page.plate.height * k, fill: this.options.monochrome ? '#FFFFFF' : '#F2F2F2', stroke: this.stroke(COLORS.frame, WIDTH.frame), meta: plateMeta });
    const door = page.surface === 'door';
    this.text(px, py - 2, `${door ? word('Tür (Ansicht von außen)', 'Door (outside view)') : word('Montageplatte', 'Mounting plate')} ${page.plate.width} × ${page.plate.height} mm   1:${page.scale}`, 2.5, 'left', plateMeta);

    for (const item of page.items) {
      if (item.kind !== 'cutout') continue;
      const [x, y] = at(item.x, item.y);
      const w = item.width * k;
      const h = item.height * k;
      const meta: ElementMeta = { role: 'layout', itemId: item.id };
      this.elements.push({ kind: 'rect', x, y, width: w, height: h, fill: '#FFFFFF', stroke: this.stroke(COLORS.symbol, WIDTH.symbol), meta });
      this.line(x, y, x + w, y + h, thin, meta);
      this.line(x, y + h, x + w, y, thin, meta);
      if (item.label) {
        const size = Math.max(0.8, Math.min(2.5, h * 0.3, (w - 0.6) / Math.max(1, item.label.length * 0.55)));
        this.elements.push({ kind: 'rect', x: x + w / 2 - estimateTextWidth(item.label, size) / 2 - 0.4, y: y + h / 2 - size * 0.7, width: estimateTextWidth(item.label, size) + 0.8, height: size * 1.3, fill: '#FFFFFF', meta });
        this.text(x + w / 2, y + h / 2 + size * 0.35, item.label, size, 'center', meta);
      }
    }

    const rails = page.items.filter((i) => i.kind === 'rail' || i.kind === 'duct');
    for (const item of rails) {
      const size = layoutSize(item);
      const [x, y] = at(item.x, item.y);
      const w = size.width * k;
      const h = size.height * k;
      const meta: ElementMeta = { role: 'layout', itemId: item.id };
      if (item.kind === 'rail') {
        this.elements.push({ kind: 'rect', x, y, width: w, height: h, fill: this.options.monochrome ? '#FFFFFF' : '#D6D6D6', stroke: this.stroke(COLORS.symbol, WIDTH.thin), meta });
        // The raised middle of the hat profile.
        const lip = (item.profile === 'TS15' ? 2.5 : 5) * k;
        if (item.vertical) {
          this.line(x + lip, y, x + lip, y + h, thin, meta);
          this.line(x + w - lip, y, x + w - lip, y + h, thin, meta);
        } else {
          this.line(x, y + lip, x + w, y + lip, thin, meta);
          this.line(x, y + h - lip, x + w, y + h - lip, thin, meta);
        }
      } else {
        this.elements.push({ kind: 'rect', x, y, width: w, height: h, fill: this.options.monochrome ? '#FFFFFF' : '#E4EAF0', stroke: this.stroke(COLORS.symbol, WIDTH.thin), meta });
        // Slots of the duct's side walls, every 25 mm.
        const slot = Math.min(6, item.width / 4) * k;
        const along = item.vertical ? h : w;
        for (let d = 12.5 * k; d < along; d += 25 * k) {
          if (item.vertical) {
            this.line(x, y + d, x + slot, y + d, thin, meta);
            this.line(x + w - slot, y + d, x + w, y + d, thin, meta);
          } else {
            this.line(x + d, y, x + d, y + slot, thin, meta);
            this.line(x + d, y + h - slot, x + d, y + h, thin, meta);
          }
        }
      }
    }

    const context = parseTag(formatTag(page.structure ?? {}));
    for (const item of page.items) {
      if (item.kind !== 'device') continue;
      const f = layoutFootprint(this.ctx.state, this.ctx.library, this.ctx.devices, item, page.surface);
      const [x, y] = at(item.x, item.y);
      const w = f.width * k;
      const h = f.height * k;
      const meta: ElementMeta = { role: 'layout', itemId: item.id };
      const missing = f.device === undefined;
      const stroke = this.stroke(missing ? COLORS.noPotential : COLORS.symbol, WIDTH.symbol);
      const outline = f.fromPart ? stroke : { ...stroke, dash: DASH.dash };
      const label = missing ? '?' : formatTag(relativeTag(parseTag(f.device!), context));
      // A door legend: the function text below the device.
      const legend = door && f.functionText !== undefined ? localize(f.functionText, this.language, this.languages).split('\n')[0]! : '';
      if (legend) this.text(x + w / 2, y + h + 2.2, fitText(legend, 1.8, Math.max(w + 6, 14)), 1.8, 'center', meta);
      if (f.shape === 'round') {
        const r = w / 2;
        this.elements.push({ kind: 'circle', cx: x + r, cy: y + r, r, fill: '#FFFFFF', stroke: outline, meta });
        const size = Math.max(0.8, Math.min(2, (w - 0.6) / Math.max(2, label.length * 0.55)));
        this.text(x + r, y + r + size * 0.35, label, size, 'center', meta);
        continue;
      }
      this.elements.push({ kind: 'rect', x, y, width: w, height: h, fill: '#FFFFFF', stroke: outline, meta });
      // Upright in wide footprints, turned in narrow ones (like labels on modular devices).
      const upright = w >= h || estimateTextWidth(label, 2) <= w - 0.6;
      const across = upright ? w : h;
      const size = Math.max(0.8, Math.min(2.5, (upright ? h : w) * 0.4, (across - 0.6) / Math.max(1, label.length * 0.55)));
      if (upright) this.text(x + w / 2, y + h / 2 + size * 0.35, label, size, 'center', meta);
      else this.text(x + w / 2 + size * 0.35, y + h / 2, label, size, 'center', meta, false, 90);
    }
    return this.scene(frame);
  }

  scene(frame: FrameDefinition | undefined): Scene {
    const size = frame?.size ?? FALLBACK_SIZE;
    return { width: size.width, height: size.height, elements: this.elements };
  }

  // -------------------------------------------------------------------------
  // Frame and title block

  frame(frame: FrameDefinition): void {
    const meta: ElementMeta = { role: 'frame' };
    for (const g of frame.graphics) this.graphic(g, (x, y) => [x, y], this.stroke(COLORS.frame, WIDTH.symbol), meta);
    const { columns, rows, drawingArea } = frame;
    for (let i = 0; i < columns.count && columns.count > 1; i++) {
      this.text(columns.x + columns.width * (i + 0.5), drawingArea.y - 1.8, String(i + 1), 2.5, 'center', meta);
    }
    if (rows.labels.length > 1) {
      rows.labels.forEach((label, i) => this.text(drawingArea.x - 2, rows.y + rows.height * (i + 0.5) + 1, label, 2.5, 'center', meta));
    }
    for (const field of frame.fields) {
      const text = field.source
        .split('/')
        .map((s) => this.frameValue(s.trim()))
        .join('/');
      if (text.replace(/\//g, '') === '') continue;
      // Several lines are centered on the field's position (where a single line sits), smaller
      // when they need more than the field's height.
      const lines = text.split('\n').length;
      let size = field.size ?? 2.5;
      if (field.height && lines > 1) size = Math.min(size, field.height / (lines * LINE_SPACING));
      this.text(field.x, field.y - ((lines - 1) * size * LINE_SPACING) / 2, text, size, field.align ?? 'left', meta);
    }
  }

  frameValue(source: string): string {
    const { project } = this.ctx.state;
    const [scope, key, sub] = source.split('.');
    if (scope === 'project') {
      if (key === 'name') return project.name;
      if (key === 'description') return localize(project.description, this.language, this.languages);
      if (key === 'pageCount') return String(this.ctx.sheets.length);
      if (key === 'properties' && sub) return project.properties[sub] ?? '';
    }
    if (scope === 'page') {
      if (key === 'name') return this.sheet.name;
      if (key === 'fullName') return this.sheet.fullName;
      if (key === 'index') return String(this.sheet.number);
      if (key === 'structure') return formatTag(this.page.structure ?? {});
      if (key === 'description') return localize(this.page.description, this.language, this.languages);
      if (key === 'properties' && sub) return this.page.properties?.[sub] ?? '';
    }
    return '';
  }

  // -------------------------------------------------------------------------
  // Connections

  connections(page: SchematicPage): void {
    const { connectivity } = this.ctx;
    for (const s of connectivity.segments) {
      if (s.pageId !== page.id || (s.x1 === s.x2 && s.y1 === s.y2)) continue;
      const potential = connectivity.potentialOf.get(s.a) ?? {};
      const conflict = potential.conflict !== undefined;
      // Pipes carry a medium (gray unless it has its own color); wires a potential.
      const stroke =
        connectivity.points.get(s.a)?.medium === 'fluid'
          ? pipeStroke(potential.name, conflict, this.ctx.state.project.media ?? [], this.options.monochrome)
          : connectionStroke(potential.name, conflict, this.ctx.state.project.potentials, this.options.monochrome);
      this.line(s.x1, s.y1, s.x2, s.y2, stroke, {
        role: 'connection',
        connection: { a: s.a, b: s.b, ...(potential.name ? { potential: potential.name } : {}), ...(conflict ? { conflict } : {}) },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Symbols

  item(page: SchematicPage, item: Item): void {
    const def = resolveSymbol(item, this.ctx.library);
    if (!def) {
      const meta: ElementMeta = { role: 'symbol', itemId: item.id };
      this.elements.push({ kind: 'rect', x: item.x - 4, y: item.y - 4, width: 8, height: 8, stroke: this.stroke(COLORS.noPotential, WIDTH.symbol), meta });
      this.text(item.x, item.y + 1, '?', 4, 'center', meta);
      return;
    }
    const at = (x: number, y: number): [number, number] => {
      const p = transformPoint({ x, y }, item.rotation, item.mirror);
      return [item.x + p.x, item.y + p.y];
    };
    const meta: ElementMeta = { role: 'symbol', itemId: item.id };
    if (def.function === 'text') return this.freeText(item);
    const first = this.elements.length;
    for (const g of def.graphics) this.graphic(g, at, this.stroke(COLORS.symbol, WIDTH.symbol), meta, item);
    const arranged = item.textArrangement ? this.arrange(page, item, def, this.elements.slice(first)) : undefined;
    for (const field of def.texts) this.field(page, item, def, field, at, arranged?.get(field.field));
    if (def.generator === 'plcCard') this.plcCardRows(page, item);
    if (def.generator === 'cable') this.cableCores(page, item);
  }

  /**
   * Free text: the lines of the text in the display language; the first line's baseline is at the
   * item's point, aligned left, centered or right to it. An empty text shows a grey placeholder.
   */
  freeText(item: Item): void {
    const style = item.props?.textStyle ?? {};
    const size = style.size ?? TEXT_SIZE.free;
    const align = style.align ?? 'left';
    const text = localize(item.props?.text, this.language, this.languages);
    // No text field: the free text moves and is selected as a whole item.
    const meta: ElementMeta = { role: 'symbol', itemId: item.id };
    if (!text.trim()) {
      if (!this.options.placeholders) return;
      this.elements.push({ kind: 'text', x: item.x, y: item.y, text: '(text)', size, color: this.color(COLORS.inherited), align, meta });
      return;
    }
    text.split('\n').forEach((line, i) => {
      this.elements.push({ kind: 'text', x: item.x, y: item.y + i * size * 1.3, text: line, size, color: this.color(style.color ?? COLORS.text), align, meta });
    });
  }

  /** Rows of a PLC card master: pin, channel, address, function and where the channel is drawn. */
  plcCardRows(page: SchematicPage, item: Item): void {
    // A view (further overview) shows the data of its card master.
    const card = this.ctx.plc.byCard.get(item.props?.plcView?.of ?? item.id);
    const channels = item.props?.plc?.channels ?? item.props?.plcView?.channels ?? [];
    const { width, stub } = PLC_CARD;
    const meta: ElementMeta = { role: 'text', itemId: item.id };
    if (card?.station) {
      this.text(item.x + width - 2, item.y + 5.5, `${card.station.name}${card.slot !== undefined ? ` / ${card.slot}` : ''}`, TEXT_SIZE.small, 'right', meta);
    }
    const layout = plcCardLayout(channels);
    channels.forEach((channel, i) => {
      const info = card?.channels[i];
      const row = layout.rows[i]!;
      // The channel's texts on its own terminal's row; further terminals show their names.
      const y = item.y + (row.pins.find((p) => p.pin === channel.pin) ?? row.pins[0]!).y;
      const base = y + 0.8;
      for (const p of row.pins) this.text(item.x - stub + 0.5, item.y + p.y - 0.8, p.pin, TEXT_SIZE.pin, 'left', { ...meta, field: `pin:${p.pin}` });
      for (const extra of channel.extraPins ?? []) {
        const p = row.pins.find((q) => q.pin === extra.pin);
        if (p && extra.label) this.text(item.x + 1.5, item.y + p.y + 0.8, extra.label, TEXT_SIZE.small, 'left', meta);
      }
      this.text(item.x + 1.5, base, channelLabel(channel), TEXT_SIZE.small, 'left', meta);
      if (info?.address) this.text(item.x + 13, base, info.address, TEXT_SIZE.small, 'left', meta);
      const fn = localize(info?.function, this.language, this.languages);
      if (fn) {
        const inherited = info?.functionSource === 'wiring';
        this.elements.push({ kind: 'text', x: item.x + 27, y: base, text: fitText(oneLine(fn), TEXT_SIZE.small, 30), size: TEXT_SIZE.small, color: this.color(inherited ? COLORS.inherited : COLORS.text), align: 'left', meta });
      }
      const refs = (info?.slaves ?? []).map((target) => ({ target, text: this.reference(page, target) }));
      refs.forEach((ref, k) =>
        this.text(item.x + width - 1.5 - (refs.length - 1 - k) * 12, base, ref.text, TEXT_SIZE.small, 'right', { role: 'xref', itemId: item.id, target: ref.target }),
      );
    });
  }

  /** The wire a marker sits on, with its number and whether that is only derived. */
  markerWire(item: Item, def: SymbolDefinition): { number: string; derived: boolean } | undefined {
    const pin = def.connections[0];
    const net = pin && this.ctx.connectivity.netOf.get(`${item.id}:${pin.id}`);
    const wire = net !== undefined ? this.ctx.wires.byNet.get(net) : undefined;
    if (item.props?.wire?.number) return { number: item.props.wire.number, derived: false };
    return wire ? { number: wire.number, derived: true } : undefined;
  }

  /** Core labels where a cable definition line crosses its conductors. */
  cableCores(page: SchematicPage, item: Item): void {
    const vertical = item.height !== undefined && item.width === undefined;
    for (const { at, net } of cableCrossings(page, item, this.ctx.connectivity)) {
      const core = this.ctx.cables.byNet.get(net)?.core;
      if (!core) continue;
      const label = core.number && core.color && core.color !== 'BK' ? `${core.number} ${core.color}` : (core.number ?? core.color ?? core.id);
      const meta: ElementMeta = { role: 'text', itemId: item.id };
      if (vertical) this.text(item.x - 0.8, at - 0.8, label, TEXT_SIZE.pin, 'right', meta);
      else this.text(at + 0.6, item.y - 0.8, label, TEXT_SIZE.pin, 'left', meta);
    }
  }

  /** Reference text from this page to an item (`/6.4`). */
  reference(from: SchematicPage, target: { pageId: string; itemId: string }): string {
    const page = this.ctx.state.pages[target.pageId] as SchematicPage;
    const item = page.items.find((i) => i.id === target.itemId)!;
    return formatReference(page, pagePosition(page, item, this.settings, this.ctx.library), this.settings, from.structure);
  }

  /**
   * Positions of the label texts for the item's text arrangement: one block of lines (tag, name,
   * function text, technical data, cross-references) next to the outline of its graphics, on the
   * chosen side and centered along it, turned by the arrangement's angle.
   */
  arrange(page: SchematicPage, item: Item, def: SymbolDefinition, graphics: readonly SceneElement[]): Map<string, ArrangedText> | undefined {
    const { side, angle } = item.textArrangement!;
    if (graphics.length === 0) return undefined;
    const box = graphics.map(elementBox).reduce((a, b) => ({ x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2) }));
    // The lines of the block: offset of each text's first line along the stacking direction.
    const starts = new Map<string, number>();
    let next = 0;
    let firstSize: number | undefined;
    let last = { at: 0, size: 0 };
    for (const field of ARRANGED_TEXT_FIELDS) {
      const definition = def.texts.find((t) => t.field === field);
      if (!definition) continue;
      const size = field === 'xref' ? TEXT_SIZE.xref : (definition.size ?? fieldSize(field));
      const step = field === 'xref' ? 2.5 : size * LINE_SPACING;
      const text = field === 'xref' ? undefined : this.fieldText(page, item, def, field);
      const lines = field === 'xref' ? (this.ctx.crossReferences.byItem.get(item.id)?.references.length ?? 0) : text ? text.split('\n').length : 0;
      if (lines === 0) continue;
      starts.set(field, next);
      firstSize ??= size;
      last = { at: next + (lines - 1) * step, size };
      next += lines * step;
    }
    if (firstSize === undefined) return undefined;
    // Extent of the block across the lines: from the ascent of the first to the descent of the last.
    const min = -firstSize * 0.8;
    const max = last.at + last.size * 0.2;
    const stack: Vec = angle === 90 ? [1, 0] : angle === 270 ? [-1, 0] : [0, 1];
    const reading: Vec = angle === 90 ? [0, -1] : angle === 270 ? [0, 1] : [1, 0];
    const normal: Vec = { left: [-1, 0], right: [1, 0], above: [0, -1], below: [0, 1] }[side] as Vec;
    const center: Vec = [(box.x1 + box.x2) / 2, (box.y1 + box.y2) / 2];
    const edge = { left: -box.x1, right: box.x2, above: -box.y1, below: box.y2 }[side] + ARRANGE_GAP;
    let origin: Vec;
    let align: TextAlign;
    if (Math.abs(dot(reading, normal)) === 1) {
      // The texts run away from the symbol, their lines side by side, centered on it.
      align = dot(reading, normal) === 1 ? 'left' : 'right';
      origin = add(scale(normal, edge), scale(stack, dot(center, stack) - (min + max) / 2));
    } else {
      // The texts run along the side, centered; the block starts just beyond the edge.
      align = 'center';
      const across = dot(stack, normal);
      origin = add(scale(reading, dot(center, reading)), scale(normal, edge - Math.min(min * across, max * across)));
    }
    return new Map([...starts].map(([field, at]) => [field, { x: origin[0] + stack[0] * at, y: origin[1] + stack[1] * at, angle, align }]));
  }

  field(page: SchematicPage, item: Item, def: SymbolDefinition, field: TextField, at: (x: number, y: number) => [number, number], arranged?: ArrangedText): void {
    const offset = item.texts?.[field.field] ?? { dx: 0, dy: 0 };
    const [px, py] = arranged ? [arranged.x, arranged.y] : at(field.x, field.y);
    const size = field.size ?? fieldSize(field.field);
    // Texts stay upright unless the item turns them (angle against the sheet). Upside down, a text
    // above the symbol must hang below it, and left/right alignment swaps with mirroring and
    // rotation by 180°. A text with its own angle or alignment, or placed by the item's text
    // arrangement, is placed exactly as set.
    const angle: TextAngle = offset.angle ?? arranged?.angle ?? 0;
    const own = offset.angle !== undefined || offset.align !== undefined || arranged !== undefined;
    const x = px + offset.dx;
    const y = py + offset.dy + (item.rotation === 180 && !own ? size * 0.7 : 0);
    const flip = item.mirror !== (item.rotation === 180);
    const base = offset.align ?? arranged?.align ?? field.align ?? 'left';
    const align: TextAlign = own
      ? base
      : item.rotation === 90 || item.rotation === 270
        ? 'center'
        : flip && base !== 'center'
          ? base === 'left'
            ? 'right'
            : 'left'
          : base;
    const meta: ElementMeta = { role: 'text', itemId: item.id, field: field.field };

    if (field.field === 'xref') {
      const refs = this.ctx.crossReferences.byItem.get(item.id)?.references ?? [];
      refs.forEach((ref, i) => {
        const [lx, ly] = lineStep(angle, i * 2.5);
        this.text(x + lx, y + ly, ref.text, TEXT_SIZE.xref, align, { role: 'xref', itemId: item.id, field: 'xref', target: ref.target }, false, angle);
      });
      return;
    }
    if (field.field === 'contactImage') {
      const rows = this.ctx.crossReferences.byItem.get(item.id)?.contactImage;
      if (rows && this.settings.contactImage !== 'none') this.contactImage(item, rows, x, y);
      return;
    }
    const text = this.fieldText(page, item, def, field.field);
    if (field.field === 'wire') {
      // Wire marker: the wire number (grey while it is only derived), color and cross-section when set.
      const wire = this.markerWire(item, def);
      if (wire?.number) this.elements.push({ kind: 'text', x, y, text: wire.number, size, color: this.color(wire.derived ? COLORS.inherited : COLORS.text), align, ...(angle ? { angle } : {}), meta });
      const extra = [item.props?.wire?.color, item.props?.wire?.crossSection ? `${item.props.wire.crossSection} mm²` : undefined].filter(Boolean).join(' ');
      const [ex, ey] = lineStep(angle, size * 1.2);
      if (extra) this.text(x + ex, y + ey, extra, size * 0.8, align, meta, false, angle);
      return;
    }
    if (text) this.text(x, y, text, size, align, meta, false, angle);
  }

  fieldText(page: SchematicPage, item: Item, def: SymbolDefinition, field: string): string {
    const props = item.props ?? {};
    if (field === 'tag') {
      if (itemRole(item, def) === 'none') return '';
      // A terminal strip shows its tag once, at its first terminal on the page.
      if (def.function === 'terminal' && !this.isFirstTerminal(page, item)) return '';
      const tag = effectiveTag(page, item, this.ctx.library);
      // A slave right of a symbol of the same device (at the same height) does not repeat the tag:
      // e.g. contacts next to their coil, the second contact block of an e-stop.
      if (itemRole(item, def) === 'auxiliary' && item.props?.showTag !== true) {
        const left = tagFromLeftNeighbour(page, item, this.ctx.library, item.id);
        if (left && formatTag(left) === formatTag(tag)) return '';
      }
      return formatTag(relativeTag(tag, tagContext(page, item, this.ctx.library, item.id)));
    }
    if (field === 'functionText') {
      // I/O points without their own function show the channel's (possibly inherited) function.
      const own = localize(props.functionText, this.language, this.languages);
      return own || localize(this.ctx.plc.bySlave.get(item.id)?.channel.function, this.language, this.languages);
    }
    if (field === 'plcChannel') {
      const info = this.ctx.plc.bySlave.get(item.id);
      if (!info) return item.props?.channel !== undefined ? `? ${item.props.channel}` : '?';
      return channelLabel(info.channel.channel);
    }
    if (field === 'plcAddress') return this.ctx.plc.bySlave.get(item.id)?.channel.address ?? '';
    if (field.startsWith('pin:')) {
      const id = field.slice(4);
      return item.pins?.[id] ?? def.connections.find((c) => c.id === id)?.designation ?? '';
    }
    if (field === 'cableType') return props.cable?.type ?? '';
    const value = props[field];
    return typeof value === 'string' ? value : '';
  }

  isFirstTerminal(page: SchematicPage, item: Item): boolean {
    const key = this.ctx.devices.byItem.get(item.id);
    const first = page.items
      .filter((i) => this.ctx.devices.byItem.get(i.id) === key && this.ctx.library.symbol(i.symbol)?.function === 'terminal')
      .sort((a, b) => a.x - b.x || a.y - b.y)[0];
    return first?.id === item.id;
  }

  /** Contact image (Kontaktspiegel) below a coil: one row per contact with pins and where it is used. */
  contactImage(item: Item, rows: ContactImageRow[], x: number, y: number): void {
    const meta: ElementMeta = { role: 'contactImage', itemId: item.id, field: 'contactImage' };
    const stroke = this.stroke(COLORS.symbol, WIDTH.thin);
    const size = TEXT_SIZE.small;
    if (this.settings.contactImage === 'path') {
      rows.forEach((row, i) => {
        const text = `${row.pins.join('-')}${row.reference ? ' ' + row.reference.text : ''}`;
        this.text(x, y + i * 2.6, text, size, 'left', row.reference ? { ...meta, role: 'xref', target: row.reference.target } : meta);
      });
      return;
    }
    // Table to the right of the conductor: contact symbol | pins | reference.
    const rowHeight = 3.2;
    const pinsWidth = Math.max(...rows.map((r) => estimateTextWidth(r.pins.join(' '), size))) + 2;
    rows.forEach((row, i) => {
      const mid = y + i * rowHeight + rowHeight / 2;
      this.miniSymbol(row, x, mid, stroke, meta);
      this.text(x + 7, mid + 0.7, row.pins.join(' '), size, 'left', meta);
      if (row.reference) {
        this.text(x + 7 + pinsWidth, mid + 0.7, row.reference.text, size, 'left', { ...meta, role: 'xref', target: row.reference.target });
      }
    });
    this.line(x + 6, y, x + 6, y + rows.length * rowHeight, stroke, meta);
  }

  /** A tiny horizontal contact symbol for the contact image. */
  /**
   * The mini symbol of a contact image row: from the drawn contact's symbol, else from a library
   * symbol with the row's function (free template contacts), else a built-in contact.
   */
  miniSymbol(row: ContactImageRow, x: number, y: number, stroke: Stroke, meta: ElementMeta): void {
    const { library } = this.ctx;
    const graphics =
      (row.symbol ? library.symbol(row.symbol)?.contactImage : undefined) ??
      library.symbols().find((s) => s.function === row.function && s.contactImage)?.contactImage;
    if (!graphics) return this.miniContact(row.function, x, y, stroke, meta);
    for (const g of graphics) this.graphic(g, (gx, gy) => [x + gx, y + gy], stroke, meta);
  }

  miniContact(fn: string, x: number, y: number, stroke: Stroke, meta: ElementMeta): void {
    const nc = fn === 'contact.nc';
    this.line(x, y, x + 1.2, y, stroke, meta);
    this.line(x + 3.6, y, x + 4.8, y, stroke, meta);
    this.line(x + 1.2, y, x + 3.8, nc ? y + 1 : y - 1, stroke, meta);
    if (nc) this.line(x + 3.6, y, x + 3.6, y + 1, stroke, meta);
    if (fn === 'contact.co') this.line(x + 3.6, y + 0.9, x + 4.8, y + 0.9, stroke, meta);
  }

  // -------------------------------------------------------------------------
  // Boxes

  box(page: SchematicPage, item: Item): void {
    const def = this.ctx.library.symbol(item.symbol)!;
    const rect = boxRect(item);
    const meta: ElementMeta = { role: 'box', itemId: item.id };
    if (def.function === 'box.structure') {
      const color = this.color(COLORS.structureBox);
      this.elements.push({ kind: 'rect', ...rect, stroke: { color, width: WIDTH.symbol, dash: DASH.dashdot }, meta });
      const label = formatTag({ ...(item.tag?.function ? { function: item.tag.function } : {}), ...(item.tag?.location ? { location: item.tag.location } : {}) });
      if (label) this.elements.push({ kind: 'text', x: rect.x + 1, y: rect.y + 3.5, text: label, size: TEXT_SIZE.tag, color, align: 'left', meta: { role: 'text', itemId: item.id, field: 'tag' } });
      return;
    }
    // Device box: drawn like a symbol, dashed, with its pins on the border.
    this.elements.push({ kind: 'rect', ...rect, stroke: { color: this.color(COLORS.symbol), width: WIDTH.symbol, dash: DASH.dash }, meta });
    for (const field of def.texts) this.field(page, item, def, field, (x, y) => [rect.x + x, rect.y + y]);
    for (const pin of item.borderPins ?? []) {
      const p = pinPosition(rect, pin.side, pin.offset);
      this.elements.push({ kind: 'circle', cx: p.x, cy: p.y, r: 0.5, fill: this.color(COLORS.symbol), meta: { ...meta, field: `pin:${pin.id}` } });
      const label = {
        left: { x: p.x + 1.2, y: p.y - 0.6, align: 'left' as const },
        right: { x: p.x - 1.2, y: p.y - 0.6, align: 'right' as const },
        top: { x: p.x + 0.8, y: p.y + 2.8, align: 'left' as const },
        bottom: { x: p.x + 0.8, y: p.y - 1, align: 'left' as const },
      }[pin.side];
      this.text(label.x, label.y, pin.designation, TEXT_SIZE.pin, label.align, { role: 'text', itemId: item.id, field: `pin:${pin.id}` });
    }
  }

  // -------------------------------------------------------------------------
  // Junction stubs (editor): drawn before the wires, which cover the connected directions.

  junctionStubs(page: SchematicPage): void {
    const stroke = { color: COLORS.noPotential, width: WIDTH.connection };
    for (const item of page.items) {
      const def = this.ctx.library.symbol(item.symbol);
      if (!def || !JUNCTIONS.has(def.function)) continue;
      for (const c of def.connections) {
        const p = transformPoint(c, item.rotation, item.mirror);
        const [dx, dy] = STUB[transformDirection(c.direction, item.rotation, item.mirror)];
        const x = item.x + p.x;
        const y = item.y + p.y;
        // Pipe junctions show gray stubs, wire junctions red ones (not connected yet).
        this.line(x, y, x + dx, y + dy, c.medium === 'fluid' ? { ...stroke, color: PIPE_COLOR } : stroke, { role: 'symbol', itemId: item.id, field: 'stub' });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Terminal bridges: bridged terminals of a strip drawn side by side at the
  // same height are joined by a bridge line below their circles.

  bridges(page: SchematicPage): void {
    const groups = new Map<string, Item[]>();
    for (const item of page.items) {
      const bridge = item.props?.bridge;
      if (typeof bridge !== 'string' || bridge === '' || item.rotation % 180 !== 0) continue;
      if (this.ctx.library.symbol(item.symbol)?.function !== 'terminal') continue;
      const key = `${formatTag(effectiveTag(page, item, this.ctx.library))}\u0000${bridge}\u0000${item.y}`;
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    const stroke = this.stroke(COLORS.symbol, WIDTH.symbol);
    for (const items of groups.values()) {
      if (items.length < 2) continue;
      items.sort((a, b) => a.x - b.x);
      const y = items[0]!.y + 2.5;
      const meta: ElementMeta = { role: 'symbol', itemId: items[0]!.id, field: 'bridge' };
      this.line(items[0]!.x, y, items.at(-1)!.x, y, stroke, meta);
      for (const item of items) this.elements.push({ kind: 'circle', cx: item.x, cy: y, r: 0.5, fill: stroke.color, meta: { ...meta, itemId: item.id } });
    }
  }

  // -------------------------------------------------------------------------
  // Pin link overlay

  links(page: SchematicPage): void {
    const points = new Map(pageConnectionPoints(page, this.ctx.library).filter((p) => !p.inner).map((p) => [p.key, p]));
    const palette = ['#FF8C00', '#8A2BE2', '#008B8B', '#C71585'];
    for (const item of page.items) {
      const def = this.ctx.library.symbol(item.symbol);
      if (!def || itemRole(item, def) === 'none') continue;
      linkGroups(def, item).forEach((group, i) => {
        const pts = group.flatMap((pin) => {
          const p = points.get(`${item.id}:${pin}`);
          return p ? [[p.x, p.y] as [number, number]] : [];
        });
        if (pts.length < 2) return;
        this.elements.push({
          kind: 'polyline',
          points: pts,
          stroke: { color: palette[i % palette.length]!, width: WIDTH.thin * 2, dash: [0.8, 0.6] },
          meta: { role: 'links', itemId: item.id },
        });
      });
    }
  }

  // -------------------------------------------------------------------------
  // Primitives

  graphic(g: Graphic, at: (x: number, y: number) => [number, number], stroke: Stroke, meta: ElementMeta, item?: Item): void {
    switch (g.type) {
      case 'line': {
        const [x1, y1] = at(g.x1, g.y1);
        const [x2, y2] = at(g.x2, g.y2);
        this.line(x1, y1, x2, y2, stroke, meta);
        return;
      }
      case 'polyline':
        this.elements.push({
          kind: 'polyline',
          points: g.points.map(([x, y]) => at(x, y)),
          ...(g.closed ? { closed: true } : {}),
          stroke,
          ...(g.fill ? { fill: stroke.color } : {}),
          meta,
        });
        return;
      case 'rect': {
        const [ax, ay] = at(g.x, g.y);
        const [bx, by] = at(g.x + g.width, g.y + g.height);
        this.elements.push({
          kind: 'rect',
          x: Math.min(ax, bx),
          y: Math.min(ay, by),
          width: Math.abs(bx - ax),
          height: Math.abs(by - ay),
          stroke,
          ...(g.fill ? { fill: stroke.color } : {}),
          meta,
        });
        return;
      }
      case 'circle': {
        const [cx, cy] = at(g.cx, g.cy);
        this.elements.push({ kind: 'circle', cx, cy, r: g.r, ...(g.fill ? { fill: stroke.color } : { stroke }), meta });
        return;
      }
      case 'arc': {
        const [cx, cy] = at(g.cx, g.cy);
        let start = g.start;
        let end = g.end;
        if (item?.mirror) [start, end] = [180 - end, 180 - start];
        const rotation = item?.rotation ?? 0;
        this.elements.push({ kind: 'arc', cx, cy, r: g.r, start: start + rotation, end: end + rotation, stroke, meta });
        return;
      }
      case 'text': {
        const [x, y] = at(g.x, g.y);
        this.text(x, y, g.text, g.size ?? 2.5, g.align ?? 'left', meta);
        return;
      }
    }
  }

  line(x1: number, y1: number, x2: number, y2: number, stroke: Stroke, meta: ElementMeta): void {
    this.elements.push({ kind: 'line', x1, y1, x2, y2, stroke, meta });
  }

  /** A text; line breaks (entered with Ctrl+Enter) give further lines below. */
  text(x: number, y: number, text: string, size: number, align: TextAlign, meta: ElementMeta, bold = false, angle: TextAngle = 0): void {
    text.split('\n').forEach((line, i) => {
      const [lx, ly] = lineStep(angle, i * size * LINE_SPACING);
      this.elements.push({ kind: 'text', x: x + lx, y: y + ly, text: line, size, color: this.color(COLORS.text), align, ...(bold ? { bold } : {}), ...(angle ? { angle } : {}), meta });
    });
  }

  stroke(color: string, width: number): Stroke {
    return { color: this.color(color), width };
  }
}

/** Position of a text placed by a text arrangement. */
interface ArrangedText {
  x: number;
  y: number;
  angle: TextAngle;
  align: TextAlign;
}

/** Distance between a symbol's graphics and its arranged texts (mm). */
const ARRANGE_GAP = 1.5;

type Vec = [number, number];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1];
const scale = (a: Vec, f: number): Vec => [a[0] * f, a[1] * f];
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];

/** Offset of a following line of a text at an angle: below it, as seen in the reading direction. */
function lineStep(angle: TextAngle, distance: number): [number, number] {
  return angle === 90 ? [distance, 0] : angle === 270 ? [-distance, 0] : [0, distance];
}

/** Distance of the lines of a multi-line text, in text sizes. */
const LINE_SPACING = 1.25;

function fieldSize(field: string): number {
  if (field.startsWith('pin:')) return TEXT_SIZE.pin;
  return (TEXT_SIZE as Record<string, number>)[field] ?? TEXT_SIZE.tag;
}

function pinPosition(rect: { x: number; y: number; width: number; height: number }, side: string, offset: number): { x: number; y: number } {
  switch (side) {
    case 'left':
      return { x: rect.x, y: rect.y + offset };
    case 'right':
      return { x: rect.x + rect.width, y: rect.y + offset };
    case 'top':
      return { x: rect.x + offset, y: rect.y };
    default:
      return { x: rect.x + offset, y: rect.y + rect.height };
  }
}
