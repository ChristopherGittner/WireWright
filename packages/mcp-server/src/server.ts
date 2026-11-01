// MCP server in project folder mode (ADR-007): every tool call loads the
// project from disk, applies commands through the core and saves the changed
// files. The desktop app picks the changes up by watching the folder.
import {
  CommandError,
  commandSchema,
  createProjectState,
  loadProject,
  pageFullName,
  parseTag,
  formatTag,
  macroFromItems,
  planRenumbering,
  projectExists,
  ProjectDocument,
  ProjectLoadError,
  saveProject,
  coresFromType,
  exportPlc,
  functionLabel,
  parseStart,
  placeFunctionCommand,
  plcIoRows,
  compareProjects,
  loadRevisionSnapshot,
  nextRevisionName,
  pagesForRevision,
  saveRevisionSnapshot,
  currentPathCommands,
  connectPinsCommands,
  localize,
  partId,
  type PartDefinition,
  planPlcTagImport,
  plcTagImportCommands,
  readPlcTags,
  type Command,
  type Library,
  type PlcStation,
  type Page,
  type ProjectState,
  type ProjectStorage,
  type LayoutPage,
  issueKey,
  channelLabel,
  isBmecat,
  readBmecat,
  catalogParts,
  catalogFeatures,
  mergePart,
  readPartsTable,
  type SchematicPage,
} from '@wirewright/core';
import { createStandardLibrary } from '@wirewright/library';
import { renderContext, renderSheet, sceneToSvg } from '@wirewright/render';
import { Resvg } from '@resvg/resvg-js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { NodeProjectStorage } from '@wirewright/core/node';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { devicesView, itemView, pageRef, pageView, projectView, symbolView } from './views.js';

/** An error whose message is shown to the AI as is. */
/** An error shown to the assistant as the tool result (not a crash). */
export class ToolError extends Error {}

/**
 * Where the tools work: `run` hands them the project document; changes they apply are kept
 * (saved to the folder, or applied to the document open in the desktop app).
 */
export interface ProjectSessionLike {
  run<T>(fn: (doc: ProjectDocument) => T): Promise<T>;
  /** Folder that relative file paths start in. */
  readonly root?: string | undefined;
  /** Creates a project (project folder mode only). */
  create?(state: ProjectState): Promise<void>;
}

export interface WirewrightServerOptions {
  /** Project folder mode: the project is loaded from and saved to this storage on each call. */
  storage?: ProjectStorage;
  /** Instead of a storage: e.g. the document open in the desktop app (live mode). */
  session?: ProjectSessionLike;
  library?: Library;
}

const INSTRUCTIONS = `Wirewright is an electrical CAD tool for IEC schematics. You edit one project folder.

Conventions:
- Coordinates are integer millimetres from the top-left page corner, y grows downwards. Place symbols on the 4 mm grid inside the frame's drawing area (see get_project → frame).
- Pages have columns (default 10 columns of 38 mm starting at x=24). Positions are written as page.column, e.g. /5.3.
- Tags follow IEC 81346: =function +location -device, e.g. =A1+CAB1-K1. Symbols inherit = and + from their page and from structure boxes; give only the device part (e.g. "-K1") unless it differs.
- Main functions (coils, breakers, push buttons, motors …) are named automatically by page and column (-5K3). Auxiliary functions (contacts) need the tag of their device, or inherit it from the nearest device symbol to their left at the same height.
- Connections are made automatically (autoconnect): two connection points connect when they face each other on the same horizontal or vertical line. Use the absolute connection coordinates from get_page to align symbols. Use connection symbols for turns and branches: one symbol per direction, e.g. wirewright.connection.corner.right-down, wirewright.connection.tee.right-down-left (pins named by direction).
- Issues the designer acknowledged (acknowledge_issues) are intended: do not try to fix them.
- PLC cards belong to the project (PLC tab) whether drawn or not: add_plc_card adds one without a drawing, place_plc_card or generate_plc_overview draws it. A card drawn more than once is reported.
- check_project also checks engineering rules: coil/lamp rated voltage (technical data "24 V DC" or the part's ratedVoltage) against the potentials at its pins (potential voltages in the project), wire cross-sections against the breaker or fuse rating ("C16"), PE pins not connected or on another potential, PLC inputs wired to coils/lamps and outputs wired to switches/sensors.
- Cabinet layout: create_layout_page makes a mounting plate or (surface "door") the door front (real mm, drawn at 1:scale); place_layout_items puts DIN rails, wire ducts and devices on it (x/y = top-left corner on the plate in real mm). Device footprints come from the part's width/height in the parts database (set_part), else 45 × 90 mm. check_project reports devices with parts that are not on a plate of their location.
- Pneumatics/hydraulics (ISO 1219, search_symbols "valve", "cylinder") sit on the same pages; their ports connect only to pipe ports (pipe corners wirewright.pipe.corner.*, pipe tees, wirewright.pipe.source with a medium name such as "P"), never to wires. A solenoid valve takes the tag of its valve coil.
- For whole current paths use draw_current_path (potential, symbols top to bottom, potential); join pins that are not on one line with connect_pins.
- Use search_symbols to find symbol IDs, apply_commands for several changes as one step, and check_project to find mistakes.`;

