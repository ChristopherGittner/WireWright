// Revisions and change tracking. A revision is a released state of the project: its metadata in
// project.json (`revisions`), a full snapshot in `revisions/<name>.json`. The current project is
// compared with a snapshot page by page and item by item. See docs/data-model.md, "Revisions".
import { z } from 'zod';
import { pageSchema, projectLibrarySchema, projectSchema, type Item, type Page, type ProjectState, type Revision } from './schema.js';
import { toJson, type ProjectStorage } from './storage.js';

export function revisionPath(name: string): string {
  return `revisions/${name}.json`;
}

const snapshotSchema = z.object({
  format: z.literal('wirewright-revision'),
  revision: z.string(),
  project: projectSchema,
  pages: z.record(z.string(), pageSchema),
  library: projectLibrarySchema.optional(),
});

/** Writes the snapshot of a revision. */
export async function saveRevisionSnapshot(storage: ProjectStorage, name: string, state: ProjectState): Promise<void> {
  await storage.write(revisionPath(name), toJson({ format: 'wirewright-revision', revision: name, project: state.project, pages: state.pages, ...(state.library ? { library: state.library } : {}) }));
}

/** The project as it was at a revision, or undefined when its snapshot is missing. */
export async function loadRevisionSnapshot(storage: ProjectStorage, name: string): Promise<ProjectState | undefined> {
  const text = await storage.read(revisionPath(name));
  if (text === undefined) return undefined;
  const result = snapshotSchema.safeParse(JSON.parse(text));
  if (!result.success) throw new Error(`${revisionPath(name)}: ${z.prettifyError(result.error)}`);
  const { project, pages, library } = result.data;
  return { project, pages, ...(library ? { library } : {}) };
}

/** Name for the next revision: A → B … Z → AA; 1 → 2; otherwise the count. */
export function nextRevisionName(revisions: readonly Revision[]): string {
  const last = revisions.at(-1)?.name;
  if (last === undefined) return 'A';
  if (/^\d+$/.test(last)) return String(Number(last) + 1);
  if (/^[A-Z]+$/.test(last)) {
    const chars = [...last];
    let i = chars.length - 1;
    while (i >= 0 && chars[i] === 'Z') chars[i--] = 'A';
    if (i < 0) chars.unshift('A');
    else chars[i] = String.fromCharCode(chars[i]!.charCodeAt(0) + 1);
    return chars.join('');
  }
  return String(revisions.length + 1);
}

export interface PageChanges {
  added: string[];
  removed: Item[];
  changed: string[];
}

export interface ProjectChanges {
  /** Pages that are new since the revision. */
  addedPages: string[];
  /** Pages of the revision that no longer exist (as they were). */
  removedPages: Page[];
  /** Pages that exist in both and differ (content, name, description, structure …). */
  changedPages: string[];
  /** Item changes of changed schematic pages. */
  items: Map<string, PageChanges>;
  /** Project data (name, settings, potentials, PLCs …) differs. */
  project: boolean;
}

/** Deep equality that ignores key order and keys with undefined values (as JSON has them). */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((v, i) => same(v, (b as unknown[])[i]));
  const keys = (o: object) => Object.keys(o).filter((k) => (o as Record<string, unknown>)[k] !== undefined);
  const ka = keys(a);
  const kb = keys(b);
  return ka.length === kb.length && ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** What changed from `before` (a revision) to `now`. Page properties set by revisions themselves are ignored. */
export function compareProjects(before: ProjectState, now: ProjectState): ProjectChanges {
  const strip = (page: Page) => {
    const properties = { ...page.properties };
    delete properties.revision;
    delete properties.date;
    return { ...page, properties };
  };
  const changes: ProjectChanges = { addedPages: [], removedPages: [], changedPages: [], items: new Map(), project: false };
  for (const id of now.project.pages) {
    const page = now.pages[id];
    const old = before.pages[id];
    if (!page) continue;
    if (!old) {
      changes.addedPages.push(id);
      continue;
    }
    if (same(strip(old), strip(page))) continue;
    changes.changedPages.push(id);
    if (page.type === 'schematic' && old.type === 'schematic') {
      const oldItems = new Map(old.items.map((i) => [i.id, i]));
      const newIds = new Set(page.items.map((i) => i.id));
      changes.items.set(id, {
        added: page.items.filter((i) => !oldItems.has(i.id)).map((i) => i.id),
        removed: old.items.filter((i) => !newIds.has(i.id)),
        changed: page.items.filter((i) => oldItems.has(i.id) && !same(oldItems.get(i.id), i)).map((i) => i.id),
      });
    }
  }
  for (const id of before.project.pages) if (!now.pages[id] && before.pages[id]) changes.removedPages.push(before.pages[id]);
  const project = (s: ProjectState) => ({ ...s.project, pages: undefined, revisions: undefined });
  changes.project = !same(project(before), project(now)) || !same(before.library, now.library);
  return changes;
}

/** Pages to mark with a new revision: those added or changed since the previous one (all for the first). */
export function pagesForRevision(previous: ProjectState | undefined, now: ProjectState): string[] {
  if (!previous) return [...now.project.pages];
  const changes = compareProjects(previous, now);
  return now.project.pages.filter((id) => changes.addedPages.includes(id) || changes.changedPages.includes(id));
}
