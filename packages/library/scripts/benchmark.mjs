/* global console, performance, process */
// Benchmark of the derived data on a large project: the demo's schematic pages copied N times
// (default 60 → about 250 pages, 3,500 items). Measures what one edit costs: after moving a
// symbol, everything the editor shows is computed again.
// Run after `pnpm build`: node packages/library/scripts/benchmark.mjs [copies]
import { ProjectDocument } from '@wirewright/core';
import { createDemoProject, createStandardLibrary } from '../dist/index.js';

const copies = Number(process.argv[2] ?? 60);
const library = createStandardLibrary();
const base = createDemoProject(library);
const state = JSON.parse(JSON.stringify(base));
const schematic = base.project.pages.filter((id) => base.pages[id].type === 'schematic');
let name = 100;
for (let k = 1; k <= copies; k++) {
  for (const id of schematic) {
    const ids = new Set(base.pages[id].items.map((i) => i.id));
    const copy = JSON.parse(JSON.stringify(base.pages[id]).replace(/"(i_[a-z0-9]+)"/g, (m, itemId) => (ids.has(itemId) ? `"${itemId}_${k}"` : m)));
    copy.id = `p_c${k}x${id.slice(2)}`;
    copy.name = String(name++);
    copy.structure = { ...copy.structure, function: `FB${k}` };
    state.pages[copy.id] = copy;
    state.project.pages.push(copy.id);
  }
}
const items = Object.values(state.pages).reduce((n, p) => n + (p.items?.length ?? 0), 0);
console.log(`${state.project.pages.length} pages, ${items} items`);

const doc = new ProjectDocument(state, library);
const parts = {
  devices: (d) => d.devices(),
  connectivity: (d) => d.connectivity(),
  crossReferences: (d) => d.crossReferences(),
  plc: (d) => d.plc(),
  cables: (d) => d.cables(),
  wires: (d) => d.wires(),
  terminals: (d) => d.terminals(),
  sheets: (d) => d.sheets(),
  check: (d) => d.check(),
};
let start = performance.now();
for (const f of Object.values(parts)) f(doc);
console.log(`first computation ${(performance.now() - start).toFixed(0)} ms`);

const lamp = base.pages.p_control.items.find((i) => i.symbol === 'iec60617.lamp').id;
const runs = 20;
const sums = {};
for (let i = 0; i < runs; i++) {
  doc.apply({ type: 'moveItems', pageId: 'p_control', itemIds: [lamp], dx: i % 2 ? -4 : 4, dy: 0 });
  for (const [key, f] of Object.entries(parts)) {
    start = performance.now();
    f(doc);
    sums[key] = (sums[key] ?? 0) + performance.now() - start;
  }
}
let total = 0;
console.log(`per edit (mean of ${runs}):`);
for (const [key, sum] of Object.entries(sums)) {
  total += sum / runs;
  console.log(`  ${key.padEnd(16)} ${(sum / runs).toFixed(1).padStart(6)} ms`);
}
console.log(`  ${'total'.padEnd(16)} ${total.toFixed(1).padStart(6)} ms`);
