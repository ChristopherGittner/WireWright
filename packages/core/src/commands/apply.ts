import { current, isDraft, type Draft } from 'immer';
import { issueMessage, type IssueText } from '../issues.js';
import { buildDeviceIndex, itemRole, tagFromLeftNeighbour, type Device, type DeviceIndex } from '../devices.js';
import { addRotation, boxRect, containsPoint, isBoxSymbol } from '../geometry.js';
import { newId } from '../ids.js';
import type { Library } from '../library.js';
import { planPageNames, planRenumbering, proposeDeviceName } from '../naming.js';
import { addressSize, buildPlcIndex, IO_KINDS, placePlcCommand } from '../plc.js';
import { devicePages, PLC_STORE_PAGE } from '../plcStore.js';
import { placeFunctionCommand } from '../devicelib.js';
import { buildCableIndex, buildWireIndex } from '../cables.js';
import { buildConnectivity } from '../connectivity.js';
import { CABLE_LENGTH, plcCardLayout } from '../symbols.js';
import { normalizeJunction } from '../junctions.js';
import { terminalDesignation } from '../terminals.js';
import { setLanguage } from '../translations.js';
import { naturalCompare } from '../reports.js';
import {
  ARRANGED_TEXT_FIELDS,
  itemPropsSchema,
  tagValueSchema,
  type IoChannel,
  type IoKind,
  type IoStart,
  type Item,
  type ItemProps,
  type LayoutItem,
  type LayoutPage,
  type LocalizedText,
  type Page,
  type ProjectState,
  type SchematicPage,
  type Structure,
  type Tag,
  type ItemStyle,
} from '../schema.js';
import { effectiveTag, formatTag, parseTag, relativeTag, tagContext } from '../tags.js';
import type { Command, CommandOf } from './schema.js';

/** A command that cannot be applied. The project is left unchanged. */
export class CommandError extends Error {
  override name = 'CommandError';
  constructor(
    message: string,
    /** The message as a template with values, so a user interface can translate it. */
    readonly text?: IssueText,
  ) {
    super(message);
  }
}

function commandError(template: string, values: Record<string, string | number | undefined> = {}): CommandError {
  const { message, text } = issueMessage(template, values);
  return new CommandError(message, text);
}

export interface ApplyResult {
  /** IDs of pages and items created by the commands, in order. */
  created: string[];
  /** Number of texts changed by `replaceTexts`. */
  replaced: number;
}

export interface ApplyContext {
  library: Library;
  result: ApplyResult;
}

type DraftState = Draft<ProjectState>;

export function applyCommand(draft: DraftState, command: Command, ctx: ApplyContext): void {
  switch (command.type) {
    case 'setProjectProperties':
      return setProjectProperties(draft, command);
    case 'setProjectSettings':
      return setProjectSettings(draft, command);
    case 'setPotentials':
      return setPotentials(draft, command);
    case 'setMedia':
      return setMedia(draft, command);
    case 'addRevision':
      return addRevision(draft, command);
    case 'createLayoutPage':
      return createLayoutPage(draft, command, ctx);
    case 'setLayoutPage': {
      const page = getLayoutPage(draft, command.pageId);
      if (command.plate) page.plate = command.plate;
      if (command.scale !== undefined) page.scale = command.scale;
      if (command.surface === 'door') page.surface = 'door';
      else if (command.surface === 'plate') delete page.surface;
      return;
    }
    case 'setLayoutItem':
      return setLayoutItem(draft, command, ctx);
    case 'moveLayoutItems': {
      const page = getLayoutPage(draft, command.pageId);
      const ids = new Set(command.itemIds);
      for (const item of page.items) {
        if (!ids.has(item.id)) continue;
        item.x = Math.round((item.x + command.dx) * 100) / 100;
        item.y = Math.round((item.y + command.dy) * 100) / 100;
      }
      return;
    }
    case 'deleteLayoutItems': {
      const page = getLayoutPage(draft, command.pageId);
      const ids = new Set(command.itemIds);
      page.items = page.items.filter((i) => !ids.has(i.id));
      return;
    }
    case 'setPlcs':
      return setPlcs(draft, command);
    case 'assignPlcAddresses':
      return assignPlcAddresses(draft, command, ctx);
    case 'addToProjectLibrary':
      return addToProjectLibrary(draft, command);
    case 'numberWires':
      return numberWires(draft, command, ctx);
    case 'renumberTerminals':
      return renumberTerminals(draft, command, ctx);
    case 'placeItems':
      return placeItems(draft, command, ctx);
    case 'setTexts':
      return setTexts(draft, command);
    case 'createPage':
      return createPage(draft, command, ctx);
    case 'createReportPage':
      return createReportPage(draft, command, ctx);
    case 'deletePage':
      return deletePage(draft, command, ctx);
    case 'movePage':
      return movePage(draft, command);
    case 'addPlcCard':
      return addPlcCard(draft, command, ctx);
    case 'placePlcCard':
      return placePlcCard(draft, command, ctx);
    case 'removePlcCards': {
      const ids = new Set(command.itemIds);
      const known = new Set([...(draft.project.plcCards ?? []), ...Object.values(draft.pages).flatMap((p) => (p.type === 'schematic' ? p.items : []))].filter((i) => i.props?.plc && !i.props.plcView).map((i) => i.id));
      for (const id of ids) if (!known.has(id)) throw commandError('PLC card "{item}" not found', { item: id });
      // The card's data and every drawing of it (master and further overviews).
      if (draft.project.plcCards) {
        draft.project.plcCards = draft.project.plcCards.filter((i) => !ids.has(i.id));
        if (draft.project.plcCards.length === 0) delete draft.project.plcCards;
      }
      for (const page of Object.values(draft.pages)) {
        if (page.type === 'schematic') page.items = page.items.filter((i) => !ids.has(i.id) && !ids.has(i.props?.plcView?.of ?? ''));
      }
      return;
    }
    case 'movePages':
      return movePages(draft, command);
    case 'setPageProperties':
      return setPageProperties(draft, command);
    case 'placeSymbol':
      return placeSymbol(draft, command, ctx);
    case 'moveItems':
      return moveItems(draft, command, ctx);
    case 'rotateItems':
      return transformItems(draft, command.pageId, command.itemIds, ctx, (item) => {
        item.rotation = addRotation(item.rotation, command.rotation);
      });
    case 'mirrorItems':
      return transformItems(draft, command.pageId, command.itemIds, ctx, (item) => {
        item.mirror = !item.mirror;
      });
    case 'deleteItems':
      return deleteItems(draft, command, ctx);
    case 'setItemProperties':
      return setItemProperties(draft, command, ctx);
    case 'setItemTag':
      return setItemTag(draft, command, ctx);
    case 'moveItemText':
      return moveItemText(draft, command);
    case 'setItemTextStyle':
      return setItemTextStyle(draft, command);
    case 'setTextArrangement':
      return setTextArrangement(draft, command);
    case 'acknowledgeIssues': {
      const list = (draft.project.acknowledged ??= []);
      for (const key of command.keys) {
        const entry = { key, ...(command.note ? { note: command.note } : {}), ...(command.date ? { date: command.date } : {}) };
        const i = list.findIndex((a) => a.key === key);
        if (i >= 0) list[i] = entry;
        else list.push(entry);
      }
      return;
    }
    case 'unacknowledgeIssues': {
      const keys = new Set(command.keys);
      draft.project.acknowledged = (draft.project.acknowledged ?? []).filter((a) => !keys.has(a.key));
      if (draft.project.acknowledged.length === 0) delete draft.project.acknowledged;
      return;
    }
    case 'applyItemStyle': {
      const page = getSchematicPage(draft, command.pageId);
      for (const id of command.itemIds) {
        const item = findItem(page, id);
        if (command.style.texts && Object.keys(command.style.texts).length > 0) item.texts = structuredClone(command.style.texts);
        else delete item.texts;
        if (command.style.textArrangement) item.textArrangement = { ...command.style.textArrangement };
        else delete item.textArrangement;
      }
      return;
    }
    case 'removeFromProjectLibrary':
      return removeFromProjectLibrary(draft, command);
    case 'generatePlcOverview':
      return generatePlcOverview(draft, command, ctx);
    case 'renameDevice':
      return renameDevice(draft, command, ctx);
    case 'renumberPages':
      return renumberPages(draft, command);
    case 'setStructures':
      return setStructures(draft, command);
    case 'renumberDevices':
      return renumberDevices(draft, command, ctx);
    case 'applyDeviceTemplate':
      return applyDeviceTemplate(draft, command, ctx);
    case 'replaceTexts':
      return replaceTexts(draft, command, ctx);
  }
}

