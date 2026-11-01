// PLC stations, I/O cards and channels. See docs/data-model.md, "PLC".
//
// - A card is a device whose main function carries `props.plc`: station, slot,
//   start addresses and the channel list (channel number, kind, terminal pin).
// - The card can be drawn whole (card master, usually on a PLC overview page)
//   and/or as single I/O points (slaves) on the pages where the sensors are.
// - Addresses are derived from the card's start address and the channel's
//   position among the card's channels of the same kind.
import type { Connectivity } from './connectivity.js';
import type { DeviceIndex } from './devices.js';
import { itemRole } from './devices.js';
import { issueMessage, type Issue } from './issues.js';
import type { Library } from './library.js';
import type { IoChannel, IoKind, IoStart, Item, LocalizedText, PlcStation, ProjectState, SchematicPage, SymbolDefinition } from './schema.js';
import { channelPins, isPlcPoint, plcPointKind, plcPointSymbol, resolveSymbol } from './symbols.js';
import { pageOrStore, PLC_STORE_PAGE, plcStorePage } from './plcStore.js';
import { effectiveTag, relativeTag, tagContext } from './tags.js';
import type { Command } from './commands/schema.js';

export const IO_KINDS: readonly IoKind[] = ['DI', 'DO', 'AI', 'AO'];

// ---------------------------------------------------------------------------
// Addresses

const SIEMENS_PREFIX: Record<'international' | 'german', Record<IoKind, string>> = {
  international: { DI: 'I', DO: 'Q', AI: 'IW', AO: 'QW' },
  german: { DI: 'E', DO: 'A', AI: 'EW', AO: 'AW' },
};

/** Size a card's channels of one kind take in the address space (bytes, or points for Mitsubishi). */
export function addressSize(station: PlcStation, kind: IoKind, count: number): number {
  if (count === 0) return 0;
  if (station.family === 'mitsubishi') {
    if (kind === 'AI' || kind === 'AO') return 0;
    const block = station.mitsubishiSeries === 'fx' ? 8 : 16;
    return Math.ceil(count / block) * block;
  }
  return kind === 'DI' || kind === 'DO' ? Math.ceil(count / 8) : count * 2;
}

/**
 * Address of the `index`-th channel of a kind on a card starting at `start`.
 * Siemens `I4.0` / `E4.0` / `IW64`, Codesys `%IX4.0` / `%IW32`, Mitsubishi
 * `X40` (FX: octal, iQ-R: hex). Mitsubishi analog values have no fixed
 * address; set one per channel.
 */
export function formatAddress(station: PlcStation, kind: IoKind, start: number, index: number): string | undefined {
  const digital = kind === 'DI' || kind === 'DO';
  switch (station.family) {
    case 'siemens': {
      const prefix = SIEMENS_PREFIX[station.mnemonic ?? 'international'][kind];
      return digital ? `${prefix}${start + Math.floor(index / 8)}.${index % 8}` : `${prefix}${start + 2 * index}`;
    }
    case 'codesys': {
      const area = kind === 'DI' || kind === 'AI' ? 'I' : 'Q';
      return digital ? `%${area}X${start + Math.floor(index / 8)}.${index % 8}` : `%${area}W${Math.floor(start / 2) + index}`;
    }
    case 'mitsubishi': {
      if (!digital) return undefined;
      const radix = station.mitsubishiSeries === 'fx' ? 8 : 16;
      return `${kind === 'DI' ? 'X' : 'Y'}${(start + index).toString(radix).toUpperCase()}`;
    }
  }
}

/** The start address in the station's notation, for dialogs: `I4.0`, `%IW32`, `X40`. */
export function formatStart(station: PlcStation, kind: IoKind, start: number): string {
  return formatAddress(station, kind, start, 0) ?? String(start);
}

