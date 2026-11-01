import { describe, expect, it } from 'vitest';
import { CommandError, itemStyle } from './commands/apply.js';
import type { Command } from './commands/schema.js';
import { ProjectDocument as ProjectDocumentClass, type ProjectDocument } from './document.js';
import type { SchematicPage } from './schema.js';
import { planPageNames, planRenumbering, usedStructureCodes } from './naming.js';
import { effectiveTag, formatTag } from './tags.js';
import { column, documentWithPage } from './test/fixtures.js';

function place(doc: ProjectDocument, pageId: string, cmd: Partial<Extract<Command, { type: 'placeSymbol' }>> & { symbol: string }): string {
  const { created } = doc.apply({ type: 'placeSymbol', pageId, x: column(3), y: 100, ...cmd });
  return created[0]!;
}

function tagOf(doc: ProjectDocument, pageId: string, itemId: string): string {
  const page = doc.state.pages[pageId] as SchematicPage;
  return formatTag(effectiveTag(page, page.items.find((i) => i.id === itemId)!, doc.library));
}

function deviceKeys(doc: ProjectDocument): string[] {
  return [...doc.devices().devices.keys()].sort();
}

describe('pages', () => {
  it('creates, orders, renames and deletes pages', () => {
    const { doc } = documentWithPage();
    doc.apply({ type: 'createPage', id: 'p_one', name: '1', index: 0 });
    doc.apply({ type: 'createReportPage', id: 'p_toc', name: '0', kind: 'pageIndex', index: 0 });
    expect(doc.state.project.pages).toEqual(['p_toc', 'p_one', 'p_five']);
    doc.apply({ type: 'movePage', pageId: 'p_toc', index: 2 });
    expect(doc.state.project.pages).toEqual(['p_one', 'p_five', 'p_toc']);
    doc.apply({ type: 'setPageProperties', pageId: 'p_one', name: '2', structure: { function: 'AA' } });
    expect(doc.state.pages.p_one).toMatchObject({ name: '2', structure: { function: 'AA' } });
    doc.apply({ type: 'deletePage', pageId: 'p_one' });
    expect(doc.state.project.pages).toEqual(['p_five', 'p_toc']);
    expect(doc.state.pages.p_one).toBeUndefined();
  });

  it('moves pages into another function/location (drag and drop)', () => {
    const { doc } = documentWithPage(); // p_five: =SG+10/5
    doc.apply([
      { type: 'createPage', id: 'p_six', name: '6', structure: { function: 'SG', location: '10' } },
      { type: 'createPage', id: 'p_a1', name: '1', structure: { function: 'AA', location: '20' } },
      { type: 'createPage', id: 'p_a2', name: '2', structure: { function: 'AA', location: '20' } },
    ]);
    const full = () => doc.state.project.pages.map((id) => `${formatTag(doc.state.pages[id]!.structure ?? {})}/${doc.state.pages[id]!.name}`);
    // into the group: after its last page
    doc.apply({ type: 'movePages', pageIds: ['p_five', 'p_six'], structure: { function: 'AA', location: '20' } });
    expect(full()).toEqual(['=AA+20/1', '=AA+20/2', '=AA+20/5', '=AA+20/6']);
    // onto a page: before it, taking its structure; one undo step
    doc.apply({ type: 'movePages', pageIds: ['p_six'], structure: { function: 'AA', location: '20' }, before: 'p_a1' });
    expect(full()).toEqual(['=AA+20/6', '=AA+20/1', '=AA+20/2', '=AA+20/5']);
    doc.undo();
    expect(full()).toEqual(['=AA+20/1', '=AA+20/2', '=AA+20/5', '=AA+20/6']);
    // only the location; a name clash is refused
    doc.apply({ type: 'movePages', pageIds: ['p_a1'], structure: { location: null } });
    expect(full()).toContain('=AA/1');
    expect(() => doc.apply({ type: 'movePages', pageIds: ['p_a2'], structure: { location: null } })).not.toThrow();
    expect(() => doc.apply({ type: 'movePages', pageIds: ['p_a2'], structure: { location: '20' }, before: 'p_five' })).not.toThrow();
    doc.apply({ type: 'setPageProperties', pageId: 'p_a2', name: '1' });
    expect(() => doc.apply({ type: 'movePages', pageIds: ['p_a2'], structure: { location: null } })).toThrow(/already exists/);
  });

  it('rejects a second page with the same structure and name', () => {
    const { doc } = documentWithPage();
    expect(() => doc.apply({ type: 'createPage', name: '5', structure: { function: 'SG', location: '10' } })).toThrow(/already exists/);
    expect(() => doc.apply({ type: 'createPage', name: '5', structure: { function: 'AA' } })).not.toThrow();
  });
});

