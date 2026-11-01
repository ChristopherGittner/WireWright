// Projects are folders of JSON files (ADR-004):
//   project.json, pages/<page id>.json
// Storage is behind an interface so the desktop app, the MCP server, tests and
// a later browser build can all use the same load/save code.
import { z } from 'zod';
import type { ChangeSet } from './document.js';
import { migrateJunction } from './junctions.js';
import { defaultSettings } from './project.js';
import { pageSchema, projectLibrarySchema, projectSchema, type Page, type ProjectState } from './schema.js';

export interface ProjectStorage {
  /** File content, or `undefined` if the file does not exist. Paths are relative to the project folder, with `/`. */
  read(path: string): Promise<string | undefined>;
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export const PROJECT_FILE = 'project.json';
export const LIBRARY_FILE = 'library.json';

export function pagePath(pageId: string): string {
  return `pages/${pageId}.json`;
}

export class ProjectLoadError extends Error {
  override name = 'ProjectLoadError';
  constructor(
    readonly path: string,
    detail: string,
  ) {
    super(`${path}: ${detail}`);
  }
}

/** JSON as written to disk: 2-space indentation and a final newline, for clean git diffs. */
export function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}

export async function projectExists(storage: ProjectStorage): Promise<boolean> {
  return (await storage.read(PROJECT_FILE)) !== undefined;
}

/** Projects saved before the rename to Wirewright: format `ecoss-project`, symbol IDs `ecoss.*`. */
const LEGACY_FORMAT = 'ecoss-project';
const LEGACY_SYMBOL_PREFIX = 'ecoss.';

function migrateSymbols(items: unknown, legacy: boolean): void {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (!isObject(item)) continue;
    if (legacy && typeof item.symbol === 'string' && item.symbol.startsWith(LEGACY_SYMBOL_PREFIX)) {
      item.symbol = 'wirewright.' + item.symbol.slice(LEGACY_SYMBOL_PREFIX.length);
    }
    // One corner/T-junction per direction instead of rotated ones.
    migrateJunction(item);
  }
}

export async function loadProject(storage: ProjectStorage): Promise<ProjectState> {
  const raw = await readJson(storage, PROJECT_FILE);
  const legacy = isObject(raw) && raw.format === LEGACY_FORMAT;
  if (legacy) raw.format = 'wirewright-project';
  // Settings added in later versions get their defaults.
  if (isObject(raw) && isObject(raw.settings)) raw.settings = { ...defaultSettings(), ...raw.settings };
  const project = parse(projectSchema, raw, PROJECT_FILE);

  const pages: Record<string, Page> = {};
  for (const id of project.pages) {
    const path = pagePath(id);
    const rawPage = await readJson(storage, path);
    if (isObject(rawPage)) migrateSymbols(rawPage.items, legacy);
    const page = parse(pageSchema, rawPage, path);
    if (page.id !== id) throw new ProjectLoadError(path, `contains page "${page.id}" instead of "${id}"`);
    pages[id] = page;
  }
  const state: ProjectState = { project, pages };
  if ((await storage.read(LIBRARY_FILE)) !== undefined) {
    const rawLibrary = await readJson(storage, LIBRARY_FILE);
    if (isObject(rawLibrary) && Array.isArray(rawLibrary.macros)) {
      for (const macro of rawLibrary.macros) if (isObject(macro)) migrateSymbols(macro.items, legacy);
    }
    state.library = parse(projectLibrarySchema, rawLibrary, LIBRARY_FILE);
  }
  return state;
}

/**
 * Writes the project. With `changes`, only changed files are written and
 * deleted pages are removed; without, everything is written.
 */
export async function saveProject(storage: ProjectStorage, state: ProjectState, changes?: ChangeSet): Promise<void> {
  if (!changes || changes.project) await storage.write(PROJECT_FILE, toJson(state.project));
  if (state.library && (!changes || changes.library)) await storage.write(LIBRARY_FILE, toJson(state.library));
  const pageIds = changes ? changes.pages : state.project.pages;
  for (const id of pageIds) {
    const page = state.pages[id];
    if (page) await storage.write(pagePath(id), toJson(page));
  }
  for (const id of changes?.deletedPages ?? []) await storage.remove(pagePath(id));
}

async function readJson(storage: ProjectStorage, path: string): Promise<unknown> {
  const text = await storage.read(path);
  if (text === undefined) throw new ProjectLoadError(path, 'file not found');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ProjectLoadError(path, `invalid JSON (${(error as Error).message})`);
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown, path: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ProjectLoadError(path, `\n${z.prettifyError(result.error)}`);
  return result.data;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** In-memory storage for tests and previews. */
export class MemoryProjectStorage implements ProjectStorage {
  readonly files = new Map<string, string>();

  async read(path: string): Promise<string | undefined> {
    return this.files.get(path);
  }

  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }
}
