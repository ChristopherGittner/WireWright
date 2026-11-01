// Engineering checks: rated voltage of coils and lamps against the potentials at their pins,
// wire cross-sections against the protective device feeding them, open or wrongly connected PE
// pins, and PLC channels wired to the wrong kind of device. See docs/data-model.md,
// "Engineering checks". These are hints for the designer, not a replacement for the standards.
import type { Connectivity } from './connectivity.js';
import type { DeviceIndex } from './devices.js';
import { issueMessage, type Issue } from './issues.js';
import { findPart, type Library } from './library.js';
import { channelLabel, wiredDeviceFinder, type PlcIndex } from './plc.js';
import type { WireIndex } from './cables.js';
import type { Item, LocalizedText, Potential, ProjectState, SchematicPage, SymbolDefinition } from './schema.js';
import { resolveSymbol } from './symbols.js';
import { localize } from './text.js';

/** A voltage: value in V and kind (UC = AC or DC). */
export interface Voltage {
  value: number;
  kind?: 'AC' | 'DC' | 'UC';
}

/**
 * Current-carrying capacity (A) of PVC-insulated copper conductors at 40 °C, installation method
 * B1 (single conductors in ducts), per EN 60204-1 Table 6, without derating for grouping.
 */
export const CURRENT_CAPACITY: readonly [crossSection: number, amps: number][] = [
  [0.75, 7.6],
  [1, 10.4],
  [1.5, 13.5],
  [2.5, 18.3],
  [4, 25],
  [6, 32],
  [10, 44],
  [16, 60],
  [25, 77],
  [35, 97],
  [50, 117],
  [70, 149],
  [95, 180],
];

/** Functions whose rated voltage is checked against the supply at their pins. */
const RATED_VOLTAGE_FUNCTIONS = new Set(['relay.coil', 'contactor.coil', 'valve.coil', 'lamp']);
/** Protective devices: their rated current limits the wires at their pins. */
const PROTECTIVE_FUNCTIONS = new Set(['breaker', 'breaker.motor', 'fuse']);
/** Devices that read a state (belong to inputs) and devices that are driven (belong to outputs). */
const INPUT_DEVICE = (fn: string) => fn.startsWith('switch.') || fn.startsWith('contact.') || fn === 'sensor';
const OUTPUT_DEVICE = (fn: string) => RATED_VOLTAGE_FUNCTIONS.has(fn) || fn === 'motor';

/** Reads a voltage such as "24 V DC", "230VAC", "24 V =", "400 V AC 50 Hz", "24 V UC". */
export function parseVoltage(text: string | undefined): Voltage | undefined {
  if (!text) return undefined;
  const values = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*V\s*(AC|DC|UC|~|=)?(?![a-z])/gi)];
  // Several different voltages (e.g. "230 V AC / 24 V DC" of a power supply): not one rating.
  if (values.length === 0 || new Set(values.map((m) => m[1])).size > 1) return undefined;
  const m = values[0]!;
  const value = Number(m[1]!.replace(',', '.'));
  const tag = (m[2] ?? (/\bAC\b|~/i.test(text) ? 'AC' : /\bDC\b/i.test(text) ? 'DC' : /\bUC\b|AC\/DC/i.test(text) ? 'UC' : '')).toUpperCase();
  const kind = tag === '~' ? 'AC' : tag === '=' ? 'DC' : tag === 'AC' || tag === 'DC' || tag === 'UC' ? tag : undefined;
  return { value, ...(kind ? { kind } : {}) };
}

/** Reads the rated current of a protective device: "C16" → 16, "6,3 A", "4–6,3 A" → 6.3. */
export function parseCurrent(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const amps = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*A\b/g)].map((m) => Number(m[1]!.replace(',', '.')));
  if (amps.length > 0) return Math.max(...amps);
  const curve = /\b[BCDKZ]\s?(\d+(?:[.,]\d+)?)\b/.exec(text);
  return curve ? Number(curve[1]!.replace(',', '.')) : undefined;
}

/** Current-carrying capacity of a cross-section (mm²); undefined below the table. */
export function currentCapacity(crossSection: number): number | undefined {
  let capacity: number | undefined;
  for (const [cs, amps] of CURRENT_CAPACITY) if (crossSection >= cs) capacity = amps;
  return capacity;
}