describe('placing symbols and automatic naming', () => {
  it('names main functions by page and column: -5K3, -5K3.1', () => {
    const { doc, pageId } = documentWithPage();
    const k1 = place(doc, pageId, { symbol: 'coil' });
    const k2 = place(doc, pageId, { symbol: 'coil', y: 160 });
    const s1 = place(doc, pageId, { symbol: 'button', x: column(1) });
    expect(tagOf(doc, pageId, k1)).toBe('=SG+10-5K3');
    expect(tagOf(doc, pageId, k2)).toBe('=SG+10-5K3.1');
    expect(tagOf(doc, pageId, s1)).toBe('=SG+10-5S1');
  });

  it('a main function never takes the name of an existing device, even one with only contacts', () => {
    const { doc, pageId } = documentWithPage();
    place(doc, pageId, { symbol: 'no', x: column(6), tag: { product: '5K3' } });
    const coil = place(doc, pageId, { symbol: 'coil' });
    expect(tagOf(doc, pageId, coil)).toBe('=SG+10-5K3.1');
  });

  it('a contact without a tag joins the device of the nearest symbol to its left at the same height', () => {
    const { doc, pageId } = documentWithPage();
    const coil = place(doc, pageId, { symbol: 'coil' });
    place(doc, pageId, { symbol: 'corner', x: column(5) });
    const first = place(doc, pageId, { symbol: 'no', x: column(8) });
    const second = place(doc, pageId, { symbol: 'nc', x: column(10) });
    expect(tagOf(doc, pageId, coil)).toBe('=SG+10-5K3');
    expect(tagOf(doc, pageId, first)).toBe('=SG+10-5K3');
    expect(tagOf(doc, pageId, second)).toBe('=SG+10-5K3');
    expect(doc.devices().devices.get('=SG+10-5K3')?.functions).toHaveLength(3);
  });

  it('a symbol whose Master is unchecked joins the device to its left, with cross-references', () => {
    const { doc, pageId } = documentWithPage();
    // Two buttons (e-stops) in a row: both are masters and get their own names
    const left = place(doc, pageId, { symbol: 'button', x: column(2) });
    const right = place(doc, pageId, { symbol: 'button', x: column(5) });
    expect(tagOf(doc, pageId, right)).toBe('=SG+10-5S5');
    doc.apply({ type: 'setItemProperties', pageId, itemId: right, main: false });
    expect(tagOf(doc, pageId, right)).toBe('=SG+10-5S2');
    expect(deviceKeys(doc)).toEqual(['=SG+10-5S2']);
    const refs = (id: string) => doc.crossReferences().byItem.get(id)?.references.map((r) => r.target.itemId);
    expect(refs(right)).toEqual([left]);
    expect(refs(left)).toEqual([right]);
    expect(doc.check().filter((i) => i.code.startsWith('device.'))).toEqual([]);
  });

  it('a former master that still has other functions keeps its name; a contact whose tag is cleared rejoins', () => {
    const { doc, pageId } = documentWithPage();
    place(doc, pageId, { symbol: 'coil', x: column(2) });
    const coil = place(doc, pageId, { symbol: 'coil', x: column(5) });
    place(doc, pageId, { symbol: 'no', x: column(5), y: 60, tag: { product: '5K5' } });
    doc.apply({ type: 'setItemProperties', pageId, itemId: coil, main: false });
    expect(tagOf(doc, pageId, coil)).toBe('=SG+10-5K5');
    const contact = place(doc, pageId, { symbol: 'no', x: column(8), tag: { product: 'K99' } });
    doc.apply({ type: 'setItemTag', pageId, itemId: contact, tag: { product: null } });
    expect(tagOf(doc, pageId, contact)).toBe('=SG+10-5K5');
  });

  it('coils in a row do not merge; contacts elsewhere stay without a device', () => {
    const { doc, pageId } = documentWithPage();
    const a = place(doc, pageId, { symbol: 'coil' });
    const b = place(doc, pageId, { symbol: 'coil', x: column(6) });
    const lower = place(doc, pageId, { symbol: 'no', x: column(8), y: 140 });
    const own = place(doc, pageId, { symbol: 'no', x: column(9), tag: { product: 'K77' } });
    expect(tagOf(doc, pageId, a)).toBe('=SG+10-5K3');
    expect(tagOf(doc, pageId, b)).toBe('=SG+10-5K6');
    expect(tagOf(doc, pageId, lower)).toBe('=SG+10');
    expect(tagOf(doc, pageId, own)).toBe('=SG+10-K77');
  });

  it('a contact inherits the full tag of a neighbour in another structure', () => {
    const { doc, pageId } = documentWithPage();
    const coil = place(doc, pageId, { symbol: 'coil', tag: { location: 'FIELD' } });
    const contact = place(doc, pageId, { symbol: 'no', x: column(7) });
    expect(tagOf(doc, pageId, coil)).toBe('=SG+FIELD-5K3');
    expect(tagOf(doc, pageId, contact)).toBe('=SG+FIELD-5K3');
  });

  it('auxiliary functions join the device given by their tag', () => {
    const { doc, pageId } = documentWithPage();
    const coil = place(doc, pageId, { symbol: 'coil' });
    const contact = place(doc, pageId, { symbol: 'no', x: column(6), tag: { product: '5K3' } });
    const device = doc.devices().devices.get('=SG+10-5K3')!;
    expect(device.main?.itemId).toBe(coil);
    expect(device.functions.map((f) => f.itemId)).toEqual([coil, contact]);
  });

  it('copies template contacts onto the main function', () => {
    const { doc, pageId } = documentWithPage();
    const coil = place(doc, pageId, { symbol: 'coil', template: 'relay.2co' });
    const item = (doc.state.pages[pageId] as SchematicPage).items.find((i) => i.id === coil)!;
    expect(item.props?.contacts).toHaveLength(2);
  });

  it('symbols placed inside a device box become functions of the box device', () => {
    const { doc, pageId } = documentWithPage();
    const box = place(doc, pageId, { symbol: 'deviceBox', x: 100, y: 40, width: 80, height: 60 });
    const coil = place(doc, pageId, { symbol: 'coil', x: 120, y: 60 });
    expect(tagOf(doc, pageId, box)).toBe('=SG+10-5A3');
    expect(tagOf(doc, pageId, coil)).toBe('=SG+10-5A3');
    const device = doc.devices().devices.get('=SG+10-5A3')!;
    expect(device.main?.itemId).toBe(box);
    expect(device.functions).toHaveLength(2);
    expect(doc.check().filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('rejects unknown symbols and invalid commands without changing anything', () => {
    const { doc, pageId } = documentWithPage();
    const before = doc.state;
    expect(() => place(doc, pageId, { symbol: 'nope' })).toThrow(CommandError);
    expect(() => doc.apply({ type: 'placeSymbol', pageId, symbol: 'coil', x: 1.5, y: 0 } as Command)).toThrow(/Invalid command/);
    expect(doc.state).toBe(before);
  });
});

describe('undo, redo and batches', () => {
  it('undoes and redoes a step', () => {
    const { doc, pageId } = documentWithPage();
    place(doc, pageId, { symbol: 'coil' });
    expect(deviceKeys(doc)).toEqual(['=SG+10-5K3']);
    expect(doc.undo()).toBe(true);
    expect(deviceKeys(doc)).toEqual([]);
    expect(doc.redo()).toBe(true);
    expect(deviceKeys(doc)).toEqual(['=SG+10-5K3']);
  });

  it('applies a batch atomically as one undo step', () => {
    const { doc, pageId } = documentWithPage();
    doc.apply([
      { type: 'placeSymbol', pageId, symbol: 'coil', x: column(3), y: 100 },
      { type: 'placeSymbol', pageId, symbol: 'no', x: column(5), y: 100, tag: { product: '5K3' } },
    ]);
    expect(doc.devices().devices.get('=SG+10-5K3')?.functions).toHaveLength(2);
    doc.undo();
    expect(deviceKeys(doc)).toEqual([]);

    const before = doc.state;
    expect(() =>
      doc.apply([
        { type: 'placeSymbol', pageId, symbol: 'coil', x: column(3), y: 100 },
        { type: 'placeSymbol', pageId, symbol: 'missing', x: 0, y: 0 },
      ]),
    ).toThrow(CommandError);
    expect(doc.state).toBe(before);
  });

  it('later commands in a batch can use IDs chosen by the caller', () => {
    const { doc } = documentWithPage();
    doc.apply([
      { type: 'createPage', id: 'p_six', name: '6' },
      { type: 'placeSymbol', pageId: 'p_six', id: 'i_coil', symbol: 'coil', x: column(2), y: 100 },
    ]);
    expect(tagOf(doc, 'p_six', 'i_coil')).toBe('-6K2');
  });

  it('previews commands without changing the document', () => {
    const { doc, pageId } = documentWithPage();
    const before = doc.state;
    const { doc: preview, result } = doc.preview({ type: 'placeSymbol', pageId, symbol: 'coil', x: column(3), y: 100 });
    expect(preview.devices().devices.has('=SG+10-5K3')).toBe(true);
    expect(result.created).toHaveLength(1);
    expect(doc.state).toBe(before);
    expect(doc.canUndo).toBe(true);
    expect(doc.undoLabel).toBe('createPage');
  });

  it('tracks which files changed', () => {
    const { doc, pageId } = documentWithPage();
    place(doc, pageId, { symbol: 'coil' });
    let changes = doc.takeChanges();
    expect(changes.project).toBe(false);
    expect([...changes.pages]).toEqual([pageId]);
    doc.apply({ type: 'deletePage', pageId });
    changes = doc.takeChanges();
    expect(changes.project).toBe(true);
    expect([...changes.deletedPages]).toEqual([pageId]);
    expect(doc.hasChanges).toBe(false);
  });
});

describe('renaming', () => {
  it('changing the tag of a main function renames the whole device', () => {
    const { doc, pageId } = documentWithPage();
    const coil = place(doc, pageId, { symbol: 'coil' });
    doc.apply({ type: 'createPage', id: 'p_seven', name: '7', structure: { function: 'SG', location: '10' } });
    const contact = place(doc, 'p_seven', { symbol: 'no', tag: { product: '5K3' } });
    doc.apply({ type: 'setItemTag', pageId, itemId: coil, tag: { product: 'K99' } });
    expect(tagOf(doc, 'p_seven', contact)).toBe('=SG+10-K99');
    expect(deviceKeys(doc)).toEqual(['=SG+10-K99']);
  });

  it('changing the tag of an auxiliary function moves it to another device', () => {
    const { doc, pageId } = documentWithPage();
    place(doc, pageId, { symbol: 'coil' });
    place(doc, pageId, { symbol: 'coil', x: column(4) });
    const contact = place(doc, pageId, { symbol: 'no', x: column(6), tag: { product: '5K3' } });
    doc.apply({ type: 'setItemTag', pageId, itemId: contact, tag: { product: '5K4' } });
    expect(doc.devices().devices.get('=SG+10-5K3')?.functions).toHaveLength(1);
    expect(doc.devices().devices.get('=SG+10-5K4')?.functions).toHaveLength(2);
  });

  it('refuses to rename a main function onto another device that has a main function', () => {
    const { doc, pageId } = documentWithPage();
    const k1 = place(doc, pageId, { symbol: 'coil' });
    place(doc, pageId, { symbol: 'coil', x: column(4) });
    expect(() => doc.apply({ type: 'setItemTag', pageId, itemId: k1, tag: { product: '5K4' } })).toThrow(/already exists/);
  });

  it('renameDevice takes full tags and keeps tags relative to the page', () => {
    const { doc, pageId } = documentWithPage();
    const coil = place(doc, pageId, { symbol: 'coil' });
    doc.apply({ type: 'renameDevice', device: '=SG+10-5K3', to: '=SG+20-K1' });
    const item = (doc.state.pages[pageId] as SchematicPage).items.find((i) => i.id === coil)!;
    expect(item.tag).toEqual({ location: '20', product: 'K1' });
    expect(() => doc.apply({ type: 'renameDevice', device: '=SG+10-nope', to: '-K2' })).toThrow(/not found/);
  });

  it('renumberDevices renames by current position, as one undo step', () => {
    const { doc, pageId } = documentWithPage();
    const a = place(doc, pageId, { symbol: 'coil', tag: { product: 'X' } });
    const b = place(doc, pageId, { symbol: 'coil', x: column(4), tag: { product: 'Y' } });
    const contact = place(doc, pageId, { symbol: 'no', x: column(8), tag: { product: 'Y' } });
    doc.apply({ type: 'renumberDevices' });
    expect(tagOf(doc, pageId, a)).toBe('=SG+10-5K3');
    expect(tagOf(doc, pageId, b)).toBe('=SG+10-5K4');
    expect(tagOf(doc, pageId, contact)).toBe('=SG+10-5K4');
    doc.undo();
    expect(tagOf(doc, pageId, a)).toBe('=SG+10-X');
  });

  it('planRenumbering previews the changes; excluded devices keep their names, the others number around them', () => {
    const { doc, pageId } = documentWithPage();
    place(doc, pageId, { symbol: 'coil', tag: { product: 'X' } });
    place(doc, pageId, { symbol: 'coil', x: column(4), tag: { product: 'Y' } });
    place(doc, pageId, { symbol: 'coil', x: column(6), tag: { product: '5K6' } });
    const plan = planRenumbering(doc.state, doc.library);
    // -5K6 already has its name and is not listed
    expect(plan.map((c) => `${c.from} → ${c.to}`)).toEqual(['=SG+10-X → =SG+10-5K3', '=SG+10-Y → =SG+10-5K4']);
    expect(planRenumbering(doc.state, doc.library, { exclude: ['=SG+10-X'] }).map((c) => c.from)).toEqual(['=SG+10-Y']);
    doc.apply({ type: 'renumberDevices', exclude: ['=SG+10-X'] });
    expect(deviceKeys(doc)).toEqual(['=SG+10-5K4', '=SG+10-5K6', '=SG+10-X']);
    expect(planRenumbering(doc.state, doc.library, { pageIds: [] })).toEqual([]);
  });

  it('renumberPages: prefix, start and step, in page order; names stay unique', () => {
    const { doc, pageId } = documentWithPage();
    const [b, c] = doc.apply([
      { type: 'createPage', name: '9' },
      { type: 'createPage', name: '7' },
    ]).created as [string, string];
    expect(planPageNames(doc.state, { pageIds: [c, pageId, b], prefix: '1.', start: 1 }).map((p) => `${p.from}→${p.to}`)).toEqual(['5→1.1', '9→1.2', '7→1.3']);
    doc.apply({ type: 'renumberPages', pageIds: [pageId, b, c], start: 10, step: 10 });
    expect(doc.state.project.pages.map((id) => doc.state.pages[id]!.name)).toEqual(['10', '20', '30']);
    // renaming only some pages onto a name that another page keeps is refused
    expect(() => doc.apply({ type: 'renumberPages', pageIds: [b], start: 30 })).toThrow(/already exists/);
    expect(doc.state.pages[b]!.name).toBe('20');
  });

  it('setStructures sorts the pages by function, then location; new and changed pages follow', () => {
    const { doc } = documentWithPage(); // page 5: =SG+10
    const [, , c] = doc.apply([
      { type: 'createPage', name: '1', structure: { function: 'DOC' } },
      { type: 'createPage', name: '2', structure: { function: 'SG', location: '20' } },
      { type: 'createPage', name: '3', structure: { function: 'AA' } },
    ]).created as [string, string, string];
    expect(usedStructureCodes(doc.state)).toEqual({ function: ['SG', 'DOC', 'AA'], location: ['10', '20'] });
    const names = () => doc.state.project.pages.map((id) => doc.state.pages[id]!.name);
    expect(names()).toEqual(['5', '1', '2', '3']);
    doc.apply({
      type: 'setStructures',
      structures: {
        function: [{ code: 'DOC', description: { de: 'Dokumentation' } }, { code: 'SG' }],
        location: [{ code: '20' }, { code: '10', description: 'Schaltschrank 1' }],
      },
    });
    // DOC, then SG (+20 before +10), then the unlisted AA
    expect(names()).toEqual(['1', '2', '5', '3']);
    doc.apply({ type: 'setPageProperties', pageId: c, structure: { function: 'DOC' } });
    expect(names()).toEqual(['1', '3', '2', '5']);
    doc.apply({ type: 'createPage', name: '9', structure: { function: 'DOC' } });
    expect(names()).toEqual(['1', '3', '9', '2', '5']);
    expect(() => doc.apply({ type: 'setStructures', structures: { function: [{ code: 'SG' }, { code: 'SG' }], location: [] } })).toThrow(/twice/);
    // moving a page across a group border keeps the structure order; within its group it moves
    const nine = doc.state.project.pages[2]!;
    doc.apply({ type: 'movePage', pageId: nine, index: 4 });
    expect(names()).toEqual(['1', '3', '9', '2', '5']);
    doc.apply({ type: 'movePage', pageId: nine, index: 0 });
    expect(names()).toEqual(['9', '1', '3', '2', '5']);
  });

  it('replaceTexts changes function texts in one language only', () => {
    const { doc, pageId } = documentWithPage();
    const coil = place(doc, pageId, { symbol: 'coil', props: { functionText: { de: 'Band ein', en: 'Band on' } } });
    const { replaced } = doc.apply({ type: 'replaceTexts', find: 'band', replace: 'Förderband', fields: ['functionText'], language: 'de' });
    expect(replaced).toBe(1);
    const item = (doc.state.pages[pageId] as SchematicPage).items.find((i) => i.id === coil)!;
    expect(item.props?.functionText).toEqual({ de: 'Förderband ein', en: 'Band on' });
  });
});

describe('boxes', () => {
  it('moving a coil into a structure box renames the device; contacts elsewhere follow', () => {
    const { doc, pageId } = documentWithPage();
    place(doc, pageId, { symbol: 'structureBox', x: 300, y: 40, width: 80, height: 80, tag: { function: 'AA', location: '20' } });
    const coil = place(doc, pageId, { symbol: 'coil', x: column(1), y: 60, tag: { product: 'K10' } });
    const contact = place(doc, pageId, { symbol: 'no', x: column(2), y: 200, tag: { product: 'K10' } });
    doc.apply({ type: 'moveItems', pageId, itemIds: [coil], dx: 300 - column(1) + 20, dy: 0 });
    expect(tagOf(doc, pageId, coil)).toBe('=AA+20-K10');
    expect(tagOf(doc, pageId, contact)).toBe('=AA+20-K10');
  });

  it('moving a box moves its contents', () => {
    const { doc, pageId } = documentWithPage();
    const box = place(doc, pageId, { symbol: 'structureBox', x: 100, y: 40, width: 80, height: 80, tag: { function: 'AA' } });
    const coil = place(doc, pageId, { symbol: 'coil', x: 120, y: 60 });
    doc.apply({ type: 'moveItems', pageId, itemIds: [box], dx: 8, dy: 4 });
    const items = (doc.state.pages[pageId] as SchematicPage).items;
    expect(items.find((i) => i.id === coil)).toMatchObject({ x: 128, y: 64 });
    expect(tagOf(doc, pageId, coil)).toBe('=AA+10-5K3');
  });

  it('boxes ignore rotation and mirroring', () => {
    const { doc, pageId } = documentWithPage();
    const box = place(doc, pageId, { symbol: 'structureBox', x: 100, y: 40 });
    const coil = place(doc, pageId, { symbol: 'coil', x: column(8) });
    doc.apply({ type: 'rotateItems', pageId, itemIds: [box, coil], rotation: 90 });
    const items = (doc.state.pages[pageId] as SchematicPage).items;
    expect(items.find((i) => i.id === box)?.rotation).toBe(0);
    expect(items.find((i) => i.id === coil)?.rotation).toBe(90);
  });
});

describe('check', () => {
  it('reports devices with several main functions or none', () => {
    const { doc, pageId } = documentWithPage();
    place(doc, pageId, { symbol: 'coil', tag: { product: 'K1' } });
    place(doc, pageId, { symbol: 'coil', x: column(5), tag: { product: 'K1' } });
    place(doc, pageId, { symbol: 'no', x: column(7), tag: { product: 'K2' } });
    place(doc, pageId, { symbol: 'terminal', x: column(8), tag: { product: 'X1' } });
    const codes = doc.check().map((i) => `${i.code} ${i.device ?? ''}`);
    expect(codes).toContain('device.multipleMainFunctions =SG+10-K1');
    expect(codes).toContain('device.noMainFunction =SG+10-K2');
    expect(codes.some((c) => c.includes('X1'))).toBe(false);
  });

  it('reports missing translations', () => {
    const { doc, pageId } = documentWithPage();
    place(doc, pageId, { symbol: 'coil', props: { functionText: { de: 'Band ein' } } });
    expect(doc.check().map((i) => i.code)).toContain('text.missingTranslation');
  });
});

describe('text angle and alignment', () => {
  it('sets angle and alignment per text, keeps them when the text moves, and resets', () => {
    const { doc, pageId } = documentWithPage();
    const k1 = place(doc, pageId, { symbol: 'coil' });
    const texts = () => (doc.state.pages[pageId] as SchematicPage).items.find((i) => i.id === k1)!.texts;
    doc.apply({ type: 'setItemTextStyle', pageId, itemId: k1, field: 'tag', angle: 90, align: 'right' });
    expect(texts()).toEqual({ tag: { dx: 0, dy: 0, angle: 90, align: 'right' } });
    doc.apply({ type: 'moveItemText', pageId, itemId: k1, field: 'tag', offset: { dx: -4, dy: 2 } });
    expect(texts()).toEqual({ tag: { dx: -4, dy: 2, angle: 90, align: 'right' } });
    doc.apply({ type: 'setItemTextStyle', pageId, itemId: k1, field: 'tag', angle: null, align: null });
    expect(texts()).toEqual({ tag: { dx: -4, dy: 2 } });
    doc.apply({ type: 'moveItemText', pageId, itemId: k1, field: 'tag', offset: null });
    expect(texts()).toBeUndefined();
  });
});

describe('text arrangement', () => {
  it('sets and clears the arrangement, resets the arranged texts, and is copied when placing', () => {
    const { doc, pageId } = documentWithPage();
    const k1 = place(doc, pageId, { symbol: 'coil' });
    const item = () => (doc.state.pages[pageId] as SchematicPage).items.find((i) => i.id === k1)!;
    doc.apply([
      { type: 'moveItemText', pageId, itemId: k1, field: 'tag', offset: { dx: 3, dy: 0 } },
      { type: 'moveItemText', pageId, itemId: k1, field: 'pin:1', offset: { dx: 1, dy: 0 } },
      { type: 'setTextArrangement', pageId, itemId: k1, arrangement: { side: 'left', angle: 90 } },
    ]);
    expect(item().textArrangement).toEqual({ side: 'left', angle: 90 });
    // the tag is arranged now (own position dropped), the pin text keeps its own
    expect(item().texts).toEqual({ 'pin:1': { dx: 1, dy: 0 } });
    const { created } = doc.apply({ type: 'placeItems', pageId, items: [structuredClone(item())], x: 300, y: 200 });
    expect((doc.state.pages[pageId] as SchematicPage).items.find((i) => i.id === created[0])?.textArrangement).toEqual({ side: 'left', angle: 90 });
    doc.apply({ type: 'setTextArrangement', pageId, itemId: k1, arrangement: null });
    expect(item().textArrangement).toBeUndefined();
  });
});

describe('style brush', () => {
  it('copies text positions, styles and the arrangement to other items (one undo step)', () => {
    const { doc, pageId } = documentWithPage();
    const k1 = place(doc, pageId, { symbol: 'coil' });
    const k2 = place(doc, pageId, { symbol: 'coil', y: 160 });
    const k3 = place(doc, pageId, { symbol: 'coil', y: 220 });
    const item = (id: string) => (doc.state.pages[pageId] as SchematicPage).items.find((i) => i.id === id)!;
    doc.apply([
      { type: 'setTextArrangement', pageId, itemId: k1, arrangement: { side: 'right', angle: 0 } },
      { type: 'moveItemText', pageId, itemId: k1, field: 'pin:1', offset: { dx: 2, dy: -1 } },
      { type: 'setItemTextStyle', pageId, itemId: k1, field: 'pin:1', angle: 90 },
      { type: 'moveItemText', pageId, itemId: k2, field: 'tag', offset: { dx: 5, dy: 5 } },
    ]);
    const style = itemStyle(item(k1));
    expect(style).toEqual({ texts: { 'pin:1': { dx: 2, dy: -1, angle: 90 } }, textArrangement: { side: 'right', angle: 0 } });
    doc.apply({ type: 'applyItemStyle', pageId, itemIds: [k2, k3], style });
    for (const id of [k2, k3]) expect(itemStyle(item(id))).toEqual(style);
    // a copy, not shared with the source
    expect(item(k2).texts).not.toBe(item(k1).texts);
    doc.undo();
    expect(item(k2).texts).toEqual({ tag: { dx: 5, dy: 5 } });
    // an item without own layout as the source resets the others
    doc.apply({ type: 'applyItemStyle', pageId, itemIds: [k1], style: itemStyle(item(k3)) });
    expect(itemStyle(item(k1))).toEqual({});
  });
});

describe('changes handed between documents', () => {
  it('stepsSince / applyStep: changes made on a copy become one undo step here', () => {
    const { doc, pageId } = documentWithPage();
    const copy = new ProjectDocumentClass(doc.state, doc.baseLibrary);
    const before = copy.historyLength;
    const k1 = place(copy, pageId, { symbol: 'coil' });
    place(copy, pageId, { symbol: 'coil', y: 160 });
    const { patches, inverse } = copy.stepsSince(before);
    doc.applyStep('AI (MCP)', patches, inverse);
    expect(doc.state).toEqual(copy.state);
    expect((doc.state.pages[pageId] as SchematicPage).items.some((i) => i.id === k1)).toBe(true);
    expect(doc.undoLabel).toBe('AI (MCP)');
    doc.undo();
    expect((doc.state.pages[pageId] as SchematicPage).items.some((i) => i.id === k1)).toBe(false);
    doc.redo();
    expect(doc.state).toEqual(copy.state);
  });
});