export function createWirewrightServer(options: WirewrightServerOptions): McpServer {
  const library = options.library ?? createStandardLibrary();
  if (!options.session && !options.storage) throw new Error('createWirewrightServer needs a storage or a session');
  const session: ProjectSessionLike = options.session ?? new ProjectSession(options.storage!, library);
  const server = new McpServer({ name: 'wirewright', version: '0.1.0' }, { instructions: INSTRUCTIONS });

  const pageArg = z.string().describe('Page ID, name ("5") or full name ("=SG+10/5")');
  const tagArg = z.string().describe('Tag such as "-K1", "+FIELD-S1" or "=AA+20-K1"');

  server.registerTool(
    'create_project',
    {
      description: 'Creates a new, empty project in the project folder. Fails if a project already exists.',
      inputSchema: {
        name: z.string().min(1),
        languages: z.array(z.string()).min(1).optional().describe('Project languages, first is displayed. Default ["de", "en"].'),
      },
    },
    ({ name, languages }) =>
      respond(async () => {
        if (!session.create) throw new ToolError('A project is already open in the desktop app; create new projects there.');
        const state = createProjectState({ name, ...(languages ? { languages } : {}) });
        await session.create(state);
        return projectView(state, library, new ProjectDocument(state, library).devices(), []);
      }),
  );

  server.registerTool(
    'get_project',
    { description: 'Project name, settings, potentials, page list, frame geometry, device count and issue counts.', inputSchema: {} },
    () => respond(() => session.run((doc) => projectView(doc.state, library, doc.devices(), doc.check()))),
  );

  server.registerTool(
    'list_pages',
    { description: 'All pages in order.', inputSchema: {} },
    () => respond(() => session.run((doc) => doc.state.project.pages.flatMap((id) => (doc.state.pages[id] ? [pageRef(doc.state.pages[id])] : [])))),
  );

  server.registerTool(
    'get_page',
    {
      description: 'One page with all items: symbol, position, effective tag, properties and connection points in absolute page coordinates.',
      inputSchema: { page: pageArg },
    },
    ({ page }) => respond(() => session.run((doc) => pageView(doc.state, resolvePage(doc.state, page), doc.library, doc.devices(), doc.plc()))),
  );

  server.registerTool(
    'render_page',
    {
      description:
        'Renders a page as an image (PNG, default) or SVG to check the drawing: connection lines are colored by potential (L black, N light blue, PE green dashed, 24V/0V dark blue, no potential red, conflict magenta).',
      inputSchema: {
        page: pageArg,
        sheet: z.int().min(1).optional().describe('Sheet of a multi-sheet report page, 1-based'),
        format: z.enum(['png', 'svg']).optional(),
        showLinks: z.boolean().optional().describe('Overlay the pin links of all devices'),
      },
    },
    async ({ page, sheet, format, showLinks }) => {
      try {
        const svg = await session.run((doc) => {
          const target = resolvePage(doc.state, page);
          const ctx = renderContext(doc);
          const found = ctx.sheets.find((s) => s.pageId === target.id && s.sheet === (sheet ?? 1) - 1);
          if (!found) throw new ToolError(`Page ${pageFullName(target)} has no sheet ${sheet}`);
          return sceneToSvg(renderSheet(ctx, found, { showLinks: showLinks ?? false }), { metadata: format === 'svg' });
        });
        if (format === 'svg') return { content: [{ type: 'text', text: svg }] };
        const png = new Resvg(svg, { fitTo: { mode: 'width', value: 2000 }, font: { loadSystemFonts: true, defaultFontFamily: 'Arial' } }).render().asPng();
        return { content: [{ type: 'image', data: Buffer.from(png).toString('base64'), mimeType: 'image/png' }] };
      } catch (error) {
        return respond(() => {
          throw error;
        });
      }
    },
  );

  server.registerTool(
    'get_report',
    {
      description: 'Rows of a report page (table of contents, device directory, bill of materials, terminal list), all sheets.',
      inputSchema: { page: pageArg },
    },
    ({ page }) =>
      respond(() =>
        session.run((doc) => {
          const target = resolvePage(doc.state, page);
          if (target.type !== 'report') throw new ToolError(`Page ${pageFullName(target)} is not a report page`);
          return { kind: target.report.kind, rows: doc.sheets().sheets.filter((s) => s.pageId === target.id).flatMap((s) => s.rows ?? []) };
        }),
      ),
  );

  server.registerTool(
    'search_symbols',
    {
      description:
        'Finds library symbols by ID, name (any language), function or letter code. Returns connection points relative to the insertion point. Without a query, lists all symbols.',
      inputSchema: {
        query: z.string().optional(),
        category: z.string().optional().describe('e.g. relays, contacts, protection, consumers, connections, boxes'),
      },
    },
    ({ query, category }) =>
      respond(() => {
        const needle = query?.toLowerCase();
        return library
          .symbols()
          .filter((s) => !category || s.category === category)
          .filter((s) => {
            if (!needle) return true;
            const names = typeof s.name === 'string' ? [s.name] : Object.values(s.name);
            return [s.id, s.function, s.letterCode ?? '', ...names].some((v) => v.toLowerCase().includes(needle));
          })
          .map((s) => symbolView(s, 'en'));
      }),
  );

  server.registerTool(
    'list_templates',
    { description: 'Device templates (e.g. relay.2co): the contacts a device provides, used for contact images.', inputSchema: {} },
    () => respond(() => library.templates()),
  );

  server.registerTool(
    'list_devices',
    {
      description: 'Devices (derived from symbols with the same tag) with their functions and where they are placed.',
      inputSchema: { query: z.string().optional().describe('Filter by tag or function text') },
    },
    ({ query }) => respond(() => session.run((doc) => devicesView(doc.state, library, doc.devices(), query))),
  );

  server.registerTool(
    'check_project',
    {
      description:
        'Problems in the project: devices with no or several main functions, open connections, potential conflicts, engineering checks, missing translations … Each has a `key`; issues the designer acknowledged (checked and intended) carry `acknowledged` and do not count.',
      inputSchema: {},
    },
    () => respond(() => session.run((doc) => doc.check().map((issue) => ({ key: issueKey(issue), ...issue })))),
  );

  server.registerTool(
    'acknowledge_issues',
    {
      description: 'Marks issues (by their `key` from check_project) as checked and intended, with a reason; they stay listed but no longer count. With undo: true the acknowledgement is taken back.',
      inputSchema: { keys: z.array(z.string()).min(1), note: z.string().optional(), undo: z.boolean().optional() },
    },
    ({ keys, note, undo }) =>
      respond(() =>
        session.run((doc) => {
          doc.apply(undo ? { type: 'unacknowledgeIssues', keys } : { type: 'acknowledgeIssues', keys, date: new Date().toISOString().slice(0, 10), ...(note ? { note } : {}) });
          return { acknowledged: doc.state.project.acknowledged ?? [] };
        }),
      ),
  );

  server.registerTool(
    'create_page',
    {
      description: 'Creates a schematic page.',
      inputSchema: {
        name: z.string().describe('Page name, e.g. "5"'),
        description: z.string().optional(),
        function: z.string().optional().describe('Structure "=" of the page, e.g. "SG"'),
        location: z.string().optional().describe('Structure "+" of the page, e.g. "10"'),
        index: z.int().min(0).optional().describe('Position in the page order; default: last'),
      },
    },
    (args) =>
      respond(() =>
        session.run((doc) => {
          const structure = { ...(args.function ? { function: args.function } : {}), ...(args.location ? { location: args.location } : {}) };
          const { created } = doc.apply({
            type: 'createPage',
            name: args.name,
            ...(args.description !== undefined ? { description: args.description } : {}),
            ...(Object.keys(structure).length > 0 ? { structure } : {}),
            ...(args.index !== undefined ? { index: args.index } : {}),
          });
          return pageRef(doc.state.pages[created[0]!]!);
        }),
      ),
  );

  server.registerTool(
    'create_report_page',
    {
      description: 'Creates a report page that is always up to date: titlePage (project name, description and properties), pageIndex (table of contents), structureOverview (functions and locations from the project settings), deviceIndex, bom, terminalList, terminalDiagram (strips drawn graphically), wireList, cableOverview, cableDiagram, plcIoList, mountingPlate (rails, ducts and devices of the cabinet layouts).',
      inputSchema: {
        name: z.string(),
        kind: z.enum(['titlePage', 'pageIndex', 'structureOverview', 'deviceIndex', 'bom', 'terminalList', 'wireList', 'cableOverview', 'cableDiagram', 'plcIoList', 'mountingPlate', 'terminalDiagram']),
        description: z.string().optional(),
        function: z.string().optional().describe('Structure "=" of the page, e.g. "DOC"'),
        index: z.int().min(0).optional(),
      },
    },
    (args) =>
      respond(() =>
        session.run((doc) => {
          const { created } = doc.apply({
            type: 'createReportPage',
            name: args.name,
            kind: args.kind,
            ...(args.description !== undefined ? { description: args.description } : {}),
            ...(args.function ? { structure: { function: args.function } } : {}),
            ...(args.index !== undefined ? { index: args.index } : {}),
          });
          return pageRef(doc.state.pages[created[0]!]!);
        }),
      ),
  );

  server.registerTool(
    'create_layout_page',
    {
      description: 'Creates a cabinet layout page: a mounting plate of plateWidth × plateHeight real mm, drawn at 1:scale in the frame. Give it the location of the cabinet (e.g. "CAB1"), so its devices are expected on it.',
      inputSchema: {
        name: z.string(),
        description: z.string().optional(),
        function: z.string().optional(),
        location: z.string().optional().describe('Structure "+" of the cabinet, e.g. "CAB1"'),
        plateWidth: z.number().positive(),
        plateHeight: z.number().positive(),
        scale: z.number().positive().describe('1:scale, e.g. 5 for a 600 × 800 plate on A3'),
        surface: z.enum(['plate', 'door']).optional().describe('door: the front of the enclosure door (pushbuttons, lamps, cutouts); default plate'),
        index: z.int().min(0).optional(),
      },
    },
    (args) =>
      respond(() =>
        session.run((doc) => {
          const structure = { ...(args.function ? { function: args.function } : {}), ...(args.location ? { location: args.location } : {}) };
          const { created } = doc.apply({
            type: 'createLayoutPage',
            name: args.name,
            ...(args.description !== undefined ? { description: args.description } : {}),
            ...(Object.keys(structure).length ? { structure } : {}),
            plate: { width: args.plateWidth, height: args.plateHeight },
            scale: args.scale,
            ...(args.surface ? { surface: args.surface } : {}),
            ...(args.index !== undefined ? { index: args.index } : {}),
          });
          return pageRef(doc.state.pages[created[0]!]!);
        }),
      ),
  );

  const layoutPosition = { x: z.number().describe('Left edge on the plate (real mm)'), y: z.number().describe('Top edge on the plate (real mm)') };
  server.registerTool(
    'place_layout_items',
    {
      description:
        'Adds DIN rails, wire ducts, cutouts (doors: HMI, fan) and devices to a cabinet layout page, or replaces items given with their id. Rails are 35 mm (TS35) or 15 mm (TS15) high, ducts `width` mm; both run along `length` (vertical when set). A device is given by its tag; its footprint comes from the parts database. Returns the page.',
      inputSchema: {
        page: pageArg,
        items: z
          .array(
            z.discriminatedUnion('kind', [
              z.object({ id: z.string().optional(), kind: z.literal('rail'), ...layoutPosition, length: z.number().positive(), vertical: z.boolean().optional(), profile: z.enum(['TS35', 'TS15']).optional() }),
              z.object({ id: z.string().optional(), kind: z.literal('duct'), ...layoutPosition, length: z.number().positive(), width: z.number().positive(), vertical: z.boolean().optional() }),
              z.object({
                id: z.string().optional(),
                kind: z.literal('device'),
                device: tagArg,
                ...layoutPosition,
                turned: z.boolean().optional().describe('Turned by 90°'),
                width: z.number().positive().optional().describe('Footprint when the part has no dimensions'),
                height: z.number().positive().optional(),
                shape: z.enum(['rect', 'round']).optional().describe('round: diameter = width (default on doors for devices without part dimensions, Ø 30 mm)'),
              }),
              z.object({ id: z.string().optional(), kind: z.literal('cutout'), ...layoutPosition, width: z.number().positive(), height: z.number().positive(), label: z.string().optional().describe('e.g. "HMI"') }),
            ]),
          )
          .min(1),
      },
    },
    ({ page, items }) =>
      respond(() =>
        session.run((doc) => {
          const target = resolveLayoutPage(doc.state, page);
          const index = doc.devices();
          const commands: Command[] = items.map((item) => {
            if (item.kind !== 'device') return { type: 'setLayoutItem', pageId: target.id, item };
            const { device, ...rest } = item;
            const key = formatTag({ ...(target.structure ?? {}), ...parseTagArg(device) });
            const found = index.devices.get(device) ?? index.devices.get(key);
            if (!found?.main) throw new ToolError(`Device "${device}" not found or without a main function (tried ${key})`);
            return { type: 'setLayoutItem', pageId: target.id, item: { ...rest, itemId: found.main.itemId } };
          });
          doc.apply(commands);
          return pageView(doc.state, doc.state.pages[target.id]!, doc.library, doc.devices());
        }),
      ),
  );

  server.registerTool(
    'move_layout_items',
    { description: 'Moves items of a cabinet layout page by dx/dy real mm.', inputSchema: { page: pageArg, items: z.array(z.string()).min(1).describe('Layout item IDs'), dx: z.number(), dy: z.number() } },
    ({ page, items, dx, dy }) =>
      respond(() =>
        session.run((doc) => {
          const pageId = resolveLayoutPage(doc.state, page).id;
          doc.apply({ type: 'moveLayoutItems', pageId, itemIds: items, dx, dy });
          return pageView(doc.state, doc.state.pages[pageId]!, doc.library, doc.devices());
        }),
      ),
  );

  server.registerTool(
    'delete_layout_items',
    { description: 'Removes rails, ducts or devices from a cabinet layout page (the devices stay in the schematic).', inputSchema: { page: pageArg, items: z.array(z.string()).min(1) } },
    ({ page, items }) =>
      respond(() =>
        session.run((doc) => {
          doc.apply({ type: 'deleteLayoutItems', pageId: resolveLayoutPage(doc.state, page).id, itemIds: items });
          return { deleted: items };
        }),
      ),
  );

  server.registerTool(
    'set_page',
    {
      description: 'Changes page name, description (display language), structure or properties (e.g. revision, date). Empty strings clear values.',
      inputSchema: {
        page: pageArg,
        name: z.string().optional(),
        description: z.string().optional(),
        function: z.string().optional(),
        location: z.string().optional(),
        properties: z.record(z.string(), z.string()).optional(),
      },
    },
    (args) =>
      respond(() =>
        session.run((doc) => {
          const page = resolvePage(doc.state, args.page);
          const language = doc.state.project.settings.displayLanguage;
          const clear = (v: string | undefined) => (v === undefined ? undefined : v === '' ? null : v);
          const structure = { function: clear(args.function), location: clear(args.location) };
          doc.apply({
            type: 'setPageProperties',
            pageId: page.id,
            ...(args.name ? { name: args.name } : {}),
            ...(args.description !== undefined
              ? { description: args.description === '' ? null : typeof page.description === 'object' ? { ...page.description, [language]: args.description } : { [language]: args.description } }
              : {}),
            ...(structure.function !== undefined || structure.location !== undefined ? { structure } : {}),
            ...(args.properties ? { properties: Object.fromEntries(Object.entries(args.properties).map(([k, v]) => [k, v === '' ? null : v])) } : {}),
          });
          return pageRef(doc.state.pages[page.id]!);
        }),
      ),
  );

  server.registerTool(
    'place_symbol',
    {
      description:
        'Places a symbol on a schematic page. Main functions (coils …) are named automatically (-5K3) unless a tag is given; they never join another device. A contact without a tag joins the device of the nearest device symbol to its left at the same height (same y); otherwise give the tag of its device. Inside a device box, symbols become functions of the box device. Returns the placed item with its connection points.',
      inputSchema: {
        page: pageArg,
        symbol: z.string().describe('Symbol ID from search_symbols'),
        x: z.int(),
        y: z.int(),
        rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
        mirror: z.boolean().optional(),
        tag: tagArg.optional(),
        functionText: z.string().optional().describe('Function text in the display language'),
        template: z.string().optional().describe('Device template for the main function, e.g. relay.2co'),
        width: z.int().min(1).optional().describe('Boxes; cable lines: horizontal length'),
        height: z.int().min(1).optional().describe('Boxes; cable lines: vertical length (instead of width)'),
        name: z.string().optional().describe('Name of an interruption point or potential point, e.g. "L1"'),
        props: z.record(z.string(), z.unknown()).optional().describe('Further item properties, e.g. {"terminal": "3", "bridge": "A"} for a terminal'),
      },
    },
    (args) =>
      respond(() =>
        session.run((doc) => {
          const page = resolveSchematicPage(doc.state, args.page);
          const props: Record<string, unknown> = { ...args.props };
          if (args.functionText !== undefined) props.functionText = { [doc.state.project.settings.displayLanguage]: args.functionText };
          if (args.name !== undefined) props.name = args.name;
          const { created } = doc.apply({
            type: 'placeSymbol',
            pageId: page.id,
            symbol: args.symbol,
            x: args.x,
            y: args.y,
            ...(args.rotation !== undefined ? { rotation: args.rotation } : {}),
            ...(args.mirror !== undefined ? { mirror: args.mirror } : {}),
            ...(args.tag !== undefined ? { tag: parseTagArg(args.tag) } : {}),
            ...(args.template !== undefined ? { template: args.template } : {}),
            ...(args.width !== undefined ? { width: args.width } : {}),
            ...(args.height !== undefined ? { height: args.height } : {}),
            ...(Object.keys(props).length > 0 ? { props } : {}),
          });
          return placedItem(doc, page.id, created[0]!);
        }),
      ),
  );

  server.registerTool(
    'draw_current_path',
    {
      description:
        'Lays out a vertical current path in one column: an optional potential point at the top (e.g. "24V"), the given symbols from top to bottom with their up and down pins on one line, and an optional potential point at the bottom (e.g. "0V"). Neighbours face each other, so autoconnect wires them. Elements need a pin facing up and one facing down (contacts, coils, lamps, terminals …). Returns the placed items; check the result with render_page or check_project.',
      inputSchema: {
        page: pageArg,
        column: z.int().min(1).optional().describe('Column of the page (1 = leftmost); the path runs through its middle'),
        x: z.int().optional().describe('x of the path instead of a column (4 mm grid)'),
        y: z.int().optional().describe('y of the top end; default just inside the drawing area'),
        top: z.string().optional().describe('Potential at the top, e.g. "24V" or "L1"'),
        bottom: z.string().optional().describe('Potential at the bottom, e.g. "0V" or "N"'),
        gap: z.int().min(4).optional().describe('Wire length between symbols in mm (default 8)'),
        elements: z
          .array(
            z.object({
              symbol: z.string(),
              tag: z.string().optional().describe('e.g. "-K1"; contacts: the tag of their coil'),
              functionText: z.string().optional(),
              template: z.string().optional().describe('Device template for a main function, e.g. relay.2co'),
              props: z.record(z.string(), z.unknown()).optional(),
            }),
          )
          .min(1),
      },
    },
    (args) =>
      respond(() =>
        session.run((doc) => {
          const page = resolveSchematicPage(doc.state, args.page);
          const frame = doc.library.frame(page.frame ?? doc.state.project.settings.defaultFrame);
          let x = args.x;
          if (x === undefined) {
            if (args.column === undefined || !frame) throw new ToolError('Give column or x');
            const { columns } = frame;
            if (args.column > columns.count) throw new ToolError(`The frame has ${columns.count} columns`);
            x = Math.round((columns.x + columns.width * (args.column - 0.5)) / 4) * 4;
          }
          const language = doc.state.project.settings.displayLanguage;
          let commands;
          try {
            commands = currentPathCommands(doc.state, doc.library, {
              pageId: page.id,
              x,
              ...(args.y !== undefined ? { y: args.y } : {}),
              ...(args.top ? { top: args.top } : {}),
              ...(args.bottom ? { bottom: args.bottom } : {}),
              ...(args.gap ? { gap: args.gap } : {}),
              elements: args.elements.map((e) => ({
                symbol: e.symbol,
                ...(e.tag ? { tag: parseTagArg(e.tag) } : {}),
                ...(e.template ? { template: e.template } : {}),
                ...(e.functionText || e.props ? { props: { ...e.props, ...(e.functionText ? { functionText: { [language]: e.functionText } } : {}) } } : {}),
              })),
            });
          } catch (error) {
            throw new ToolError((error as Error).message);
          }
          const { created } = doc.apply(commands);
          const open = doc.check().filter((i) => i.code === 'connection.open' && i.itemId && created.includes(i.itemId));
          return { x, items: created.map((id) => placedItem(doc, page.id, id)), openConnections: open.map((i) => i.message) };
        }),
      ),
  );

  server.registerTool(
    'connect_pins',
    {
      description:
        'Joins two pins of a page that are not on one line, with corner symbols: one corner (L route) when one pin points horizontally and the other vertically, two corners (Z route, turning halfway) when both point the same way. Each pin must point towards the route. Pins on one line that face each other are joined by autoconnect already.',
      inputSchema: {
        page: pageArg,
        from: z.object({ item: z.string(), pin: z.string() }),
        to: z.object({ item: z.string(), pin: z.string() }),
      },
    },
    (args) =>
      respond(() =>
        session.run((doc) => {
          const page = resolveSchematicPage(doc.state, args.page);
          let commands;
          try {
            commands = connectPinsCommands(doc.connectivity(), page.id, { itemId: args.from.item, pin: args.from.pin }, { itemId: args.to.item, pin: args.to.pin });
          } catch (error) {
            throw new ToolError((error as Error).message);
          }
          const created = commands.length > 0 ? doc.apply(commands).created : [];
          const net = (key: string) => doc.connectivity().netOf.get(key);
          return {
            corners: created.map((id) => placedItem(doc, page.id, id)),
            connected: net(`${args.from.item}:${args.from.pin}`) !== undefined && net(`${args.from.item}:${args.from.pin}`) === net(`${args.to.item}:${args.to.pin}`),
          };
        }),
      ),
  );

  /** Snapshot files of revisions live in the project folder (both modes). */
  const revisionFiles = (): ProjectStorage => {
    if (options.storage) return options.storage;
    if (!session.root) throw new ToolError('Revisions need a project folder');
    return new NodeProjectStorage(session.root);
  };

  server.registerTool(
    'create_revision',
    {
      description:
        'Releases a revision (e.g. "A", default: the next letter): pages changed since the previous revision (all for the first) get its name and date in their title block, and the project state is kept as revisions/<name>.json for comparing.',
      inputSchema: { name: z.string().optional(), date: z.string().optional().describe('YYYY-MM-DD, default today'), author: z.string().optional(), description: z.string().optional() },
    },
    (args) =>
      respond(async () => {
        const files = revisionFiles();
        const current = await session.run((doc) => doc.state);
        const previousName = current.project.revisions?.at(-1)?.name;
        const previous = previousName ? await loadRevisionSnapshot(files, previousName) : undefined;
        const released = await session.run((doc) => {
          const name = args.name ?? nextRevisionName(doc.state.project.revisions ?? []);
          const pageIds = pagesForRevision(previous, doc.state);
          doc.apply({
            type: 'addRevision',
            revision: { name, date: args.date ?? new Date().toISOString().slice(0, 10), ...(args.author ? { author: args.author } : {}), ...(args.description ? { description: args.description } : {}) },
            pageIds,
          });
          return { name, state: doc.state, pages: pageIds.map((id) => pageFullName(doc.state.pages[id]!)) };
        });
        await saveRevisionSnapshot(files, released.name, released.state);
        return { revision: released.name, markedPages: released.pages };
      }),
  );

  server.registerTool(
    'get_changes',
    {
      description: 'What changed since a revision (default: the last one): new, changed and deleted pages, and per page the added, changed and removed items with their tags.',
      inputSchema: { since: z.string().optional() },
    },
    (args) =>
      respond(async () => {
        const files = revisionFiles();
        const current = await session.run((doc) => doc.state);
        const name = args.since ?? current.project.revisions?.at(-1)?.name;
        if (!name) throw new ToolError('No revision released yet (create_revision)');
        const before = await loadRevisionSnapshot(files, name);
        if (!before) throw new ToolError(`The snapshot of revision ${name} is missing`);
        return session.run((doc) => {
          const changes = compareProjects(before, doc.state);
          const tag = (pageId: string, id: string) => doc.devices().byItem.get(id) ?? id;
          return {
            since: name,
            newPages: changes.addedPages.map((id) => pageFullName(doc.state.pages[id]!)),
            deletedPages: changes.removedPages.map((p) => pageFullName(p)),
            changedPages: changes.changedPages.map((id) => {
              const items = changes.items.get(id);
              return {
                page: pageFullName(doc.state.pages[id]!),
                ...(items ? { added: items.added.map((i) => tag(id, i)), changed: items.changed.map((i) => tag(id, i)), removed: items.removed.map((i) => `${i.symbol} at (${i.x}, ${i.y})`) } : {}),
              };
            }),
            projectData: changes.project,
          };
        });
      }),
  );

  server.registerTool(
    'move_items',
    {
      description: 'Moves items by dx/dy mm. Moving a box moves its contents. Moving a main function into or out of a structure box renames its device.',
      inputSchema: { page: pageArg, items: z.array(z.string()).min(1).describe('Item IDs'), dx: z.int(), dy: z.int() },
    },
    ({ page, items, dx, dy }) =>
      respond(() =>
        session.run((doc) => {
          const pageId = resolveSchematicPage(doc.state, page).id;
          doc.apply({ type: 'moveItems', pageId, itemIds: items, dx, dy });
          return items.map((id) => placedItem(doc, pageId, id));
        }),
      ),
  );

  server.registerTool(
    'delete_items',
    { description: 'Deletes items from a page.', inputSchema: { page: pageArg, items: z.array(z.string()).min(1) } },
    ({ page, items }) =>
      respond(() =>
        session.run((doc) => {
          doc.apply({ type: 'deleteItems', pageId: resolveSchematicPage(doc.state, page).id, itemIds: items });
          return { deleted: items };
        }),
      ),
  );

  server.registerTool(
    'set_tag',
    {
      description:
        'Sets the tag of an item, relative to its page and boxes (aspects left out are inherited). On a main function this renames the whole device and its contacts follow; on a contact it moves the contact to another device.',
      inputSchema: { page: pageArg, item: z.string(), tag: tagArg },
    },
    ({ page, item, tag }) =>
      respond(() =>
        session.run((doc) => {
          const pageId = resolveSchematicPage(doc.state, page).id;
          const parsed = parseTagArg(tag);
          doc.apply({
            type: 'setItemTag',
            pageId,
            itemId: item,
            tag: { function: parsed.function ?? null, location: parsed.location ?? null, product: parsed.product ?? null },
          });
          return placedItem(doc, pageId, item);
        }),
      ),
  );

  server.registerTool(
    'set_properties',
    {
      description: 'Sets item properties. Keys of props are merged; null removes a key. Device data (parts, technicalData, contacts) belongs on the main function.',
      inputSchema: {
        page: pageArg,
        item: z.string(),
        functionText: z.string().optional().describe('Function text in the display language'),
        props: z.record(z.string(), z.unknown()).optional(),
        pins: z.record(z.string(), z.string().nullable()).optional().describe('Connection designations by pin ID, e.g. {"1": "23", "2": "24"}'),
      },
    },
    (args) =>
      respond(() =>
        session.run((doc) => {
          const page = resolveSchematicPage(doc.state, args.page);
          const props: Record<string, unknown> = { ...args.props };
          if (args.functionText !== undefined) {
            const current = page.items.find((i) => i.id === args.item)?.props?.functionText;
            const language = doc.state.project.settings.displayLanguage;
            props.functionText = typeof current === 'object' ? { ...current, [language]: args.functionText } : { [language]: args.functionText };
          }
          doc.apply({
            type: 'setItemProperties',
            pageId: page.id,
            itemId: args.item,
            ...(Object.keys(props).length > 0 ? { props } : {}),
            ...(args.pins ? { pins: args.pins } : {}),
          });
          return placedItem(doc, page.id, args.item);
        }),
      ),
  );

  server.registerTool(
    'rename_device',
    { description: 'Renames a device: all its functions get the new tag.', inputSchema: { device: tagArg.describe('Current full tag'), to: tagArg.describe('New full tag') } },
    ({ device, to }) =>
      respond(() =>
        session.run((doc) => {
          doc.apply({ type: 'renameDevice', device, to });
          return devicesView(doc.state, library, doc.devices(), parseTag(to).product);
        }),
      ),
  );

  server.registerTool(
    'renumber_devices',
    {
      description:
        'Renames devices by the current page and column of their main function (-5K3, -5K3.1 …). With dryRun the changes (before → after) are only listed; excluded devices keep their names.',
      inputSchema: {
        pages: z.array(pageArg).optional(),
        exclude: z.array(z.string()).optional().describe('Full tags of devices that keep their names, e.g. ["=FB+CAB1-K99"]'),
        dryRun: z.boolean().optional(),
      },
    },
    ({ pages, exclude, dryRun }) =>
      respond(() =>
        session.run((doc) => {
          const pageIds = pages?.map((p) => resolveSchematicPage(doc.state, p).id);
          const options = { ...(pageIds ? { pageIds } : {}), ...(exclude ? { exclude } : {}) };
          const changes = planRenumbering(doc.state, doc.library, options).map((c) => ({ from: c.from, to: c.to }));
          if (!dryRun && changes.length > 0) doc.apply({ type: 'renumberDevices', ...options });
          return changes;
        }),
      ),
  );

  server.registerTool(
    'apply_commands',
    {
      description:
        'Applies several core commands as one atomic step: if one fails, nothing changes. Commands use page and item IDs; create commands accept an "id" so later commands can refer to it (IDs look like "p_abc123", "i_abc123"). Command types: ' +
        commandSchema.options.map((o) => o.shape.type.value).join(', '),
      inputSchema: { commands: z.array(commandSchema).min(1) },
    },
    ({ commands }) =>
      respond(() =>
        session.run((doc) => {
          const result = doc.apply(commands as Command[]);
          return { applied: commands.length, ...result };
        }),
      ),
  );

  // -------------------------------------------------------------------------
  // Device library

  server.registerTool(
    'search_parts',
    {
      description: 'Searches the parts database (manufacturer, part number, description, ERP number): prices, currency, suppliers. Devices refer to parts by manufacturer and part number in their parts.',
      inputSchema: { query: z.string().optional() },
    },
    ({ query }) =>
      respond(() =>
        session.run((doc) => {
          const q = (query ?? '').trim().toLowerCase();
          const { languages, displayLanguage } = doc.state.project.settings;
          return doc.library
            .parts()
            .filter((p) => `${p.manufacturer} ${p.partNumber} ${localize(p.description, displayLanguage, languages)} ${p.erpNumber ?? ''}`.toLowerCase().includes(q))
            .slice(0, 100);
        }),
      ),
  );

  server.registerTool(
    'import_parts',
    {
      description:
        "Imports parts into the project's parts database from a manufacturer or wholesaler catalog (BMEcat 1.2/2005 with ECLASS or ETIM features, .xml or zipped) or an ERP table (CSV, .xlsx). Existing parts are merged (ERP numbers and other suppliers stay). Catalog features fill width/height/depth (cabinet layout) and ratedVoltage/ratedCurrent (engineering checks): recognized by name or ETIM code, others can be assigned with `mapping` (feature code or name → field). With dryRun: true only lists the products and features with their fields.",
      inputSchema: {
        path: z.string().describe('File to read (absolute, or relative to the project folder)'),
        mapping: z.record(z.string(), z.enum(['width', 'height', 'depth', 'ratedVoltage', 'ratedCurrent', 'property', 'ignore'])).optional(),
        dryRun: z.boolean().optional(),
      },
    },
    async (args) => {
      let data: Uint8Array;
      try {
        data = new Uint8Array(await readFile(resolve(session.root ?? process.cwd(), args.path)));
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: `Cannot read ${args.path}: ${(error as Error).message}` }] };
      }
      return respond(() =>
        session.run((doc) => {
          const language = doc.state.project.settings.displayLanguage;
          const catalog = isBmecat(data) ? readBmecat(data) : undefined;
          const imported = catalog ? catalogParts(catalog, args.mapping) : readPartsTable(data, language);
          const features = catalog ? catalogFeatures(catalog, args.mapping).slice(0, 60).map((f) => ({ feature: f.key, ...(f.name ? { name: f.name } : {}), example: `${f.example}${f.unit ? ` ${f.unit}` : ''}`, products: f.count, field: f.target ?? 'property' })) : undefined;
          if (!args.dryRun && imported.length > 0) doc.apply({ type: 'addToProjectLibrary', content: { parts: imported.map((p) => mergePart(doc.library.part(p.id), p)) } });
          return {
            imported: args.dryRun ? 0 : imported.length,
            ...(catalog ? { catalog: { supplier: catalog.supplier, version: catalog.version, products: catalog.products.length }, features } : {}),
            examples: imported.slice(0, 5),
          };
        }),
      );
    },
  );

  server.registerTool(
    'set_part',
    {
      description: "Adds or replaces a part in the project's parts database (library.json). The bill of materials takes description, price, supplier and ERP number from it, the cabinet layout width and height.",
      inputSchema: {
        manufacturer: z.string(),
        partNumber: z.string(),
        description: z.string().optional().describe('In the display language'),
        orderNumber: z.string().optional(),
        ean: z.string().optional(),
        erpNumber: z.string().optional(),
        unit: z.string().optional(),
        price: z.number().nonnegative().optional(),
        currency: z.string().optional(),
        priceUnit: z.number().positive().optional(),
        suppliers: z.array(z.object({ name: z.string(), orderNumber: z.string().optional(), price: z.number().optional(), currency: z.string().optional(), deliveryDays: z.int().min(0).optional() })).optional(),
        url: z.string().optional(),
        width: z.number().positive().optional().describe('Outer width in mm (footprint on the mounting plate)'),
        height: z.number().positive().optional().describe('Outer height in mm (footprint on the mounting plate)'),
        depth: z.number().positive().optional().describe('Outer depth in mm'),
        ratedVoltage: z.string().optional().describe('Rated (coil) voltage, e.g. "24 V DC" (checked against the potentials)'),
        ratedCurrent: z.number().positive().optional().describe('Rated current in A of a breaker or fuse (checked against wire cross-sections)'),
      },
    },
    (args) =>
      respond(() =>
        session.run((doc) => {
          const { description, ...rest } = args;
          const part = Object.fromEntries(
            Object.entries({
              id: partId(args.manufacturer, args.partNumber),
              ...rest,
              ...(description ? { description: { [doc.state.project.settings.displayLanguage]: description } } : {}),
            }).filter(([, v]) => v !== undefined),
          ) as unknown as PartDefinition;
          doc.apply({ type: 'addToProjectLibrary', content: { parts: [part] } });
          return doc.library.part(part.id);
        }),
      ),
  );

  server.registerTool(
    'list_device_definitions',
    {
      description:
        'Device definitions of the library: devices as bought (relays, contactors, PLC I/O modules of WAGO 750, Beckhoff EtherCAT terminals, Siemens ET 200SP and S7-1500/ET 200MP, CPUs, controllers, couplers …) with all their symbols (functions). Place them with place_device_function. Words in query must all match (ID, name, manufacturer, part number, category).',
      inputSchema: { query: z.string().optional().describe('Filter by ID, name, manufacturer or part number') },
    },
    ({ query }) =>
      respond(() =>
        session.run((doc) => {
          const words = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
          const found = doc.library
            .devices()
            .filter((d) => words.every((w) => [d.id, d.manufacturer ?? '', d.partNumber ?? '', d.category ?? '', ...(typeof d.name === 'string' ? [d.name] : Object.values(d.name))].some((v) => v.toLowerCase().includes(w))));
          // Many matches: a compact list to narrow down; few: with functions and channels.
          if (found.length > 20) {
            return { count: found.length, note: 'Narrow down with query (e.g. "750-430", "EL1008", "ET 200SP DI", "CPU 1515") to see functions and channels.', devices: found.map((d) => ({ id: d.id, name: d.name, category: d.category })) };
          }
          return found.map((d) => ({
              id: d.id,
              name: d.name,
              manufacturer: d.manufacturer,
              partNumber: d.partNumber,
              functions: d.functions.map((_, i) => ({ function: i + 1, label: functionLabel(d, i, doc.library, 'en'), main: d.functions[i]!.main ?? i === 0 })),
              ...(d.plc ? { channels: d.plc.channels } : {}),
            }));
        }),
      ),
  );

  server.registerTool(
    'place_device_function',
    {
      description:
        'Places one function (symbol) of a device definition, e.g. function 1 = the card overview or coil, function 3 = DI 2 or a contact. Place the main function first (it is named automatically), then the others with the tag of that device. The definition is copied into the project library.',
      inputSchema: {
        page: pageArg,
        device: z.string().describe('Device definition ID from list_device_definitions'),
        function: z.int().min(1).describe('1-based function number'),
        x: z.int(),
        y: z.int(),
        tag: tagArg.optional().describe('Tag of the device when placing further functions, e.g. "-4A1"'),
        rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
      },
    },
    (args) =>
      respond(() =>
        session.run((doc) => {
          const page = resolveSchematicPage(doc.state, args.page);
          const def = doc.library.device(args.device);
          if (!def) throw new ToolError(`Unknown device definition "${args.device}". Use list_device_definitions.`);
          if (!def.functions[args.function - 1]) throw new ToolError(`${def.id} has ${def.functions.length} functions`);
          const command = placeFunctionCommand(def, args.function - 1, doc.library, {
            pageId: page.id,
            x: args.x,
            y: args.y,
            ...(args.rotation !== undefined ? { rotation: args.rotation } : {}),
            ...(args.tag ? { tag: parseTagArg(args.tag) } : {}),
          });
          const inProject = doc.state.library?.devices?.some((d) => d.id === def.id);
          const { created } = doc.apply(inProject ? [command] : [{ type: 'addToProjectLibrary', content: { devices: [def] } }, command]);
          return placedItem(doc, page.id, created[0]!);
        }),
      ),
  );

  // -------------------------------------------------------------------------
  // PLC

  const addressArg = z.string().describe('Address in the PLC notation: Siemens "I4.0"/"E4.0", Codesys "%IX4.0"/"%IW32", Mitsubishi "X40"');
  const startArg = z.object({ DI: addressArg.optional(), DO: addressArg.optional(), AI: addressArg.optional(), AO: addressArg.optional() });

  server.registerTool(
    'set_plc',
    {
      description: 'Creates or changes a PLC station. Families: siemens (mnemonic international I/Q or german E/A), codesys, mitsubishi (series fx = octal X/Y, iqr = hex X/Y).',
      inputSchema: {
        name: z.string(),
        family: z.enum(['siemens', 'codesys', 'mitsubishi']),
        mitsubishiSeries: z.enum(['fx', 'iqr']).optional(),
        mnemonic: z.enum(['international', 'german']).optional(),
        description: z.string().optional(),
        firstAddress: startArg.optional().describe('First addresses for numbering'),
        remove: z.boolean().optional().describe('Delete this PLC instead'),
      },
    },
    (args) =>
      respond(() =>
        session.run((doc) => {
          const others = doc.state.project.plcs.filter((p) => p.name !== args.name);
          if (args.remove) {
            doc.apply({ type: 'setPlcs', plcs: others });
            return others;
          }
          const station: PlcStation = {
            name: args.name,
            family: args.family,
            ...(args.mitsubishiSeries ? { mitsubishiSeries: args.mitsubishiSeries } : {}),
            ...(args.mnemonic ? { mnemonic: args.mnemonic } : {}),
            ...(args.description ? { description: { [doc.state.project.settings.displayLanguage]: args.description } } : {}),
          };
          if (args.firstAddress) station.firstAddress = parseStarts(station, args.firstAddress);
          const index = doc.state.project.plcs.findIndex((p) => p.name === args.name);
          const plcs = [...doc.state.project.plcs];
          if (index >= 0) plcs[index] = station;
          else plcs.push(station);
          doc.apply({ type: 'setPlcs', plcs });
          return station;
        }),
      ),
  );

  server.registerTool(
    'set_card',
    {
      description: 'Assigns an I/O card (its card overview / main item) to a PLC, with slot and start addresses.',
      inputSchema: { page: pageArg, item: z.string().describe('Item ID of the card master'), plc: z.string().optional(), slot: z.int().optional(), start: startArg.optional() },
    },
    (args) =>
      respond(() =>
        session.run((doc) => {
          const page = resolveSchematicPage(doc.state, args.page);
          const item = page.items.find((i) => i.id === args.item);
          const plc = item?.props?.plc;
          if (!item || !plc) throw new ToolError(`Item "${args.item}" is not an I/O card with channels`);
          const stationName = args.plc ?? plc.station;
          const station = doc.state.project.plcs.find((p) => p.name === stationName);
          if (stationName && !station) throw new ToolError(`PLC "${stationName}" is not defined; create it with set_plc`);
          const next = {
            ...plc,
            ...(stationName ? { station: stationName } : {}),
            ...(args.slot !== undefined ? { slot: args.slot } : {}),
            ...(args.start && station ? { start: { ...plc.start, ...parseStarts(station, args.start) } } : {}),
          };
          doc.apply({ type: 'setItemProperties', pageId: page.id, itemId: item.id, props: { plc: next } });
          return placedItem(doc, page.id, item.id);
        }),
      ),
  );

  server.registerTool(
    'add_plc_card',
    {
      description:
        'Adds an I/O card from the device library (list_device_definitions) to the project, without drawing it: it appears in the PLC tab. Draw it with place_plc_card, or let generate_plc_overview draw all cards not drawn yet.',
      inputSchema: {
        device: z.string().describe('Device definition ID, e.g. "wago.750-430" (I/O card, CPU or coupler)'),
        tag: tagArg.optional().describe('Full tag of the card, e.g. "=FB+CAB1-A10"; default: the next free -A<n> beside the PLC\'s other cards'),
        plc: z.string().optional(),
        slot: z.int().min(0).optional().describe('Default: the PLC\'s next slot'),
      },
    },
    (args) =>
      respond(() =>
        session.run((doc) => {
          if (args.plc && !doc.state.project.plcs.some((p) => p.name === args.plc)) throw new ToolError(`PLC "${args.plc}" is not defined; create it with set_plc`);
          const { created } = doc.apply({ type: 'addPlcCard', device: args.device, ...(args.tag ? { tag: parseTagArg(args.tag) } : {}), ...(args.plc ? { station: args.plc } : {}), ...(args.slot !== undefined ? { slot: args.slot } : {}) });
          const card = doc.plc().byCard.get(created[0]!)!;
          return { item: card.itemId, device: card.device, slot: card.slot, drawn: false, channels: card.channels.map((c) => ({ channel: channelLabel(c.channel), pin: c.channel.pin, address: c.address })) };
        }),
      ),
  );

  server.registerTool(
    'place_plc_card',
    {
      description: 'Draws a card of the project (by tag or item ID) at a point of a page: a card not drawn yet moves there; a drawn card gets a further drawing (reported as a warning).',
      inputSchema: { card: z.string().describe('Card tag ("-A10", "=FB+CAB1-A10") or item ID'), page: pageArg, x: z.int(), y: z.int() },
    },
    (args) =>
      respond(() =>
        session.run((doc) => {
          const pageId = resolveSchematicPage(doc.state, args.page).id;
          const cards = doc.plc().cards;
          const card = cards.find((c) => c.itemId === args.card || c.device === args.card) ?? cards.find((c) => c.device.endsWith(args.card));
          if (!card) throw new ToolError(`PLC card "${args.card}" not found. Cards: ${cards.map((c) => c.device).join(', ') || '(none)'}`);
          const { created } = doc.apply({ type: 'placePlcCard', itemId: card.itemId, pageId, x: args.x, y: args.y });
          return placedItem(doc, pageId, created[0]!);
        }),
      ),
  );

  server.registerTool(
    'number_plc_addresses',
    {
      description: 'Numbers the start addresses of I/O cards per PLC in slot order: all cards, only cards without address, or the given cards.',
      inputSchema: {
        plc: z.string().optional(),
        devices: z.array(tagArg).optional().describe('Card tags'),
        onlyMissing: z.boolean().optional(),
        step: z.int().min(1).optional().describe('Distance between card start addresses (bytes; Mitsubishi: points), e.g. 10 for I0.0, I10.0, I20.0'),
      },
    },
    (args) =>
      respond(() =>
        session.run((doc) => {
          doc.apply({ type: 'assignPlcAddresses', ...(args.plc ? { station: args.plc } : {}), ...(args.devices ? { devices: args.devices } : {}), ...(args.onlyMissing ? { onlyMissing: true } : {}), ...(args.step ? { step: args.step } : {}) });
          return doc.plc().cards.map((c) => ({ card: c.device, plc: c.station?.name, slot: c.slot, first: c.channels[0]?.address, last: c.channels.at(-1)?.address }));
        }),
      ),
  );

  server.registerTool(
    'generate_plc_overview',
    {
      description:
        'Creates overview pages of a PLC: a view of each of its I/O cards in slot order, packed in columns. Run again later, it only adds cards that are not on its overview pages yet (existing views and their wiring stay).',
      inputSchema: {
        plc: z.string(),
        function: z.string().optional().describe('Structure "=" of the new pages; default: that of the first card'),
        location: z.string().optional().describe('Structure "+" of the new pages'),
      },
    },
    (args) =>
      respond(() =>
        session.run((doc) => {
          const structure = { ...(args.function ? { function: args.function } : {}), ...(args.location ? { location: args.location } : {}) };
          const { created } = doc.apply({ type: 'generatePlcOverview', station: args.plc, ...(Object.keys(structure).length > 0 ? { structure } : {}) });
          const pages = created.flatMap((id) => (doc.state.pages[id] ? [pageRef(doc.state.pages[id])] : []));
          return pages.length > 0 ? { pages } : { pages, note: 'All cards are already on the overview pages.' };
        }),
      ),
  );

  server.registerTool(
    'import_plc_tags',
    {
      description:
        'Takes tag names (and with comments: true, comments as channel functions) from a PLC project export back into the channels of a PLC, matched by address. Reads a TIA Portal tag table (.xlsx), a Codesys GVL, GX Works3 global labels or an I/O list CSV. Without apply: true it only lists the changes.',
      inputSchema: {
        plc: z.string(),
        path: z.string().optional().describe('File to read (absolute, or relative to the project folder)'),
        content: z.string().optional().describe('Text content instead of a file (GVL, CSV)'),
        comments: z.boolean().optional(),
        language: z.string().optional().describe('Language of the comments; default: the display language'),
        apply: z.boolean().optional(),
      },
    },
    async (args) => {
      const fail = (text: string): CallToolResult => ({ isError: true, content: [{ type: 'text', text }] });
      let data: string | Uint8Array | undefined = args.content;
      if (data === undefined && args.path) {
        // Relative paths start in the project folder.
        const root = session.root ?? process.cwd();
        try {
          data = new Uint8Array(await readFile(resolve(root, args.path)));
        } catch (error) {
          return fail(`Cannot read ${args.path}: ${(error as Error).message}`);
        }
      }
      if (data === undefined) return fail('Give path or content');
      const content = data;
      return respond(() =>
        session.run((doc) => {
          const language = args.language ?? doc.state.project.settings.displayLanguage;
          const plan = planPlcTagImport(doc.state, doc.plc(), args.plc, readPlcTags(content), { comments: args.comments === true, language });
          if (args.apply && plan.changes.length > 0) doc.apply(plcTagImportCommands(doc.state, plan.changes, language));
          return {
            applied: args.apply === true,
            changes: plan.changes.map((c) => ({ card: c.card, channel: c.channel, address: c.address, ...(c.name ? { name: c.name } : {}), ...(c.comment ? { function: c.comment } : {}) })),
            unchanged: plan.unchanged,
            unmatched: plan.unmatched,
          };
        }),
      );
    },
  );

  server.registerTool(
    'get_io_list',
    { description: 'All I/O channels (of one PLC): card, channel, pin, address, tag name, function and where the channel is drawn.', inputSchema: { plc: z.string().optional() } },
    ({ plc }) => respond(() => session.run((doc) => plcIoRows(doc.reportContext(), plc))),
  );

  server.registerTool(
    'export_plc',
    {
      description: 'Exports the I/O of a PLC: csv (I/O list), tia (TIA Portal tag table .xlsx, Siemens), codesys (GVL), gxworks3 (global labels, Mitsubishi).',
      inputSchema: { plc: z.string(), format: z.enum(['csv', 'tia', 'codesys', 'gxworks3']), language: z.string().optional() },
    },
    async ({ plc, format, language }) => {
      try {
        const file = await session.run((doc) => exportPlc(doc.reportContext(), plc, format, language ?? doc.state.project.settings.displayLanguage));
        if (typeof file.content === 'string') return { content: [{ type: 'text', text: file.content }] };
        return {
          content: [
            { type: 'text', text: `${file.fileName} (${file.content.length} bytes)` },
            { type: 'resource', resource: { uri: `file:///${encodeURIComponent(file.fileName)}`, mimeType: file.mimeType, blob: Buffer.from(file.content).toString('base64') } },
          ],
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: (error as Error).message }] };
      }
    },
  );

  // -------------------------------------------------------------------------
  // Cables and wires

  server.registerTool(
    'set_cable',
    {
      description:
        'Sets the data of a cable (its first definition line, symbol wirewright.cable placed across the conductors with width or height as length). With a type like "5G1.5" or "7x0.75" the cores are generated (numbered or HD 308 colors).',
      inputSchema: {
        page: pageArg,
        item: z.string(),
        type: z.string().optional(),
        identification: z.enum(['numbers', 'colors', 'both']).optional(),
        crossSection: z.number().positive().optional(),
        outerDiameterMm: z.number().positive().optional(),
        lengthM: z.number().positive().optional(),
        shield: z.boolean().optional(),
      },
    },
    (args) =>
      respond(() =>
        session.run((doc) => {
          const page = resolveSchematicPage(doc.state, args.page);
          const item = page.items.find((i) => i.id === args.item);
          if (!item || doc.library.symbol(item.symbol)?.generator !== 'cable') throw new ToolError(`Item "${args.item}" is not a cable definition line`);
          const cable = { cores: [], ...item.props?.cable } as NonNullable<NonNullable<typeof item.props>['cable']>;
          if (args.type !== undefined) {
            cable.type = args.type;
            const generated = coresFromType(args.type, args.identification ?? 'numbers');
            if (generated) {
              cable.cores = generated.cores;
              cable.crossSection = generated.crossSection;
              cable.coreIdentification = args.identification ?? 'numbers';
            }
          }
          if (args.crossSection !== undefined) cable.crossSection = args.crossSection;
          if (args.outerDiameterMm !== undefined) cable.outerDiameterMm = args.outerDiameterMm;
          if (args.lengthM !== undefined) cable.lengthM = args.lengthM;
          if (args.shield !== undefined) cable.shield = args.shield;
          doc.apply({ type: 'setItemProperties', pageId: page.id, itemId: item.id, props: { cable } });
          return cablesView(doc);
        }),
      ),
  );

  server.registerTool(
    'get_cables',
    { description: 'Cables with type and their cores: which wire (number, connected pins) each core carries, spare cores.', inputSchema: {} },
    () => respond(() => session.run((doc) => cablesView(doc))),
  );

  server.registerTool(
    'get_wires',
    { description: 'All wires (conductors): number, connected pins, color, cross-section, potential, cable core.', inputSchema: {} },
    () => respond(() => session.run((doc) => doc.wires().wires.map(({ net: _net, markers: _markers, ...w }) => w))),
  );

  server.registerTool(
    'number_wires',
    {
      description:
        'Writes wire numbers ({page}.{column}.{counter}) into the wire markers (symbol wirewright.connection.definition placed on a connection line). Wires without a marker are numbered in the wire list only.',
      inputSchema: { pages: z.array(pageArg).optional(), onlyMissing: z.boolean().optional() },
    },
    ({ pages, onlyMissing }) =>
      respond(() =>
        session.run((doc) => {
          const pageIds = pages?.map((p) => resolveSchematicPage(doc.state, p).id);
          doc.apply({ type: 'numberWires', ...(pageIds ? { pageIds } : {}), ...(onlyMissing ? { onlyMissing } : {}) });
          return doc.wires().wires.filter((w) => w.markers.length > 0).map((w) => ({ number: w.number, ends: w.ends }));
        }),
      ),
  );

  server.registerTool(
    'list_macros',
    {
      description:
        'Macros of the library: reusable pieces of circuit (e.g. start/stop with self-holding contact). Place them with place_macro; save your own with save_macro.',
      inputSchema: { query: z.string().optional().describe('Filter by ID, name or category') },
    },
    ({ query }) =>
      respond(() =>
        session.run((doc) => {
          const needle = query?.toLowerCase();
          return doc.library
            .macros()
            .filter((m) => !needle || [m.id, m.category ?? '', ...(typeof m.name === 'string' ? [m.name] : Object.values(m.name))].some((v) => v.toLowerCase().includes(needle)))
            .map((m) => ({
              id: m.id,
              name: m.name,
              description: m.description,
              category: m.category,
              items: m.items.length,
              width: Math.max(...m.items.map((i) => i.x + (i.width ?? 0))),
              height: Math.max(...m.items.map((i) => i.y + (i.height ?? 0))),
            }));
        }),
      ),
  );

  server.registerTool(
    'place_macro',
    {
      description:
        'Places a macro so that its top-left item lands on (x, y). Its devices get new names by page and column; contacts follow their coil; contacts of devices outside the macro keep their tag. Returns the placed items.',
      inputSchema: {
        page: pageArg,
        macro: z.string().describe('Macro ID from list_macros'),
        x: z.int(),
        y: z.int(),
        renameDevices: z.boolean().optional().describe('Default true; false keeps the device names of the macro'),
      },
    },
    (args) =>
      respond(() =>
        session.run((doc) => {
          const page = resolveSchematicPage(doc.state, args.page);
          const macro = doc.library.macro(args.macro);
          if (!macro) throw new ToolError(`Unknown macro "${args.macro}". Use list_macros.`);
          const inProject = doc.state.library?.macros?.some((m) => m.id === macro.id);
          const place: Command = { type: 'placeItems', pageId: page.id, macro: macro.id, x: args.x, y: args.y, ...(args.renameDevices === false ? { renameDevices: false } : {}) };
          const { created } = doc.apply(inProject ? [place] : [{ type: 'addToProjectLibrary', content: { macros: [macro] } }, place]);
          return created.map((id) => placedItem(doc, page.id, id));
        }),
      ),
  );

  server.registerTool(
    'save_macro',
    {
      description: 'Saves items of a page as a macro in the project library (library.json), to place it again with place_macro.',
      inputSchema: {
        page: pageArg,
        items: z.array(z.string()).min(1).describe('Item IDs'),
        id: z.string().min(1),
        name: z.string().min(1),
        description: z.string().optional(),
        category: z.string().optional(),
      },
    },
    (args) =>
      respond(() =>
        session.run((doc) => {
          const page = resolveSchematicPage(doc.state, args.page);
          const language = doc.state.project.settings.displayLanguage;
          const missing = args.items.filter((id) => !page.items.some((i) => i.id === id));
          if (missing.length > 0) throw new ToolError(`Items not on page ${page.name}: ${missing.join(', ')}`);
          const macro = macroFromItems(page, args.items, {
            id: args.id,
            name: { [language]: args.name },
            ...(args.description ? { description: { [language]: args.description } } : {}),
            ...(args.category ? { category: args.category } : {}),
          });
          doc.apply({ type: 'addToProjectLibrary', content: { macros: [macro] } });
          return { id: macro.id, items: macro.items.length };
        }),
      ),
  );

  server.registerTool(
    'get_terminal_strips',
    {
      description:
        'Terminal strips with their terminals in order: designation, bridge label (same label = bridged), external targets (other locations, field side), internal targets (same location as the strip), page reference. Set terminal designations and bridges with set_properties (props.terminal, props.bridge).',
      inputSchema: { strip: z.string().optional().describe('Full tag of one strip, e.g. =FB+CAB1-X1') },
    },
    ({ strip }) =>
      respond(() =>
        session.run((doc) =>
          doc
            .terminals()
            .strips.filter((s) => !strip || s.device === strip)
            .map((s) => ({ ...s, terminals: s.terminals.map(({ pageId: _p, ...t }) => ({ ...t, page: doc.state.pages[_p]?.name })) })),
        ),
      ),
  );

  server.registerTool(
    'renumber_terminals',
    {
      description: 'Numbers the terminals of a strip in drawing order (page order, then left to right). Terminals with names like PE or N keep them.',
      inputSchema: { strip: z.string().describe('Full tag of the strip, e.g. =FB+CAB1-X1'), start: z.int().min(0).optional(), step: z.int().min(1).optional() },
    },
    ({ strip, start, step }) =>
      respond(() =>
        session.run((doc) => {
          doc.apply({ type: 'renumberTerminals', strip, ...(start !== undefined ? { start } : {}), ...(step !== undefined ? { step } : {}) });
          const tag = formatTag(parseTagArg(strip));
          return doc.terminals().strips.find((s) => s.device === tag)?.terminals.map((t) => ({ item: t.itemId, terminal: t.designation }));
        }),
      ),
  );

  return server;
}

