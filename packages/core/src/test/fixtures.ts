// A minimal library and helpers for core tests (the real library lives in @wirewright/library).
import { ProjectDocument } from '../document.js';
import { MapLibrary } from '../library.js';
import { createProjectState } from '../project.js';
import type { FrameDefinition, SymbolDefinition } from '../schema.js';

function symbol(def: Partial<SymbolDefinition> & Pick<SymbolDefinition, 'id' | 'function' | 'defaultRole'>): SymbolDefinition {
  return { name: def.id, category: 'test', graphics: [], connections: [], texts: [], ...def };
}

const twoPins = [
  { id: '1', x: 0, y: -8, direction: 'up' as const },
  { id: '2', x: 0, y: 8, direction: 'down' as const },
];

export const frame: FrameDefinition = {
  id: 'iec.frame.a3',
  name: 'A3',
  size: { width: 420, height: 297 },
  drawingArea: { x: 24, y: 16, width: 380, height: 240 },
  columns: { count: 10, x: 24, width: 38 },
  rows: { labels: ['A', 'B', 'C', 'D', 'E', 'F'], y: 16, height: 40 },
  graphics: [],
  fields: [],
};

export const library = new MapLibrary({
  symbols: [
    symbol({ id: 'coil', function: 'relay.coil', defaultRole: 'main', letterCode: 'K', connections: twoPins, links: [] }),
    // A coil that shows a contact image even without a contact template
    symbol({ id: 'contactorCoil', function: 'contactor.coil', defaultRole: 'main', letterCode: 'Q', connections: twoPins, links: [], hasContactImage: true }),
    symbol({ id: 'no', function: 'contact.no', defaultRole: 'auxiliary', letterCode: 'K', links: [['1', '2']], connections: [
      { id: '1', x: 0, y: -8, direction: 'up', designation: '13' },
      { id: '2', x: 0, y: 8, direction: 'down', designation: '14' },
    ] }),
    symbol({ id: 'nc', function: 'contact.nc', defaultRole: 'auxiliary', letterCode: 'K', links: [['1', '2']], connections: [
      { id: '1', x: 0, y: -8, direction: 'up', designation: '21' },
      { id: '2', x: 0, y: 8, direction: 'down', designation: '22' },
    ] }),
    symbol({ id: 'button', function: 'switch.pushbutton.no', defaultRole: 'main', letterCode: 'S', connections: twoPins }),
    symbol({ id: 'terminal', function: 'terminal', defaultRole: 'auxiliary', letterCode: 'X', connections: twoPins, links: [['1', '2']] }),
    symbol({ id: 'psu', function: 'psu', defaultRole: 'main', letterCode: 'T', links: [], connections: [
      { id: 'L', x: -4, y: -12, direction: 'up' },
      { id: 'N', x: 0, y: -12, direction: 'up' },
      { id: '+', x: -4, y: 12, direction: 'down' },
      { id: '-', x: 4, y: 12, direction: 'down' },
    ] }),
    symbol({ id: 'corner', function: 'connection.corner', defaultRole: 'none', links: [['a', 'b']], connections: [
      { id: 'a', x: 0, y: 0, direction: 'right' },
      { id: 'b', x: 0, y: 0, direction: 'down' },
    ] }),
    symbol({ id: 'tee', function: 'connection.tee', defaultRole: 'none', links: [['a', 'b', 'c']], connections: [
      { id: 'a', x: 0, y: 0, direction: 'left' },
      { id: 'b', x: 0, y: 0, direction: 'right' },
      { id: 'c', x: 0, y: 0, direction: 'down' },
    ] }),
    symbol({ id: 'interruption', function: 'connection.interruption', defaultRole: 'none', connections: [{ id: 'a', x: 0, y: 0, direction: 'up' }] }),
    symbol({ id: 'break', function: 'connection.break', defaultRole: 'none', connections: [{ id: 'a', x: 0, y: 0, direction: 'up' }] }),
    symbol({ id: 'potential', function: 'connection.potential', defaultRole: 'none', connections: [{ id: 'a', x: 0, y: 0, direction: 'down' }] }),
    symbol({ id: 'potentialDefinition', function: 'connection.potentialDefinition', defaultRole: 'none', links: [['a', 'b']], connections: [
      { id: 'a', x: 0, y: 0, direction: 'up' },
      { id: 'b', x: 0, y: 0, direction: 'down' },
    ] }),
    symbol({ id: 'blackbox', function: 'generic', defaultRole: 'main', letterCode: 'A', connections: twoPins }),
    symbol({ id: 'cable', function: 'cable', defaultRole: 'main', letterCode: 'W', generator: 'cable' }),
    symbol({ id: 'marker', function: 'connection.definition', defaultRole: 'none', links: [['a', 'b']], connections: [
      { id: 'a', x: 0, y: 0, direction: 'up' },
      { id: 'b', x: 0, y: 0, direction: 'down' },
    ] }),
    symbol({ id: 'card', function: 'plc.card', defaultRole: 'main', letterCode: 'A', generator: 'plcCard' }),
    symbol({ id: 'di', function: 'plc.di', defaultRole: 'auxiliary', letterCode: 'A', links: [], connections: [{ id: '1', x: 0, y: -8, direction: 'up' }] }),
    symbol({ id: 'do', function: 'plc.do', defaultRole: 'auxiliary', letterCode: 'A', links: [], connections: [{ id: '1', x: 0, y: 8, direction: 'down' }] }),
    symbol({ id: 'structureBox', function: 'box.structure', defaultRole: 'none', resizable: true }),
    symbol({ id: 'text', function: 'text', defaultRole: 'none' }),
    symbol({ id: 'deviceBox', function: 'box.device', defaultRole: 'main', letterCode: 'A', resizable: true, links: [] }),
  ],
  frames: [frame],
  forms: (['pageIndex', 'deviceIndex', 'bom', 'terminalList'] as const).map((kind) => ({
    id: `iec.form.${kind}`,
    name: kind,
    kind,
    frame: 'iec.frame.a3',
    title: kind,
    table: { x: 24, y: 24, headerHeight: 8, rowHeight: 6, rows: 3 },
    columns: [{ key: 'a', title: { de: 'A', en: 'A' }, width: 100 }],
  })),
  devices: [
    {
      id: 'wago.750-430',
      name: 'WAGO 750-430 8DI',
      manufacturer: 'WAGO',
      partNumber: '750-430',
      functions: [
        { symbol: 'card', main: true },
        ...[1, 2, 3, 4, 5, 6, 7, 8].map((channel) => ({ symbol: 'di', channel })),
      ],
      plc: {
        channels: [1, 2, 3, 4, 5, 6, 7, 8].map((channel) => ({ channel, kind: 'DI' as const, pin: String([1, 5, 2, 6, 3, 7, 4, 8][channel - 1]) })),
      },
    },
    {
      id: 'relay.2no',
      name: 'Relay 2 NO',
      functions: [
        { symbol: 'coil', main: true },
        { symbol: 'no', pins: { '1': '13', '2': '14' } },
        { symbol: 'no', pins: { '1': '23', '2': '24' } },
      ],
    },
  ],
  templates: [
    {
      id: 'relay.2co',
      name: 'Relay 2 CO',
      contacts: [
        { function: 'contact.co', pins: ['11', '12', '14'] },
        { function: 'contact.co', pins: ['21', '22', '24'] },
      ],
    },
  ],
});

/** x coordinate in the middle of a frame column (1-based). */
export function column(n: number): number {
  return frame.columns.x + frame.columns.width * (n - 1) + 16;
}

/** A document with one schematic page named `5` (=SG+10). Returns the document and the page ID. */
export function documentWithPage(): { doc: ProjectDocument; pageId: string } {
  const doc = new ProjectDocument(createProjectState({ name: 'Test' }), library);
  doc.apply({ type: 'createPage', id: 'p_five', name: '5', structure: { function: 'SG', location: '10' } });
  doc.takeChanges();
  return { doc, pageId: 'p_five' };
}