// ---------------------------------------------------------------------------
// Project

function setProjectProperties(draft: DraftState, cmd: CommandOf<'setProjectProperties'>): void {
  if (cmd.name !== undefined) draft.project.name = cmd.name;
  if (cmd.description === null) delete draft.project.description;
  else if (cmd.description !== undefined) draft.project.description = cmd.description;
  if (cmd.properties) applyStringMapUpdate(draft.project.properties, cmd.properties);
}

function setProjectSettings(draft: DraftState, cmd: CommandOf<'setProjectSettings'>): void {
  Object.assign(draft.project.settings, cmd.settings);
  const { languages, displayLanguage } = draft.project.settings;
  if (!languages.includes(displayLanguage)) {
    throw commandError('Display language "{language}" is not one of the project languages ({languages})', { language: displayLanguage, languages: languages.join(', ') });
  }
}

function setPotentials(draft: DraftState, cmd: CommandOf<'setPotentials'>): void {
  const names = new Set<string>();
  for (const p of cmd.potentials) {
    if (names.has(p.name)) throw commandError('Potential "{name}" is defined twice', { name: p.name });
    names.add(p.name);
  }
  draft.project.potentials = cmd.potentials;
}

function createLayoutPage(draft: DraftState, cmd: CommandOf<'createLayoutPage'>, ctx: ApplyContext): void {
  const id = claimPageId(draft, cmd.id);
  const page: LayoutPage = { id, type: 'layout', name: cmd.name, plate: cmd.plate, scale: cmd.scale, items: [] };
  if (cmd.description !== undefined) page.description = cmd.description;
  if (cmd.structure && Object.keys(cmd.structure).length > 0) page.structure = cmd.structure;
  if (cmd.surface === 'door') page.surface = 'door';
  insertPage(draft, page, cmd.index);
  ctx.result.created.push(id);
}

function getLayoutPage(draft: DraftState, pageId: string): Draft<LayoutPage> {
  const page = getPage(draft, pageId);
  if (page.type !== 'layout') throw commandError('Page "{page}" is not a cabinet layout', { page: page.name });
  return page;
}

function setLayoutItem(draft: DraftState, cmd: CommandOf<'setLayoutItem'>, ctx: ApplyContext): void {
  const page = getLayoutPage(draft, cmd.pageId);
  const used = new Set(page.items.map((i) => i.id));
  let id = cmd.item.id;
  if (id === undefined) {
    do id = newId('i');
    while (used.has(id));
  }
  const item = { ...cmd.item, id } as LayoutItem;
  const index = page.items.findIndex((i) => i.id === id);
  if (index >= 0) page.items[index] = item;
  else {
    page.items.push(item);
    ctx.result.created.push(id);
  }
}

function addRevision(draft: DraftState, cmd: CommandOf<'addRevision'>): void {
  const { revision } = cmd;
  if (draft.project.revisions?.some((r) => r.name === revision.name)) throw commandError('Revision "{name}" exists already', { name: revision.name });
  draft.project.revisions = [...(draft.project.revisions ?? []), revision];
  for (const id of cmd.pageIds) {
    const page = getPage(draft, id);
    page.properties = { ...page.properties, revision: revision.name, date: revision.date };
  }
}

function setMedia(draft: DraftState, cmd: CommandOf<'setMedia'>): void {
  const names = new Set<string>();
  for (const m of cmd.media) {
    if (names.has(m.name)) throw commandError('Medium "{name}" is defined twice', { name: m.name });
    names.add(m.name);
  }
  if (cmd.media.length === 0) delete draft.project.media;
  else draft.project.media = cmd.media;
}

function setPlcs(draft: DraftState, cmd: CommandOf<'setPlcs'>): void {
  const names = new Set<string>();
  for (const p of cmd.plcs) {
    if (names.has(p.name)) throw commandError('PLC "{name}" is defined twice', { name: p.name });
    names.add(p.name);
  }
  draft.project.plcs = cmd.plcs;
}

/**
 * Numbers the terminals of a strip 1, 2, 3 … in drawing order (page order,
 * then left to right, top to bottom). Terminals with a non-numeric
 * designation (PE, N …) keep it.
 */
function renumberTerminals(draft: DraftState, cmd: CommandOf<'renumberTerminals'>, ctx: ApplyContext): void {
  const state = snapshot(draft) as ProjectState;
  const index = buildDeviceIndex(state, ctx.library);
  const device = index.devices.get(formatTag(parseTagOrThrow(cmd.strip)));
  if (!device) throw commandError('Terminal strip {strip} not found', { strip: cmd.strip });
  const order = new Map(state.project.pages.map((id, i) => [id, i]));
  const terminals = device.functions
    .filter((f) => f.function === 'terminal')
    .map((f) => ({ f, item: (state.pages[f.pageId] as SchematicPage).items.find((i) => i.id === f.itemId)! }))
    .filter(({ item }) => /^\d*$/.test(terminalDesignation(item, ctx.library)))
    .sort((a, b) => (order.get(a.f.pageId) ?? 0) - (order.get(b.f.pageId) ?? 0) || a.item.x - b.item.x || a.item.y - b.item.y);
  if (terminals.length === 0) throw commandError('{device} has no numbered terminals', { device: device.key });
  terminals.forEach(({ f }, i) => {
    const item = findItem(getSchematicPage(draft, f.pageId), f.itemId);
    item.props = { ...item.props, terminal: String((cmd.start ?? 1) + i * (cmd.step ?? 1)) };
  });
}

/**
 * Writes wire numbers into the wire markers, so they no longer change with the
 * drawing. Renumbering all first forgets the numbers of the markers in scope.
 */
function numberWires(draft: DraftState, cmd: CommandOf<'numberWires'>, ctx: ApplyContext): void {
  const { library } = ctx;
  const scope = new Set(cmd.pageIds ?? draft.project.pages);
  for (const id of cmd.pageIds ?? []) getSchematicPage(draft, id);
  const state = structuredClone(snapshot(draft) as ProjectState);
  const isMarker = (item: Item) => library.symbol(item.symbol)?.function === 'connection.definition';
  if (!cmd.onlyMissing) {
    for (const page of Object.values(state.pages)) {
      if (page.type !== 'schematic' || !scope.has(page.id)) continue;
      for (const item of page.items) if (isMarker(item) && item.props?.wire) delete item.props.wire.number;
    }
  }
  const connectivity = buildConnectivity(state, library);
  const cables = buildCableIndex(state, library, buildDeviceIndex(state, library), connectivity);
  const wires = buildWireIndex(state, library, connectivity, cables);
  for (const wire of wires.wires) {
    for (const m of wire.markers) {
      if (!scope.has(m.pageId)) continue;
      const item = findItem(getSchematicPage(draft, m.pageId), m.itemId);
      if (cmd.onlyMissing && item.props?.wire?.number) continue;
      item.props = { ...item.props, wire: { ...item.props?.wire, number: wire.number } };
    }
  }
}

function addToProjectLibrary(draft: DraftState, cmd: CommandOf<'addToProjectLibrary'>): void {
  draft.library ??= {};
  for (const key of ['symbols', 'templates', 'devices', 'macros', 'parts', 'frames'] as const) {
    const incoming = cmd.content[key];
    if (!incoming || incoming.length === 0) continue;
    const ids = new Set(incoming.map((e) => e.id));
    const kept = (draft.library[key] ?? []).filter((e) => !ids.has(e.id));
    (draft.library as Record<string, unknown[]>)[key] = [...kept, ...incoming];
  }
}

function removeFromProjectLibrary(draft: DraftState, cmd: CommandOf<'removeFromProjectLibrary'>): void {
  const list = draft.library?.[cmd.kind];
  if (!list) return;
  const ids = new Set(cmd.ids);
  (draft.library as Record<string, unknown[]>)[cmd.kind] = list.filter((e) => !ids.has(e.id));
  if (draft.library![cmd.kind]!.length === 0) delete draft.library![cmd.kind];
}

/**
 * Numbers the start addresses of I/O cards: per PLC, cards in slot order
 * (then by tag) get consecutive address ranges, starting at the PLC's first
 * address or after the cards that keep their addresses.
 */