function cablesView(doc: ProjectDocument) {
  return doc.cables().cables.map((c) => ({
    cable: c.device,
    type: c.cable.type,
    crossSection: c.cable.crossSection,
    lengthM: c.cable.lengthM,
    cores: c.cable.cores.map((core) => {
      const a = c.assignments.find((x) => x.core.id === core.id);
      const wire = a ? doc.wires().byNet.get(a.net) : undefined;
      return { core: core.id, number: core.number, color: core.color, wire: wire?.number, connects: wire?.ends, spare: !a };
    }),
  }));
}

function parseStarts(station: PlcStation, starts: Partial<Record<'DI' | 'DO' | 'AI' | 'AO', string>>): Partial<Record<'DI' | 'DO' | 'AI' | 'AO', number>> {
  const result: Partial<Record<'DI' | 'DO' | 'AI' | 'AO', number>> = {};
  for (const [kind, text] of Object.entries(starts) as ['DI' | 'DO' | 'AI' | 'AO', string | undefined][]) {
    if (text === undefined) continue;
    const value = parseStart(station, kind, text);
    if (value === undefined) throw new ToolError(`"${text}" is not a ${kind} address of ${station.name}`);
    result[kind] = value;
  }
  return result;
}

/** Runs tool calls one at a time against the project on disk. */
class ProjectSession implements ProjectSessionLike {
  #queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly storage: ProjectStorage,
    readonly library: Library,
  ) {}

  get root(): string | undefined {
    return (this.storage as { root?: string }).root;
  }

  async create(state: ProjectState): Promise<void> {
    if (await projectExists(this.storage)) throw new ToolError('This folder already contains a project.');
    await saveProject(this.storage, state);
  }

  run<T>(fn: (doc: ProjectDocument) => T): Promise<T> {
    const next = this.#queue.then(async () => {
      if (!(await projectExists(this.storage))) throw new ToolError('There is no project in this folder yet. Create one with create_project.');
      const doc = new ProjectDocument(await loadProject(this.storage), this.library);
      const result = fn(doc);
      if (doc.hasChanges) await saveProject(this.storage, doc.state, doc.takeChanges());
      return result;
    });
    this.#queue = next.catch(() => undefined);
    return next;
  }
}

