// The shared (company) library folder: JSON files with device definitions,
// macros, symbols, templates … used by all projects. Devices and macros placed
// from it are copied into the project's library.json, so projects stay complete.
import {
  deviceDefinitionSchema,
  frameDefinitionSchema,
  macroDefinitionSchema,
  parseLibraryContent,
  partDefinitionSchema,
  symbolDefinitionSchema,
  type DeviceDefinition,
  type LibraryContent,
  type FrameDefinition,
  type MacroDefinition,
  type PartDefinition,
  type SymbolDefinition,
} from '@wirewright/core';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Reads all `.json` files in the folder and its direct subfolders. A file is
 * one device definition (it has `functions`), one macro (it has `items`) or
 * library content (`{ devices, macros, symbols, templates, frames, forms }`).
 */
export async function loadLibraryFolder(folder: string): Promise<LibraryContent> {
  const files: string[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.json')) files.push(join(folder, entry.name));
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      for (const sub of await readdir(join(folder, entry.name), { withFileTypes: true })) {
        if (sub.isFile() && sub.name.endsWith('.json')) files.push(join(folder, entry.name, sub.name));
      }
    }
  }
  const merged = {
    devices: [] as NonNullable<LibraryContent['devices']>[number][],
    symbols: [] as NonNullable<LibraryContent['symbols']>[number][],
    templates: [] as NonNullable<LibraryContent['templates']>[number][],
    frames: [] as NonNullable<LibraryContent['frames']>[number][],
    forms: [] as NonNullable<LibraryContent['forms']>[number][],
    macros: [] as NonNullable<LibraryContent['macros']>[number][],
    parts: [] as NonNullable<LibraryContent['parts']>[number][],
  };
  for (const file of files.sort()) {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      throw new Error(`${file}: invalid JSON (${(error as Error).message})`, { cause: error });
    }
    const isDevice = typeof raw === 'object' && raw !== null && 'functions' in raw;
    const isMacro = typeof raw === 'object' && raw !== null && 'items' in raw;
    const isPart = typeof raw === 'object' && raw !== null && 'partNumber' in raw && !isDevice;
    let content: LibraryContent;
    try {
      content = parseLibraryContent(isDevice ? { devices: [raw] } : isMacro ? { macros: [raw] } : isPart ? { parts: [raw] } : raw);
    } catch (error) {
      throw new Error(`${file}: ${(error as Error).message}`, { cause: error });
    }
    merged.devices.push(...(content.devices ?? []));
    merged.symbols.push(...(content.symbols ?? []));
    merged.templates.push(...(content.templates ?? []));
    merged.frames.push(...(content.frames ?? []));
    merged.forms.push(...(content.forms ?? []));
    merged.macros.push(...(content.macros ?? []));
    merged.parts.push(...(content.parts ?? []));
  }
  return merged;
}

/** A definition saved to the shared library folder. */
export type LibraryEntry = DeviceDefinition | MacroDefinition | PartDefinition | SymbolDefinition | FrameDefinition;

/**
 * Writes a device definition to `devices/<id>.json`, a macro to `macros/<id>.json`, a part to
 * `parts/<id>.json`, a symbol to `symbols/<id>.json` or a frame to `frames/<id>.json` (the
 * last two as library content, `{ "symbols": [ … ] }`).
 */
export async function saveLibraryEntry(folder: string, entry: LibraryEntry): Promise<string> {
  const kind = 'items' in entry ? 'macros' : 'functions' in entry ? 'devices' : 'drawingArea' in entry ? 'frames' : 'connections' in entry ? 'symbols' : 'parts';
  const def =
    kind === 'macros'
      ? macroDefinitionSchema.parse(entry)
      : kind === 'devices'
        ? deviceDefinitionSchema.parse(entry)
        : kind === 'frames'
          ? frameDefinitionSchema.parse(entry)
          : kind === 'symbols'
            ? symbolDefinitionSchema.parse(entry)
            : partDefinitionSchema.parse(entry);
  const name = def.id.replace(/[^A-Za-z0-9._-]+/g, '_');
  const dir = join(folder, kind);
  await mkdir(dir, { recursive: true });
  const target = join(dir, `${name}.json`);
  const content = kind === 'symbols' || kind === 'frames' ? { [kind]: [def] } : def;
  await writeFile(`${target}.tmp`, JSON.stringify(content, null, 2) + '\n', 'utf8');
  await rename(`${target}.tmp`, target);
  return target;
}