function assignPlcAddresses(draft: DraftState, cmd: CommandOf<'assignPlcAddresses'>, ctx: ApplyContext): void {
  const state = snapshot(draft) as ProjectState;
  const index = buildDeviceIndex(state, ctx.library);
  const stations = new Map(state.project.plcs.map((s) => [s.name, s]));
  if (cmd.station !== undefined && !stations.has(cmd.station)) throw commandError('PLC "{plc}" not found', { plc: cmd.station });
  const wanted = cmd.devices ? new Set(cmd.devices.map((d) => formatTag(parseTagOrThrow(d)))) : undefined;

  type Card = { key: string; pageId: string; itemId: string; slot?: number; start: IoStart; counts: Record<IoKind, number> };
  const byStation = new Map<string, Card[]>();
  for (const device of index.devices.values()) {
    const main = device.main;
    const page = main && (state.pages[main.pageId] as SchematicPage);
    const item = page?.items.find((i) => i.id === main!.itemId);
    const plc = item?.props?.plc;
    if (!main || !plc?.station || !stations.has(plc.station)) continue;
    const counts: Record<IoKind, number> = { DI: 0, DO: 0, AI: 0, AO: 0 };
    for (const c of plc.channels) counts[c.kind]++;
    const card: Card = { key: device.key, pageId: main.pageId, itemId: main.itemId, ...(plc.slot !== undefined ? { slot: plc.slot } : {}), start: { ...plc.start }, counts };
    byStation.set(plc.station, [...(byStation.get(plc.station) ?? []), card]);
  }
  if (wanted) {
    const known = new Set([...byStation.values()].flat().map((c) => c.key));
    for (const key of wanted) if (!known.has(key)) throw commandError('{name} is not an I/O card of a PLC', { name: key });
  }

  for (const [name, cards] of byStation) {
    if (cmd.station !== undefined && cmd.station !== name) continue;
    const station = stations.get(name)!;
    cards.sort((a, b) => (a.slot ?? Number.MAX_SAFE_INTEGER) - (b.slot ?? Number.MAX_SAFE_INTEGER) || naturalCompare(a.key, b.key));
    for (const kind of IO_KINDS) {
      const renumber = (card: Card) => (!wanted || wanted.has(card.key)) && !(cmd.onlyMissing && card.start[kind] !== undefined);
      // Cards that keep their addresses are left alone; numbering continues after them.
      let next = station.firstAddress?.[kind] ?? 0;
      for (const card of cards) {
        const start = card.start[kind];
        if (!renumber(card) && start !== undefined) next = Math.max(next, start + Math.max(addressSize(station, kind, card.counts[kind]), cmd.step ?? 0));
      }
      for (const card of cards) {
        const size = addressSize(station, kind, card.counts[kind]);
        if (size === 0 || !renumber(card)) continue;
        card.start[kind] = next;
        next += Math.max(size, cmd.step ?? 0);
      }
    }
    for (const card of cards) {
      const item = findItem(getSchematicPage(draft, card.pageId), card.itemId);
      if (item.props?.plc) item.props.plc.start = card.start;
    }
  }
}

// ---------------------------------------------------------------------------
// Pages

function createPage(draft: DraftState, cmd: CommandOf<'createPage'>, ctx: ApplyContext): void {
  const id = claimPageId(draft, cmd.id);
  const page: SchematicPage = { id, type: 'schematic', name: cmd.name, items: [] };
  if (cmd.description !== undefined) page.description = cmd.description;
  if (cmd.structure && Object.keys(cmd.structure).length > 0) page.structure = cmd.structure;
  if (cmd.frame !== undefined) page.frame = cmd.frame;
  insertPage(draft, page, cmd.index);
  ctx.result.created.push(id);
}

function createReportPage(draft: DraftState, cmd: CommandOf<'createReportPage'>, ctx: ApplyContext): void {
  const id = claimPageId(draft, cmd.id);
  const page: Page = { id, type: 'report', name: cmd.name, report: { kind: cmd.kind } };
  if (cmd.form !== undefined) page.report.form = cmd.form;
  if (cmd.description !== undefined) page.description = cmd.description;
  if (cmd.structure && Object.keys(cmd.structure).length > 0) page.structure = cmd.structure;
  insertPage(draft, page, cmd.index);
  ctx.result.created.push(id);
}

function claimPageId(draft: DraftState, requested: string | undefined): string {
  if (requested !== undefined) {
    if (draft.pages[requested]) throw commandError('Page ID "{id}" is already in use', { id: requested });
    return requested;
  }
  let id: string;
  do id = newId('p');
  while (draft.pages[id]);
  return id;
}

function insertPage(draft: DraftState, page: Page, index: number | undefined): void {
  assertUniquePageName(draft, page.name, page.structure, page.id);
  draft.pages[page.id] = page;
  const order = draft.project.pages;
  order.splice(Math.min(index ?? order.length, order.length), 0, page.id);
  sortPagesByStructure(draft);
}

function setStructures(draft: DraftState, cmd: CommandOf<'setStructures'>): void {
  for (const aspect of ['function', 'location'] as const) {
    const codes = cmd.structures[aspect].map((e) => e.code);
    const twice = codes.find((c, i) => codes.indexOf(c) !== i);
    if (twice !== undefined) throw (aspect === 'function' ? commandError('Function "{code}" is listed twice', { code: twice }) : commandError('Location "{code}" is listed twice', { code: twice }));
  }
  if (cmd.structures.function.length + cmd.structures.location.length === 0) delete draft.project.structures;
  else draft.project.structures = structuredClone(cmd.structures);
  sortPagesByStructure(draft);
}

/**
 * Keeps the pages sorted by the order of the project's functions, then locations (stable:
 * pages of the same structure keep their order). Codes that are not listed come after the
 * listed ones. Without structure definitions the page order is left as it is.
 */
function sortPagesByStructure(draft: DraftState): void {
  const structures = draft.project.structures;
  if (!structures || structures.function.length + structures.location.length === 0) return;
  const rank = (list: readonly { code: string }[], code: string | undefined) => {
    const i = code === undefined ? -1 : list.findIndex((e) => e.code === code);
    return i < 0 ? list.length : i;
  };
  const order = draft.project.pages.map((id, index) => {
    const structure = draft.pages[id]?.structure;
    return { id, index, f: rank(structures.function, structure?.function), l: rank(structures.location, structure?.location) };
  });
  order.sort((a, b) => a.f - b.f || a.l - b.l || a.index - b.index);
  const sorted = order.map((o) => o.id);
  if (sorted.some((id, i) => id !== draft.project.pages[i])) draft.project.pages = sorted;
}

function assertUniquePageName(draft: DraftState, name: string, structure: Structure | undefined, ownId: string): void {
  const key = formatTag(structure ?? {}) + '/' + name;
  for (const page of Object.values(draft.pages)) {
    if (page.id !== ownId && formatTag(page.structure ?? {}) + '/' + page.name === key) {
      throw commandError('A page named "{name}" already exists', { name: key });
    }
  }
}

function deletePage(draft: DraftState, cmd: CommandOf<'deletePage'>, ctx: ApplyContext): void {
  const page = getPage(draft, cmd.pageId);
  // PLC cards drawn there stay in the project (PLC tab).
  if (page.type === 'schematic') stashPlcCards(draft, cmd.pageId, page.items.map((i) => i.id), ctx.library);
  delete draft.pages[cmd.pageId];
  draft.project.pages = draft.project.pages.filter((id) => id !== cmd.pageId);
}

/**
 * Moves a page in the page order. With project structures defined, pages stay sorted by
 * structure: a page moves only among the pages of its function and location (to another
 * group by changing its structure).
 */
function movePage(draft: DraftState, cmd: CommandOf<'movePage'>): void {
  getPage(draft, cmd.pageId);
  const order = draft.project.pages.filter((id) => id !== cmd.pageId);
  order.splice(Math.min(cmd.index, order.length), 0, cmd.pageId);
  draft.project.pages = order;
  sortPagesByStructure(draft);
}

function movePages(draft: DraftState, cmd: CommandOf<'movePages'>): void {
  const ids = draft.project.pages.filter((id) => cmd.pageIds.includes(id));
  for (const id of cmd.pageIds) getPage(draft, id);
  if (cmd.structure) {
    for (const id of ids) {
      const page = getPage(draft, id);
      const structure: Structure = { ...page.structure };
      for (const aspect of ['function', 'location'] as const) {
        const value = cmd.structure[aspect];
        if (value === null) delete structure[aspect];
        else if (value !== undefined) structure[aspect] = value;
      }
      if (Object.keys(structure).length > 0) page.structure = structure;
      else delete page.structure;
    }
    for (const id of ids) assertUniquePageName(draft, getPage(draft, id).name, getPage(draft, id).structure, id);
  }
  const rest = draft.project.pages.filter((id) => !ids.includes(id));
  let at = cmd.before !== undefined ? rest.indexOf(cmd.before) : -1;
  if (at < 0) {
    // After the last page of the same group (function and location), else where they were.
    const key = (id: string) => formatTag(draft.pages[id]?.structure ?? {});
    const group = key(ids[0]!);
    const last = rest.map(key).lastIndexOf(group);
    at = last >= 0 ? last + 1 : Math.min(draft.project.pages.indexOf(ids[0]!), rest.length);
  }
  rest.splice(at, 0, ...ids);
  draft.project.pages = rest;
  sortPagesByStructure(draft);
}

