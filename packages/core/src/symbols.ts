// Symbols whose graphics and connections depend on the item: a PLC card
// master has one row and one connection per channel.
import type { Library } from './library.js';
import type { Graphic, IoChannel, Item, SymbolDefinition } from './schema.js';

/** Layout of a PLC card master in mm, origin at the top-left corner. */
export const PLC_CARD = { width: 72, header: 8, row: 8, stub: 4 };

/** The terminals of a channel in drawing order: further terminals before it (clock …), its pin, those after it (sensor supply …). */
export function channelPins(channel: Pick<IoChannel, 'pin' | 'extraPins'>): string[] {
  const extra = channel.extraPins ?? [];
  return [...extra.filter((p) => !p.after).map((p) => p.pin), channel.pin, ...extra.filter((p) => p.after).map((p) => p.pin)];
}

/** Rows of a card master (relative to its top-left): one row per channel, one row step per terminal. */
export function plcCardLayout(channels: readonly Pick<IoChannel, 'pin' | 'extraPins'>[]): { height: number; rows: { y: number; height: number; pins: { pin: string; y: number }[] }[] } {
  const { header, row } = PLC_CARD;
  let y = header;
  const rows = channels.map((channel) => {
    const pins = channelPins(channel).map((pin, k) => ({ pin, y: y + row * k + row / 2 }));
    const r = { y, height: row * pins.length, pins };
    y += r.height;
    return r;
  });
  return { height: Math.max(y, header + row), rows };
}

/** The I/O point symbol for a channel: one connection per terminal (`wirewright.plc.di`, `….di.2` … `….di.4`). */
export function plcPointSymbol(channel: Pick<IoChannel, 'kind' | 'pin' | 'extraPins'>): string {
  const n = Math.min(channelPins(channel).length, 4);
  return `wirewright.plc.${channel.kind.toLowerCase()}${n > 1 ? `.${n}` : ''}`;
}

/** The symbol definition of an item, with generated graphics and connections where needed. */
export function resolveSymbol(item: Item, library: Library): SymbolDefinition | undefined {
  const def = library.symbol(item.symbol);
  if (def?.generator === 'cable') return cableSymbol(def, item);
  if (def?.generator !== 'plcCard') return def;
  const channels = item.props?.plc?.channels ?? item.props?.plcView?.channels ?? [];
  const { width, header, stub } = PLC_CARD;
  const layout = plcCardLayout(channels);
  const graphics: Graphic[] = [
    { type: 'rect', x: 0, y: 0, width, height: layout.height },
    { type: 'line', x1: 0, y1: header, x2: width, y2: header },
  ];
  layout.rows.forEach((r, i) => {
    if (i > 0) graphics.push({ type: 'line', x1: 0, y1: r.y, x2: width, y2: r.y });
    for (const p of r.pins) graphics.push({ type: 'line', x1: -stub, y1: p.y, x2: 0, y2: p.y });
  });
  return {
    ...def,
    graphics: [...def.graphics, ...graphics],
    connections: layout.rows.flatMap((r) => r.pins.map((p) => ({ id: p.pin, x: -stub, y: p.y, direction: 'left' as const, designation: p.pin }))),
    links: [],
  };
}

/** PLC I/O point symbols (slaves of a card). */
export function isPlcPoint(def: SymbolDefinition | undefined): boolean {
  return def !== undefined && ['plc.di', 'plc.do', 'plc.ai', 'plc.ao'].includes(def.function);
}

export function plcPointKind(def: SymbolDefinition): 'DI' | 'DO' | 'AI' | 'AO' {
  return def.function.slice(4).toUpperCase() as 'DI' | 'DO' | 'AI' | 'AO';
}

/** Default length of a new cable definition line in mm. */
export const CABLE_LENGTH = 40;

/** Geometry of a cable definition line: start at the item, `height` set means vertical. */
export function cableLine(item: Item): { vertical: boolean; length: number } {
  const vertical = item.height !== undefined && item.width === undefined;
  return { vertical, length: (vertical ? item.height : item.width) ?? CABLE_LENGTH };
}

function cableSymbol(def: SymbolDefinition, item: Item): SymbolDefinition {
  const { vertical, length } = cableLine(item);
  const at = (along: number, across: number) => (vertical ? { x: across, y: along } : { x: along, y: across });
  const line = (a: { x: number; y: number }, b: { x: number; y: number }): Graphic => ({ type: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  return {
    ...def,
    graphics: [
      line(at(0, 0), at(length, 0)),
      line(at(0, -1.5), at(0, 1.5)),
      line(at(length, -1.5), at(length, 1.5)),
    ],
    connections: [],
    texts: vertical
      ? [
          { field: 'tag', x: 1.5, y: 3 },
          { field: 'cableType', x: 1.5, y: 6 },
        ]
      : [
          { field: 'tag', x: 1, y: -1.5 },
          { field: 'cableType', x: 1, y: 3.5 },
        ],
  };
}
