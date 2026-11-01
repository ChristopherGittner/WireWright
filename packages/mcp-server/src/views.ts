// What the AI sees: compact JSON views of project data. Positions are given as
// page coordinates in mm and as page/column references (`/5.3`); connection
// points are given in absolute page coordinates so symbols can be aligned for
// autoconnect.
import {
  channelLabel,
  effectiveTag,
  formatReference,
  formatTag,
  itemRole,
  layoutFootprint,
  layoutSize,
  localize,
  pageFullName,
  pagePosition,
  relativeTag,
  resolveSymbol,
  tagContext,
  transformDirection,
  transformPoint,
  type DeviceIndex,
  type PlcIndex,
  type Issue,
  type Item,
  type Library,
  type LocalizedText,
  type Page,
  type ProjectState,
  type SchematicPage,
  type SymbolDefinition,
} from '@wirewright/core';

export function pageRef(page: Page): Record<string, unknown> {
  return {
    id: page.id,
    name: page.name,
    fullName: pageFullName(page),
    type: page.type,
    ...(page.type === 'report' ? { report: page.report.kind } : {}),
    ...(page.description !== undefined ? { description: page.description } : {}),
  };
}

export function projectView(state: ProjectState, library: Library, devices: DeviceIndex, issues: Issue[]): Record<string, unknown> {
  const { project } = state;
  const frame = library.frame(project.settings.defaultFrame);
  return {
    name: project.name,
    description: project.description,
    properties: project.properties,
    settings: project.settings,
    potentials: project.potentials,
    plcs: project.plcs,
    pages: project.pages.flatMap((id) => (state.pages[id] ? [pageRef(state.pages[id])] : [])),
    deviceCount: devices.devices.size,
    issues: countBySeverity(issues),
    ...(frame
      ? {
          frame: {
            id: frame.id,
            size: frame.size,
            drawingArea: frame.drawingArea,
            columns: frame.columns,
            rows: frame.rows,
            note: 'Coordinates are integer mm from the top-left corner. Place symbols inside the drawing area on the 4 mm grid.',
          },
        }
      : {}),
  };
}

export function pageView(state: ProjectState, page: Page, library: Library, devices: DeviceIndex, plc?: PlcIndex): Record<string, unknown> {
  if (page.type === 'report') return { ...pageRef(page), structure: page.structure, report: page.report };
  if (page.type === 'layout') {
    return {
      ...pageRef(page),
      structure: page.structure,
      surface: page.surface ?? 'plate',
      plate: page.plate,
      scale: page.scale,
      note: 'Positions and sizes are real mm from the plate\'s top-left corner.',
      items: page.items.map((item) => {
        if (item.kind !== 'device') return { ...item, size: layoutSize(item) };
        const f = layoutFootprint(state, library, devices, item, page.surface);
        return { ...item, device: f.device ?? '(gone)', size: { width: f.width, height: f.height }, sizeFrom: f.fromPart ? 'part' : item.width !== undefined ? 'item' : 'default', shape: f.shape, ...(f.part ? { part: f.part } : {}) };
      }),
    };
  }
  return {
    ...pageRef(page),
    structure: page.structure,
    frame: page.frame ?? state.project.settings.defaultFrame,
    items: page.items.map((item) => itemView(state, page, item, library, devices, plc)),
  };
}