/** Parses a start address typed in the station's notation (`I4.0`, `E4`, `%IX4.0`, `%IW32`, `X40`, or a plain number). */
export function parseStart(station: PlcStation, kind: IoKind, text: string): number | undefined {
  const t = text.trim().toUpperCase();
  if (t === '') return undefined;
  if (station.family === 'mitsubishi') {
    const m = /^[XY]?([0-9A-F]+)$/.exec(t);
    const radix = station.mitsubishiSeries === 'fx' ? 8 : 16;
    const value = m ? Number.parseInt(m[1]!, radix) : Number.NaN;
    return Number.isNaN(value) ? undefined : value;
  }
  const m = /^%?[A-Z]*?(\d+)(?:\.\d)?$/.exec(t);
  if (!m) return undefined;
  const value = Number(m[1]);
  // Codesys word addresses count words, starts are stored as bytes.
  return station.family === 'codesys' && /^%?[IQ]W/.test(t) ? value * 2 : value;
}

export function defaultDataType(kind: IoKind): string {
  return kind === 'DI' || kind === 'DO' ? 'BOOL' : 'INT';
}

export function channelLabel(channel: IoChannel): string {
  return channel.label ?? `${channel.kind} ${channel.channel}`;
}

// ---------------------------------------------------------------------------
// Index

export interface PlcChannelInfo {
  channel: IoChannel;
  /** Position among the card's channels of the same kind (for the address). */
  index: number;
  address?: string;
  /** PLC tag name (explicit or generated). */
  name: string;
  /** Function: explicit on the channel, else from the slave, else from the wired device. */
  function?: LocalizedText;
  functionSource: 'channel' | 'slave' | 'wiring' | 'none';
  /** I/O point symbols (slaves) showing this channel. */
  slaves: { pageId: string; itemId: string }[];
}

export interface PlcCardInfo {
  /** Device key of the card, e.g. `=FB+CAB1-A10`. */
  device: string;
  /** Where the card's data item is: a page, or the card store (`PLC_STORE_PAGE`) when not drawn. */
  pageId: string;
  itemId: string;
  /** The card is not drawn: it exists only in the PLC tab (card store). */
  stored: boolean;
  /** Where the card is drawn: its master (when on a page) and further overviews (views). */
  drawings: { pageId: string; itemId: string }[];
  station?: PlcStation;
  slot?: number;
  start: IoStart;
  channels: PlcChannelInfo[];
}

export interface PlcIndex {
  cards: PlcCardInfo[];
  /** Card info by the card master's item ID. */
  byCard: Map<string, PlcCardInfo>;
  /** Channel info by slave item ID. */
  bySlave: Map<string, { card: PlcCardInfo; channel: PlcChannelInfo }>;
  issues: Issue[];
}

