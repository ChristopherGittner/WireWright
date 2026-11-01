import { describe, expect, it } from 'vitest';
import { defaultSettings } from './project.js';
import { formatReference, pageFullName, pagePosition } from './references.js';
import type { SchematicPage } from './schema.js';
import { column, library } from './test/fixtures.js';

const settings = defaultSettings();
const page: SchematicPage = { id: 'p_a', type: 'schematic', name: '5', structure: { function: 'SG', location: '10' }, items: [] };

describe('references', () => {
  it('formats page/column references, with the structure only when it differs', () => {
    const position = pagePosition(page, { x: column(3), y: 100 }, settings, library);
    expect(position).toEqual({ column: 3, row: 'C' });
    expect(formatReference(page, position, settings, { function: 'SG', location: '10' })).toBe('/5.3');
    expect(formatReference(page, position, settings, { function: 'AA' })).toBe('=SG+10/5.3');
    expect(formatReference(page, position, { ...settings, crossReferences: { format: '/{page}.{column}{row}', structure: 'always' } })).toBe(
      '=SG+10/5.3C',
    );
  });

  it('names pages with their structure', () => {
    expect(pageFullName(page)).toBe('=SG+10/5');
    expect(pageFullName({ name: '1' })).toBe('/1');
  });
});
