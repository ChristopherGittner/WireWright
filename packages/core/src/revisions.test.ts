import { describe, expect, it } from 'vitest';
import { reportRows } from './reports.js';
import { compareProjects, loadRevisionSnapshot, nextRevisionName, pagesForRevision, saveRevisionSnapshot } from './revisions.js';
import type { SchematicPage } from './schema.js';
import { MemoryProjectStorage } from './storage.js';
import { column, documentWithPage } from './test/fixtures.js';

describe('revisions', () => {
  it('names the next revision', () => {
    const r = (name: string) => ({ name, date: '2026-01-01' });
    expect(nextRevisionName([])).toBe('A');
    expect(nextRevisionName([r('A'), r('B')])).toBe('C');
    expect(nextRevisionName([r('Z')])).toBe('AA');
    expect(nextRevisionName([r('AZ')])).toBe('BA');
    expect(nextRevisionName([r('3')])).toBe('4');
    expect(nextRevisionName([r('v1.0')])).toBe('2');
  });

  it('releases a revision, keeps a snapshot, and tracks the changes since', async () => {
    const { doc, pageId } = documentWithPage();
    doc.apply({ type: 'placeSymbol', pageId, id: 'i_k1', symbol: 'coil', x: column(3), y: 100 });
    // Revision A: all pages get "A" in their title block
    expect(pagesForRevision(undefined, doc.state)).toEqual([pageId]);
    doc.apply({ type: 'addRevision', revision: { name: 'A', date: '2026-11-01', author: 'CG', description: 'Erstausgabe' }, pageIds: [pageId] });
    expect(doc.state.pages[pageId]!.properties).toMatchObject({ revision: 'A', date: '2026-11-01' });
    expect(() => doc.apply({ type: 'addRevision', revision: { name: 'A', date: '2026-11-02' }, pageIds: [] })).toThrow(/exists/);
    const storage = new MemoryProjectStorage();
    await saveRevisionSnapshot(storage, 'A', doc.state);
    const a = (await loadRevisionSnapshot(storage, 'A'))!;
    expect(a).toEqual(doc.state);
    expect(await loadRevisionSnapshot(storage, 'B')).toBeUndefined();

    // Changes: the coil moves, a contact is added, a new page appears
    doc.apply([
      { type: 'moveItems', pageId, itemIds: ['i_k1'], dx: 8, dy: 0 },
      { type: 'placeSymbol', pageId, id: 'i_s1', symbol: 'no', x: column(5), y: 100, tag: { product: 'K1' } },
      { type: 'createPage', id: 'p_new', name: '6' },
    ]);
    const changes = compareProjects(a, doc.state);
    expect(changes.addedPages).toEqual(['p_new']);
    expect(changes.changedPages).toEqual([pageId]);
    expect(changes.items.get(pageId)).toEqual({ added: ['i_s1'], removed: [], changed: ['i_k1'] });
    expect(pagesForRevision(a, doc.state)).toEqual([pageId, 'p_new']);
    doc.apply({ type: 'deleteItems', pageId, itemIds: ['i_k1'] });
    expect(compareProjects(a, doc.state).items.get(pageId)!.removed.map((i) => i.id)).toEqual(['i_k1']);

    // Revision B marks only the changed pages; the report lists both
    doc.apply({ type: 'addRevision', revision: { name: 'B', date: '2026-11-08' }, pageIds: pagesForRevision(a, doc.state) });
    expect(reportRows('revisions', doc.reportContext())).toEqual([
      { revision: 'B', date: '2026-11-08', author: '', description: '', pages: expect.stringContaining('/6') },
      { revision: 'A', date: '2026-11-01', author: 'CG', description: 'Erstausgabe', pages: '' },
    ]);
    // the revision marks themselves are not changes
    const unchanged = structuredClone(doc.state);
    (unchanged.pages[pageId] as SchematicPage).properties = { revision: 'X', date: 'never' };
    expect(compareProjects(unchanged, doc.state).changedPages).toEqual([]);
  });

  it('ignores key order (snapshots are read back through the schema)', () => {
    const { doc, pageId } = documentWithPage();
    const reordered = JSON.parse(JSON.stringify(doc.state, (_, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v)));
    expect(compareProjects(reordered, doc.state)).toMatchObject({ addedPages: [], changedPages: [], removedPages: [], project: false });
    expect(pageId).toBeTruthy();
  });
});
