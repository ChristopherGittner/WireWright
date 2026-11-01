// Device definitions: a device as it is bought, with all its symbols. Placing
// a device steps through its functions (Tab in the editor); every placed
// function gets the device's tag. See docs/data-model.md, "Device library".
import type { Command } from './commands/schema.js';
import type { Device } from './devices.js';
import type { Library } from './library.js';
import type { ContactTemplateEntry, DeviceDefinition, DeviceFunctionDefinition, Item, ItemProps, ProjectState, Rotation, Tag } from './schema.js';
import { localize } from './text.js';

const CONTACT_FUNCTIONS = ['contact.no', 'contact.nc', 'contact.co', 'contactor.main'];

/** Contact image template of a definition: explicit, or from its contact functions. */
export function definitionContacts(def: DeviceDefinition, library: Library): ContactTemplateEntry[] | undefined {
  if (def.contacts) return def.contacts;
  const entries = def.functions.flatMap((f) => {
    const symbol = library.symbol(f.symbol);
    if (!symbol || f.main || !CONTACT_FUNCTIONS.includes(symbol.function)) return [];
    return [{ function: symbol.function, pins: symbol.connections.map((c) => f.pins?.[c.id] ?? c.designation ?? c.id) }];
  });
  return entries.length > 0 ? entries : undefined;
}

/** Label of a function while placing: its own label, or symbol name and pins. */
export function functionLabel(def: DeviceDefinition, index: number, library: Library, language: string): string {
  const f = def.functions[index];
  if (!f) return '';
  if (f.label !== undefined) return localize(f.label, language, ['en']);
  const symbol = library.symbol(f.symbol);
  const name = symbol ? localize(symbol.name, language, ['en']) : f.symbol;
  const pins = f.pins ? Object.values(f.pins).join('/') : '';
  return pins ? `${name} ${pins}` : name;
}

export interface PlaceFunctionOptions {
  pageId: string;
  x: number;
  y: number;
  rotation?: Rotation;
  mirror?: boolean;
  /** Tag of the device when one of its functions is already placed. */
  tag?: Tag;
  id?: string;
}

/**
 * The placeSymbol command for function `index` of a definition. The main
 * function carries the device data: part, contact template, I/O channels.
 */
export function placeFunctionCommand(def: DeviceDefinition, index: number, library: Library, options: PlaceFunctionOptions): Extract<Command, { type: 'placeSymbol' }> {
  const f = def.functions[index];
  if (!f) throw new Error(`Device "${def.id}" has no function ${index + 1}`);
  const isMain = f.main ?? index === 0;
  const props: ItemProps = { device: def.id };
  if (f.channel !== undefined) props.channel = f.channel;
  if (isMain) {
    if (def.partNumber) props.parts = [{ manufacturer: def.manufacturer ?? '', partNumber: def.partNumber, quantity: 1 }];
    const contacts = definitionContacts(def, library);
    if (contacts) props.contacts = contacts;
    if (def.plc) props.plc = { channels: structuredClone(def.plc.channels) };
    if (def.cable) props.cable = structuredClone(def.cable);
  }
  return {
    type: 'placeSymbol',
    pageId: options.pageId,
    ...(options.id ? { id: options.id } : {}),
    symbol: f.symbol,
    x: options.x,
    y: options.y,
    ...(options.rotation !== undefined ? { rotation: options.rotation } : {}),
    ...(options.mirror !== undefined ? { mirror: options.mirror } : {}),
    ...(options.tag ? { tag: options.tag } : {}),
    main: isMain,
    ...(f.pins ? { pins: f.pins } : {}),
    props: props as Record<string, unknown>,
  };
}

/** Indices of the definition's functions that a device already has (same symbol and pins, or same channel). */
export function placedFunctions(def: DeviceDefinition, device: Device | undefined, state: ProjectState): Set<number> {
  const placed = new Set<number>();
  if (!device) return placed;
  const items = device.functions.flatMap((f) => {
    const page = state.pages[f.pageId];
    const item = page?.type === 'schematic' ? page.items.find((i) => i.id === f.itemId) : undefined;
    return item ? [item] : [];
  });
  for (const item of items) {
    const index = def.functions.findIndex((f, i) => !placed.has(i) && matches(f, item));
    if (index >= 0) placed.add(index);
  }
  return placed;
}

function matches(f: DeviceFunctionDefinition, item: Item): boolean {
  if (f.symbol !== item.symbol) return false;
  if (f.channel !== undefined) return item.props?.channel === f.channel;
  return JSON.stringify(f.pins ?? {}) === JSON.stringify(item.pins ?? {});
}

/** A definition made from a drawn device: its functions, part and channels (for "save device to library"). */
export function definitionFromDevice(device: Device, state: ProjectState, id: string, name: string): DeviceDefinition {
  const items = device.functions.flatMap((f) => {
    const page = state.pages[f.pageId];
    const item = page?.type === 'schematic' ? page.items.find((i) => i.id === f.itemId) : undefined;
    return item ? [{ item, main: f.role === 'main' }] : [];
  });
  items.sort((a, b) => Number(b.main) - Number(a.main));
  const main = items.find((i) => i.main)?.item;
  const part = main?.props?.parts?.[0];
  return {
    id,
    name,
    ...(part ? { manufacturer: part.manufacturer, partNumber: part.partNumber } : {}),
    functions: items.map(({ item, main: isMain }) => ({
      symbol: item.symbol,
      ...(isMain ? { main: true } : {}),
      ...(item.pins ? { pins: item.pins } : {}),
      ...(item.props?.channel !== undefined ? { channel: item.props.channel } : {}),
    })),
    ...(main?.props?.contacts ? { contacts: main.props.contacts } : {}),
    ...(main?.props?.plc ? { plc: { channels: main.props.plc.channels } } : {}),
    ...(main?.props?.cable ? { cable: main.props.cable } : {}),
  };
}
