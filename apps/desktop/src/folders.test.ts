import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureFolder } from './folders.js';

let base: string;
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'wirewright-folders-'));
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('ensureFolder', () => {
  it('accepts existing folders without asking', async () => {
    expect(await ensureFolder(base, async () => { throw new Error('asked'); })).toBe(true);
  });

  it('asks before creating a missing folder (with parents)', async () => {
    const path = join(base, 'Projects', 'Machine 1');
    const questions: string[] = [];
    expect(await ensureFolder(path, async (q) => (questions.push(q), false))).toBe(false);
    await expect(stat(path)).rejects.toThrow();
    expect(await ensureFolder(path, async () => true)).toBe(true);
    expect((await stat(path)).isDirectory()).toBe(true);
    expect(questions[0]).toContain('does not exist');
  });

  it('refuses a file', async () => {
    await writeFile(join(base, 'file.txt'), 'x');
    await expect(ensureFolder(join(base, 'file.txt'), async () => true)).rejects.toThrow(/is a file/);
  });
});