function setPageProperties(draft: DraftState, cmd: CommandOf<'setPageProperties'>): void {
  const page = getPage(draft, cmd.pageId);
  if (cmd.name !== undefined) page.name = cmd.name;
  if (cmd.description === null) delete page.description;
  else if (cmd.description !== undefined) page.description = cmd.description;
  if (cmd.structure) {
    const structure: Structure = { ...page.structure };
    for (const aspect of ['function', 'location'] as const) {
      const value = cmd.structure[aspect];
      if (value === null) delete structure[aspect];
      else if (value !== undefined) structure[aspect] = value;
    }
    if (Object.keys(structure).length > 0) page.structure = structure;
    else delete page.structure;
    sortPagesByStructure(draft);
  }
  if (cmd.properties) {
    page.properties ??= {};
    applyStringMapUpdate(page.properties, cmd.properties);
    if (Object.keys(page.properties).length === 0) delete page.properties;
  }
  if (cmd.frame === null) delete page.frame;
  else if (cmd.frame !== undefined) page.frame = cmd.frame;
  assertUniquePageName(draft, page.name, page.structure, page.id);
}

// ---------------------------------------------------------------------------
// Items

const DEFAULT_BOX_SIZE = { width: 40, height: 24 };

function placeSymbol(draft: DraftState, cmd: CommandOf<'placeSymbol'>, ctx: ApplyContext): void {
  const { library } = ctx;
  const def = library.symbol(cmd.symbol);
  if (!def) throw commandError('Unknown symbol "{symbol}". Use search_symbols to find symbol IDs.', { symbol: cmd.symbol });
  const page = getSchematicPage(draft, cmd.pageId);

  const item: Item = {
    id: claimItemId(draft, cmd.id),
    symbol: def.id,
    x: cmd.x,
    y: cmd.y,
    rotation: cmd.rotation ?? 0,
    mirror: cmd.mirror ?? false,
  };
  if (def.resizable) {
    item.width = cmd.width ?? DEFAULT_BOX_SIZE.width;
    item.height = cmd.height ?? DEFAULT_BOX_SIZE.height;
    item.rotation = 0;
    item.mirror = false;
  } else if (def.generator === 'cable') {
    // A cable line is horizontal (width) or vertical (height).
    if (cmd.height !== undefined && cmd.width === undefined) item.height = cmd.height;
    else item.width = cmd.width ?? CABLE_LENGTH;
  } else if (cmd.width !== undefined || cmd.height !== undefined) {
    throw commandError('Symbol "{symbol}" has a fixed size', { symbol: def.id });
  }
  if (def.generator) {
    item.rotation = 0;
    item.mirror = false;
  }
  normalizeJunction(item, library);
  if (cmd.tag && Object.keys(cmd.tag).length > 0) item.tag = { ...cmd.tag };
  if (cmd.main !== undefined) item.main = cmd.main;
  if (cmd.pins) item.pins = { ...cmd.pins };
  if (cmd.borderPins) {
    if (def.function !== 'box.device') throw commandError('Only device boxes have border pins');
    item.borderPins = cmd.borderPins;
  }
  if (cmd.props) item.props = parseProps(cmd.props);
  if (cmd.template) {
    const template = library.template(cmd.template);
    if (!template) throw commandError('Unknown device template "{template}"', { template: cmd.template });
    item.props = { ...item.props, contacts: structuredClone(template.contacts) };
  }

  const snapshotPage = snapshot(page) as SchematicPage;
  const context = tagContext(snapshotPage, item, library);
  // Inside a device box, a symbol without its own device tag becomes a function of the box device.
  if (context.product && !item.tag?.product && cmd.main === undefined && itemRole(item, def) === 'main') {
    item.main = false;
  }
  // A contact without its own tag belongs to the device of the nearest symbol to its left
  // at the same height. Main functions (coils …) never inherit; they get their own name.
  if (!context.product && !item.tag?.product && itemRole(item, def) === 'auxiliary') {
    const neighbour = tagFromLeftNeighbour(snapshotPage, item, library);
    if (neighbour) {
      const own = { function: item.tag?.function ?? context.function, location: item.tag?.location ?? context.location };
      item.tag = { ...relativeTag(neighbour, own), ...item.tag };
    }
  }
  if (itemRole(item, def) === 'main' && !item.tag?.product && cmd.autoName !== false) {
    const state = snapshot(draft) as ProjectState;
    const product = proposeDeviceName({
      settings: state.project.settings,
      library,
      page: snapshotPage,
      at: item,
      letter: def.letterCode ?? 'A',
      context: { function: item.tag?.function ?? context.function, location: item.tag?.location ?? context.location },
      taken: new Set(buildDeviceIndex(state, library).devices.keys()),
    });
    item.tag = { ...item.tag, product };
  }

  page.items.push(item);
  ctx.result.created.push(item.id);
}

/** Sets one language of multilingual texts addressed by translation keys. */
function setTexts(draft: DraftState, cmd: CommandOf<'setTexts'>): void {
  const languages = draft.project.settings.languages;
  const update = (text: LocalizedText | undefined, language: string, value: string) => setLanguage(snapshot(text as never) as LocalizedText | undefined, language, value, languages);
  for (const { key, language, value } of cmd.texts) {
    const [kind, a, b, c] = key.split(':');
    if (kind === 'project' && a === 'description') {
      const text = update(draft.project.description, language, value);
      if (text === undefined) delete draft.project.description;
      else draft.project.description = text;
    } else if (kind === 'plc' && b === 'description') {
      const plc = draft.project.plcs.find((p) => p.name === a);
      if (!plc) throw commandError('PLC "{name}" not found', { name: a });
      const text = update(plc.description, language, value);
      if (text === undefined) delete plc.description;
      else plc.description = text;
    } else if (kind === 'page' && b === 'description') {
      const page = draft.pages[a ?? ''];
      if (!page) throw commandError('Page "{name}" not found', { name: a });
      const text = update(page.description, language, value);
      if (text === undefined) delete page.description;
      else page.description = text;
    } else if (kind === 'item' && (c === 'functionText' || c === 'technicalData' || c === 'text')) {
      const item = findItem(getSchematicPage(draft, a ?? ''), b ?? '');
      const text = update(item.props?.[c], language, value);
      item.props ??= {};
      if (text === undefined) delete item.props[c];
      else item.props[c] = text;
      if (Object.keys(item.props).length === 0) delete item.props;
    } else if (kind === 'channel') {
      const item = findItem(getSchematicPage(draft, a ?? ''), b ?? '');
      const channel = item.props?.plc?.channels[Number(c)];
      if (!channel) throw commandError('Channel {channel} of {card} not found', { channel: c, card: b });
      const text = update(channel.function, language, value);
      if (text === undefined) delete channel.function;
      else channel.function = text;
    } else {
      throw commandError('Unknown text "{name}"', { name: key });
    }
  }
}

/**
 * Places a group of items (a macro or copied items) at a new position. A
 * device whose main function is in the group gets a new name, and the group's
 * contacts of that device follow it. Contacts of devices outside the group
 * keep their tag. Wire numbers and PLC start addresses are not taken over.
 */