async function respond(fn: () => unknown): Promise<CallToolResult> {
  try {
    const data = await fn();
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  } catch (error) {
    if (error instanceof ToolError || error instanceof CommandError || error instanceof ProjectLoadError) {
      return { isError: true, content: [{ type: 'text', text: error.message }] };
    }
    throw error;
  }
}

function resolvePage(state: ProjectState, ref: string): Page {
  const pages = state.project.pages.flatMap((id) => (state.pages[id] ? [state.pages[id]] : []));
  const match =
    pages.find((p) => p.id === ref) ??
    pages.find((p) => pageFullName(p) === ref) ??
    (() => {
      const byName = pages.filter((p) => p.name === ref);
      if (byName.length > 1) throw new ToolError(`Several pages are named "${ref}"; use the full name: ${byName.map(pageFullName).join(', ')}`);
      return byName[0];
    })();
  if (!match) throw new ToolError(`Page "${ref}" not found. Pages: ${pages.map(pageFullName).join(', ') || '(none)'}`);
  return match;
}

function resolveSchematicPage(state: ProjectState, ref: string): SchematicPage {
  const page = resolvePage(state, ref);
  if (page.type !== 'schematic') throw new ToolError(`Page ${pageFullName(page)} is a ${page.type === 'report' ? 'report page' : 'cabinet layout'}, not a schematic page`);
  return page;
}

function resolveLayoutPage(state: ProjectState, ref: string): LayoutPage {
  const page = resolvePage(state, ref);
  if (page.type !== 'layout') throw new ToolError(`Page ${pageFullName(page)} is not a cabinet layout page (create one with create_layout_page)`);
  return page;
}

function parseTagArg(text: string) {
  try {
    return parseTag(text);
  } catch (error) {
    throw new ToolError((error as Error).message);
  }
}

function placedItem(doc: ProjectDocument, pageId: string, itemId: string): Record<string, unknown> {
  const page = doc.state.pages[pageId] as SchematicPage;
  const item = page.items.find((i) => i.id === itemId);
  if (!item) throw new ToolError(`Item "${itemId}" not found`);
  return itemView(doc.state, page, item, doc.library, doc.devices(), doc.plc());
}
