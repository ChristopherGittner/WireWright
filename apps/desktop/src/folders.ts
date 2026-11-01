// Folders typed into the folder chooser may not exist yet: ask before creating them.
import { mkdir, stat } from 'node:fs/promises';
import { t } from './texts.js';

/**
 * Makes sure `path` is a folder. A missing folder is created after `ask`
 * agrees; returns false when the user declines. Throws if `path` is a file.
 */
export async function ensureFolder(path: string, ask: (question: string) => Promise<boolean>): Promise<boolean> {
  const info = await stat(path).catch(() => undefined);
  if (info?.isDirectory()) return true;
  if (info) throw new Error(t('"{path}" is a file, not a folder.', { path }));
  if (!(await ask(t('The folder "{path}" does not exist.', { path })))) return false;
  await mkdir(path, { recursive: true });
  return true;
}
