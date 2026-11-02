import { issueKey, ProjectDocument } from '@wirewright/core';
import { createDemoProject, createStandardLibrary } from '@wirewright/library';
import { describe, expect, it } from 'vitest';
import { renderContext, renderPage, renderSheet } from './render.js';
import type { SchematicPage } from '@wirewright/core';
import { elementBox, textBox, type SceneElement } from './scene.js';
import { arcPath, sceneToSvg } from './svg.js';

const library = createStandardLibrary();
const doc = new ProjectDocument(createDemoProject(library), library);
const ctx = renderContext(doc);

const texts = (elements: SceneElement[]) => elements.flatMap((e) => (e.kind === 'text' ? [e.text] : []));

describe('schematic pages', () => {
  const power = renderPage(ctx, 'p_power');
  const control = renderPage(ctx, 'p_control');

  it('has the frame size and fills the title block', () => {
    expect(power).toMatchObject({ width: 420, height: 297 });
    const t = texts(power.elements);
    expect(t).toEqual(expect.arrayContaining(['Förderband FB-100', 'ACME GmbH', 'Leistungsteil Förderband', '=FB+CAB1/2', '2/9', '1', '10', 'A', 'F']));
  });

  it('colors connection lines by potential', () => {
    const colors = new Map<string, string>();
    for (const e of power.elements) {
      if (e.kind === 'line' && e.meta?.role === 'connection' && e.meta.connection?.potential) colors.set(e.meta.connection.potential, e.stroke.color);
    }
    expect(Object.fromEntries(colors)).toEqual({ L1: '#000000', L2: '#000000', L3: '#000000', PE: '#1E9E3A', N: '#3FA9F5', '24V': '#D0021B', '0V': '#00008B' });
    const pe = power.elements.find((e) => e.kind === 'line' && e.meta?.connection?.potential === 'PE');
    expect(pe?.kind === 'line' && pe.stroke.dash).toBeTruthy();
  });

  it('shows tags relative to the page, function texts and pins', () => {
    const t = texts(control.elements);
    expect(t).toEqual(expect.arrayContaining(['-3Q2', '-3S2.1', 'Förderband', 'A1', 'A2', '+FIELD-3M9']));
    expect(t).not.toContain('=FB+CAB1-3Q2');
  });

  it('a slave next to a symbol of the same device does not repeat the tag', () => {
    const d = new ProjectDocument(createDemoProject(library), library);
    const [left, right] = d.apply([
      { type: 'placeSymbol', pageId: 'p_sensors', symbol: 'iec60617.estop', x: 120, y: 200 },
      { type: 'placeSymbol', pageId: 'p_sensors', symbol: 'iec60617.estop', x: 200, y: 200 },
    ]).created as [string, string];
    const tagTexts = () =>
      renderPage(renderContext(d), 'p_sensors').elements.flatMap((e) => (e.kind === 'text' && e.meta?.field === 'tag' && (e.meta.itemId === left || e.meta.itemId === right) ? [`${e.meta.itemId === left ? 'left' : 'right'} ${e.text}`] : []));
    expect(tagTexts()).toEqual(['left -5S3', 'right -5S5']);
    d.apply({ type: 'setItemProperties', pageId: 'p_sensors', itemId: right, main: false });
    expect(tagTexts()).toEqual(['left -5S3']);
    // … unless the symbol asks to show it anyway
    d.apply({ type: 'setItemProperties', pageId: 'p_sensors', itemId: right, props: { showTag: true } });
    expect(tagTexts()).toEqual(['left -5S3', 'right -5S3']);
  });

  it('draws red stubs in the directions of junctions in the editor only, under the wires', () => {
    const stubs = (scene: ReturnType<typeof renderPage>) => scene.elements.filter((e) => e.meta?.field === 'stub');
    expect(stubs(control)).toEqual([]);
    const editor = renderPage(ctx, 'p_control', { junctionStubs: true });
    // demo page 3: two T-junctions (3 directions) and two corners (2 directions)
    expect(stubs(editor)).toHaveLength(10);
    expect(stubs(editor).every((e) => e.kind === 'line' && e.stroke.color === '#E00000')).toBe(true);
    const firstWire = editor.elements.findIndex((e) => e.meta?.role === 'connection');
    expect(editor.elements.findIndex((e) => e.meta?.field === 'stub')).toBeLessThan(firstWire);
  });

  it('draws free text: lines, alignment, color and language; a placeholder only in the editor', () => {
    const d = new ProjectDocument(createDemoProject(library), library);
    const [id] = d.apply({ type: 'placeSymbol', pageId: 'p_sensors', symbol: 'wirewright.text', x: 300, y: 150 }).created as [string];
    const free = (options = {}) => renderPage(renderContext(d), 'p_sensors', options).elements.filter((e) => e.kind === 'text' && e.meta?.itemId === id);
    expect(free()).toEqual([]);
    expect(free({ placeholders: true }).map((e) => e.kind === 'text' && e.text)).toEqual(['(text)']);
    d.apply({ type: 'setItemProperties', pageId: 'p_sensors', itemId: id, props: { text: { de: 'Achtung\nFremdspannung', en: 'Caution' }, textStyle: { align: 'center', color: '#cc0000', size: 4 } } });
    expect(free().map((e) => e.kind === 'text' && [e.text, e.y, e.align, e.color, e.size])).toEqual([
      ['Achtung', 150, 'center', '#cc0000', 4],
      ['Fremdspannung', 155.2, 'center', '#cc0000', 4],
    ]);
    expect(free({ language: 'en' }).map((e) => e.kind === 'text' && e.text)).toEqual(['Caution']);
    expect(free({ monochrome: true }).every((e) => e.kind === 'text' && e.color === '#000000')).toBe(true);
  });

  it('draws cross-references with jump targets and the contact image', () => {
    const xrefs = control.elements.filter((e) => e.meta?.role === 'xref');
    expect(xrefs.map((e) => e.kind === 'text' && e.text)).toEqual(expect.arrayContaining(['/2.2', '/3.3', '/3.5', '/3.2']));
    expect(xrefs.every((e) => e.meta?.target?.itemId)).toBe(true);
    const contactImage = control.elements.filter((e) => e.meta?.role === 'contactImage' && e.kind === 'text');
    expect(texts(contactImage)).toEqual(expect.arrayContaining(['1 2 3 4 5 6', '13 14', '21 22']));
  });

  it('can draw everything black and show pin links', () => {
    const mono = renderPage(ctx, 'p_power', { monochrome: true, showLinks: true });
    const colors = new Set(mono.elements.flatMap((e) => ('stroke' in e && e.stroke && e.meta?.role !== 'links' ? [e.stroke.color] : [])));
    expect(colors).toEqual(new Set(['#000000']));
    expect(mono.elements.some((e) => e.meta?.role === 'links')).toBe(true);
  });
});