/** The smallest cross-section of the table that carries `amps`. */
export function minimumCrossSection(amps: number): number | undefined {
  return CURRENT_CAPACITY.find(([, a]) => a >= amps)?.[0];
}

/** Voltage between two potentials, from their types and voltages (L–N, L–L, +/−). */
export function voltageBetween(a: Potential, b: Potential): Voltage | undefined {
  const va = parseVoltage(a.voltage);
  const vb = parseVoltage(b.voltage);
  const pair = (x: Potential['type'], y: Potential['type']) => (a.type === x && b.type === y) || (a.type === y && b.type === x);
  if (pair('L', 'N')) {
    const line = a.type === 'L' ? va : vb;
    if (!line) return undefined;
    // Potentials of a three-phase supply carry the line-to-line voltage (400 V): phase to N is 230 V.
    const value = line.value >= 380 && line.value <= 415 ? Math.round(line.value / Math.sqrt(3)) : line.value;
    return { value, kind: 'AC' };
  }
  if (a.type === 'L' && b.type === 'L' && a.name !== b.name) return va ? { value: va.value, kind: 'AC' } : undefined;
  if (pair('+', '-')) {
    const plus = a.type === '+' ? va : vb;
    const minus = a.type === '+' ? vb : va;
    if (!plus) return undefined;
    return { value: Math.abs(plus.value - (minus?.value ?? 0)), kind: 'DC' };
  }
  return undefined;
}

function formatVoltage(v: Voltage): string {
  return `${String(v.value).replace('.', ',')} V${v.kind ? ` ${v.kind}` : ''}`;
}

function sameVoltage(rated: Voltage, applied: Voltage): boolean {
  if (rated.kind && applied.kind && rated.kind !== 'UC' && rated.kind !== applied.kind) return false;
  return Math.abs(applied.value - rated.value) <= rated.value * 0.1;
}

export interface EngineeringContext {
  devices: DeviceIndex;
  connectivity: Connectivity;
  plc: PlcIndex;
  wires: WireIndex;
}