export function buildPlcIndex(state: ProjectState, library: Library, devices: DeviceIndex, connectivity: Connectivity): PlcIndex {
  const items = new Map<string, { page: SchematicPage; item: Item }>();
  const views = new Map<string, { pageId: string; itemId: string }[]>();
  for (const page of [...Object.values(state.pages), plcStorePage(state)]) {
    if (page.type !== 'schematic') continue;
    for (const item of page.items) {
      items.set(item.id, { page, item });
      const of = item.props?.plcView?.of;
      if (of) views.set(of, [...(views.get(of) ?? []), { pageId: page.id, itemId: item.id }]);
    }
  }
  const stations = new Map(state.project.plcs.map((s) => [s.name, s]));
  const issues: Issue[] = [];
  const cards: PlcCardInfo[] = [];
  const byCard = new Map<string, PlcCardInfo>();
  const bySlave = new Map<string, { card: PlcCardInfo; channel: PlcChannelInfo }>();
  const wiredFunction = functionFinder(library, devices, connectivity, items);

  for (const device of devices.devices.values()) {
    const main = device.main && items.get(device.main.itemId);
    const plc = main?.item.props?.plc;
    if (!main || !plc) {
      for (const f of device.functions) {
        const entry = items.get(f.itemId)!;
        if (isPlcPoint(library.symbol(entry.item.symbol))) {
          issues.push({ severity: 'warning', code: 'plc.noCard', ...issueMessage('{device}: I/O point without an I/O card (no main function with channels)', { device: device.key }), pageId: f.pageId, itemId: f.itemId, device: device.key });
        }
      }
      continue;
    }
    const station = plc.station ? stations.get(plc.station) : undefined;
    if (!plc.station) {
      issues.push({ severity: 'warning', code: 'plc.noStation', ...issueMessage('{device}: I/O card is not assigned to a PLC', { device: device.key }), pageId: main.page.id, itemId: main.item.id, device: device.key });
    } else if (!station) {
      issues.push({ severity: 'error', code: 'plc.unknownStation', ...issueMessage('{device}: PLC "{plc}" is not defined in the project', { device: device.key, plc: plc.station }), pageId: main.page.id, itemId: main.item.id, device: device.key });
    }

    const start = plc.start ?? {};
    const counters: Record<IoKind, number> = { DI: 0, DO: 0, AI: 0, AO: 0 };
    const card: PlcCardInfo = {
      device: device.key,
      pageId: main.page.id,
      itemId: main.item.id,
      stored: main.page.id === PLC_STORE_PAGE,
      drawings: [...(main.page.id === PLC_STORE_PAGE ? [] : [{ pageId: main.page.id, itemId: main.item.id }]), ...(views.get(main.item.id) ?? [])],
      ...(station ? { station } : {}),
      ...(plc.slot !== undefined ? { slot: plc.slot } : {}),
      start,
      channels: [],
    };
    const cardPins = new Map<string, string>();
    for (const channel of plc.channels) {
      const index = counters[channel.kind]++;
      const startAt = start[channel.kind];
      const address = channel.address ?? (station && startAt !== undefined ? formatAddress(station, channel.kind, startAt, index) : undefined);
      card.channels.push({
        channel,
        index,
        ...(address ? { address } : {}),
        name: channel.name ?? defaultName(device.tag.product ?? 'IO', channel),
        functionSource: 'none',
        slaves: [],
      });
      cardPins.set(`${channel.kind}:${channel.channel}`, `${main.item.id}:${channel.pin}`);
    }
    for (const kind of IO_KINDS) {
      if (counters[kind] > 0 && start[kind] === undefined && station && !(station.family === 'mitsubishi' && (kind === 'AI' || kind === 'AO'))) {
        issues.push({ severity: 'info', code: 'plc.noAddress', ...issueMessage('{device}: no start address for {kind}', { device: device.key, kind }), pageId: main.page.id, itemId: main.item.id, device: device.key });
      }
    }

    for (const f of device.functions) {
      if (f.itemId === main.item.id) continue;
      const entry = items.get(f.itemId)!;
      const def = library.symbol(entry.item.symbol);
      if (!isPlcPoint(def)) continue;
      const kind = plcPointKind(def!);
      const number = entry.item.props?.channel;
      const info = card.channels.find((c) => c.channel.kind === kind && c.channel.channel === number);
      if (!info) {
        issues.push({
          severity: 'error',
          code: 'plc.unknownChannel',
          ...(number === undefined ? issueMessage('{device}: I/O point without a channel', { device: device.key }) : issueMessage('{device}: the card has no {kind} channel {number}', { device: device.key, kind, number })),
          pageId: f.pageId,
          itemId: f.itemId,
          device: device.key,
        });
        continue;
      }
      if (info.slaves.length > 0) {
        issues.push({ severity: 'warning', code: 'plc.channelUsedTwice', ...issueMessage('{device}: {channel} is drawn more than once', { device: device.key, channel: channelLabel(info.channel) }), pageId: f.pageId, itemId: f.itemId, device: device.key });
      }
      info.slaves.push({ pageId: f.pageId, itemId: f.itemId });
      bySlave.set(f.itemId, { card, channel: info });
    }

    for (const info of card.channels) {
      const slaveText = info.slaves.map((s) => items.get(s.itemId)?.item.props?.functionText).find((t) => t !== undefined);
      if (info.channel.function !== undefined) {
        info.function = info.channel.function;
        info.functionSource = 'channel';
      } else if (slaveText !== undefined) {
        info.function = slaveText;
        info.functionSource = 'slave';
      } else {
        const wired = wiredFunction(cardPins.get(`${info.channel.kind}:${info.channel.channel}`)!);
        if (wired !== undefined) {
          info.function = wired;
          info.functionSource = 'wiring';
        }
      }
    }
    // A card is drawn once; more drawings are allowed but reported, none is a hint (PLC tab).
    const where = card.drawings[0] ?? {};
    if (card.drawings.length > 1) {
      issues.push({ severity: 'warning', code: 'plc.cardDrawnTwice', ...issueMessage('{device}: the card is drawn {count} times', { device: device.key, count: card.drawings.length }), ...where, device: device.key });
    } else if (card.drawings.length === 0) {
      issues.push({ severity: 'info', code: 'plc.cardNotDrawn', ...issueMessage('{device}: the card is not drawn yet (drag it from the PLC tab onto a page)', { device: device.key }), device: device.key });
    }
    cards.push(card);
    byCard.set(main.item.id, card);
  }

  checkStations(cards, issues);
  // Problems of cards in the store have no place on a page: they show the device only.
  for (const issue of issues) {
    if (issue.pageId !== PLC_STORE_PAGE) continue;
    delete issue.pageId;
    delete issue.itemId;
  }
  return { cards, byCard, bySlave, issues };
}