export function itemView(
  state: ProjectState,
  page: SchematicPage,
  item: Item,
  library: Library,
  devices?: DeviceIndex,
  plc?: PlcIndex,
): Record<string, unknown> {
  const { settings } = state.project;
  const def = resolveSymbol(item, library);
  const role = itemRole(item, def);
  const tag = effectiveTag(page, item, library);
  const context = tagContext(page, item, library, item.id);
  const view: Record<string, unknown> = {
    id: item.id,
    symbol: item.symbol,
    function: def?.function ?? 'unknown',
    role,
    x: item.x,
    y: item.y,
    position: formatReference(page, pagePosition(page, item, settings, library), settings, page.structure),
  };
  if (item.rotation !== 0) view.rotation = item.rotation;
  if (item.mirror) view.mirror = true;
  if (item.width !== undefined) view.size = { width: item.width, height: item.height };
  if (role !== 'none' || item.tag) {
    view.tag = formatTag(tag);
    view.displayTag = formatTag(relativeTag(tag, context));
    const device = devices?.byItem.get(item.id);
    if (device) view.device = device;
  }
  if (item.props) view.props = item.props;
  if (item.pinPotentials) view.pinPotentials = item.pinPotentials;
  if (item.borderPins) view.borderPins = item.borderPins;
  const card = plc?.byCard.get(item.id);
  if (card) {
    view.plcCard = {
      plc: card.station?.name,
      slot: card.slot,
      channels: card.channels.map((c) => ({ channel: channelLabel(c.channel), pin: c.channel.pin, address: c.address, name: c.name, function: c.function, functionSource: c.functionSource, drawnAt: c.slaves.map((s) => s.pageId) })),
    };
  }
  const point = plc?.bySlave.get(item.id);
  if (point) view.plcPoint = { card: point.card.device, channel: channelLabel(point.channel.channel), pin: point.channel.channel.pin, address: point.channel.address, name: point.channel.name, function: point.channel.function };
  if (def && def.connections.length > 0) {
    view.connections = def.connections.map((c) => {
      const p = transformPoint(c, item.rotation, item.mirror);
      return {
        pin: c.id,
        designation: item.pins?.[c.id] ?? c.designation,
        x: item.x + p.x,
        y: item.y + p.y,
        direction: transformDirection(c.direction, item.rotation, item.mirror),
      };
    });
  }
  return view;
}

export function symbolView(def: SymbolDefinition, language: string): Record<string, unknown> {
  return {
    id: def.id,
    name: localize(def.name, language, ['en']),
    category: def.category,
    function: def.function,
    role: def.defaultRole,
    ...(def.letterCode ? { letterCode: def.letterCode } : {}),
    ...(def.resizable ? { resizable: true } : {}),
    connections: def.connections.map((c) => ({ pin: c.id, designation: c.designation, x: c.x, y: c.y, direction: c.direction })),
    ...(def.links !== undefined ? { links: def.links } : {}),
  };
}

export function devicesView(state: ProjectState, library: Library, devices: DeviceIndex, query?: string): Record<string, unknown>[] {
  const { settings } = state.project;
  const needle = query?.toLowerCase();
  const result: Record<string, unknown>[] = [];
  for (const device of devices.devices.values()) {
    const main = device.main && findItem(state, device.main.pageId, device.main.itemId);
    const functionText = main?.props?.functionText;
    if (needle && !device.key.toLowerCase().includes(needle) && !textMatches(functionText, needle)) continue;
    result.push({
      device: device.key,
      ...(functionText !== undefined ? { functionText } : {}),
      ...(main?.props?.parts ? { parts: main.props.parts } : {}),
      ...(main?.props?.contacts ? { contacts: main.props.contacts } : {}),
      functions: device.functions.map((f) => {
        const page = state.pages[f.pageId] as SchematicPage;
        const item = findItem(state, f.pageId, f.itemId)!;
        return {
          page: page.name,
          pageId: f.pageId,
          itemId: f.itemId,
          function: f.function,
          role: f.role,
          position: formatReference(page, pagePosition(page, item, settings, library), settings),
        };
      }),
    });
  }
  return result;
}

function findItem(state: ProjectState, pageId: string, itemId: string): Item | undefined {
  const page = state.pages[pageId];
  return page?.type === 'schematic' ? page.items.find((i) => i.id === itemId) : undefined;
}

function textMatches(text: LocalizedText | undefined, needle: string): boolean {
  if (text === undefined) return false;
  const values = typeof text === 'string' ? [text] : Object.values(text);
  return values.some((v) => v.toLowerCase().includes(needle));
}

function countBySeverity(issues: Issue[]): Record<string, number> {
  const counts: Record<string, number> = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) {
    if (issue.acknowledged) counts.acknowledged = (counts.acknowledged ?? 0) + 1;
    else counts[issue.severity] = (counts[issue.severity] ?? 0) + 1;
  }
  return counts;
}