export function checkEngineering(state: ProjectState, library: Library, ctx: EngineeringContext): Issue[] {
  const issues: Issue[] = [];
  const { settings, potentials } = state.project;
  const text = (t: LocalizedText | undefined) => (t === undefined ? undefined : localize(t, settings.displayLanguage, settings.languages));
  const potentialDefs = new Map(potentials.map((p) => [p.name, p]));
  const items = new Map<string, { page: SchematicPage; item: Item }>();
  for (const page of Object.values(state.pages)) if (page.type === 'schematic') for (const item of page.items) items.set(item.id, { page, item });
  const deviceOf = (item: Item) => ctx.devices.byItem.get(item.id);
  /** The part of an item's device (its main function's first part). */
  const partOf = (item: Item) => {
    const key = deviceOf(item);
    const main = key ? ctx.devices.devices.get(key)?.main : undefined;
    const ref = (main ? items.get(main.itemId)?.item : item)?.props?.parts?.[0] ?? item.props?.parts?.[0];
    return ref ? findPart(library, ref.manufacturer, ref.partNumber) : undefined;
  };
  const potentialAt = (key: string) => {
    const name = ctx.connectivity.potentialOf.get(key)?.name;
    return name === undefined ? undefined : potentialDefs.get(name);
  };
  const reportedWires = new Set<string>();

  for (const { page, item } of items.values()) {
    const def = resolveSymbol(item, library);
    if (!def) continue;
    const device = deviceOf(item);
    const where = { pageId: page.id, itemId: item.id, ...(device ? { device } : {}) };
    const name = device ?? def.id;

    // Rated voltage of coils and lamps.
    if (RATED_VOLTAGE_FUNCTIONS.has(def.function)) {
      const part = partOf(item);
      const rated = parseVoltage(text(item.props?.technicalData)) ?? parseVoltage(part?.ratedVoltage) ?? parseVoltage(text(part?.description));
      const pins = electricPins(def).filter((c) => c.designation !== 'PE');
      const at = pins.map((c) => potentialAt(`${item.id}:${c.id}`));
      if (rated && pins.length === 2 && at[0] && at[1]) {
        const applied = voltageBetween(at[0], at[1]);
        if (applied && !sameVoltage(rated, applied)) {
          issues.push({
            severity: 'warning',
            code: 'voltage.mismatch',
            ...issueMessage('{device} is rated {rated} but connected to {a}/{b} ({applied})', { device: name, rated: formatVoltage(rated), a: at[0].name, b: at[1].name, applied: formatVoltage(applied) }),
            ...where,
          });
        }
      }
    }

    // Wires behind a protective device.
    if (PROTECTIVE_FUNCTIONS.has(def.function)) {
      const part = partOf(item);
      const rating = parseCurrent(text(item.props?.technicalData)) ?? part?.ratedCurrent ?? parseCurrent(text(part?.description));
      if (rating !== undefined) {
        for (const c of electricPins(def)) {
          const net = ctx.connectivity.netOf.get(`${item.id}:${c.id}`);
          const wire = net === undefined ? undefined : ctx.wires.byNet.get(net);
          if (!wire || reportedWires.has(wire.net)) continue;
          const capacity = currentCapacity(wire.crossSection);
          if (capacity !== undefined && capacity >= rating) continue;
          reportedWires.add(wire.net);
          const needed = minimumCrossSection(rating);
          issues.push({
            severity: 'warning',
            code: 'wire.crossSection',
            ...issueMessage('Wire {wire} ({crossSection} mm²) at {device}:{pin} is too thin for {rating} A; at least {needed} mm²', {
              wire: wire.number,
              crossSection: String(wire.crossSection).replace('.', ','),
              device: name,
              pin: c.designation ?? c.id,
              rating: String(rating).replace('.', ','),
              needed: needed === undefined ? '?' : String(needed).replace('.', ','),
            }),
            ...where,
          });
        }
      }
    }

    // PE pins: connected, and to a protective earth potential.
    for (const c of electricPins(def)) {
      if (c.designation !== 'PE' && c.id !== 'PE') continue;
      const key = `${item.id}:${c.id}`;
      if (!ctx.connectivity.wiring.get(key)?.length) {
        issues.push({ severity: 'warning', code: 'pe.notConnected', ...issueMessage('{device}: the PE connection is not connected', { device: name }), ...where });
        continue;
      }
      const potential = potentialAt(key);
      if (potential && potential.type !== 'PE' && potential.type !== 'PEN') {
        issues.push({ severity: 'error', code: 'pe.wrongPotential', ...issueMessage('{device}: the PE connection is on potential {potential}', { device: name, potential: potential.name }), ...where });
      }
    }
  }

  // PLC channels wired to the wrong kind of device.
  const wired = wiredDeviceFinder(library, ctx.connectivity, items);
  for (const card of ctx.plc.cards) {
    const master = items.get(card.itemId);
    if (!master) continue;
    for (const info of card.channels) {
      const starts = [`${card.itemId}:${info.channel.pin}`];
      for (const slave of info.slaves) {
        const entry = items.get(slave.itemId);
        const def = entry && resolveSymbol(entry.item, library);
        for (const c of def?.connections ?? []) starts.push(`${slave.itemId}:${c.id}`);
      }
      const found = starts.flatMap((key) => wired(key));
      const nearest = Math.min(...found.map((f) => f.depth));
      const input = info.channel.kind === 'DI' || info.channel.kind === 'AI';
      // Only when every nearest device is of the wrong kind: an input on the A1 of a coil that a
      // pushbutton switches reads the pushbutton (the switch is wired there too), which is fine.
      const close = found.filter((f) => f.depth === nearest);
      const right = close.some((f) => (input ? INPUT_DEVICE(f.def.function) : OUTPUT_DEVICE(f.def.function)));
      const wrong = right ? undefined : close.find((f) => (input ? OUTPUT_DEVICE(f.def.function) : INPUT_DEVICE(f.def.function)));
      if (!wrong) continue;
      const target = deviceOf(wrong.item) ?? wrong.def.id;
      issues.push({
        severity: 'warning',
        code: 'plc.channelType',
        ...(input
          ? issueMessage('{device}: input {channel} is wired to {target}, which is driven, not read (output device on an input)', { device: card.device, channel: channelLabel(info.channel), target })
          : issueMessage('{device}: output {channel} is wired to {target}, a switch or sensor (input device on an output)', { device: card.device, channel: channelLabel(info.channel), target })),
        pageId: info.slaves[0]?.pageId ?? card.pageId,
        itemId: info.slaves[0]?.itemId ?? card.itemId,
        device: card.device,
      });
    }
  }
  return issues;
}

function electricPins(def: SymbolDefinition) {
  return def.connections.filter((c) => c.medium !== 'fluid');
}
