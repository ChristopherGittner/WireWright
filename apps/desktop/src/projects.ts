// Open project folders of the desktop app. The renderer refers to a folder by
// an ID handed out here; it can only read and write inside folders the user
// picked in a dialog.
import { createProjectState, saveProject, type ProjectDefaults } from '@wirewright/core';
import { NodeProjectStorage } from '@wirewright/core/node';
import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { t } from './texts.js';

interface OpenFolder {
  storage: NodeProjectStorage;
  watchers: FSWatcher[];
  /** Time of the editor's own last write; changes shortly after are not reported. */
  ownWriteAt: number;
}

const OWN_WRITE_GRACE_MS = 1500;
const DEBOUNCE_MS = 300;

export class ProjectFolders {
  readonly #folders = new Map<string, OpenFolder>();
  #next = 1;

  /** Registers an existing project folder. Throws if it holds no project. */
  async open(root: string): Promise<{ id: string; name: string; folder: string }> {
    const storage = new NodeProjectStorage(root);
    if ((await storage.read('project.json')) === undefined) {
      throw new Error(t('"{path}" does not contain a Wirewright project (project.json is missing).', { path: root }));
    }
    return this.#register(storage);
  }

  /** Creates a new project in an empty folder (or one without a project), with the machine's defaults. */
  async create(root: string, defaults?: ProjectDefaults): Promise<{ id: string; name: string; folder: string }> {
    const storage = new NodeProjectStorage(root);
    if ((await storage.read('project.json')) !== undefined) throw new Error(t('"{path}" already contains a project.', { path: root }));
    const entries = await readdir(storage.root).catch(() => []);
    if (entries.some((e) => !e.startsWith('.'))) throw new Error(t('"{path}" is not empty. Choose an empty folder for a new project.', { path: root }));
    await saveProject(storage, createProjectState({ name: basename(storage.root), ...defaults }));
    return this.#register(storage);
  }

  #register(storage: NodeProjectStorage): { id: string; name: string; folder: string } {
    const id = `f${this.#next++}`;
    this.#folders.set(id, { storage, watchers: [], ownWriteAt: 0 });
    return { id, name: basename(storage.root), folder: storage.root };
  }

  get(id: string): OpenFolder {
    const folder = this.#folders.get(id);
    if (!folder) throw new Error('Unknown project folder');
    return folder;
  }

  read(id: string, path: string): Promise<string | undefined> {
    return this.get(id).storage.read(path);
  }

  write(id: string, path: string, content: string): Promise<void> {
    const folder = this.get(id);
    folder.ownWriteAt = Date.now();
    return folder.storage.write(path, content);
  }

  remove(id: string, path: string): Promise<void> {
    const folder = this.get(id);
    folder.ownWriteAt = Date.now();
    return folder.storage.remove(path);
  }

  markOwnWrite(id: string): void {
    this.get(id).ownWriteAt = Date.now();
  }

  /**
   * Calls `onChange` (debounced) when JSON files in the folder change from
   * outside the editor. The project folder and `pages/` are watched as
   * directories, so files replaced by rename (atomic writes) are still seen.
   */
  async watch(id: string, onChange: () => void): Promise<void> {
    const folder = this.get(id);
    for (const w of folder.watchers) w.close();
    await mkdir(join(folder.storage.root, 'pages'), { recursive: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const listener = (_event: string, file: string | Buffer | null) => {
      if (file && !String(file).endsWith('.json')) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (Date.now() - folder.ownWriteAt > OWN_WRITE_GRACE_MS) onChange();
      }, DEBOUNCE_MS);
    };
    folder.watchers = [watch(folder.storage.root, listener), watch(join(folder.storage.root, 'pages'), listener)];
  }

  close(id: string): void {
    for (const w of this.#folders.get(id)?.watchers ?? []) w.close();
    this.#folders.delete(id);
  }

  closeAll(): void {
    for (const id of [...this.#folders.keys()]) this.close(id);
  }
}
