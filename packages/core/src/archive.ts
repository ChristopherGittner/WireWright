// Project archive: the whole project in one zip file (`<name>.wirewright.zip`) – project.json,
// pages, library.json and a manifest. Definitions the project uses from outside the standard
// library (shared library folder) are added to its library.json, so the archive is complete.
// See docs/data-model.md, "Project archive".
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Library } from './library.js';
import type { ProjectLibrary, ProjectState } from './schema.js';
import { MemoryProjectStorage, saveProject, toJson } from './storage.js';

export const ARCHIVE_MANIFEST = 'wirewright-archive.json';
export const ARCHIVE_EXTENSION = '.wirewright.zip';

/**
 * The project as a zip archive. `library` is the project's full library (standard, shared and
 * project); `standard` the standard library: used definitions found in neither the standard
 * library nor the project library are copied into the archived library.json.
 */
export async function projectArchive(state: ProjectState, library: Library, standard: Library): Promise<Uint8Array> {
  const own = state.library ?? {};
  const has = <K extends keyof ProjectLibrary>(key: K, id: string) => (own[key] as { id: string }[] | undefined)?.some((e) => e.id === id) ?? false;
  const extra: Required<Pick<ProjectLibrary, 'symbols' | 'frames' | 'devices' | 'parts'>> = { symbols: [], frames: [], devices: [], parts: [] };
  const usedSymbols = new Set<string>();
  const usedDevices = new Set<string>();
  const usedFrames = new Set<string>([state.project.settings.defaultFrame]);
  const usedParts = new Set<string>();
  for (const page of Object.values(state.pages)) {
    if (page.frame) usedFrames.add(page.frame);
    if (page.type !== 'schematic') continue;
    for (const item of page.items) {
      usedSymbols.add(item.symbol);
      if (typeof item.props?.device === 'string') usedDevices.add(item.props.device);
      for (const part of item.props?.parts ?? []) usedParts.add(`${part.manufacturer}:${part.partNumber}`);
    }
  }
  for (const id of usedSymbols) {
    const def = library.symbol(id);
    if (def && !standard.symbol(id) && !has('symbols', id)) extra.symbols.push(def);
  }
  for (const id of usedFrames) {
    const def = library.frame(id);
    if (def && !standard.frame(id) && !has('frames', id)) extra.frames.push(def);
  }
  for (const id of usedDevices) {
    const def = library.device(id);
    if (def && !standard.device(id) && !has('devices', id)) extra.devices.push(def);
  }
  for (const id of usedParts) {
    const def = library.part(id);
    if (def && !has('parts', id)) extra.parts.push(def);
  }
  const merged: ProjectLibrary = { ...own };
  for (const key of ['symbols', 'frames', 'devices', 'parts'] as const) {
    if (extra[key].length > 0) (merged as Record<string, unknown[]>)[key] = [...((own[key] as unknown[] | undefined) ?? []), ...extra[key]];
  }
  const storage = new MemoryProjectStorage();
  await saveProject(storage, { ...state, ...(Object.keys(merged).length > 0 ? { library: merged } : {}) });
  const files: Record<string, Uint8Array> = {
    [ARCHIVE_MANIFEST]: strToU8(toJson({ format: 'wirewright-archive', formatVersion: 1, name: state.project.name, pages: state.project.pages.length, created: new Date().toISOString() })),
  };
  for (const [path, content] of storage.files) files[path] = strToU8(content);
  return zipSync(files, { level: 6 });
}

/** The files of a project archive, as a storage to load the project from or to copy into a folder. */
export function readProjectArchive(bytes: Uint8Array): MemoryProjectStorage {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch (error) {
    throw new Error('Not a Wirewright archive (no zip file)', { cause: error });
  }
  // Archives zipped by hand may hold the project in a single top folder.
  const names = Object.keys(files).filter((n) => !n.endsWith('/'));
  const projectFile = names.find((n) => n === 'project.json') ?? names.find((n) => /^[^/]+\/project\.json$/.test(n));
  if (!projectFile) throw new Error('Not a Wirewright archive (project.json missing)');
  const prefix = projectFile.slice(0, -'project.json'.length);
  const storage = new MemoryProjectStorage();
  for (const name of names) {
    if (!name.startsWith(prefix) || name.slice(prefix.length) === ARCHIVE_MANIFEST) continue;
    storage.files.set(name.slice(prefix.length), strFromU8(files[name]!));
  }
  return storage;
}