describe('PLC', () => {
  it('card masters list channels with address, function and where they are drawn', () => {
    const scene = renderPage(ctx, 'p_plc');
    const t = texts(scene.elements);
    expect(t).toEqual(expect.arrayContaining(['DI 1', 'I10.0', 'Endlage Förderband', 'DI 2', 'I10.1', 'PLC1 / 1', 'DO 1', 'Q10.0', 'Schmierventil']));
    const xref = scene.elements.find((e) => e.meta?.role === 'xref' && e.kind === 'text' && e.text === '/5.2');
    expect(xref?.meta?.target?.pageId).toBe('p_sensors');
  });

  it('I/O points show channel, address, inherited function and the card reference', () => {
    const t = texts(renderPage(ctx, 'p_sensors').elements);
    expect(t).toEqual(expect.arrayContaining(['DI 1', 'I10.0', 'DI 2', 'I10.1', 'DO 1', 'Q10.0', 'Störung quittieren', '/4.1', '5']));
  });
});

describe('report sheets', () => {
  it('draws the table with title, header and rows', () => {
    const sheet = ctx.sheets.find((s) => s.pageId === 'p_devices')!;
    const scene = renderSheet(ctx, sheet);
    const t = texts(scene.elements);
    expect(t).toEqual(expect.arrayContaining(['Betriebsmittelverzeichnis', 'BMK', 'Funktionstext', '=FB+CAB1-3Q2', 'Förderband', 'ACME CON-9A-24DC']));
    expect(t).toContain('6/9');
  });

  it('uses the other language on request', () => {
    const scene = renderPage(ctx, 'p_bom', { language: 'en' });
    expect(texts(scene.elements)).toEqual(expect.arrayContaining(['Bill of materials', 'Qty', 'Part number']));
  });
});

