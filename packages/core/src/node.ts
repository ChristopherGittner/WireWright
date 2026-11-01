// Node.js file system storage. Separate entry point (`@wirewright/core/node`) so the
// main entry stays usable in the browser.
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { ProjectStorage } from './storage.js';

/** Reads and writes inside one project folder; paths that leave the folder are rejected. */
export class NodeProjectStorage implements ProjectStorage {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async read(path: string): Promise<string | undefined> {
    try {
      return await readFile(this.#resolve(path), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  /** Writes to a temporary file first, so a watching editor never sees a half-written file. */
  async write(path: string, content: string): Promise<void> {
    const target = this.#resolve(path);
    await mkdir(dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, content, 'utf8');
    await rename(temp, target);
  }

  async remove(path: string): Promise<void> {
    await rm(this.#resolve(path), { force: true });
  }

  #resolve(path: string): string {
    const full = resolve(this.root, path);
    const rel = relative(this.root, full);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`Path "${path}" is outside the project folder`);
    }
    return full;
  }
}

export * from './index.js';