function placeItems(draft: DraftState, cmd: CommandOf<'placeItems'>, ctx: ApplyContext): void {
  const { library } = ctx;
  const items = cmd.items ?? (cmd.macro !== undefined ? library.macro(cmd.macro)?.items : undefined);
  if (!items) throw (cmd.macro !== undefined ? commandError('Unknown macro "{macro}"', { macro: cmd.macro }) : commandError('placeItems needs items or a macro'));
  const dx = cmd.x - Math.min(...items.map((i) => i.x));
  const dy = cmd.y - Math.min(...items.map((i) => i.y));
  const page = getSchematicPage(draft, cmd.pageId);
  const isMain = (item: Item) => {
    const def = library.symbol(item.symbol);
    if (!def) throw commandError('Unknown symbol "{symbol}"', { symbol: item.symbol });
    return itemRole(item, def) === 'main';
  };
  const rename = cmd.renameDevices !== false;
  const renamed = new Map<string, string>();
  const firstCreated = ctx.result.created.length;
  // Main functions first, so their new names are known when the contacts are placed.
  for (const item of [...items.filter(isMain), ...items.filter((i) => !isMain(i))]) {
    const main = isMain(item);
    const tag = item.tag ? { ...item.tag } : undefined;
    if (rename && tag?.product !== undefined) {
      if (main) delete tag.product;
      else {
        const product = renamed.get(formatTag(item.tag!));
        if (product !== undefined) tag.product = product;
      }
    }
    const props = item.props ? structuredClone(item.props) : undefined;
    if (props?.wire?.number !== undefined) delete props.wire.number;
    if (props?.plc?.start !== undefined) delete props.plc.start;
    placeSymbol(
      draft,
      {
        type: 'placeSymbol',
        pageId: cmd.pageId,
        symbol: item.symbol,
        x: item.x + dx,
        y: item.y + dy,
        rotation: item.rotation,
        mirror: item.mirror,
        ...(item.width !== undefined ? { width: item.width } : {}),
        ...(item.height !== undefined ? { height: item.height } : {}),
        ...(tag && Object.keys(tag).length > 0 ? { tag } : {}),
        ...(item.main !== undefined ? { main: item.main } : {}),
        ...(item.pins ? { pins: item.pins } : {}),
        ...(item.borderPins ? { borderPins: item.borderPins } : {}),
        ...(props ? { props } : {}),
        ...(!rename && main ? { autoName: false } : {}),
      },
      ctx,
    );
    const placed = page.items.at(-1)!;
    if (item.pinPotentials) placed.pinPotentials = { ...item.pinPotentials };
    if (item.links) placed.links = structuredClone(item.links);
    if (item.texts) placed.texts = structuredClone(item.texts);
    if (item.textArrangement) placed.textArrangement = item.textArrangement;
    if (main && item.tag?.product !== undefined && placed.tag?.product !== undefined) renamed.set(formatTag(item.tag), placed.tag.product);
  }
  if (rename) continueTerminalStrips(draft, cmd.pageId, new Set(ctx.result.created.slice(firstCreated)), ctx.library);
}

/**
 * Placed terminals that join a strip which already has terminals continue its
 * numbering (after the highest number) and get bridge labels not yet used on
 * the strip, so a macro or a paste does not create duplicates.
 */
function continueTerminalStrips(draft: DraftState, pageId: string, placedIds: ReadonlySet<string>, library: Library): void {
  const state = snapshot(draft) as ProjectState;
  const index = buildDeviceIndex(state, library);
  const strips = new Map<string, string[]>();
  for (const id of placedIds) {
    const key = index.byItem.get(id);
    const def = library.symbol(findItem(state.pages[pageId] as SchematicPage, id).symbol);
    if (key && def?.function === 'terminal') strips.set(key, [...(strips.get(key) ?? []), id]);
  }
  for (const [key, ids] of strips) {
    const existing = index.devices.get(key)!.functions.filter((f) => !placedIds.has(f.itemId) && f.function === 'terminal');
    if (existing.length === 0) continue;
    const others = existing.map((f) => findItem(state.pages[f.pageId] as SchematicPage, f.itemId));
    const numbers = others.map((i) => terminalDesignation(i, library)).filter((d) => /^\d+$/.test(d)).map(Number);
    const offset = numbers.length > 0 ? Math.max(...numbers) : 0;
    const usedBridges = new Set(others.map((i) => i.props?.bridge).filter((b): b is string => typeof b === 'string' && b !== ''));
    const bridgeMap = new Map<string, string>();
    const freeBridge = () => {
      for (let n = 0; ; n++) {
        const label = bridgeLabel(n);
        if (!usedBridges.has(label)) return (usedBridges.add(label), label);
      }
    };
    const page = getSchematicPage(draft, pageId);
    // Labels of the placed terminals that the strip does not use yet stay; the others get free ones.
    const placedLabels = new Set(ids.map((id) => findItem(page, id).props?.bridge).filter((b): b is string => typeof b === 'string' && b !== ''));
    const clashing = [...placedLabels].filter((label) => usedBridges.has(label));
    for (const label of placedLabels) usedBridges.add(label);
    for (const label of clashing) bridgeMap.set(label, freeBridge());
    for (const id of ids) {
      const item = findItem(page, id);
      const designation = terminalDesignation(item, library);
      const props = { ...item.props };
      if (/^\d+$/.test(designation)) props.terminal = String(Number(designation) + offset);
      if (typeof props.bridge === 'string' && bridgeMap.has(props.bridge)) props.bridge = bridgeMap.get(props.bridge)!;
      item.props = props;
    }
  }
}

/** Bridge labels A … Z, AA, AB … */
function bridgeLabel(n: number): string {
  return n < 26 ? String.fromCharCode(65 + n) : bridgeLabel(Math.floor(n / 26) - 1) + String.fromCharCode(65 + (n % 26));
}

function claimItemId(draft: DraftState, requested: string | undefined): string {
  const used = new Set<string>();
  for (const page of Object.values(draft.pages)) {
    if (page.type === 'schematic') for (const item of page.items) used.add(item.id);
  }
  for (const item of draft.project.plcCards ?? []) used.add(item.id);
  if (requested !== undefined) {
    if (used.has(requested)) throw commandError('Item ID "{id}" is already in use', { id: requested });
    return requested;
  }
  let id: string;
  do id = newId('i');
  while (used.has(id));
  return id;
}

function moveItems(draft: DraftState, cmd: CommandOf<'moveItems'>, ctx: ApplyContext): void {
  const page = getSchematicPage(draft, cmd.pageId);
  const before = snapshot(draft) as ProjectState;
  const beforeIndex = buildDeviceIndex(before, ctx.library);
  const moved = withBoxContents(before.pages[cmd.pageId] as SchematicPage, cmd.itemIds, ctx.library);
  for (const item of page.items) {
    if (moved.has(item.id)) {
      item.x += cmd.dx;
      item.y += cmd.dy;
    }
  }
  followMainFunctions(draft, beforeIndex, moved, ctx.library);
}

/** The given items plus everything inside boxes among them: moving a box moves its contents. */
function withBoxContents(page: SchematicPage, itemIds: readonly string[], library: Library): Set<string> {
  const ids = new Set(itemIds);
  for (const id of itemIds) {
    const item = findItem(page, id);
    if (!isBoxSymbol(library.symbol(item.symbol))) continue;
    const rect = boxRect(item);
    for (const other of page.items) {
      if (other.id !== id && containsPoint(rect, other)) ids.add(other.id);
    }
  }
  return ids;
}

function transformItems(
  draft: DraftState,
  pageId: string,
  itemIds: readonly string[],
  ctx: ApplyContext,
  transform: (item: Draft<Item>) => void,
): void {
  const page = getSchematicPage(draft, pageId);
  for (const id of itemIds) {
    const item = findItem(page, id);
    // Boxes and generated symbols (PLC cards) are always drawn upright.
    const def = ctx.library.symbol(item.symbol);
    if (isBoxSymbol(def) || def?.generator) continue;
    transform(item);
    // A rotated corner/T-junction becomes the symbol for its new directions.
    normalizeJunction(item, ctx.library);
  }
}

/** Moves the card masters among the items into the card store, with their full tag. */
function stashPlcCards(draft: DraftState, pageId: string, itemIds: readonly string[], library: Library): void {
  const page = getSchematicPage(draft, pageId);
  const snap = snapshot(page) as SchematicPage;
  const ids = new Set(itemIds);
  for (const item of snap.items) {
    if (!ids.has(item.id) || !item.props?.plc || item.props.plcView) continue;
    const tag = effectiveTag(snap, item, library);
    const stored: Item = { ...structuredClone(item), x: 0, y: 0, rotation: 0, mirror: false };
    delete stored.texts;
    delete stored.textArrangement;
    if (Object.keys(tag).length > 0) stored.tag = tag;
    (draft.project.plcCards ??= []).push(stored);
  }
}

