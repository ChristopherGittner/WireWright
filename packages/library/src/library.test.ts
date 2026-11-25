import { channelPins, createProjectState, localize, plcPointSymbol, ProjectDocument } from '@wirewright/core';
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
    for (const id of ['iec60617.relay.coil', 'iec60617.motor.3ph', 'iec60617.lamp', 'iec60617.heater', 'iec60617.luminaire', 'iec60617.socket', 'wirewright.box.device']) {
      expect(library.symbol(id)?.links, id).toEqual([]);
    }
  });

  it('contains the cabinet protection, switch and consumer symbols with one link group per pole', () => {
    const poles: Record<string, number> = {
      'iec60617.mcb.2p': 2, 'iec60617.rcbo.2p': 2, 'iec60617.rcbo.4p': 4, 'iec60617.rccb.4p': 4,
      'iec60617.switch.disconnector.3p': 3, 'iec60617.fuse.disconnector.1p': 1, 'iec60617.fuse.disconnector.2p': 2,
      'iec60617.switch.selector.3pos': 2, 'iec60617.pushbutton.illuminated': 1, 'iec60617.thermostat': 1,
      'iec60617.pushbutton.latched.no': 1, 'iec60617.pushbutton.latched.nc': 1, 'iec60617.switch.selector.momentary': 1,
      'iec60617.keyswitch.no': 1, 'iec60617.keyswitch.nc': 1, 'iec60617.keyswitch.momentary.no': 1,
    };
    for (const [id, n] of Object.entries(poles)) {
      expect(library.symbol(id)?.links, id).toHaveLength(n);
    }
    for (const id of ['iec60617.heater', 'iec60617.luminaire', 'iec60617.socket']) expect(library.symbol(id), id).toBeDefined();
  });

  it('contact variants (early, late, passing, delayed) stay contacts, so cross-references and contact images list them', () => {
    const variants: Record<string, string> = {
      'iec60617.contact.no.early': 'contact.no', 'iec60617.contact.no.late': 'contact.no',
      'iec60617.contact.nc.early': 'contact.nc', 'iec60617.contact.nc.late': 'contact.nc',
      'iec60617.contact.no.passing': 'contact.no', 'iec60617.contact.no.passing.release': 'contact.no', 'iec60617.contact.no.passing.both': 'contact.no',
      'iec60617.contact.no.ondelay': 'contact.no', 'iec60617.contact.no.offdelay': 'contact.no',
      'iec60617.contact.nc.ondelay': 'contact.nc', 'iec60617.contact.nc.offdelay': 'contact.nc',
      'iec60617.contact.co.mbb': 'contact.co', 'iec60617.contact.co.center': 'contact.co',
    };
    for (const [id, fn] of Object.entries(variants)) {
      const s = library.symbol(id);
      expect(s?.function, id).toBe(fn);
      expect(s?.contactImage, id).toBeDefined();
    }
    for (const id of ['iec60617.relay.coil.ondelay', 'iec60617.relay.coil.offdelay', 'iec60617.relay.coil.impulse']) {
      expect(library.symbol(id)?.function, id).toBe('relay.coil');
    }
  });

  it('contains installation switches, surge protection, instrument transformers and components', () => {
    const poles: Record<string, number> = {
      'iec60617.installation.switch.oneway': 1, 'iec60617.installation.switch.twoway': 1, 'iec60617.installation.switch.series': 1,
      'iec60617.installation.switch.intermediate': 1, 'iec60617.switch.multiposition.4': 1,
      'iec60617.limitswitch.no': 1, 'iec60617.limitswitch.nc': 1, 'iec60617.transformer.current': 1,
    };
    for (const [id, n] of Object.entries(poles)) expect(library.symbol(id)?.links, id).toHaveLength(n);
    for (const id of [
      'iec60617.installation.dimmer', 'iec60617.surge.arrester', 'iec60617.surge.sparkgap', 'iec60617.surge.gdt', 'iec60617.transformer.voltage',
      'iec60617.resistor', 'iec60617.resistor.variable', 'iec60617.potentiometer', 'iec60617.resistor.ntc', 'iec60617.resistor.ptc', 'iec60617.varistor',
      'iec60617.capacitor', 'iec60617.capacitor.polarized', 'iec60617.inductor', 'iec60617.diode', 'iec60617.diode.zener', 'iec60617.diode.led',
      'iec60617.battery', 'iec60617.horn', 'iec60617.bell',
    ]) expect(library.symbol(id), id).toBeDefined();
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

  it('has the Beckhoff terminal points of the Beckhoff documentation', () => {
    const channels = (id: string) => library.device(id)?.plc?.channels;
    expect(library.devices().filter((d) => d.id.startsWith('beckhoff.')).length).toBeGreaterThan(190);
    // EL1002: input 1 on 1 with sensor supply +24 V on 2, 0 V on 3, PE on 4; input 2 on 5
    expect(channels('beckhoff.el1002')?.[0]).toEqual({
      channel: 1, kind: 'DI', pin: '1',
      extraPins: [{ pin: '2', label: '+24 V', after: true }, { pin: '3', label: '0 V', after: true }, { pin: '4', label: 'PE', after: true }],
    });
    // EL1004: inputs 1-4 on 1, 5, 4, 8; input 3 has its +24 V on 3
    expect(channels('beckhoff.el1004')?.map((c) => c.pin)).toEqual(['1', '5', '4', '8']);
    expect(channels('beckhoff.el1004')?.[2]?.extraPins).toEqual([{ pin: '3', label: '+24 V', after: true }]);
    // EL3102: differential input, +Input 1 on 1, -Input 1 on 2, GND on 3, shield on 4
    expect(channels('beckhoff.el3102')?.[0]).toMatchObject({ pin: '1', pinLabel: '+Input 1', extraPins: [{ pin: '2', label: '-Input 1' }, { pin: '3', label: 'GND' }, { pin: '4', label: 'Shield' }] });
    // EL2612: changeover relay 1 with contacts 14 (1), 11 (2), 12 (3)
    expect(channels('beckhoff.el2612')?.[0]).toMatchObject({ kind: 'DO', pin: '1', pinLabel: '14', extraPins: [{ pin: '2', label: '11' }, { pin: '3', label: '12' }] });
    // EL1124/EL1144/EL1134 share one table "+5 / 12 / 48 V": each gets its own supply voltage
    expect(channels('beckhoff.el1144')?.[0]?.extraPins?.[0]?.label).toBe('+12 V');
    // every Beckhoff I/O card names the page its terminal points come from
    for (const d of library.devices().filter((d) => /^beckhoff\.el[1-4]/.test(d.id) && !/el19[01]|el2904/.test(d.id))) {
      expect(localize(d.description, 'en'), d.id).toMatch(/^Pin assignment from the Beckhoff documentation, as of 2026-11: https:\/\/infosys\.beckhoff\.com\//);
    }
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
