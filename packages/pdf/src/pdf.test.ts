import { ProjectDocument } from '@wirewright/core';
import { createDemoProject, createStandardLibrary } from '@wirewright/library';
import { renderContext } from '@wirewright/render';
import { describe, expect, it } from 'vitest';
import { exportProjectPdf, scenesToPdf } from './pdf.js';

describe('PDF export', () => {
  it('writes one page per sheet with bookmarks and cross-reference links', async () => {
    const library = createStandardLibrary();
    const doc = new ProjectDocument(createDemoProject(library), library);
    const bytes = await exportProjectPdf(renderContext(doc));
    const text = Buffer.from(bytes).toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text.match(/\/Type \/Page\b/g)).toHaveLength(9);
    expect(text).toContain('/Outlines');
    expect(text).toContain('/Dests');
    expect(text.match(/\/Subtype \/Link/g)?.length).toBeGreaterThanOrEqual(8);
    // A3 landscape in points
    expect(text).toMatch(/\/MediaBox \[0 0 1190\.55\d* 841\.88\d*\]/);
  });

  it('draws all element kinds', async () => {
    const bytes = await scenesToPdf([
      {
        destination: 'a',
        title: 'A',
        scene: {
          width: 100,
          height: 50,
          elements: [
            { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 10, stroke: { color: '#ff0000', width: 0.25, dash: [2, 1] } },
            { kind: 'polyline', points: [[0, 0], [5, 5], [10, 0]], closed: true, fill: '#000000' },
            { kind: 'rect', x: 1, y: 1, width: 5, height: 5, stroke: { color: '#000', width: 0.1 }, fill: '#eee' },
            { kind: 'circle', cx: 20, cy: 20, r: 3, stroke: { color: '#000', width: 0.1 } },
            { kind: 'arc', cx: 30, cy: 20, r: 3, start: 90, end: 270, stroke: { color: '#000', width: 0.1 } },
            { kind: 'text', x: 50, y: 20, text: 'Förderband 1,5 mm²', size: 3, color: '#000', align: 'center', bold: true },
          ],
        },
      },
    ]);
    expect(Buffer.from(bytes).toString('latin1').startsWith('%PDF-')).toBe(true);
  });
});