/** Adds a card to the card store (PLC tab), from a device definition or with its own channels. */
function addPlcCard(draft: DraftState, cmd: CommandOf<'addPlcCard'>, ctx: ApplyContext): void {
  const state = snapshot(draft) as ProjectState;
  if (cmd.station !== undefined && !state.project.plcs.some((p) => p.name === cmd.station)) throw commandError('PLC "{plc}" not found', { plc: cmd.station });
  const devices = buildDeviceIndex(state, ctx.library);
  // The PLC's other cards: their structure for the tag, their slots for the next slot.
  const others = devicePages(state).flatMap((page) =>
    page.items.filter((i) => cmd.station !== undefined && i.props?.plc?.station === cmd.station && !i.props.plcView).map((item) => ({ item, tag: effectiveTag(page, item, ctx.library) })),
  );
  let tag = cmd.tag;
  if (!tag) {
    const base = cmd.structure ?? others[0]?.tag ?? {};
    const structure = { ...(base.function ? { function: base.function } : {}), ...(base.location ? { location: base.location } : {}) };
    let n = 1;
    while (devices.devices.has(formatTag({ ...structure, product: `A${n}` }))) n++;
    tag = { ...structure, product: `A${n}` };
  }
  if (!tag.product) throw commandError('A PLC card needs a device tag (e.g. -A10)');
  const key = formatTag(tag);
  if (devices.devices.has(key)) throw commandError('The device {device} already exists', { device: key });
  const slot = cmd.slot ?? (cmd.station !== undefined ? Math.max(0, ...others.map((o) => (o.item.props!.plc!.slot ?? 0) + 1)) : undefined);
  let props: ItemProps;
  let symbol = 'wirewright.plc.card';
  if (cmd.device !== undefined) {
    const def = ctx.library.device(cmd.device);
    if (!def) throw commandError('Unknown device "{device}"', { device: cmd.device });
    const main = Math.max(0, def.functions.findIndex((f) => f.main));
    // I/O cards, and CPUs or couplers (cards without channels).
    if (def.functions[main]?.symbol !== 'wirewright.plc.card') throw commandError('"{device}" is not a PLC card of the device library', { device: cmd.device });
    const placed = placeFunctionCommand(def, main, ctx.library, { pageId: PLC_STORE_PAGE, x: 0, y: 0 });
    symbol = placed.symbol;
    props = structuredClone(placed.props) as ItemProps;
    // Like placing a device: its definition is kept in the project.
    if (!state.library?.devices?.some((d) => d.id === def.id)) addToProjectLibrary(draft, { type: 'addToProjectLibrary', content: { devices: [def] } });
  } else {
    props = { plc: { channels: structuredClone(cmd.channels ?? []) } };
  }
  props.plc = { channels: [], ...props.plc, ...(cmd.station ? { station: cmd.station } : {}), ...(slot !== undefined ? { slot } : {}) };
  const id = claimItemId(draft, cmd.id);
  (draft.project.plcCards ??= []).push({ id, symbol, x: 0, y: 0, rotation: 0, mirror: false, tag, main: true, props: parseProps(props as Record<string, unknown>) });
  ctx.result.created.push(id);
}

/** Draws a card: from the store onto the page (it keeps its ID and tag), else as a further overview. */
function placePlcCard(draft: DraftState, cmd: CommandOf<'placePlcCard'>, ctx: ApplyContext): void {
  const page = getSchematicPage(draft, cmd.pageId);
  const stored = (draft.project.plcCards ?? []).findIndex((i) => i.id === cmd.itemId);
  if (stored < 0) {
    const state = snapshot(draft) as ProjectState;
    const card = buildPlcIndex(state, ctx.library, buildDeviceIndex(state, ctx.library), buildConnectivity(state, ctx.library)).byCard.get(cmd.itemId);
    if (!card) throw commandError('PLC card "{item}" not found', { item: cmd.itemId });
    placeSymbol(draft, placePlcCommand(state, ctx.library, card, { pageId: cmd.pageId, x: cmd.x, y: cmd.y }), ctx);
    return;
  }
  const item = structuredClone(snapshot(draft.project.plcCards![stored]!) as Item);
  draft.project.plcCards!.splice(stored, 1);
  if (draft.project.plcCards!.length === 0) delete draft.project.plcCards;
  const full = item.tag ?? {};
  const context = tagContext(snapshot(page) as SchematicPage, { x: cmd.x, y: cmd.y }, ctx.library);
  const tag = relativeTag(full, context);
  const placed: Item = { ...item, x: cmd.x, y: cmd.y };
  if (Object.keys(tag).length > 0) placed.tag = tag;
  else delete placed.tag;
  page.items.push(placed);
  ctx.result.created.push(placed.id);
}

function deleteItems(draft: DraftState, cmd: CommandOf<'deleteItems'>, ctx: ApplyContext): void {
  const page = getSchematicPage(draft, cmd.pageId);
  for (const id of cmd.itemIds) findItem(page, id);
  // Deleting the drawing of a PLC card keeps the card in the project (PLC tab); in the card store
  // (PLC tab) deleting removes it.
  if (cmd.pageId !== PLC_STORE_PAGE) stashPlcCards(draft, cmd.pageId, cmd.itemIds, ctx.library);
  const ids = new Set(cmd.itemIds);
  page.items = page.items.filter((item) => !ids.has(item.id));
}

function setItemProperties(draft: DraftState, cmd: CommandOf<'setItemProperties'>, ctx: ApplyContext): void {
  const page = getSchematicPage(draft, cmd.pageId);
  const item = findItem(page, cmd.itemId);
  const def = ctx.library.symbol(item.symbol);

  if (cmd.props) {
    const props: Record<string, unknown> = { ...item.props };
    for (const [key, value] of Object.entries(cmd.props)) {
      if (value === null) delete props[key];
      else props[key] = value;
    }
    if (Object.keys(props).length > 0) item.props = parseProps(props);
    else delete item.props;
    // Further overviews (views) of a card keep the card's channels.
    if ('plc' in cmd.props) syncPlcViews(draft, item.id, item.props?.plc?.channels ?? []);
  }
  if (cmd.main === null) delete item.main;
  else if (cmd.main !== undefined) item.main = cmd.main;
  if (cmd.main !== undefined) adoptLeftNeighbour(draft, cmd.pageId, item.id, ctx);
  if (cmd.pins) {
    item.pins ??= {};
    applyStringMapUpdate(item.pins, cmd.pins);
    if (Object.keys(item.pins).length === 0) delete item.pins;
  }
  if (cmd.pinPotentials) {
    item.pinPotentials ??= {};
    applyStringMapUpdate(item.pinPotentials, cmd.pinPotentials);
    if (Object.keys(item.pinPotentials).length === 0) delete item.pinPotentials;
  }
  if (cmd.width !== undefined || cmd.height !== undefined) {
    if (def?.generator === 'cable') {
      // Exactly one of them: the line's length along its direction.
      if (cmd.width !== undefined) {
        item.width = cmd.width;
        delete item.height;
      } else {
        item.height = cmd.height!;
        delete item.width;
      }
    } else {
      if (!def?.resizable) throw commandError('Symbol "{symbol}" has a fixed size', { symbol: item.symbol });
      if (cmd.width !== undefined) item.width = cmd.width;
      if (cmd.height !== undefined) item.height = cmd.height;
    }
  }
  if (cmd.borderPins) {
    if (def?.function !== 'box.device') throw commandError('Only device boxes have border pins');
    item.borderPins = cmd.borderPins;
  }
  if (cmd.links !== undefined) {
    if (def?.function !== 'box.device') throw commandError('Only device boxes have editable pin links');
    if (cmd.links === null) delete item.links;
    else item.links = cmd.links;
  }
}

/**
 * Changes an item's stored tag. On a main function this renames the whole
 * device: its auxiliary functions follow. On an auxiliary function only this
 * function changes, so it moves to another device. See docs/editor.md.
 */
function setItemTag(draft: DraftState, cmd: CommandOf<'setItemTag'>, ctx: ApplyContext): void {
  const page = getSchematicPage(draft, cmd.pageId);
  const item = findItem(page, cmd.itemId);
  const before = snapshot(draft) as ProjectState;
  const beforeIndex = buildDeviceIndex(before, ctx.library);

  const tag: Tag = { ...item.tag };
  for (const aspect of ['function', 'location', 'product'] as const) {
    const value = cmd.tag[aspect];
    if (value === null) delete tag[aspect];
    else if (value !== undefined) tag[aspect] = value;
  }
  if (Object.keys(tag).length > 0) item.tag = tag;
  else delete item.tag;

  const oldKey = beforeIndex.byItem.get(item.id);
  const isMain = oldKey !== undefined && beforeIndex.devices.get(oldKey)?.main?.itemId === item.id;
  const after = snapshot(draft) as ProjectState;
  const newKey = formatTag(effectiveTag(after.pages[cmd.pageId] as SchematicPage, item, ctx.library));
  if (isMain && newKey !== oldKey) {
    const target = beforeIndex.devices.get(newKey);
    if (target?.main) throw commandError('Device {device} already exists', { device: newKey });
  }
  followMainFunctions(draft, beforeIndex, new Set([item.id]), ctx.library);
  if (cmd.tag.product === null) adoptLeftNeighbour(draft, cmd.pageId, item.id, ctx);
}

