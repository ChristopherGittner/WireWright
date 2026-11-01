import { loadProject, MapLibrary, projectArchive, ProjectDocument, readProjectArchive, type SymbolDefinition } from '@wirewright/core';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createDemoProject } from './demo.js';
import { createStandardLibrary, standardLibraryContent } from './index.js';

describe('project archive', () => {
  it('holds the whole project and reads back the same', async () => {
    const standard = createStandardLibrary();
    // A symbol from a shared library folder, used in the project
    const shared: SymbolDefinition = { id: 'acme.lamp', name: 'ACME lamp', category: 'own', function: 'lamp', defaultRole: 'main', letterCode: 'P', graphics: [{ type: 'circle', cx: 0, cy: 0, r: 3 }], connections: [{ id: '1', x: 0, y: -4, direction: 'up' }], texts: [] };
    const library = new MapLibrary(standardLibraryContent(), { symbols: [shared] });
    const doc = new ProjectDocument(createDemoProject(standard), library);
    doc.apply({ type: 'placeSymbol', pageId: 'p_control', symbol: 'acme.lamp', x: 380, y: 200 });

    const bytes = await projectArchive(doc.state, doc.library, standard);
    const names = Object.keys(unzipSync(bytes));
    expect(names).toEqual(expect.arrayContaining(['wirewright-archive.json', 'project.json', 'library.json', 'pages/p_control.json']));

    const state = await loadProject(readProjectArchive(bytes));
    expect(state.project).toEqual(doc.state.project);
    expect(state.pages).toEqual(doc.state.pages);
    // the shared symbol travels with the project; the project library's own entries stay
    expect(state.library?.symbols?.map((s) => s.id)).toEqual(['acme.lamp']);
    expect(state.library?.devices?.length).toBe(doc.state.library?.devices?.length);
    // opened with only the standard library, the symbol is still there
    expect(new ProjectDocument(state, standard).library.symbol('acme.lamp')).toEqual(shared);
  });

  it('accepts a zip with the project in one folder, refuses other zips', async () => {
    const files = { 'MyMachine/project.json': strToU8('{}'), 'MyMachine/pages/p_1.json': strToU8('{}') };
    expect([...readProjectArchive(zipSync(files)).files.keys()]).toEqual(['project.json', 'pages/p_1.json']);
    expect(() => readProjectArchive(zipSync({ 'a.txt': strToU8('x') }))).toThrow(/project\.json missing/);
    expect(() => readProjectArchive(strToU8('nope'))).toThrow(/no zip/);
  });
});
