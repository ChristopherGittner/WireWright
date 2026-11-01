import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addRecent, describeRecent, removeRecent } from './recent.js';

let folder: string;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'wirewright-recent-'));
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe('recent projects', () => {
  it('puts the latest folder first, once, and keeps ten', () => {
    let list = addRecent([], '/p/a', new Date('2026-01-01'));
    list = addRecent(list, '/p/b', new Date('2026-01-02'));
    list = addRecent(list, '/p/a/', new Date('2026-01-03'));
    expect(list.map((e) => e.path)).toEqual(['/p/a', '/p/b']);
    expect(list[0]!.openedAt).toBe('2026-01-03T00:00:00.000Z');
    for (let i = 0; i < 12; i++) list = addRecent(list, `/p/${i}`);
    expect(list).toHaveLength(10);
    expect(list[0]!.path).toBe('/p/11');
    expect(removeRecent(list, '/p/11')[0]!.path).toBe('/p/10');
  });

  it('reads project names and marks missing folders', async () => {
    await mkdir(join(folder, 'Machine'));
    await writeFile(join(folder, 'Machine', 'project.json'), JSON.stringify({ name: 'Conveyor' }));
    const list = await describeRecent([
      { path: join(folder, 'Machine'), openedAt: '2026-01-01T00:00:00.000Z' },
      { path: join(folder, 'Gone'), openedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    expect(list.map((e) => [e.folder, e.name, e.missing])).toEqual([
      ['Machine', 'Conveyor', false],
      ['Gone', undefined, true],
    ]);
  });
});