/**
 * A symbol that is not a master (a contact, or a symbol whose Master box was
 * unchecked) and has no device of its own joins the device of the nearest
 * symbol to its left at the same height, like a contact placed there. "No
 * device of its own": no product in its tag, or only a name no other symbol
 * uses (e.g. the automatic name it got as a master). Inside a device box it
 * belongs to the box instead.
 */
function adoptLeftNeighbour(draft: DraftState, pageId: string, itemId: string, ctx: ApplyContext): void {
  const { library } = ctx;
  const page = getSchematicPage(draft, pageId);
  const item = findItem(page, itemId);
  const def = library.symbol(item.symbol);
  if (!def || itemRole(item, def) !== 'auxiliary') return;
  const snapshotPage = snapshot(page) as SchematicPage;
  const context = tagContext(snapshotPage, item, library);
  if (context.product) return;
  if (item.tag?.product) {
    const index = buildDeviceIndex(snapshot(draft) as ProjectState, library);
    const key = index.byItem.get(item.id);
    if (!key || (index.devices.get(key)?.functions.length ?? 0) > 1) return;
  }
  const neighbour = tagFromLeftNeighbour(snapshotPage, item, library, item.id);
  if (!neighbour) return;
  const rest: Tag = { ...item.tag };
  delete rest.product;
  const own = { function: rest.function ?? context.function, location: rest.location ?? context.location };
  item.tag = { ...relativeTag(neighbour, own), ...rest };
}

function moveItemText(draft: DraftState, cmd: CommandOf<'moveItemText'>): void {
  const item = findItem(getSchematicPage(draft, cmd.pageId), cmd.itemId);
  if (cmd.offset === null) {
    if (item.texts) delete item.texts[cmd.field];
    if (item.texts && Object.keys(item.texts).length === 0) delete item.texts;
  } else {
    item.texts ??= {};
    item.texts[cmd.field] = { ...item.texts[cmd.field], dx: cmd.offset.dx, dy: cmd.offset.dy };
  }
}

/** Layout of generated PLC overview pages (mm): card columns, their pitch and the gaps. */
const PLC_OVERVIEW = { left: 12, top: 8, pitch: 92, gap: 16 };

function generatePlcOverview(draft: DraftState, cmd: CommandOf<'generatePlcOverview'>, ctx: ApplyContext): void {
  const state = snapshot(draft) as ProjectState;
  if (!state.project.plcs.some((p) => p.name === cmd.station)) throw commandError('PLC "{plc}" not found', { plc: cmd.station });
  const cards: { page: SchematicPage; item: Item; key: string; slot: number }[] = [];
  for (const page of devicePages(state)) {
    for (const item of page.items) {
      if (item.props?.plc?.station !== cmd.station || item.props.plcView) continue;
      cards.push({ page, item, key: formatTag(effectiveTag(page, item, ctx.library)), slot: item.props.plc.slot ?? Number.MAX_SAFE_INTEGER });
    }
  }
  cards.sort((a, b) => a.slot - b.slot || naturalCompare(a.key, b.key));
  // Only cards that are not drawn yet (in the PLC tab's card store): drawn ones stay where they
  // are, with their wiring; a second drawing would be reported.
  const missing = cards.filter((c) => c.page.id === PLC_STORE_PAGE);
  if (missing.length === 0) return;

  // Columns of cards stacked while they fit the drawing area; then the next column and page.
  const area = ctx.library.frame(state.project.settings.defaultFrame)?.drawingArea ?? { x: 24, y: 16, width: 380, height: 240 };
  const columns = Math.max(1, Math.floor((area.width - PLC_OVERVIEW.left) / PLC_OVERVIEW.pitch));
  const top = area.y + PLC_OVERVIEW.top;
  const bottom = area.y + area.height - PLC_OVERVIEW.top;
  const pages: { card: (typeof cards)[number]; x: number; y: number }[][] = [[]];
  let column = 0;
  let y = top;
  for (const card of missing) {
    const height = plcCardLayout(card.item.props!.plc!.channels).height;
    if (y > top && y + height > bottom) {
      column++;
      y = top;
    }
    if (column >= columns) {
      pages.push([]);
      column = 0;
    }
    pages.at(-1)!.push({ card, x: area.x + PLC_OVERVIEW.left + column * PLC_OVERVIEW.pitch, y });
    y += height + PLC_OVERVIEW.gap;
  }

  const firstTag = missing[0]!.item.tag ?? {};
  const structure = cmd.structure ?? (firstTag.function || firstTag.location ? { ...(firstTag.function ? { function: firstTag.function } : {}), ...(firstTag.location ? { location: firstTag.location } : {}) } : {});
  const sameStructure = (p: Page) => (p.structure?.function ?? '') === (structure.function ?? '') && (p.structure?.location ?? '') === (structure.location ?? '');
  let number = Math.max(0, ...Object.values(state.pages).filter(sameStructure).map((p) => Number.parseInt(p.name, 10)).filter((n) => !Number.isNaN(n)));
  for (const placements of pages) {
    createPage(
      draft,
      {
        type: 'createPage',
        name: String(++number),
        description: { de: `SPS-Übersicht ${cmd.station}`, en: `PLC overview ${cmd.station}` },
        ...(Object.keys(structure).length > 0 ? { structure } : {}),
      },
      ctx,
    );
    const pageId = ctx.result.created.at(-1)!;
    getPage(draft, pageId).properties = { plcOverview: cmd.station };
    for (const { card, x, y } of placements) {
      placePlcCard(draft, { type: 'placePlcCard', itemId: card.item.id, pageId, x, y }, ctx);
    }
  }
}

/** The text layout of an item, for the style brush. */
export function itemStyle(item: Item): ItemStyle {
  return {
    ...(item.texts && Object.keys(item.texts).length > 0 ? { texts: structuredClone(item.texts) } : {}),
    ...(item.textArrangement ? { textArrangement: { ...item.textArrangement } } : {}),
  };
}

function setTextArrangement(draft: DraftState, cmd: CommandOf<'setTextArrangement'>): void {
  const item = findItem(getSchematicPage(draft, cmd.pageId), cmd.itemId);
  if (cmd.arrangement === null) delete item.textArrangement;
  else item.textArrangement = cmd.arrangement;
  // The arrangement places these texts; earlier own positions would only get in the way.
  if (item.texts) {
    for (const field of ARRANGED_TEXT_FIELDS) delete item.texts[field];
    if (Object.keys(item.texts).length === 0) delete item.texts;
  }
}

function setItemTextStyle(draft: DraftState, cmd: CommandOf<'setItemTextStyle'>): void {
  const item = findItem(getSchematicPage(draft, cmd.pageId), cmd.itemId);
  const text = { dx: 0, dy: 0, ...item.texts?.[cmd.field] };
  if (cmd.angle !== undefined) {
    if (cmd.angle === null) delete text.angle;
    else text.angle = cmd.angle;
  }
  if (cmd.align !== undefined) {
    if (cmd.align === null) delete text.align;
    else text.align = cmd.align;
  }
  item.texts ??= {};
  if (text.dx === 0 && text.dy === 0 && text.angle === undefined && text.align === undefined) delete item.texts[cmd.field];
  else item.texts[cmd.field] = text;
  if (Object.keys(item.texts).length === 0) delete item.texts;
}

// ---------------------------------------------------------------------------
// Devices

function renameDevice(draft: DraftState, cmd: CommandOf<'renameDevice'>, ctx: ApplyContext): void {
  const index = buildDeviceIndex(snapshot(draft) as ProjectState, ctx.library);
  const device = index.devices.get(formatTag(parseTagOrThrow(cmd.device)));
  if (!device) throw commandError('Device {device} not found', { device: cmd.device });
  const newTag = parseTagOrThrow(cmd.to);
  if (!newTag.product) throw commandError('New tag "{tag}" has no device part (e.g. -K1)', { tag: cmd.to });
  const newKey = formatTag(newTag);
  if (newKey === device.key) return;
  if (index.devices.has(newKey)) throw commandError('Device {device} already exists', { device: newKey });
  retagDevice(draft, device, newTag, ctx.library);
}

