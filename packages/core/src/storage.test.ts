import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NodeProjectStorage } from './node.js';
import { loadProject, MemoryProjectStorage, pagePath, PROJECT_FILE, ProjectLoadError, saveProject } from './storage.js';
import { column, documentWithPage } from './test/fixtures.js';

describe('saving and loading', () => {
  it('round-trips a project through a folder of JSON files', async () => {
    const { doc, pageId } = documentWithPage();
    doc.apply({ type: 'placeSymbol', pageId, symbol: 'coil', x: column(3), y: 100, props: { functionText: { de: 'Band ein', en: 'Belt on' } } });
    const storage = new MemoryProjectStorage();
    await saveProject(storage, doc.state);
    expect([...storage.files.keys()].sort()).toEqual([pagePath(pageId), PROJECT_FILE]);
    expect(await loadProject(storage)).toEqual(doc.state);
  });

  it('writes only changed pages and removes deleted ones', async () => {
    const { doc, pageId } = documentWithPage();
    doc.apply({ type: 'createPage', id: 'p_six', name: '6' });
    const storage = new MemoryProjectStorage();
    await saveProject(storage, doc.state);
    doc.takeChanges();

    storage.files.set(pagePath(pageId), 'untouched');
    doc.apply({ type: 'placeSymbol', pageId: 'p_six', symbol: 'coil', x: 100, y: 100 });
    await saveProject(storage, doc.state, doc.takeChanges());
    expect(storage.files.get(pagePath(pageId))).toBe('untouched');

    doc.apply({ type: 'deletePage', pageId: 'p_six' });
    await saveProject(storage, doc.state, doc.takeChanges());
    expect(storage.files.has(pagePath('p_six'))).toBe(false);
  });

  it('reports which file is broken and why', async () => {
    const { doc, pageId } = documentWithPage();
    const storage = new MemoryProjectStorage();
    await saveProject(storage, doc.state);
    storage.files.set(pagePath(pageId), '{ "id": "p_five", "type": "schematic", "name": "5", "items": [{ "id": "bad" }] }');
    await expect(loadProject(storage)).rejects.toThrow(ProjectLoadError);
    await expect(loadProject(storage)).rejects.toThrow(/pages\/p_five\.json/);
    storage.files.delete(pagePath(pageId));
    await expect(loadProject(storage)).rejects.toThrow(/file not found/);
  });

  it('opens projects saved under the old name (format ecoss-project, symbols ecoss.*)', async () => {
    const { doc, pageId } = documentWithPage();
    doc.apply({ type: 'placeSymbol', pageId, id: 'i_old', symbol: 'coil', x: 100, y: 100 });
    const storage = new MemoryProjectStorage();
    await saveProject(storage, doc.state);
    const project = JSON.parse(storage.files.get(PROJECT_FILE)!);
    storage.files.set(PROJECT_FILE, JSON.stringify({ ...project, format: 'ecoss-project' }));
    const page = JSON.parse(storage.files.get(pagePath(pageId))!);
    page.items[0].symbol = 'ecoss.connection.tee';
    storage.files.set(pagePath(pageId), JSON.stringify(page));
    const loaded = await loadProject(storage);
    expect(loaded.project.format).toBe('wirewright-project');
    // … and the rotated T-junction of that time is the T-junction for its directions now.
    expect((loaded.pages[pageId] as { items: { symbol: string }[] }).items[0]!.symbol).toBe('wirewright.connection.tee.right-down-left');
  });

  it('fills in settings added in later versions', async () => {
    const { doc } = documentWithPage();
    const storage = new MemoryProjectStorage();
    await saveProject(storage, doc.state);
    const raw = JSON.parse(storage.files.get(PROJECT_FILE)!);
    delete raw.settings.defaultWire;
    storage.files.set(PROJECT_FILE, JSON.stringify(raw));
    expect((await loadProject(storage)).project.settings.defaultWire).toEqual({ color: 'BK', crossSection: 1.5 });
  });
});

describe('NodeProjectStorage', () => {
  it('writes files inside the project folder and refuses paths outside it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wirewright-'));
    try {
      const storage = new NodeProjectStorage(root);
      const { doc } = documentWithPage();
      await saveProject(storage, doc.state);
      expect(JSON.parse(await readFile(join(root, PROJECT_FILE), 'utf8')).name).toBe('Test');
      expect(await loadProject(storage)).toEqual(doc.state);
      expect(await storage.read('missing.json')).toBeUndefined();
      await expect(storage.write('../escape.json', '{}')).rejects.toThrow(/outside the project folder/);
      await expect(storage.read('/etc/passwd')).rejects.toThrow(/outside the project folder/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
