// Positions as engineers read them: page and column (`/5.3`), as used by
// cross-references. See docs/data-model.md, "Cross-references".
import type { Point } from './geometry.js';
import type { Library } from './library.js';
import { columnAt, rowAt } from './naming.js';
import type { Page, ProjectSettings, Structure } from './schema.js';
import { formatTag } from './tags.js';

export interface PagePosition {
  column: number;
  row: string;
}

export function pagePosition(page: Page, point: Point, settings: ProjectSettings, library: Library): PagePosition {
  const frame = library.frame(page.frame ?? settings.defaultFrame);
  return { column: columnAt(frame, point.x), row: rowAt(frame, point.y) };
}

/** `=A1+CAB1/5`: page structure plus page name. */
export function pageFullName(page: Pick<Page, 'name' | 'structure'>): string {
  return formatTag(page.structure ?? {}) + '/' + page.name;
}

/**
 * A reference such as `/5.3`, formatted with `settings.crossReferences`. With
 * `structure: "whenDifferent"` the page structure is only prefixed when it
 * differs from `from` (the structure of the page the reference is shown on).
 */
export function formatReference(
  page: Pick<Page, 'name' | 'structure'>,
  position: PagePosition,
  settings: ProjectSettings,
  from?: Structure,
): string {
  const { format, structure } = settings.crossReferences;
  const text = format
    .replace('{page}', page.name)
    .replace('{column}', String(position.column))
    .replace('{row}', position.row);
  const pageStructure = formatTag(page.structure ?? {});
  const show = structure === 'always' || pageStructure !== formatTag(from ?? {});
  return show ? pageStructure + text : text;
}