/** Renames devices by the current position of their main function (page/column or counter scheme). */
/** Copies a card's channels into its views (further overviews placed from the PLC tab). */
function syncPlcViews(draft: DraftState, cardItemId: string, channels: readonly IoChannel[]): void {
  for (const page of Object.values(draft.pages)) {
    if (page.type !== 'schematic') continue;
    for (const item of page.items) {
      if (item.props?.plcView?.of === cardItemId) item.props.plcView.channels = structuredClone(channels as IoChannel[]);
    }
  }
}

/** Renames pages to prefix + start, start + step, … in page order; names must stay unique per structure. */
function renumberPages(draft: DraftState, cmd: CommandOf<'renumberPages'>): void {
  for (const id of cmd.pageIds) getPage(draft, id);
  const state = snapshot(draft) as ProjectState;
  for (const change of planPageNames(state, cmd)) getPage(draft, change.pageId).name = change.to;
  for (const page of Object.values(draft.pages)) assertUniquePageName(draft, page.name, page.structure, page.id);
}

function renumberDevices(draft: DraftState, cmd: CommandOf<'renumberDevices'>, ctx: ApplyContext): void {
  for (const id of cmd.pageIds ?? []) getSchematicPage(draft, id);
  const before = snapshot(draft) as ProjectState;
  const index = buildDeviceIndex(before, ctx.library);
  for (const change of planRenumbering(before, ctx.library, { ...(cmd.pageIds ? { pageIds: cmd.pageIds } : {}), ...(cmd.exclude ? { exclude: cmd.exclude } : {}) })) {
    retagDevice(draft, index.devices.get(change.from)!, change.tag, ctx.library);
  }
}

function applyDeviceTemplate(draft: DraftState, cmd: CommandOf<'applyDeviceTemplate'>, ctx: ApplyContext): void {
  const item = findItem(getSchematicPage(draft, cmd.pageId), cmd.itemId);
  const template = ctx.library.template(cmd.template);
  if (!template) throw commandError('Unknown device template "{template}"', { template: cmd.template });
  if (itemRole(item, ctx.library.symbol(item.symbol)) !== 'main') {
    throw commandError('Device templates can only be applied to a main function (e.g. a coil)');
  }
  item.props = { ...item.props, contacts: structuredClone(template.contacts) };
}

/**
 * When a main function's effective tag changed (by a move or a tag edit), the
 * other functions of its device follow it to the new tag.
 */
function followMainFunctions(draft: DraftState, beforeIndex: DeviceIndex, changed: ReadonlySet<string>, library: Library): void {
  for (const itemId of changed) {
    const key = beforeIndex.byItem.get(itemId);
    const device = key === undefined ? undefined : beforeIndex.devices.get(key);
    if (!device?.main || device.main.itemId !== itemId) continue;
    const page = snapshot(draft.pages[device.main.pageId]!) as SchematicPage;
    const newTag = effectiveTag(page, findItem(page, itemId), library);
    if (formatTag(newTag) === device.key) continue;
    const others = device.functions.filter((f) => !changed.has(f.itemId));
    retagFunctions(draft, others, newTag, library);
  }
}

function retagDevice(draft: DraftState, device: Device, tag: Tag, library: Library): void {
  retagFunctions(draft, device.functions, tag, library);
}

/**
 * Gives each function the effective tag `tag`, storing only the aspects that
 * differ from its page and boxes. Device boxes go first, so components inside
 * them keep inheriting the box's (new) name.
 */
function retagFunctions(draft: DraftState, functions: readonly Device['functions'][number][], tag: Tag, library: Library): void {
  const ordered = [...functions].sort(
    (a, b) => Number(isDeviceBox(b.symbol, library)) - Number(isDeviceBox(a.symbol, library)),
  );
  for (const f of ordered) {
    if (f.pageId === PLC_STORE_PAGE) {
      // A card not drawn yet keeps its full tag.
      const item = (draft.project.plcCards ?? []).find((i) => i.id === f.itemId);
      if (item) item.tag = { ...tag };
      continue;
    }
    const draftPage = draft.pages[f.pageId];
    if (draftPage?.type !== 'schematic') continue;
    const page = snapshot(draftPage) as SchematicPage;
    const context = tagContext(page, findItem(page, f.itemId), library, f.itemId);
    const stored = relativeTag(tag, context);
    const item = findItem(draftPage, f.itemId);
    if (Object.keys(stored).length > 0) item.tag = stored;
    else delete item.tag;
  }
}

function isDeviceBox(symbol: string, library: Library): boolean {
  return library.symbol(symbol)?.function === 'box.device';
}

// ---------------------------------------------------------------------------
// Texts

function replaceTexts(draft: DraftState, cmd: CommandOf<'replaceTexts'>, ctx: ApplyContext): void {
  const pattern = new RegExp(escapeRegExp(cmd.find), cmd.matchCase ? 'g' : 'gi');
  const fields = new Set(cmd.fields);
  for (const id of cmd.pageIds ?? []) getPage(draft, id);
  const pageIds = cmd.pageIds ?? draft.project.pages;

  const replaceString = (text: string): string => {
    const next = text.replace(pattern, () => cmd.replace);
    if (next !== text) ctx.result.replaced++;
    return next;
  };
  const replaceText = (text: LocalizedText): LocalizedText => {
    if (typeof text === 'string') return replaceString(text);
    const next: Record<string, string> = { ...text };
    for (const [lang, value] of Object.entries(text)) {
      if (cmd.language === undefined || cmd.language === lang) next[lang] = replaceString(value);
    }
    return next;
  };

  for (const pageId of pageIds) {
    const page = getPage(draft, pageId);
    if (fields.has('pageDescription') && page.description !== undefined) page.description = replaceText(page.description);
    if (page.type !== 'schematic') continue;
    for (const item of page.items) {
      if (fields.has('product') && item.tag?.product) {
        const product = replaceString(item.tag.product);
        if (!tagValueSchema.safeParse(product).success) {
          throw commandError('Replacing gives the invalid device tag "-{product}"', { product });
        }
        item.tag.product = product;
      }
      for (const field of ['functionText', 'technicalData'] as const) {
        const value = item.props?.[field];
        if (fields.has(field) && value !== undefined && item.props) item.props[field] = replaceText(value);
      }
    }
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Helpers

/** Plain copy of a draft for read-only computations. Objects added in this batch are not drafts yet. */
function snapshot<T>(value: T): T {
  return isDraft(value) ? (current(value as Draft<T>) as T) : value;
}

function getPage(draft: DraftState, pageId: string): Draft<Page> {
  const page = draft.pages[pageId];
  if (!page) throw commandError('Page "{page}" not found', { page: pageId });
  return page;
}

function getSchematicPage(draft: DraftState, pageId: string): Draft<SchematicPage> {
  // The card store: item commands (properties, tag, delete) work on cards not drawn yet.
  if (pageId === PLC_STORE_PAGE) {
    return {
      id: PLC_STORE_PAGE,
      type: 'schematic',
      name: 'PLC',
      get items() {
        return draft.project.plcCards ?? [];
      },
      set items(items: Item[]) {
        if (items.length > 0) draft.project.plcCards = items;
        else delete draft.project.plcCards;
      },
    } as unknown as Draft<SchematicPage>;
  }
  const page = getPage(draft, pageId);
  if (page.type !== 'schematic') throw commandError('Page "{page}" is a report page and has no symbols', { page: page.name });
  return page;
}

function findItem<T extends { items: Item[] } | Draft<SchematicPage>>(page: T, itemId: string): T['items'][number] {
  const item = page.items.find((i) => i.id === itemId);
  if (!item) throw commandError('Item "{item}" not found on this page', { item: itemId });
  return item;
}

function parseProps(props: Record<string, unknown>): Item['props'] {
  const result = itemPropsSchema.safeParse(props);
  if (!result.success) throw commandError('Invalid properties: {details}', { details: result.error.issues.map((i) => i.message).join('; ') });
  return result.data;
}

function parseTagOrThrow(text: string): Tag {
  try {
    return parseTag(text);
  } catch (error) {
    throw new CommandError((error as Error).message);
  }
}

function applyStringMapUpdate(target: Record<string, string>, update: Record<string, string | null>): void {
  for (const [key, value] of Object.entries(update)) {
    if (value === null) delete target[key];
    else target[key] = value;
  }
}

/** Whether two pages are in the same structure group (function and location) for page sorting. */
export function sameStructureGroup(a: Page | undefined, b: Page | undefined): boolean {
  return (a?.structure?.function ?? '') === (b?.structure?.function ?? '') && (a?.structure?.location ?? '') === (b?.structure?.location ?? '');
}
