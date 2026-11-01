// Fixtures for the end-to-end tests: a fresh copy of the demo project and a fresh user data
// folder per test, the Electron app started on them, and its editor window.
import { saveProject } from '@wirewright/core';
import { NodeProjectStorage } from '@wirewright/core/node';
import { createDemoProject, createStandardLibrary } from '@wirewright/library';
import { _electron as electron, test as base, type ElectronApplication, type Page } from '@playwright/test';
import electronPath from 'electron';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The editor's store, as the window exposes it for tests (`window.wirewrightStore`). */
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    wirewrightStore: any;
  }
}

interface Fixtures {
  /** Content of settings.json in the user data folder (machine settings, MCP token …). */
  settings: Record<string, unknown> | undefined;
  /** Temporary folders of this test. */
  dirs: { project: string; userData: string; temp: string };
  app: ElectronApplication;
  win: Page;
}

export const test = base.extend<Fixtures>({
  settings: [undefined, { option: true }],
  // eslint-disable-next-line no-empty-pattern
  dirs: async ({}, use) => {
    const temp = mkdtempSync(join(tmpdir(), 'wirewright-e2e-'));
    const dirs = { project: join(temp, 'project'), userData: join(temp, 'user-data'), temp };
    mkdirSync(dirs.project);
    mkdirSync(dirs.userData);
    await saveProject(new NodeProjectStorage(dirs.project), createDemoProject(createStandardLibrary()));
    await use(dirs);
    rmSync(temp, { recursive: true, force: true });
  },
  app: async ({ dirs, settings }, use) => {
    if (settings) writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify(settings));
    const app = await electron.launch({
      executablePath: electronPath as unknown as string,
      args: ['--no-sandbox', '--lang=en-US', `--user-data-dir=${dirs.userData}`, appDir, dirs.project],
    });
    await use(app);
    // Leave without the "unsaved changes" question (discard).
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBoxSync = () => 1;
    }).catch(() => undefined);
    await app.close().catch(() => undefined);
  },
  win: async ({ app }, use) => {
    const win = await app.firstWindow();
    win.on('dialog', (d) => void d.dismiss().catch(() => undefined));
    await win.setViewportSize({ width: 1500, height: 950 });
    await win.waitForSelector('.tree li');
    await use(win);
  },
});

export { expect } from '@playwright/test';

