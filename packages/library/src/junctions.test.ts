import { createProjectState, loadProject, MemoryProjectStorage, pagePath, ProjectDocument, saveProject, type SchematicPage } from '@wirewright/core';
import { describe, expect, it } from 'vitest';
import { createStandardLibrary } from './index.js';

const library = createStandardLibrary();

function project() {
  const doc = new ProjectDocument(createProjectState({ name: 'Junctions' }), library);
  const pageId = doc.apply({ type: 'createPage', name: '1' }).created[0]!;
  const items = () => (doc.state.pages[pageId] as SchematicPage).items;
  return { doc, pageId, items };
}

describe('corners and T-junctions', () => {
  it('has one symbol per direction set', () => {
    const ids = library
      .symbols()
      .filter((s) => (s.function === 'connection.corner' || s.function === 'connection.tee') && s.connections[0]?.medium === undefined)
      .map((s) => s.id);
    expect(ids).toEqual([
      'wirewright.connection.corner.up-right',
      'wirewright.connection.corner.right-down',
      'wirewright.connection.corner.down-left',
      'wirewright.connection.corner.left-up',
      'wirewright.connection.tee.up-right-down',
      'wirewright.connection.tee.right-down-left',
      'wirewright.connection.tee.down-left-up',
      'wirewright.connection.tee.left-up-right',
    ]);
    // the same set for pipes
    const pipes = library.symbols().filter((s) => s.id.startsWith('wirewright.pipe.corner.') || s.id.startsWith('wirewright.pipe.tee.'));
    expect(pipes.map((s) => s.id.replace('pipe', 'connection'))).toEqual(ids);
    expect(pipes.every((s) => s.connections.every((c) => c.medium === 'fluid'))).toBe(true);
  });

  it('placing rotated, rotating and mirroring switch to the symbol for the new directions', () => {
    const { doc, pageId, items } = project();
    doc.apply({ type: 'placeSymbol', pageId, id: 'i_c', symbol: 'wirewright.connection.corner.right-down', x: 80, y: 80, rotation: 90 });
    expect(items()[0]).toMatchObject({ symbol: 'wirewright.connection.corner.down-left', rotation: 0, mirror: false });
    doc.apply({ type: 'rotateItems', pageId, itemIds: ['i_c'], rotation: 90 });
    expect(items()[0]!.symbol).toBe('wirewright.connection.corner.left-up');
    doc.apply({ type: 'mirrorItems', pageId, itemIds: ['i_c'] });
    expect(items()[0]).toMatchObject({ symbol: 'wirewright.connection.corner.up-right', rotation: 0, mirror: false });
    doc.apply({ type: 'placeSymbol', pageId, id: 'i_t', symbol: 'wirewright.connection.tee.right-down-left', x: 120, y: 80, rotation: 180 });
    expect(items()[1]!.symbol).toBe('wirewright.connection.tee.left-up-right');
  });

  it('converts the rotated corners and T-junctions of older projects when loading', async () => {
    const { doc, pageId } = project();
    const storage = new MemoryProjectStorage();
    await saveProject(storage, doc.state);
    const page = JSON.parse(storage.files.get(pagePath(pageId))!);
    page.items = [
      { id: 'i_a', symbol: 'wirewright.connection.corner', x: 80, y: 80, rotation: 270, mirror: false },
      { id: 'i_b', symbol: 'wirewright.connection.tee', x: 120, y: 80, rotation: 90, mirror: true },
    ];
    storage.files.set(pagePath(pageId), JSON.stringify(page));
    const loaded = await loadProject(storage);
    expect((loaded.pages[pageId] as SchematicPage).items.map((i) => [i.symbol, i.rotation, i.mirror])).toEqual([
      ['wirewright.connection.corner.up-right', 0, false],
      ['wirewright.connection.tee.down-left-up', 0, false],
    ]);
  });
});
