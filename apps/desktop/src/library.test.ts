import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadLibraryFolder, saveLibraryEntry } from './library.js';

let folder: string;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'wirewright-lib-'));
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

const device = { id: 'acme.relay', name: 'ACME relay', functions: [{ symbol: 'iec60617.relay.coil', main: true }] };

describe('shared library folder', () => {
  it('saves device definitions and loads them with other library files', async () => {
    await saveLibraryEntry(folder, device);
    await saveLibraryEntry(folder, { id: 'own.lamp-test', name: 'Lamp test', items: [{ id: 'i_lamp', symbol: 'own.lamp', x: 0, y: 0, rotation: 0, mirror: false }] });
    await mkdir(join(folder, 'symbols'));
    await writeFile(join(folder, 'symbols', 'own.json'), JSON.stringify({ symbols: [{ id: 'own.lamp', name: 'Lamp', category: 'own', function: 'lamp', defaultRole: 'main', letterCode: 'P', graphics: [], connections: [], texts: [] }] }));
    const content = await loadLibraryFolder(folder);
    expect(content.devices?.map((d) => d.id)).toEqual(['acme.relay']);
    expect(content.symbols?.map((s) => s.id)).toEqual(['own.lamp']);
    expect(content.macros?.map((m) => m.id)).toEqual(['own.lamp-test']);
  });

  it('saves symbols and frames as library content and loads them', async () => {
    const symbol = { id: 'own.lamp', name: 'Lamp', category: 'own', function: 'lamp', defaultRole: 'main' as const, graphics: [], connections: [], texts: [] };
    const frame = { id: 'own.a4', name: 'A4', size: { width: 297, height: 210 }, drawingArea: { x: 10, y: 10, width: 277, height: 170 }, columns: { count: 8, x: 10, width: 277 / 8 }, rows: { labels: ['A', 'B'], y: 10, height: 85 }, graphics: [], fields: [] };
    expect(await saveLibraryEntry(folder, symbol)).toMatch(/symbols[\\/]own\.lamp\.json$/);
    expect(await saveLibraryEntry(folder, frame)).toMatch(/frames[\\/]own\.a4\.json$/);
    const content = await loadLibraryFolder(folder);
    expect(content.symbols?.map((s) => s.id)).toEqual(['own.lamp']);
    expect(content.frames?.map((f) => f.id)).toEqual(['own.a4']);
  });

  it('saves parts to parts/<id>.json and loads them', async () => {
    const target = await saveLibraryEntry(folder, { id: 'Finder:40.52', manufacturer: 'Finder', partNumber: '40.52', price: 12.5, currency: 'EUR' });
    expect(target).toMatch(/parts[\\/]Finder_40\.52\.json$/);
    expect((await loadLibraryFolder(folder)).parts).toEqual([{ id: 'Finder:40.52', manufacturer: 'Finder', partNumber: '40.52', price: 12.5, currency: 'EUR' }]);
  });

  it('names the file that is broken', async () => {
    await writeFile(join(folder, 'broken.json'), '{ nope');
    await expect(loadLibraryFolder(folder)).rejects.toThrow(/broken\.json: invalid JSON/);
    await writeFile(join(folder, 'broken.json'), JSON.stringify({ id: 'x', functions: [] }));
    await expect(loadLibraryFolder(folder)).rejects.toThrow(/broken\.json/);
  });
});