/** `DI2_4A1`: kind and channel first, so the name starts with a letter as PLC tag names must. */
function defaultName(product: string, channel: IoChannel): string {
  return `${channel.kind}${channel.channel}_${product}`.replace(/[^A-Za-z0-9_]/g, '_');
}

/** Address overlaps and duplicate tag names within each PLC. */
function checkStations(cards: PlcCardInfo[], issues: Issue[]): void {
  const byStation = new Map<string, PlcCardInfo[]>();
  for (const card of cards) {
    if (!card.station) continue;
    byStation.set(card.station.name, [...(byStation.get(card.station.name) ?? []), card]);
  }
  for (const [name, list] of byStation) {
    const station = list[0]!.station!;
    for (const kind of IO_KINDS) {
      const ranges = list.flatMap((card) => {
        const count = card.channels.filter((c) => c.channel.kind === kind).length;
        const start = card.start[kind];
        const size = addressSize(station, kind, count);
        return start === undefined || size === 0 ? [] : [{ card, from: start, to: start + size }];
      });
      ranges.sort((a, b) => a.from - b.from);
      for (let i = 1; i < ranges.length; i++) {
        const a = ranges[i - 1]!;
        const b = ranges[i]!;
        if (b.from < a.to) {
          issues.push({
            severity: 'error',
            code: 'plc.addressOverlap',
            ...issueMessage('{plc}: {kind} addresses of {a} and {b} overlap', { plc: name, kind, a: a.card.device, b: b.card.device }),
            pageId: b.card.pageId,
            itemId: b.card.itemId,
            device: b.card.device,
          });
        }
      }
    }
    const names = new Map<string, PlcCardInfo>();
    for (const card of list) {
      for (const c of card.channels) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.name)) {
          issues.push({ severity: 'warning', code: 'plc.invalidName', ...issueMessage('{channel}: "{name}" is not a valid PLC tag name', { channel: name, name: c.name }), pageId: card.pageId, itemId: card.itemId, device: card.device });
        }
        if (names.has(c.name)) {
          issues.push({ severity: 'error', code: 'plc.duplicateName', ...issueMessage('{channel}: tag name "{name}" is used twice', { channel: name, name: c.name }), pageId: card.pageId, itemId: card.itemId, device: card.device });
        }
        names.set(c.name, card);
      }
    }
  }
}

/**
 * The devices wired to a connection point: follows the wire (and through terminals) to the
 * devices, nearest first (`depth` = terminals passed). Connection symbols, PLC cards and I/O
 * points are passed over.
 */
