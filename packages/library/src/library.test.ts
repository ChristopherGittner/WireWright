import { channelPins, createProjectState, plcPointSymbol, ProjectDocument } from '@wirewright/core';
import { describe, expect, it } from 'vitest';
import { createStandardLibrary } from './index.js';

const library = createStandardLibrary();

describe('standard library', () => {
  it('validates and contains the starter symbols, frames and templates', () => {
    expect(library.symbols().length).toBeGreaterThanOrEqual(30);
    expect(library.frame('iec.frame.a3')?.columns.count).toBe(10);
    expect(library.template('relay.2co')?.contacts).toHaveLength(2);
  });

  it('has a report form for each stage 1 report, fitting its frame', () => {
    for (const kind of ['pageIndex', 'deviceIndex', 'bom', 'terminalList', 'wireList', 'cableOverview', 'cableDiagram', 'plcIoList']) {
      const form = library.form(`iec.form.${kind}`);
      expect(form?.kind, kind).toBe(kind);
      const frame = library.frame(form!.frame)!;
      const width = form!.columns.reduce((sum, c) => sum + c.width, 0);
      expect(form!.table.x + width).toBeLessThanOrEqual(frame.drawingArea.x + frame.drawingArea.width);
      const bottom = form!.table.y + form!.table.headerHeight + form!.table.rows * form!.table.rowHeight;
      expect(bottom).toBeLessThanOrEqual(frame.drawingArea.y + frame.drawingArea.height);
    }
  });

  it.each(library.symbols().map((s) => [s.id, s] as const))('%s: connection points lie on the 4 mm raster', (_, symbol) => {
    for (const c of symbol.connections) {
      expect(Math.abs(c.x % 4), `${c.id}.x`).toBe(0);
      expect(Math.abs(c.y % 4), `${c.id}.y`).toBe(0);
    }
  });

  it.each(library.symbols().map((s) => [s.id, s] as const))('%s: links refer to existing pins, each pin at most once', (_, symbol) => {
    const pins = new Set(symbol.connections.map((c) => c.id));
    const seen = new Set<string>();
    for (const pin of (symbol.links ?? []).flat()) {
      expect(pins.has(pin), pin).toBe(true);
      expect(seen.has(pin), pin).toBe(false);
      seen.add(pin);
    }
  });

  it('device functions have a letter code; consumers pass no potential through', () => {
    for (const s of library.symbols()) {
      if (s.defaultRole !== 'none') expect(s.letterCode, s.id).toBeTruthy();
    }
    for (const id of ['iec60617.relay.coil', 'iec60617.motor.3ph', 'iec60617.lamp', 'wirewright.box.device']) {
      expect(library.symbol(id)?.links, id).toEqual([]);
    }
  });

  it('device definitions use existing symbols, and I/O cards have consistent channels', () => {
    expect(library.devices().length).toBeGreaterThanOrEqual(8);
    for (const d of library.devices()) {
      for (const f of d.functions) expect(library.symbol(f.symbol), `${d.id}: ${f.symbol}`).toBeDefined();
      expect(d.functions.filter((f) => f.main), d.id).toHaveLength(1);
      if (!d.plc) continue;
      const pins = d.plc.channels.flatMap((c) => channelPins(c));
      expect(new Set(pins).size, `${d.id}: pins unique`).toBe(pins.length);
      for (const f of d.functions.filter((f) => f.channel !== undefined)) {
        const channel = d.plc.channels.find((c) => c.channel === f.channel && plcPointSymbol(c) === f.symbol);
        expect(channel, `${d.id}: channel ${f.channel}`).toBeDefined();
        // one connection per terminal of the channel, named like the card's terminals
        expect(Object.values(f.pins ?? {}), `${d.id}: pins of channel ${f.channel}`).toEqual(channelPins(channel!));
        expect(library.symbol(f.symbol)!.connections.length, `${d.id}: ${f.symbol}`).toBe(channelPins(channel!).length);
      }
    }
    expect(library.device('wago.750-430')?.plc?.channels.slice(0, 3).map((c) => c.pin)).toEqual(['1', '5', '2']);
    // broad coverage of the common I/O systems
    const count = (prefix: string) => library.devices().filter((d) => d.id.startsWith(prefix)).length;
    expect(count('wago.')).toBeGreaterThan(90);
    expect(count('beckhoff.')).toBeGreaterThan(80);
    expect(count('siemens.et200sp.')).toBeGreaterThan(20);
    expect(count('siemens.s71500.')).toBeGreaterThan(30);
    expect(library.device('wago.750-667-000-003')?.functions[1]).toMatchObject({ symbol: 'wirewright.plc.di.2', pins: { '1': '1', '2': '5' } }); // clock T1 on terminal 1, input I1 on 5 (manual)
  });

  it('template contacts use functions that exist in the library', () => {
    const functions = new Set(library.symbols().map((s) => s.function));
    for (const t of library.templates()) {
      for (const c of t.contacts) expect(functions.has(c.function), `${t.id}: ${c.function}`).toBe(true);
      if (t.symbol) expect(library.symbol(t.symbol), t.id).toBeDefined();
    }
  });
});

