import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectFolders } from './projects.js';

let root: string;
let folders: ProjectFolders;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wirewright-desktop-'));
  folders = new ProjectFolders();
});

afterEach(async () => {
  folders.closeAll();
  await rm(root, { recursive: true, force: true });
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('ProjectFolders', () => {
  it('creates a project in an empty folder and opens it again', async () => {
    const { id, name } = await folders.create(root);
    expect(name).toBe(root.split('/').pop());
    expect(JSON.parse((await folders.read(id, 'project.json'))!).format).toBe('wirewright-project');
    await expect(folders.create(root)).rejects.toThrow(/already contains a project/);
    const again = await folders.open(root);
    expect(again.id).not.toBe(id);
  });

  it('refuses folders without a project, non-empty folders and paths outside the folder', async () => {
    await expect(folders.open(root)).rejects.toThrow(/does not contain a Wirewright project/);
    await writeFile(join(root, 'notes.txt'), 'x');
    await expect(folders.create(root)).rejects.toThrow(/not empty/);
    await rm(join(root, 'notes.txt'));
    const { id } = await folders.create(root);
    await expect(folders.write(id, '../evil.json', '{}')).rejects.toThrow(/outside the project folder/);
    expect(() => folders.get('nope')).toThrow(/Unknown project folder/);
  });

  it('reports outside changes but not its own writes', async () => {
    const { id } = await folders.create(root);
    let changes = 0;
    await folders.watch(id, () => changes++);
    await folders.write(id, 'pages/p_a.json', '{}');
    await wait(600);
    expect(changes).toBe(0);
    await wait(1200);
    const text = await readFile(join(root, 'project.json'), 'utf8');
    await writeFile(join(root, 'project.json'), text.replace('"name"', '"name" ').trim());
    await wait(600);
    expect(changes).toBe(1);
  });
});
