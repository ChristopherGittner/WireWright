// The most recently opened project folders, shown on the welcome screen.
// Stored in the app settings (settings.json in the user data folder).
import { readFile, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

export const MAX_RECENT = 10;

export interface RecentEntry {
  path: string;
  /** ISO time of the last opening. */
  openedAt: string;
}

export interface RecentProject extends RecentEntry {
  /** Folder name. */
  folder: string;
  /** Project name from project.json, if it can be read. */
  name?: string;
  /** The folder or its project.json is gone (moved, deleted, drive not connected). */
  missing: boolean;
}

/** Puts a folder at the top of the list (once) and keeps the newest `max` entries. */
export function addRecent(list: readonly RecentEntry[], path: string, now = new Date(), max = MAX_RECENT): RecentEntry[] {
  const full = resolve(path);
  return [{ path: full, openedAt: now.toISOString() }, ...list.filter((e) => resolve(e.path) !== full)].slice(0, max);
}

export function removeRecent(list: readonly RecentEntry[], path: string): RecentEntry[] {
  const full = resolve(path);
  return list.filter((e) => resolve(e.path) !== full);
}

/** The entries with project name and whether the folder still holds a project. */
export async function describeRecent(list: readonly RecentEntry[]): Promise<RecentProject[]> {
  return Promise.all(
    list.map(async (entry) => {
      const folder = basename(entry.path);
      try {
        if (!(await stat(entry.path)).isDirectory()) return { ...entry, folder, missing: true };
        const project = JSON.parse(await readFile(join(entry.path, 'project.json'), 'utf8')) as { name?: unknown };
        return { ...entry, folder, missing: false, ...(typeof project.name === 'string' ? { name: project.name } : {}) };
      } catch {
        return { ...entry, folder, missing: true };
      }
    }),
  );
}
