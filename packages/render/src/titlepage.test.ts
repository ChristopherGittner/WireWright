import { ProjectDocument } from '@wirewright/core';
import { createDemoProject, createStandardLibrary } from '@wirewright/library';
import { describe, expect, it } from 'vitest';
import { renderContext, renderPage } from './render.js';
import type { SceneElement } from './scene.js';

const texts = (elements: SceneElement[]) => elements.flatMap((e) => (e.kind === 'text' ? [e.text] : []));

describe('title page and structure overview', () => {
  const library = createStandardLibrary();
  const doc = new ProjectDocument(createDemoProject(library), library);
  doc.apply([
    { type: 'createReportPage', id: 'p_title', name: '0', kind: 'titlePage', structure: { function: 'DOC' }, index: 0 },
    { type: 'createReportPage', id: 'p_structure', name: '1a', kind: 'structureOverview', structure: { function: 'DOC' }, index: 2 },
  ]);
  const ctx = renderContext(doc);

  it('title page shows project name, description and properties without a table header', () => {
    const scene = renderPage(ctx, 'p_title');
    const t = texts(scene.elements);
    expect(t).toEqual(expect.arrayContaining(['Förderband FB-100', 'Demoprojekt', 'Kunde', 'ACME GmbH', 'Zeichnungsnummer', 'FB-100-E']));
    expect(t).not.toContain('Bezeichnung');
  });

  it('structure overview lists the functions and locations', () => {
    const scene = renderPage(ctx, 'p_structure');
    const t = texts(scene.elements);
    expect(t).toEqual(expect.arrayContaining(['Strukturübersicht', '=DOC', '=FB', '+CAB1']));
  });
});

describe('title block', () => {
  const library = createStandardLibrary();
  const doc = new ProjectDocument(createDemoProject(library), library);
  const descriptionLines = (pageId: string) =>
    renderPage(renderContext(doc), pageId).elements.flatMap((e) => (e.kind === 'text' && e.meta?.role === 'frame' && e.x === 170 ? [e] : []));

  it('centers a two-line page description on the field position', () => {
    doc.apply({ type: 'setPageProperties', pageId: 'p_power', description: 'Leistungsteil\nFörderband' });
    const [first, second] = descriptionLines('p_power');
    expect([first?.text, second?.text]).toEqual(['Leistungsteil', 'Förderband']);
    // single line sits at y = 265; two lines are spread evenly around it
    expect(((first!.y + second!.y) / 2)).toBeCloseTo(265);
    expect(first!.size).toBe(5);
  });

  it('shrinks text that needs more than the field height', () => {
    doc.apply({ type: 'setPageProperties', pageId: 'p_power', description: 'a\nb\nc' });
    const lines = descriptionLines('p_power');
    expect(lines).toHaveLength(3);
    expect(lines[0]!.size).toBeLessThan(5);
    expect(lines[1]!.y).toBeCloseTo(265);
  });
});