describe('SVG', () => {
  it('writes a standalone SVG with data attributes', () => {
    const svg = sceneToSvg(renderPage(ctx, 'p_control'));
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="420mm" height="297mm" viewBox="0 0 420 297"')).toBe(true);
    expect(svg).toContain('data-role="xref"');
    expect(svg).toContain('data-target-page="p_power"');
    expect(svg).toContain('Förderband');
    expect(svg.match(/<text/g)?.length).toBe(svg.match(/<\/text>/g)?.length);
  });

  it('escapes text and draws arcs clockwise', () => {
    const svg = sceneToSvg({ width: 10, height: 10, elements: [{ kind: 'text', x: 0, y: 0, text: 'a<b&"c"', size: 2, color: '#000', align: 'left' }] });
    expect(svg).toContain('a&lt;b&amp;&quot;c&quot;');
    expect(arcPath(0, 0, 1, 0, 90)).toBe('M 1 0 A 1 1 0 0 1 0 1');
    expect(arcPath(0, 0, 1, 90, 0)).toContain(' 0 1 1 ');
  });
});

describe('text angle', () => {
  it('turns a text against the sheet; further lines go sideways; SVG rotates it', () => {
    const d = new ProjectDocument(createDemoProject(library), library);
    const page = d.state.pages['p_control'] as SchematicPage;
    const coil = page.items.find((i) => i.symbol === 'iec60617.relay.coil')!;
    d.apply([
      { type: 'setItemTextStyle', pageId: 'p_control', itemId: coil.id, field: 'tag', angle: 90, align: 'right' },
      { type: 'setItemProperties', pageId: 'p_control', itemId: coil.id, props: { functionText: 'Zeile 1\nZeile 2' } },
      { type: 'setItemTextStyle', pageId: 'p_control', itemId: coil.id, field: 'functionText', angle: 270 },
    ]);
    const scene = renderPage(renderContext(d), 'p_control');
    const texts = scene.elements.filter((e) => e.kind === 'text' && e.meta?.itemId === coil.id) as Extract<SceneElement, { kind: 'text' }>[];
    const tag = texts.find((e) => e.meta?.field === 'tag')!;
    expect(tag).toMatchObject({ angle: 90, align: 'right' });
    const [first, second] = texts.filter((e) => e.meta?.field === 'functionText');
    expect([first?.text, second?.text]).toEqual(['Zeile 1', 'Zeile 2']);
    expect(first!.angle).toBe(270);
    // reading downward, the second line lies to the left of the first
    expect(second!.x).toBeLessThan(first!.x);
    expect(second!.y).toBe(first!.y);
    expect(sceneToSvg(scene)).toContain(`transform="rotate(-90 `);
  });
});

describe('turned symbols', () => {
  it('a text that comes to lie below a symbol turned by 90° or 270° hangs from its point, clear of the symbol', () => {
    const d = new ProjectDocument(createDemoProject(library), library);
    const ids = d.apply(
      ([90, 270] as const).map((rotation, i) => ({ type: 'placeSymbol' as const, pageId: 'p_sensors', symbol: 'wirewright.connection.potentialDefinition', x: 300 + 40 * i, y: 40, rotation, props: { name: 'L1' } })),
    ).created;
    const elements = renderPage(renderContext(d), 'p_sensors').elements;
    for (const id of ids) {
      const graphics = elements.filter((e) => e.meta?.itemId === id && e.meta.role === 'symbol' && e.kind !== 'text').map(elementBox);
      const name = elements.find((e) => e.kind === 'text' && e.meta?.itemId === id && e.meta.field === 'name') as Extract<SceneElement, { kind: 'text' }>;
      const t = textBox(name);
      const overlaps = graphics.some((g) => t.x1 < g.x2 && t.x2 > g.x1 && t.y1 < g.y2 && t.y2 > g.y1);
      expect(overlaps).toBe(false);
    }
  });
});

