import { MemoryProjectStorage } from '@wirewright/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createWirewrightServer } from './server.js';

let storage: MemoryProjectStorage;
let client: Client;

beforeEach(async () => {
  storage = new MemoryProjectStorage();
  const server = createWirewrightServer({ storage });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientTransport);
});

async function call(name: string, args: Record<string, unknown> = {}): Promise<{ data: any; isError: boolean }> {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0]!.text;
  return { data: result.isError ? text : JSON.parse(text), isError: Boolean(result.isError) };
}

async function ok(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const { data, isError } = await call(name, args);
  if (isError) throw new Error(`${name} failed: ${data}`);
  return data;
}

describe('Wirewright MCP server', () => {
  it('lists its tools and explains conventions', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['create_project', 'get_page', 'place_symbol', 'list_devices', 'check_project', 'apply_commands']),
    );
    expect(client.getInstructions()).toMatch(/autoconnect/);
  });

  it('asks for create_project when the folder is empty', async () => {
    const { data, isError } = await call('get_project');
    expect(isError).toBe(true);
    expect(data).toMatch(/create_project/);
  });

  it('draws a relay with a contact and saves it to the folder', async () => {
    await ok('create_project', { name: 'Conveyor' });
    const page = await ok('create_page', { name: '5', description: 'Control circuit', function: 'SG', location: '10' });
    expect(page.fullName).toBe('=SG+10/5');

    const coil = await ok('place_symbol', { page: '5', symbol: 'iec60617.relay.coil', x: 104, y: 120, template: 'relay.2co', functionText: 'Band ein' });
    expect(coil).toMatchObject({ tag: '=SG+10-5K3', displayTag: '-5K3', position: '/5.3' });
    expect(coil.connections).toEqual([
      { pin: 'A1', designation: 'A1', x: 104, y: 112, direction: 'up' },
      { pin: 'A2', designation: 'A2', x: 104, y: 128, direction: 'down' },
    ]);

    const contact = await ok('place_symbol', { page: '=SG+10/5', symbol: 'iec60617.contact.no', x: 220, y: 120, tag: '-5K3' });
    expect(contact.device).toBe('=SG+10-5K3');

    const devices = await ok('list_devices');
    expect(devices).toHaveLength(1);
    expect(devices[0].functions.map((f: { position: string }) => f.position)).toEqual(['=SG+10/5.3', '=SG+10/5.6']);
    expect(devices[0].functionText).toEqual({ de: 'Band ein' });

    const project = await ok('get_project');
    expect(project.deviceCount).toBe(1);
    expect(project.frame.columns.count).toBe(10);
    expect(storage.files.has('project.json')).toBe(true);
    expect(storage.files.has(`pages/${page.id}.json`)).toBe(true);
  });

  it('renames a device through its coil; the contact follows', async () => {
    await ok('create_project', { name: 'Test' });
    await ok('create_page', { name: '1' });
    const coil = await ok('place_symbol', { page: '1', symbol: 'iec60617.relay.coil', x: 104, y: 120 });
    await ok('place_symbol', { page: '1', symbol: 'iec60617.contact.nc', x: 200, y: 120, tag: coil.displayTag });
    await ok('set_tag', { page: '1', item: coil.id, tag: '-K10' });
    const devices = await ok('list_devices');
    expect(devices.map((d: { device: string }) => d.device)).toEqual(['-K10']);
    expect(devices[0].functions).toHaveLength(2);
  });

  it('applies command batches atomically', async () => {
    await ok('create_project', { name: 'Test' });
    const result = await ok('apply_commands', {
      commands: [
        { type: 'createPage', id: 'p_two', name: '2' },
        { type: 'placeSymbol', pageId: 'p_two', id: 'i_k1', symbol: 'iec60617.relay.coil', x: 64, y: 100 },
        { type: 'placeSymbol', pageId: 'p_two', symbol: 'iec60617.contact.no', x: 140, y: 100, tag: { product: '2K2' } },
      ],
    });
    expect(result.created).toHaveLength(3);
    expect((await ok('get_page', { page: '2' })).items).toHaveLength(2);

    const failed = await call('apply_commands', {
      commands: [
        { type: 'deletePage', pageId: 'p_two' },
        { type: 'placeSymbol', pageId: 'p_two', symbol: 'nope', x: 0, y: 0 },
      ],
    });
    expect(failed.isError).toBe(true);
    expect((await ok('list_pages')).map((p: { id: string }) => p.id)).toEqual(['p_two']);
  });

  it('renders pages as PNG or SVG and lists report rows', async () => {
    await ok('create_project', { name: 'Test' });
    await ok('create_page', { name: '1', function: 'SG' });
    await ok('place_symbol', { page: '1', symbol: 'iec60617.relay.coil', x: 104, y: 120, functionText: 'Band ein' });
    await ok('create_report_page', { name: '2', kind: 'deviceIndex' });

    const png = await client.callTool({ name: 'render_page', arguments: { page: '1' } });
    const image = (png.content as { type: string; data: string; mimeType: string }[])[0]!;
    expect(image.type).toBe('image');
    expect(image.mimeType).toBe('image/png');
    expect(Buffer.from(image.data, 'base64').subarray(1, 4).toString()).toBe('PNG');

    const raw = await client.callTool({ name: 'render_page', arguments: { page: '1', format: 'svg' } });
    expect((raw.content as { text: string }[])[0]!.text).toContain('Band ein');

    const report = await ok('get_report', { page: '2' });
    expect(report.rows.map((r: { tag: string }) => r.tag)).toEqual(['=SG-1K3']);

    const page = await ok('set_page', { page: '1', description: 'Steuerung', properties: { revision: 'A' } });
    expect(page.description).toEqual({ de: 'Steuerung' });
  });

  it('draws a PLC card from the device library and exports its I/O', async () => {
    await ok('create_project', { name: 'PLC' });
    await ok('create_page', { name: '1', description: 'PLC overview' });
    await ok('create_page', { name: '2', description: 'Sensors' });
    await ok('set_plc', { name: 'PLC1', family: 'siemens', firstAddress: { DI: 'I8.0' } });
    const defs = await ok('list_device_definitions', { query: '750-430' });
    expect(defs[0].functions[2]).toEqual({ function: 3, label: 'DI 2 (pin 5)', main: false });

    const card = await ok('place_device_function', { page: '1', device: 'wago.750-430', function: 1, x: 60, y: 40 });
    expect(card.plcCard.channels).toHaveLength(8);
    await ok('set_card', { page: '1', item: card.id, plc: 'PLC1', slot: 1 });
    await ok('number_plc_addresses', { plc: 'PLC1' });
    const di2 = await ok('place_device_function', { page: '2', device: 'wago.750-430', function: 3, x: 100, y: 100, tag: card.displayTag });
    expect(di2.plcPoint).toMatchObject({ channel: 'DI 2', pin: '5', address: 'I8.1' });

    const io = await ok('get_io_list', { plc: 'PLC1' });
    expect(io[1]).toMatchObject({ channel: 'DI 2', address: 'I8.1', used: '/2.3' });

    const csv = await client.callTool({ name: 'export_plc', arguments: { plc: 'PLC1', format: 'csv' } });
    expect((csv.content as { text: string }[])[0]!.text).toContain('DI 2;5;I8.1');
    const tia = await client.callTool({ name: 'export_plc', arguments: { plc: 'PLC1', format: 'tia' } });
    const resource = (tia.content as { type: string; resource?: { blob: string; mimeType: string } }[])[1]!;
    expect(resource.type).toBe('resource');
    expect(Buffer.from(resource.resource!.blob, 'base64').subarray(0, 2).toString()).toBe('PK');
    expect(storage.files.has('library.json')).toBe(true);
  });

  it('keeps parts with prices; the bill of materials uses them', async () => {
    await ok('create_project', { name: 'Parts' });
    await ok('create_page', { name: '1' });
    const coil = await ok('place_symbol', { page: '1', symbol: 'iec60617.relay.coil', x: 100, y: 100 });
    await ok('set_properties', { page: '1', item: coil.id, props: { parts: [{ manufacturer: 'Finder', partNumber: '40.52', quantity: 2 }] } });
    await ok('set_part', { manufacturer: 'Finder', partNumber: '40.52', description: 'Relais', price: 9.5, currency: 'EUR', suppliers: [{ name: 'Elektro AG' }] });
    expect(await ok('search_parts', { query: 'relais' })).toEqual([expect.objectContaining({ id: 'Finder:40.52', price: 9.5 })]);
    await ok('create_report_page', { name: '90', kind: 'bom' });
    const bom = await ok('get_report', { page: '90' });
    expect(JSON.stringify(bom)).toContain('19,00 EUR');
  });

  it('draws a current path in a column and joins pins with corners', async () => {
    await ok('create_project', { name: 'Paths' });
    await ok('create_page', { name: '1' });
    const path = await ok('draw_current_path', {
      page: '1',
      column: 3,
      top: '24V',
      bottom: '0V',
      elements: [
        { symbol: 'iec60617.contact.no', tag: '-K1', functionText: 'Start' },
        { symbol: 'iec60617.relay.coil', tag: '-K2', functionText: 'Motor ein' },
      ],
    });
    expect(path.x).toBe(120);
    expect(path.items.map((i: { symbol: string }) => i.symbol)).toEqual(['wirewright.connection.potential', 'iec60617.contact.no', 'iec60617.relay.coil', 'wirewright.connection.potential']);
    expect(path.openConnections).toEqual([]);
    const issues = await ok('check_project');
    expect(JSON.stringify(issues)).not.toMatch(/connection\.open|ambiguous/);

    // two lamps side by side at different heights: a Z route with two corners
    const a = await ok('place_symbol', { page: '1', symbol: 'iec60617.lamp', x: 200, y: 60 });
    const b = await ok('place_symbol', { page: '1', symbol: 'iec60617.lamp', x: 240, y: 120 });
    const pinOf = (item: { connections: { pin: string; direction: string }[] }, dir: string) => item.connections.find((c) => c.direction === dir)!.pin;
    const joined = await ok('connect_pins', { page: '1', from: { item: a.id, pin: pinOf(a, 'down') }, to: { item: b.id, pin: pinOf(b, 'up') } });
    expect(joined.corners.map((c: { symbol: string }) => c.symbol)).toEqual(['wirewright.connection.corner.up-right', 'wirewright.connection.corner.down-left']);
    expect(joined.connected).toBe(true);
    const wrong = await call('connect_pins', { page: '1', from: { item: a.id, pin: pinOf(a, 'up') }, to: { item: b.id, pin: pinOf(b, 'down') } });
    expect(wrong.isError).toBe(true);
  });

  it('lays out a mounting plate with rails, ducts and devices', async () => {
    await ok('create_project', { name: 'Cabinet' });
    await ok('create_page', { name: '1', location: 'CAB1' });
    const coil = await ok('place_symbol', { page: '1', symbol: 'iec60617.relay.coil', x: 100, y: 100, tag: '-K1' });
    await ok('set_properties', { page: '1', item: coil.id, props: { parts: [{ manufacturer: 'Finder', partNumber: '40.52', quantity: 1 }] } });
    expect(JSON.stringify(await ok('check_project'))).not.toContain('layout.notPlaced');
    await ok('create_layout_page', { name: '10', location: 'CAB1', plateWidth: 600, plateHeight: 800, scale: 5 });
    expect(JSON.stringify(await ok('check_project'))).toContain('layout.notPlaced');
    await ok('set_part', { manufacturer: 'Finder', partNumber: '40.52', width: 15.5, height: 78 });
    const page = await ok('place_layout_items', {
      page: '10',
      items: [
        { kind: 'rail', x: 20, y: 100, length: 560 },
        { kind: 'duct', x: 20, y: 20, length: 560, width: 60 },
        { kind: 'device', device: '-K1', x: 40, y: 78.5 },
      ],
    });
    expect(page).toMatchObject({ type: 'layout', plate: { width: 600, height: 800 }, scale: 5 });
    expect(page.items[2]).toMatchObject({ kind: 'device', device: '+CAB1-K1', size: { width: 15.5, height: 78 }, sizeFrom: 'part', part: 'Finder 40.52' });
    expect(JSON.stringify(await ok('check_project'))).not.toContain('layout.notPlaced');
    const moved = await ok('move_layout_items', { page: '10', items: [page.items[2].id], dx: 20, dy: 0 });
    expect(moved.items[2].x).toBe(60);
    expect((await call('place_symbol', { page: '10', symbol: 'iec60617.lamp', x: 0, y: 0 })).data).toMatch(/cabinet layout/);
    await ok('create_report_page', { name: '90', kind: 'mountingPlate' });
    expect(JSON.stringify(await ok('get_report', { page: '90' }))).toContain('Finder 40.52');
    const png = await client.callTool({ name: 'render_page', arguments: { page: '10' } });
    expect(png.isError).toBeFalsy();

    const lamp = await ok('place_symbol', { page: '1', symbol: 'iec60617.lamp', x: 200, y: 100, tag: '-P1', functionText: 'Betrieb' });
    await ok('create_layout_page', { name: '11', location: 'CAB1', plateWidth: 600, plateHeight: 800, scale: 5, surface: 'door' });
    const door = await ok('place_layout_items', { page: '11', items: [{ kind: 'device', device: '-P1', x: 100, y: 100 }, { kind: 'cutout', x: 200, y: 100, width: 192, height: 138, label: 'HMI' }] });
    expect(door).toMatchObject({ surface: 'door', items: [{ device: '+CAB1-P1', shape: 'round', size: { width: 30, height: 30 } }, { kind: 'cutout', label: 'HMI' }] });
    expect(lamp.id).toBeTruthy();
  });

  it('imports parts from a BMEcat catalog with feature mapping', async () => {
    await ok('create_project', { name: 'Catalog' });
    const file = join(mkdtempSync(join(tmpdir(), 'wirewright-bmecat-')), 'catalog.xml');
    writeFileSync(
      file,
      `<?xml version="1.0" encoding="UTF-8"?><BMECAT version="2005"><HEADER><CATALOG><LANGUAGE>eng</LANGUAGE><CURRENCY>EUR</CURRENCY></CATALOG><SUPPLIER><SUPPLIER_NAME>Finder</SUPPLIER_NAME></SUPPLIER></HEADER><T_NEW_CATALOG>
      <PRODUCT><SUPPLIER_PID>405290240000</SUPPLIER_PID><PRODUCT_DETAILS><DESCRIPTION_SHORT>Relay</DESCRIPTION_SHORT><MANUFACTURER_PID>40.52</MANUFACTURER_PID><MANUFACTURER_NAME>Finder</MANUFACTURER_NAME></PRODUCT_DETAILS>
      <PRODUCT_FEATURES><REFERENCE_FEATURE_SYSTEM_NAME>ECLASS-13.0</REFERENCE_FEATURE_SYSTEM_NAME><REFERENCE_FEATURE_GROUP_ID>27371601</REFERENCE_FEATURE_GROUP_ID>
      <FEATURE><FNAME>Width</FNAME><FVALUE>15.5</FVALUE><FUNIT>MMT</FUNIT></FEATURE><FEATURE><FNAME>0173-1#02-XYZ#001</FNAME><FVALUE>78</FVALUE><FUNIT>MMT</FUNIT></FEATURE>
      <FEATURE><FNAME>Rated control supply voltage at DC</FNAME><FVALUE>24</FVALUE><FUNIT>VLT</FUNIT></FEATURE></PRODUCT_FEATURES></PRODUCT></T_NEW_CATALOG></BMECAT>`,
    );
    const preview = await ok('import_parts', { path: file, dryRun: true });
    expect(preview).toMatchObject({ imported: 0, catalog: { supplier: 'Finder', products: 1 } });
    expect(preview.features).toContainEqual({ feature: '0173-1#02-XYZ#001', example: '78 MMT', products: 1, field: 'property' });
    expect(await ok('import_parts', { path: file, mapping: { '0173-1#02-XYZ#001': 'height' } })).toMatchObject({ imported: 1 });
    expect(await ok('search_parts', { query: '40.52' })).toEqual([expect.objectContaining({ width: 15.5, height: 78, ratedVoltage: '24 V DC', classification: [{ system: 'ECLASS-13.0', id: '27371601' }] })]);
  });

  it('acknowledges issues: they stay listed but do not count', async () => {
    await ok('create_project', { name: 'Ack' });
    await ok('create_page', { name: '1' });
    await ok('place_symbol', { page: '1', symbol: 'iec60617.motor.3ph', x: 100, y: 200 });
    const issue = (await ok('check_project')).find((i: { code: string }) => i.code === 'pe.notConnected');
    expect(issue.key).toBeTruthy();
    expect((await ok('get_project')).issues.warning).toBeGreaterThan(0);
    const before = (await ok('get_project')).issues.warning;
    await ok('acknowledge_issues', { keys: [issue.key], note: 'PE via housing' });
    expect((await ok('check_project')).find((i: { code: string }) => i.code === 'pe.notConnected').acknowledged).toMatchObject({ note: 'PE via housing' });
    expect((await ok('get_project')).issues).toMatchObject({ warning: before - 1, acknowledged: 1 });
    await ok('acknowledge_issues', { keys: [issue.key], undo: true });
    expect((await ok('get_project')).issues.warning).toBe(before);
  });

  it('appends PLC cards to a PLC', async () => {
    await ok('create_project', { name: 'Rack' });
    await ok('set_plc', { name: 'PLC1', family: 'siemens' });
    const card = await ok('add_plc_card', { plc: 'PLC1', device: 'wago.750-430' });
    expect(card).toMatchObject({ slot: 0 });
    expect(card.channels.slice(0, 2)).toMatchObject([{ channel: 'DI 1', pin: '1' }, { channel: 'DI 2', pin: '5' }]);
    expect(await ok('add_plc_card', { plc: 'PLC1', device: 'wago.750-530' })).toMatchObject({ slot: 1 });
  });

  it('adds a PLC card without a drawing and draws it later', async () => {
    await ok('create_project', { name: 'Cards' });
    await ok('create_page', { name: '1', location: 'CAB1' });
    await ok('set_plc', { name: 'PLC1', family: 'siemens' });
    const card = await ok('add_plc_card', { device: 'wago.750-430', tag: '+CAB1-A10', plc: 'PLC1', slot: 1 });
    expect(card).toMatchObject({ device: '+CAB1-A10', drawn: false });
    expect(card.channels).toHaveLength(8);
    expect(JSON.stringify(await ok('check_project'))).toContain('plc.cardNotDrawn');
    const placed = await ok('place_plc_card', { card: '-A10', page: '1', x: 300, y: 40 });
    expect(placed.id).toBe(card.item);
    expect(JSON.stringify(await ok('check_project'))).not.toContain('plc.cardNotDrawn');
    await ok('place_plc_card', { card: '+CAB1-A10', page: '1', x: 200, y: 40 });
    expect(JSON.stringify(await ok('check_project'))).toContain('plc.cardDrawnTwice');
  });

  it('releases revisions and reports the changes since', async () => {
    await ok('create_project', { name: 'Rev' });
    await ok('create_page', { name: '1' });
    const lamp = await ok('place_symbol', { page: '1', symbol: 'iec60617.lamp', x: 100, y: 100 });
    expect(await ok('create_revision', { author: 'CG', description: 'Erstausgabe' })).toEqual({ revision: 'A', markedPages: ['/1'] });
    expect(storage.files.has('revisions/A.json')).toBe(true);
    await ok('create_page', { name: '2' });
    await ok('move_items', { page: '1', items: [lamp.id], dx: 8, dy: 0 });
    const changes = await ok('get_changes');
    expect(changes).toMatchObject({ since: 'A', newPages: ['/2'], deletedPages: [], changedPages: [{ page: '/1', added: [], removed: [] }] });
    expect(changes.changedPages[0].changed).toHaveLength(1);
    expect(await ok('create_revision', {})).toEqual({ revision: 'B', markedPages: ['/1', '/2'] });
  });

  it('imports tag names back from a PLC tag table', async () => {
    await ok('create_project', { name: 'PLC' });
    await ok('create_page', { name: '1' });
    await ok('set_plc', { name: 'PLC1', family: 'siemens', firstAddress: { DI: 'I8.0' } });
    const card = await ok('place_device_function', { page: '1', device: 'wago.750-430', function: 1, x: 60, y: 40 });
    await ok('set_card', { page: '1', item: card.id, plc: 'PLC1', slot: 1 });
    await ok('number_plc_addresses', { plc: 'PLC1' });
    const content = 'Name;Logical Address;Comment\nB_Endlage;%E8.1;Endlage Band\nX;%I99.0;\n';
    const preview = await ok('import_plc_tags', { plc: 'PLC1', content, comments: true });
    expect(preview).toMatchObject({ applied: false, unmatched: [{ name: 'X', address: '%I99.0' }] });
    expect(preview.changes).toEqual([{ card: expect.any(String), channel: 'DI 2', address: 'I8.1', name: { from: expect.any(String), to: 'B_Endlage' }, function: { from: '', to: 'Endlage Band' } }]);
    await ok('import_plc_tags', { plc: 'PLC1', content, comments: true, apply: true });
    const io = await ok('get_io_list', { plc: 'PLC1' });
    expect(io[1]).toMatchObject({ address: 'I8.1', name: 'B_Endlage', function: 'Endlage Band' });
  });

  it('draws a cable across conductors and numbers the wires', async () => {
    await ok('create_project', { name: 'Cable' });
    await ok('create_page', { name: '1' });
    for (const [x, name] of [[100, 'L1'], [108, 'N'], [116, 'PE']] as const) {
      await ok('place_symbol', { page: '1', symbol: 'wirewright.connection.potential', x, y: 40, name });
      await ok('place_symbol', { page: '1', symbol: 'wirewright.connection.break', x, y: 120 });
    }
    await ok('place_symbol', { page: '1', symbol: 'wirewright.connection.definition', x: 100, y: 60 });
    const cable = await ok('place_symbol', { page: '1', symbol: 'wirewright.cable', x: 92, y: 80, width: 32 });
    const cables = await ok('set_cable', { page: '1', item: cable.id, type: '3G1.5', identification: 'colors' });
    expect(cables[0].cores.map((c: { color: string; wire?: string }) => [c.color, c.wire])).toEqual([
      ['BN', '1.3.1'],
      ['BU', '1.3.2'],
      ['GNYE', '1.3.3'],
    ]);
    const numbered = await ok('number_wires', {});
    expect(numbered).toEqual([{ number: '1.3.1', ends: [] }]);
    const wires = await ok('get_wires');
    expect(wires[0]).toMatchObject({ number: '1.3.1', color: 'BN', crossSection: 1.5, potential: 'L1', numberSource: 'marker' });
  });

  it('lists and renumbers terminal strips', async () => {
    await ok('create_project', { name: 'Terminals' });
    await ok('create_page', { name: '1' });
    for (const x of [100, 120]) await ok('place_symbol', { page: '1', symbol: 'iec60617.terminal', x, y: 60, tag: '+CAB-X1', props: { bridge: 'A' } });
    await ok('place_symbol', { page: '1', symbol: 'iec60617.terminal.pe', x: 140, y: 60, tag: '+CAB-X1', props: { terminal: 'PE' } });
    const renumbered = await ok('renumber_terminals', { strip: '+CAB-X1', start: 5 });
    expect(renumbered.map((t: { terminal: string }) => t.terminal)).toEqual(['5', '6', 'PE']);
    const strips = await ok('get_terminal_strips', {});
    expect(strips[0]).toMatchObject({ device: '+CAB-X1', location: 'CAB' });
    expect(strips[0].terminals[0]).toMatchObject({ designation: '5', bridge: 'A', page: '1' });
  });

  it('places, saves and lists macros', async () => {
    await ok('create_project', { name: 'Macros' });
    await ok('create_page', { name: '2' });
    const macros = await ok('list_macros', { query: 'self' });
    expect(macros[0]).toMatchObject({ id: 'wirewright.macro.selfholding' });
    const placed = await ok('place_macro', { page: '2', macro: 'wirewright.macro.selfholding', x: 80, y: 24 });
    const tags = placed.map((i: { tag?: string }) => i.tag).filter(Boolean);
    expect(tags).toContain('-2Q2');
    expect(tags.filter((t: string) => t === '-2Q2')).toHaveLength(2);
    const saved = await ok('save_macro', { page: '2', items: placed.slice(0, 3).map((i: { id: string }) => i.id), id: 'own', name: 'Own' });
    expect(saved).toEqual({ id: 'own', items: 3 });
    expect((await ok('list_macros', { query: 'own' })).map((m: { id: string }) => m.id)).toEqual(['own']);
  });

  it('finds symbols and reports problems', async () => {
    const symbols = await ok('search_symbols', { query: 'schließer' });
    expect(symbols.map((s: { id: string }) => s.id)).toContain('iec60617.contact.no');

    await ok('create_project', { name: 'Test' });
    await ok('create_page', { name: '1' });
    await ok('place_symbol', { page: '1', symbol: 'iec60617.contact.no', x: 100, y: 100, tag: '-K7' });
    const issues = await ok('check_project');
    expect(issues.map((i: { code: string }) => i.code)).toContain('device.noMainFunction');

    const bad = await call('place_symbol', { page: '9', symbol: 'iec60617.relay.coil', x: 0, y: 0 });
    expect(bad.isError).toBe(true);
    expect(bad.data).toMatch(/Page "9" not found/);
  });
});
