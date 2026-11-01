import { createProjectState, MemoryProjectStorage, projectDefaults, readMachineSettings, readProjectArchive, saveProject, type MachineSettings, type ProjectStorage } from '@wirewright/core';
import { createDemoProject, createStandardLibrary } from '@wirewright/library';
import type { OpenedProject, ProjectHost } from '../host.js';

// File System Access API (Chromium). Declared here because TypeScript's DOM
// types do not include the picker yet.
interface DirectoryHandle {
  name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<{
    getFile(): Promise<File>;
    createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  }>;
  removeEntry(name: string): Promise<void>;
}
declare global {
  interface Window {
    showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<DirectoryHandle>;
  }
}

class DirectoryStorage implements ProjectStorage {
  constructor(private readonly root: DirectoryHandle) {}

  async #dir(path: string, create: boolean): Promise<{ dir: DirectoryHandle; name: string }> {
    const parts = path.split('/');
    const name = parts.pop()!;
    let dir = this.root;
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
    return { dir, name };
  }

  async read(path: string): Promise<string | undefined> {
    try {
      const { dir, name } = await this.#dir(path, false);
      return await (await (await dir.getFileHandle(name)).getFile()).text();
    } catch (error) {
      if ((error as DOMException).name === 'NotFoundError') return undefined;
      throw error;
    }
  }

  async write(path: string, content: string): Promise<void> {
    const { dir, name } = await this.#dir(path, true);
    const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
    await writable.write(content);
    await writable.close();
  }

  async remove(path: string): Promise<void> {
    try {
      const { dir, name } = await this.#dir(path, false);
      await dir.removeEntry(name);
    } catch (error) {
      if ((error as DOMException).name !== 'NotFoundError') throw error;
    }
  }
}

async function pickFolder(): Promise<OpenedProject | null> {
  if (!window.showDirectoryPicker) {
    alert('Opening folders needs a Chromium-based browser (Chrome, Edge) or the Wirewright desktop app.');
    return null;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    return { storage: new DirectoryStorage(handle), name: handle.name };
  } catch {
    return null; // cancelled
  }
}

const MACHINE_KEY = 'wirewright.machineSettings';

/** Machine settings of this browser (local storage; empty when it is not available). */
function loadMachine(): MachineSettings {
  try {
    const raw = localStorage.getItem(MACHINE_KEY);
    return readMachineSettings(raw ? JSON.parse(raw) : {});
  } catch {
    return {};
  }
}

export function createBrowserHost(): ProjectHost {
  return {
    kind: 'browser',
    async initial() {
      const storage = new MemoryProjectStorage();
      await saveProject(storage, createDemoProject(createStandardLibrary()));
      return { project: { storage, name: 'Demo (in memory)' } };
    },
    openProject: pickFolder,
    async openArchive() {
      // A file picker; the archive stays in memory (save it again as an archive, or open a folder).
      const file = await new Promise<File | undefined>((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.zip,application/zip';
        input.onchange = () => resolve(input.files?.[0]);
        input.click();
      });
      if (!file) return null;
      try {
        const storage = readProjectArchive(new Uint8Array(await file.arrayBuffer()));
        return { storage, name: file.name.replace(/\.wirewright\.zip$|\.zip$/i, '') };
      } catch (error) {
        alert((error as Error).message);
        return null;
      }
    },
    async newProject() {
      const project = await pickFolder();
      if (project) await saveProject(project.storage, createProjectState({ name: project.name, ...projectDefaults(loadMachine()) }));
      return project;
    },
    machineSettings: async () => loadMachine(),
    async saveMachineSettings(settings) {
      try {
        localStorage.setItem(MACHINE_KEY, JSON.stringify(settings));
      } catch {
        throw new Error('The browser does not allow storing settings (local storage is blocked).');
      }
    },
    async saveFile(defaultName, content, mimeType) {
      const blob = new Blob([content as BlobPart], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = defaultName;
      // Attached to the document, so every browser uses the file name.
      a.style.display = 'none';
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  };
}