describe('acknowledged potential conflict', () => {
  it('is drawn in the line of its first potential instead of the conflict color', () => {
    const d = new ProjectDocument(createDemoProject(library), library);
    const [l1] = d.apply([
      { type: 'placeSymbol', pageId: 'p_sensors', symbol: 'wirewright.connection.potential', x: 380, y: 30, props: { name: 'L1' }, autoName: false },
      { type: 'placeSymbol', pageId: 'p_sensors', symbol: 'wirewright.connection.potential', x: 380, y: 50, rotation: 180, props: { name: 'N' }, autoName: false },
    ]).created as [string, string];
    const wire = () => renderPage(renderContext(d), 'p_sensors').elements.find((e) => e.kind === 'line' && [e.meta?.connection?.a, e.meta?.connection?.b].includes(`${l1}:a`));
    const issue = d.check().find((i) => i.code === 'potential.conflict' && i.pageId === 'p_sensors')!;
    expect(wire()?.meta?.connection?.conflict).toBe(true);
    d.apply({ type: 'acknowledgeIssues', keys: [issueKey(issue)] });
    const after = wire();
    expect(after?.meta?.connection?.conflict).toBeUndefined();
    expect(after?.kind === 'line' && after.stroke.color).toBe('#000000');
  });
});

describe('text arrangement', () => {
  it('places the label texts as a block beside the graphics, centered, at the angle', () => {
    const d = new ProjectDocument(createDemoProject(library), library);
    const page = d.state.pages['p_control'] as SchematicPage;
    const coil = page.items.find((i) => i.symbol === 'iec60617.relay.coil')!;
    d.apply({ type: 'setTextArrangement', pageId: 'p_control', itemId: coil.id, arrangement: { side: 'left', angle: 90 } });
    const elements = renderPage(renderContext(d), 'p_control').elements;
    const graphics = elements.filter((e) => e.meta?.itemId === coil.id && e.meta.role === 'symbol' && e.kind !== 'text');
    const left = Math.min(...graphics.map((e) => elementBox(e).x1));
    const top = Math.min(...graphics.map((e) => elementBox(e).y1));
    const bottom = Math.max(...graphics.map((e) => elementBox(e).y2));
    const tag = elements.find((e) => e.kind === 'text' && e.meta?.itemId === coil.id && e.meta.field === 'tag') as Extract<SceneElement, { kind: 'text' }>;
    const fn = elements.find((e) => e.kind === 'text' && e.meta?.itemId === coil.id && e.meta.field === 'functionText') as Extract<SceneElement, { kind: 'text' }>;
    expect(tag).toMatchObject({ angle: 90, align: 'center' });
    // centered vertically on the graphics, both lines left of them, the function text right of the tag
    expect(tag.y).toBeCloseTo((top + bottom) / 2);
    expect(Math.max(textBox(tag).x2, textBox(fn).x2)).toBeLessThanOrEqual(left);
    expect(fn.x).toBeGreaterThan(tag.x);
  });
});