describe('standard macros', () => {
  it.each(library.macros().filter((m) => m.category === 'control').map((m) => [m.id] as const))('%s places cleanly, twice, with new device names', (id) => {
    const doc = new ProjectDocument(createProjectState({ name: 'Macro' }), library);
    const { created } = doc.apply({ type: 'createPage', name: '1' });
    const pageId = created[0]!;
    doc.apply({ type: 'placeItems', pageId, macro: id, x: 80, y: 24 });
    doc.apply({ type: 'placeItems', pageId, macro: id, x: 200, y: 24 });
    const issues = doc.check().filter((i) => i.severity !== 'info');
    expect(issues).toEqual([]);
    const devices = [...doc.devices().devices.values()];
    // Every device of the second copy is a new device in column 5 with all its functions.
    const second = devices.filter((d) => d.tag.product?.startsWith('1') && /^1[A-Z]+5/.test(d.tag.product));
    const first = devices.filter((d) => /^1[A-Z]+2/.test(d.tag.product ?? ''));
    expect(second.length).toBeGreaterThan(1);
    expect(second.map((d) => d.functions.length)).toEqual(first.map((d) => d.functions.length));
  });
});

describe('terminal macros', () => {
  it('has 1 … 20 bridged terminals with 2 and with 3 connections', () => {
    const ids = library.macros().filter((m) => m.category?.startsWith('terminals')).map((m) => m.id);
    expect(ids).toHaveLength(40);
    expect(library.macro('wirewright.macro.terminals3.20')?.items).toHaveLength(20);
    expect(library.symbol('iec60617.terminal.3')?.connections.map((c) => c.id)).toEqual(['1', '2', '3']);
  });

  it.each(['wirewright.macro.terminals.5', 'wirewright.macro.terminals3.5'])('%s: bridged, and a second placement continues the strip', (id) => {
    const doc = new ProjectDocument(createProjectState({ name: 'Terminals' }), library);
    const pageId = doc.apply({ type: 'createPage', name: '1' }).created[0]!;
    doc.apply([
      { type: 'placeSymbol', pageId, symbol: 'wirewright.connection.potential', x: 80, y: 40, props: { name: '24V' } },
      { type: 'placeItems', pageId, macro: id, x: 80, y: 80 },
      { type: 'placeItems', pageId, macro: id, x: 160, y: 80 },
    ]);
    const strip = doc.terminals().strips[0]!;
    expect(strip.device).toBe('-X1');
    expect(strip.terminals.map((t) => `${t.designation}${t.bridge}`)).toEqual(['1A', '2A', '3A', '4A', '5A', '6B', '7B', '8B', '9B', '10B']);
    // the first terminal is fed with 24V: the bridge carries it to all five
    const potential = (t: (typeof strip.terminals)[number]) => doc.connectivity().potentialOf.get(`${t.itemId}:2`)?.name;
    expect(strip.terminals.map(potential)).toEqual(['24V', '24V', '24V', '24V', '24V', undefined, undefined, undefined, undefined, undefined]);
    expect(doc.check().filter((i) => i.code.startsWith('terminal.'))).toEqual([]);
  });
});

describe('contact images', () => {
  it('every symbol that shows a contact image has a place for it', () => {
    for (const s of library.symbols().filter((s) => s.hasContactImage)) expect(s.texts.map((t) => t.field), s.id).toContain('contactImage');
  });

  it('contacts have mini symbols', () => {
    for (const id of ['iec60617.contact.no', 'iec60617.contact.nc', 'iec60617.contact.co', 'iec60617.contactor.main3']) expect(library.symbol(id)?.contactImage?.length, id).toBeGreaterThan(0);
  });
});
