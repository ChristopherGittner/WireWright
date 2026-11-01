// A small demo project: motor power circuit, 24 V supply, contactor control
// with self-holding, indicator lamp, relay and valve, plus report pages.
// Used by the editor's browser demo, by tests and as an example for MCP users.
// Part numbers are placeholders (manufacturer "ACME").
import { createProjectState, placeFunctionCommand, ProjectDocument, type Command, type Library, type ProjectState } from '@wirewright/core';

type Place = Omit<Extract<Command, { type: 'placeSymbol' }>, 'type' | 'pageId'>;

const text = (de: string, en: string) => ({ de, en });
const part = (partNumber: string) => [{ manufacturer: 'ACME', partNumber, quantity: 1 }];

export function createDemoProject(library: Library): ProjectState {
  const doc = new ProjectDocument(createProjectState({ name: 'Förderband FB-100' }), library);
  doc.apply([
    { type: 'setProjectProperties', description: text('Demoprojekt', 'Demo project'), properties: { customer: 'ACME GmbH', drawingNumber: 'FB-100-E', createdBy: 'Wirewright' } },
    { type: 'createReportPage', id: 'p_toc', name: '1', kind: 'pageIndex', structure: { function: 'DOC' }, description: text('Inhaltsverzeichnis', 'Table of contents') },
    { type: 'createPage', id: 'p_power', name: '2', structure: { function: 'FB', location: 'CAB1' }, description: text('Leistungsteil Förderband', 'Power circuit conveyor') },
    { type: 'createPage', id: 'p_control', name: '3', structure: { function: 'FB', location: 'CAB1' }, description: text('Steuerung Förderband', 'Control circuit conveyor') },
    { type: 'createPage', id: 'p_plc', name: '4', structure: { function: 'FB', location: 'CAB1' }, description: text('SPS-Übersicht', 'PLC overview') },
    { type: 'createPage', id: 'p_sensors', name: '5', structure: { function: 'FB', location: 'CAB1' }, description: text('SPS-Ein- und Ausgänge', 'PLC inputs and outputs') },
    { type: 'createReportPage', id: 'p_devices', name: '6', kind: 'deviceIndex', structure: { function: 'DOC' }, description: text('Betriebsmittelverzeichnis', 'Device directory') },
    { type: 'createReportPage', id: 'p_bom', name: '7', kind: 'bom', structure: { function: 'DOC' }, description: text('Stückliste', 'Bill of materials') },
    { type: 'createReportPage', id: 'p_terminals', name: '8', kind: 'terminalList', structure: { function: 'DOC' }, description: text('Klemmenplan', 'Terminal list') },
    { type: 'createReportPage', id: 'p_io', name: '9', kind: 'plcIoList', structure: { function: 'DOC' }, description: text('E/A-Liste', 'I/O list') },
    { type: 'setPlcs', plcs: [{ name: 'PLC1', family: 'siemens', description: text('Steuerung Förderband', 'Conveyor controller'), firstAddress: { DI: 10, DO: 10 } }] },
  ]);

  const place = (pageId: string, items: Place[]) => doc.apply(items.map((i) => ({ type: 'placeSymbol' as const, pageId, ...i })));
  const potential = (x: number, y: number, name: string, up = false): Place => ({ symbol: 'wirewright.connection.potential', x, y, props: { name }, ...(up ? { rotation: 180 as const } : {}) });

  // The contactor coil first: it is named by its position (-3Q2), and its
  // contacts on pages 2 and 3 refer to that name.
  place('p_control', [
    {
      id: 'i_q2',
      symbol: 'iec60617.contactor.coil',
      x: 80,
      y: 136,
      template: 'contactor.3p.1no1nc',
      props: { functionText: text('Förderband', 'Conveyor'), parts: part('CON-9A-24DC') },
    },
  ]);

  // Page 2: power circuit and 24 V supply
  place('p_power', [
    potential(80, 24, 'L1'),
    potential(88, 24, 'L2'),
    potential(96, 24, 'L3'),
    potential(104, 24, 'PE'),
    { id: 'i_f2', symbol: 'iec60617.mcb.3p', x: 80, y: 40, props: { functionText: text('Motorabgang', 'Motor feeder'), technicalData: 'C10', parts: part('MCB-C10-3P') } },
    { symbol: 'iec60617.contactor.main3', x: 80, y: 72, tag: { product: '3Q2' } },
    { symbol: 'iec60617.terminal', x: 80, y: 92, tag: { product: 'X1' }, props: { terminal: '1' } },
    { symbol: 'iec60617.terminal', x: 88, y: 92, tag: { product: 'X1' }, props: { terminal: '2' } },
    { symbol: 'iec60617.terminal', x: 96, y: 92, tag: { product: 'X1' }, props: { terminal: '3' } },
    { symbol: 'iec60617.terminal.pe', x: 104, y: 92, tag: { product: 'X1' }, props: { terminal: 'PE' } },
    { id: 'i_m', symbol: 'iec60617.motor.3ph', x: 88, y: 116, tag: { location: 'FIELD' }, props: { functionText: text('Antrieb Förderband', 'Conveyor drive'), technicalData: '0,75 kW', parts: part('MOT-075') } },
    potential(268, 24, 'L1'),
    potential(272, 24, 'N'),
    potential(276, 24, 'PE'),
    { id: 'i_t', symbol: 'iec60617.psu.acdc', x: 272, y: 60, props: { functionText: text('Netzteil 24 V DC', 'Power supply 24 V DC'), parts: part('PSU-24-5A') } },
    potential(268, 96, '24V', true),
    potential(276, 96, '0V', true),
  ]);
  doc.apply({ type: 'setItemProperties', pageId: 'p_power', itemId: 'i_t', pinPotentials: { '+': '24V', '-': '0V' } });

  // Page 3: control circuit
  place('p_control', [
    // Path 1: e-stop, stop, start with self-holding contact, contactor coil
    potential(80, 24, '24V'),
    { symbol: 'iec60617.estop', x: 80, y: 48, props: { functionText: text('Not-Halt', 'Emergency stop'), parts: part('ESTOP-1NC') } },
    { symbol: 'iec60617.pushbutton.nc', x: 80, y: 72, props: { functionText: text('Band aus', 'Conveyor off'), parts: part('PB-RED-1NC') } },
    { symbol: 'wirewright.connection.tee.up-right-down', x: 80, y: 84 },
    { symbol: 'wirewright.connection.corner.down-left', x: 100, y: 84 },
    { symbol: 'iec60617.pushbutton.no', x: 80, y: 96, props: { functionText: text('Band ein', 'Conveyor on'), parts: part('PB-GRN-1NO') } },
    { symbol: 'iec60617.contact.no', x: 100, y: 96, tag: { product: '3Q2' } },
    { symbol: 'wirewright.connection.tee.up-right-down', x: 80, y: 116 },
    { symbol: 'wirewright.connection.corner.left-up', x: 100, y: 116 },
    potential(80, 160, '0V', true),
    // Path 2: lamp "conveyor stopped" via the contactor's NC contact
    potential(196, 24, '24V'),
    { symbol: 'iec60617.contact.nc', x: 196, y: 48, tag: { product: '3Q2' } },
    { symbol: 'iec60617.lamp', x: 196, y: 72, props: { functionText: text('Band steht', 'Conveyor stopped'), parts: part('LAMP-24-RD') } },
    potential(196, 96, '0V', true),
    // Path 3: selector switch and relay
    potential(272, 24, '24V'),
    { symbol: 'iec60617.switch.selector', x: 272, y: 48, props: { functionText: text('Beölung', 'Lubrication'), parts: part('SEL-2POS') } },
    { symbol: 'iec60617.relay.coil', x: 272, y: 72, template: 'relay.2co', props: { functionText: text('Beölung', 'Lubrication'), parts: part('REL-2CO-24DC') } },
    potential(272, 96, '0V', true),
    // Path 4: valve switched by the relay's first changeover contact, used as NO
    potential(348, 24, '24V'),
    { symbol: 'iec60617.contact.no', x: 348, y: 48, tag: { product: '3K7' }, pins: { '1': '11', '2': '14' } },
    { symbol: 'iec60617.valve.coil', x: 348, y: 72, tag: { location: 'FIELD' }, props: { functionText: text('Ölventil', 'Oil valve'), parts: part('VALVE-24') } },
    potential(348, 96, '0V', true),
  ]);
  // Page 4: PLC overview with a WAGO input card and output card (card masters)
  const di = library.device('wago.750-430')!;
  const dq = library.device('wago.750-530')!;
  doc.apply([
    placeFunctionCommand(di, 0, library, { pageId: 'p_plc', x: 60, y: 40, id: 'i_dicard' }),
    placeFunctionCommand(dq, 0, library, { pageId: 'p_plc', x: 220, y: 40, id: 'i_dqcard' }),
  ]);
  const cardTag = (id: string) => ({ product: doc.devices().byItem.get(id)!.split('-').at(-1)! });
  for (const [id, slot] of [['i_dicard', 1], ['i_dqcard', 2]] as const) {
    const card = (doc.state.pages.p_plc as { items: { id: string; props?: { plc?: object } }[] }).items.find((i) => i.id === id)!;
    doc.apply({ type: 'setItemProperties', pageId: 'p_plc', itemId: id, props: { plc: { ...card.props!.plc, station: 'PLC1', slot } } });
  }
  doc.apply({ type: 'assignPlcAddresses' });

  // Page 5: the I/O points where the sensors and valves are (slaves of the cards)
  const diTag = cardTag('i_dicard');
  const dqTag = cardTag('i_dqcard');
  place('p_sensors', [
    potential(80, 24, '24V'),
    { symbol: 'iec60617.pushbutton.no', x: 80, y: 48, tag: { location: 'FIELD' }, props: { functionText: text('Endlage Förderband', 'Conveyor end position'), parts: part('LS-1NO') } },
    { symbol: 'iec60617.terminal', x: 80, y: 72, tag: { product: 'X3' }, props: { terminal: '1' } },
    potential(160, 24, '24V'),
    { symbol: 'iec60617.pushbutton.no', x: 160, y: 48, props: { functionText: text('Störung quittieren', 'Acknowledge fault'), parts: part('PB-BLU-1NO') } },
    { symbol: 'iec60617.valve.coil', x: 240, y: 64, tag: { location: 'FIELD' }, props: { functionText: text('Schmierventil', 'Lubrication valve'), parts: part('VALVE-24') } },
    potential(240, 96, '0V', true),
    // 0V distribution: -X4:1 fed from the rail, bridged to -X4:2 … for field devices
    potential(320, 24, '0V'),
    { symbol: 'iec60617.terminal', x: 320, y: 72, tag: { product: 'X4' }, props: { terminal: '1', bridge: '0V' } },
    { symbol: 'iec60617.terminal', x: 328, y: 72, tag: { product: 'X4' }, props: { terminal: '2', bridge: '0V' } },
    { symbol: 'iec60617.terminal', x: 336, y: 72, tag: { product: 'X4' }, props: { terminal: '3', bridge: '0V' } },
  ]);
  // Motor cable between the terminals and the motor, and a wire marker in the control circuit
  doc.apply([
    placeFunctionCommand(library.device('cable.4g1.5.colors')!, 0, library, { pageId: 'p_power', x: 72, y: 102 }),
    { type: 'placeSymbol', pageId: 'p_control', symbol: 'wirewright.connection.definition', x: 80, y: 32 },
  ]);
  doc.apply({ type: 'setItemProperties', pageId: 'p_power', itemId: lastItem(doc, 'p_power'), props: { cable: { ...library.device('cable.4g1.5.colors')!.cable!, lengthM: 12 } } });
  doc.apply([
    placeFunctionCommand(di, 1, library, { pageId: 'p_sensors', x: 80, y: 96, tag: diTag }),
    placeFunctionCommand(di, 2, library, { pageId: 'p_sensors', x: 160, y: 72, tag: diTag }),
    placeFunctionCommand(dq, 1, library, { pageId: 'p_sensors', x: 240, y: 40, tag: dqTag }),
  ]);
  doc.apply({ type: 'numberWires' });
  return doc.state;
}

function lastItem(doc: ProjectDocument, pageId: string): string {
  const page = doc.state.pages[pageId] as { items: { id: string }[] };
  return page.items.at(-1)!.id;
}
