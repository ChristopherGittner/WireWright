// Machine settings: defaults of this installation (not of a project), stored by the host
// (desktop app: settings.json in the user data folder; browser: local storage).
// See docs/data-model.md, "Machine settings".
import { z } from 'zod';
import { defaultPotentials, defaultSettings } from './project.js';
import { potentialSchema, settingsSchema, type Potential, type ProjectSettings } from './schema.js';

export const machineSettingsSchema = z.object({
  /** Language of the editor's own texts (menus, dialogs). */
  uiLanguage: z.string().min(1).optional(),
  /** Desktop app: MCP server for AI assistants working on the open project (live mode). */
  mcp: z.object({ enabled: z.boolean(), port: z.int().min(1024).max(65535).optional() }).optional(),
  /**
   * Catalog import (BMEcat): which feature (ECLASS/ETIM code or name) fills which part field,
   * as chosen in the import dialog.
   */
  catalogFeatures: z.record(z.string(), z.enum(['width', 'height', 'depth', 'ratedVoltage', 'ratedCurrent', 'property', 'ignore'])).optional(),
  /** Settings and potentials a new project starts with. */
  newProject: z
    .object({
      settings: settingsSchema.optional(),
      potentials: z.array(potentialSchema).optional(),
    })
    .optional(),
});

export type MachineSettings = z.infer<typeof machineSettingsSchema>;

export interface ProjectDefaults {
  settings: ProjectSettings;
  potentials: Potential[];
}

/**
 * Settings and potentials for a new project: the machine's defaults where they are valid,
 * the built-in ones otherwise.
 */
export function projectDefaults(machine: unknown): ProjectDefaults {
  const parsed = machineSettingsSchema.safeParse(machine ?? {});
  const defaults = parsed.success ? parsed.data.newProject : undefined;
  return {
    settings: structuredClone(defaults?.settings ?? defaultSettings()),
    potentials: structuredClone(defaults?.potentials ?? defaultPotentials()),
  };
}

/** Machine settings read from storage; anything invalid is left out (built-in defaults apply). */
export function readMachineSettings(value: unknown): MachineSettings {
  const parsed = machineSettingsSchema.safeParse(value ?? {});
  if (parsed.success) return parsed.data;
  const result: MachineSettings = {};
  const raw = (value ?? {}) as Record<string, unknown>;
  const ui = z.string().min(1).safeParse(raw.uiLanguage);
  if (ui.success) result.uiLanguage = ui.data;
  const project = (raw.newProject ?? {}) as Record<string, unknown>;
  const settings = settingsSchema.safeParse(project.settings);
  const potentials = z.array(potentialSchema).safeParse(project.potentials);
  if (settings.success || potentials.success) {
    result.newProject = { ...(settings.success ? { settings: settings.data } : {}), ...(potentials.success ? { potentials: potentials.data } : {}) };
  }
  return result;
}
