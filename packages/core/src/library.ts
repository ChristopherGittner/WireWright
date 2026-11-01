import { z } from 'zod';
import {
  deviceDefinitionSchema,
  deviceTemplateSchema,
  formDefinitionSchema,
  frameDefinitionSchema,
  macroDefinitionSchema,
  partDefinitionSchema,
  symbolDefinitionSchema,
  type DeviceDefinition,
  type DeviceTemplate,
  type FormDefinition,
  type FrameDefinition,
  type MacroDefinition,
  type PartDefinition,
  type SymbolDefinition,
} from './schema.js';

/** Read access to symbols, frames and device templates. */
export interface Library {
  symbol(id: string): SymbolDefinition | undefined;
  frame(id: string): FrameDefinition | undefined;
  template(id: string): DeviceTemplate | undefined;
  form(id: string): FormDefinition | undefined;
  device(id: string): DeviceDefinition | undefined;
  macro(id: string): MacroDefinition | undefined;
  part(id: string): PartDefinition | undefined;
  symbols(): readonly SymbolDefinition[];
  frames(): readonly FrameDefinition[];
  templates(): readonly DeviceTemplate[];
  forms(): readonly FormDefinition[];
  devices(): readonly DeviceDefinition[];
  macros(): readonly MacroDefinition[];
  parts(): readonly PartDefinition[];
}

/** ID of a part in the parts database. */
export function partId(manufacturer: string, partNumber: string): string {
  return `${manufacturer.trim()}:${partNumber.trim()}`;
}

/** The parts database entry for a device's part (by manufacturer and part number). */
export function findPart(library: Library, manufacturer: string, partNumber: string): PartDefinition | undefined {
  return (
    library.part(partId(manufacturer, partNumber)) ??
    library.parts().find((p) => p.partNumber === partNumber.trim() && (manufacturer.trim() === '' || p.manufacturer === manufacturer.trim()))
  );
}

export interface LibraryContent {
  symbols?: readonly SymbolDefinition[];
  frames?: readonly FrameDefinition[];
  templates?: readonly DeviceTemplate[];
  forms?: readonly FormDefinition[];
  devices?: readonly DeviceDefinition[];
  macros?: readonly MacroDefinition[];
  parts?: readonly PartDefinition[];
}

const libraryContentSchema = z.object({
  devices: z.array(deviceDefinitionSchema).optional(),
  symbols: z.array(symbolDefinitionSchema).optional(),
  frames: z.array(frameDefinitionSchema).optional(),
  templates: z.array(deviceTemplateSchema).optional(),
  forms: z.array(formDefinitionSchema).optional(),
  macros: z.array(macroDefinitionSchema).optional(),
  parts: z.array(partDefinitionSchema).optional(),
});

/** Validates raw (e.g. JSON) library content. Throws a readable error. */
export function parseLibraryContent(raw: unknown): LibraryContent {
  const result = libraryContentSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid library content:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export class MapLibrary implements Library {
  readonly #symbols = new Map<string, SymbolDefinition>();
  readonly #frames = new Map<string, FrameDefinition>();
  readonly #templates = new Map<string, DeviceTemplate>();
  readonly #forms = new Map<string, FormDefinition>();
  readonly #devices = new Map<string, DeviceDefinition>();
  readonly #macros = new Map<string, MacroDefinition>();
  readonly #parts = new Map<string, PartDefinition>();

  /** Later content overrides earlier content with the same ID (project-local library over standard library). */
  constructor(...contents: LibraryContent[]) {
    for (const content of contents) {
      for (const s of content.symbols ?? []) this.#symbols.set(s.id, s);
      for (const f of content.frames ?? []) this.#frames.set(f.id, f);
      for (const t of content.templates ?? []) this.#templates.set(t.id, t);
      for (const f of content.forms ?? []) this.#forms.set(f.id, f);
      for (const d of content.devices ?? []) this.#devices.set(d.id, d);
      for (const m of content.macros ?? []) this.#macros.set(m.id, m);
      for (const p of content.parts ?? []) this.#parts.set(p.id, p);
    }
  }

  symbol(id: string): SymbolDefinition | undefined {
    return this.#symbols.get(id);
  }

  frame(id: string): FrameDefinition | undefined {
    return this.#frames.get(id);
  }

  template(id: string): DeviceTemplate | undefined {
    return this.#templates.get(id);
  }

  form(id: string): FormDefinition | undefined {
    return this.#forms.get(id);
  }

  forms(): readonly FormDefinition[] {
    return [...this.#forms.values()];
  }

  device(id: string): DeviceDefinition | undefined {
    return this.#devices.get(id);
  }

  devices(): readonly DeviceDefinition[] {
    return [...this.#devices.values()];
  }

  macro(id: string): MacroDefinition | undefined {
    return this.#macros.get(id);
  }

  macros(): readonly MacroDefinition[] {
    return [...this.#macros.values()];
  }

  part(id: string): PartDefinition | undefined {
    return this.#parts.get(id);
  }

  parts(): readonly PartDefinition[] {
    return [...this.#parts.values()];
  }

  symbols(): readonly SymbolDefinition[] {
    return [...this.#symbols.values()];
  }

  frames(): readonly FrameDefinition[] {
    return [...this.#frames.values()];
  }

  templates(): readonly DeviceTemplate[] {
    return [...this.#templates.values()];
  }
}

/** A library with project-local content on top of a base library (standard + shared). */
export class LayeredLibrary implements Library {
  readonly #top: MapLibrary;

  constructor(
    readonly base: Library,
    top: LibraryContent,
  ) {
    this.#top = new MapLibrary(top);
  }

  symbol(id: string) {
    return this.#top.symbol(id) ?? this.base.symbol(id);
  }
  frame(id: string) {
    return this.#top.frame(id) ?? this.base.frame(id);
  }
  template(id: string) {
    return this.#top.template(id) ?? this.base.template(id);
  }
  form(id: string) {
    return this.#top.form(id) ?? this.base.form(id);
  }
  device(id: string) {
    return this.#top.device(id) ?? this.base.device(id);
  }
  symbols() {
    return merge(this.base.symbols(), this.#top.symbols());
  }
  frames() {
    return merge(this.base.frames(), this.#top.frames());
  }
  templates() {
    return merge(this.base.templates(), this.#top.templates());
  }
  forms() {
    return merge(this.base.forms(), this.#top.forms());
  }
  devices() {
    return merge(this.base.devices(), this.#top.devices());
  }
  macro(id: string) {
    return this.#top.macro(id) ?? this.base.macro(id);
  }
  macros() {
    return merge(this.base.macros(), this.#top.macros());
  }
  part(id: string) {
    return this.#top.part(id) ?? this.base.part(id);
  }
  parts() {
    return merge(this.base.parts(), this.#top.parts());
  }
}

function merge<T extends { id: string }>(base: readonly T[], top: readonly T[]): T[] {
  const ids = new Set(top.map((t) => t.id));
  return [...base.filter((b) => !ids.has(b.id)), ...top];
}