export function wiredDeviceFinder(
  library: Library,
  connectivity: Connectivity,
  items: Map<string, { page: SchematicPage; item: Item }>,
): (pointKey: string) => { item: Item; def: SymbolDefinition; depth: number }[] {
  const members = new Map<string, string[]>();
  for (const [key, net] of connectivity.netOf) {
    const list = members.get(net);
    if (list) list.push(key);
    else members.set(net, [key]);
  }
  return (start) => {
    const startNet = connectivity.netOf.get(start);
    if (startNet === undefined) return [];
    const found: { item: Item; def: SymbolDefinition; depth: number }[] = [];
    const seenItems = new Set<string>();
    const seen = new Set([startNet]);
    let frontier = [startNet];
    for (let depth = 0; frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const net of frontier) {
        for (const key of members.get(net) ?? []) {
          const point = connectivity.points.get(key);
          const entry = point && items.get(point.itemId);
          if (!entry || seenItems.has(entry.item.id)) continue;
          seenItems.add(entry.item.id);
          const def = resolveSymbol(entry.item, library);
          if (!def || itemRole(entry.item, def) === 'none' || def.generator === 'plcCard' || isPlcPoint(def)) continue;
          if (def.function === 'terminal') {
            // Pass through the terminal to its other side.
            for (const c of def.connections) {
              const other = connectivity.netOf.get(`${entry.item.id}:${c.id}`);
              if (other !== undefined && !seen.has(other)) {
                seen.add(other);
                next.push(other);
              }
            }
            continue;
          }
          found.push({ item: entry.item, def, depth });
        }
      }
      frontier = next;
    }
    return found;
  };
}

/**
 * The function of the device wired to a PLC terminal: the function text of the nearest wired
 * device. For an auxiliary function without its own text, the text of its main function is used.
 */
function functionFinder(
  library: Library,
  devices: DeviceIndex,
  connectivity: Connectivity,
  items: Map<string, { page: SchematicPage; item: Item }>,
): (pointKey: string) => LocalizedText | undefined {
  const wired = wiredDeviceFinder(library, connectivity, items);
  const textOf = (item: Item): LocalizedText | undefined => {
    if (item.props?.functionText !== undefined) return item.props.functionText;
    const key = devices.byItem.get(item.id);
    const main = key ? devices.devices.get(key)?.main : undefined;
    return main ? items.get(main.itemId)?.item.props?.functionText : undefined;
  };
  return (start) => {
    for (const { item } of wired(start)) {
      const text = textOf(item);
      if (text !== undefined) return text;
    }
    return undefined;
  };
}

/**
 * The command placing a PLC card from the PLC tab at a point: `channel` (index into the card's
 * channels) places that channel's I/O point; without it a further overview of the whole card
 * (a view, not the master) is placed. The device tag is written relative to the target page.
 */
export function placePlcCommand(
  state: ProjectState,
  library: Library,
  card: { pageId: string; itemId: string },
  target: { pageId: string; x: number; y: number },
  channel?: number,
): Extract<Command, { type: 'placeSymbol' }> {
  const cardPage = pageOrStore(state, card.pageId) as SchematicPage | undefined;
  const cardItem = cardPage?.items.find((i) => i.id === card.itemId);
  const channels = cardItem?.props?.plc?.channels;
  if (!cardPage || !cardItem || !channels) throw new Error('The PLC card was not found');
  const targetPage = state.pages[target.pageId];
  if (targetPage?.type !== 'schematic') throw new Error('PLC symbols can only be placed on schematic pages');
  const tag = relativeTag(effectiveTag(cardPage, cardItem, library), tagContext(targetPage, target, library));
  const base = { type: 'placeSymbol' as const, pageId: target.pageId, x: target.x, y: target.y, ...(Object.keys(tag).length > 0 ? { tag } : {}) };
  if (channel === undefined) {
    return { ...base, symbol: cardItem.symbol, main: false, props: { plcView: { of: cardItem.id, channels: structuredClone(channels) } } };
  }
  const c = channels[channel];
  if (!c) throw new Error(`The card has no channel ${channel}`);
  const pins = Object.fromEntries(channelPins(c).slice(0, 4).map((pin, k) => [String(k + 1), pin]));
  return { ...base, symbol: plcPointSymbol(c), pins, props: { channel: c.channel } };
}