describe('pipes', () => {
  it('pipes connect only to pipe ports; gray by default, the medium color when set', () => {
    const d = new ProjectDocument(createDemoProject(library), library);
    d.apply([
      { type: 'createPage', id: 'p_pneu00001', name: '20' },
      // pressure source P above a 3/2 valve's port 1 … the valve is drawn at (100, 60); its port 1 is at (104, 72)
      { type: 'placeSymbol', pageId: 'p_pneu00001', id: 'i_valve00001', symbol: 'iso1219.valve.32.solenoid', x: 100, y: 60, tag: { product: 'Y1' } },
      { type: 'placeSymbol', pageId: 'p_pneu00001', id: 'i_source0001', symbol: 'wirewright.pipe.source', x: 104, y: 92, rotation: 180, props: { name: 'P' } },
      // a cylinder above port 2 (at 104, 56): its port 1 faces down at (104, 40)
      { type: 'placeSymbol', pageId: 'p_pneu00001', id: 'i_cyl0000001', symbol: 'iso1219.cylinder.double', x: 100, y: 24 },
      // an electrical potential point right under port 3 (108, 72): it must not connect
      { type: 'placeSymbol', pageId: 'p_pneu00001', id: 'i_pot0000001', symbol: 'wirewright.connection.potential', x: 108, y: 84, rotation: 180, props: { name: '24V' } },
    ]);
    const c = d.connectivity();
    const net = (key: string) => c.netOf.get(key);
    expect(net('i_valve00001:1')).toBe(net('i_source0001:a'));
    expect(net('i_valve00001:2')).toBe(net('i_cyl0000001:1'));
    expect(net('i_valve00001:3')).not.toBe(net('i_pot0000001:a'));
    expect(c.potentialOf.get('i_valve00001:1')).toEqual({ name: 'P' });
    // the valve does not pass the medium on (state dependent), and pipes have no wire numbers
    expect(c.potentialOf.get('i_valve00001:2')).toEqual({});
    expect([...d.wires().byNet.keys()]).not.toContain(net('i_valve00001:1'));

    const lines = (doc: ProjectDocument) =>
      renderPage(renderContext(doc), 'p_pneu00001').elements.filter((e) => e.kind === 'line' && e.meta?.role === 'connection') as Extract<SceneElement, { kind: 'line' }>[];
    expect(lines(d).map((l) => l.stroke.color).sort()).toEqual(['#808080', '#808080']);
    d.apply({ type: 'setMedia', media: [{ name: 'P', type: 'pressure', line: { color: '#1e6fff' } }] });
    expect(lines(d).map((l) => l.stroke.color).sort()).toEqual(['#1e6fff', '#808080']);
  });
});

describe('cabinet layout pages', () => {
  const layoutDoc = new ProjectDocument(createDemoProject(library), library);
  layoutDoc.apply([
    { type: 'createLayoutPage', id: 'p_plate', name: '10', structure: { function: 'FB', location: 'CAB1' }, plate: { width: 600, height: 800 }, scale: 5 },
    { type: 'setLayoutItem', pageId: 'p_plate', item: { id: 'l_rail', kind: 'rail', x: 20, y: 100, length: 560 } },
    { type: 'setLayoutItem', pageId: 'p_plate', item: { id: 'l_duct', kind: 'duct', x: 20, y: 40, length: 560, width: 40 } },
    { type: 'setLayoutItem', pageId: 'p_plate', item: { id: 'l_f2', kind: 'device', itemId: 'i_f2', x: 40, y: 72.5 } },
  ]);
  const scene = renderPage(renderContext(layoutDoc), 'p_plate');

  it('draws the plate to scale with rails, ducts and device footprints', () => {
    const plate = scene.elements.find((e) => e.kind === 'rect' && e.meta?.role === 'layout' && !e.meta.itemId);
    expect(plate).toMatchObject({ width: 120, height: 160 });
    const rail = scene.elements.find((e) => e.kind === 'rect' && e.meta?.itemId === 'l_rail');
    expect(rail).toMatchObject({ width: 112, height: 7 });
    const device = scene.elements.find((e) => e.kind === 'rect' && e.meta?.itemId === 'l_f2');
    expect(device).toMatchObject({ width: 9, height: 18, stroke: { dash: expect.any(Array) } }); // no dimensions: default, dashed
    expect(texts(scene.elements)).toEqual(expect.arrayContaining(['-2F2', 'Montageplatte 600 × 800 mm   1:5']));
  });
});

describe('terminal diagram', () => {
  it('draws each strip as terminal boxes with targets and bridges', () => {
    const d = new ProjectDocument(createDemoProject(library), library);
    d.apply({ type: 'createReportPage', id: 'p_termdiag', name: '20', kind: 'terminalDiagram' });
    const scene = renderPage(renderContext(d), 'p_termdiag');
    const t = texts(scene.elements);
    expect(t).toEqual(expect.arrayContaining(['=FB+CAB1-X1', '=FB+CAB1-X4', 'PE', '=FB+FIELD-2M2:U', '=FB+CAB1-3Q2:2']));
    // X1: 4 terminals, X3: 1, X4: 3 boxes
    expect(scene.elements.filter((e) => e.kind === 'rect' && e.meta?.role === 'report')).toHaveLength(8);
    // X4 1–2–3 bridged: dots joined by two vertical lines
    expect(scene.elements.filter((e) => e.kind === 'circle')).toHaveLength(3);
  });
});
