// Wirewright desktop app: loads the editor and gives it project folders, PDF export
// and printing through IPC (see preload.cts).
import { scenesToPdf, sheetDestination } from '@wirewright/pdf';
import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type IpcMainInvokeEvent } from 'electron';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { machineSettingsSchema, projectDefaults, readMachineSettings, readProjectArchive, type ProjectState } from '@wirewright/core';
import { NodeProjectStorage } from '@wirewright/core/node';
import { ToolError } from '@wirewright/mcp-server';
import { randomBytes } from 'node:crypto';
import { DEFAULT_MCP_PORT, LiveMcpServer, LiveSession } from './live.js';
import { loadLibraryFolder, saveLibraryEntry, type LibraryEntry } from './library.js';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureFolder } from './folders.js';
import { setTextLanguage, t } from './texts.js';
import { ProjectFolders } from './projects.js';
import { addRecent, describeRecent, removeRecent, type RecentEntry } from './recent.js';

const here = dirname(fileURLToPath(import.meta.url));
const folders = new ProjectFolders();

/**
 * The project folder given on the command line: `wirewright <folder>` (the app
 * path itself is skipped). Relative paths are taken from where the command was
 * typed: pnpm runs the app in apps/desktop but keeps that directory in INIT_CWD.
 */
function startFolder(): string | undefined {
  const base = process.env.INIT_CWD ?? process.cwd();
  const appPath = resolve(app.getAppPath());
  const args = process.argv.slice(1).filter((a) => !a.startsWith('-') && a !== '.' && resolve(a) !== appPath);
  const folder = args.at(-1);
  return folder === undefined ? undefined : resolve(base, folder);
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    title: 'Wirewright',
    icon: join(here, '../resources/icon.png'),
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  const devUrl = process.env.WIREWRIGHT_DEV_URL;
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(here, '../../../packages/editor/dist/index.html'));
  // The editor blocks closing while there are unsaved changes (beforeunload); Electron then
  // shows nothing, so ask here: save, discard or keep the window open.
  win.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: [t('Save'), t('Discard changes'), t('Cancel')],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      title: t('Unsaved changes'),
      message: t('The project has unsaved changes.'),
      detail: t('Save them before closing? Discarded changes are lost.'),
    });
    if (choice === 1) event.preventDefault(); // closes without saving
    else if (choice === 0) win.webContents.send('wirewright:saveAndClose');
  });
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    // Detached editor tabs: empty child windows the editor renders into (same page, shared state).
    if (url === 'about:blank' && frameName.startsWith('wirewright-panel-')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { width: 380, height: 760, title: 'Wirewright', icon: join(here, '../resources/icon.png'), autoHideMenuBar: true },
      };
    }
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  return win;
}

function windowOf(event: IpcMainInvokeEvent): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(event.sender) ?? undefined;
}

/** Opens (or creates) a project folder and puts it on the recent projects list. */
async function openFolder(root: string, create = false): Promise<{ id: string; name: string; folder: string }> {
  const opened = create ? await folders.create(root, projectDefaults((await readSettings()).machine)) : await folders.open(root);
  await updateSettings((s) => ({ ...s, recent: addRecent(s.recent ?? [], root) }));
  return opened;
}

ipcMain.handle('wirewright:startFolder', async () => {
  const folder = startFolder();
  if (!folder) return null;
  try {
    return await openFolder(folder);
  } catch (error) {
    await dialog.showMessageBox({ type: 'error', message: (error as Error).message });
    return null;
  }
});

ipcMain.handle('wirewright:openProject', async (event) => {
  const win = windowOf(event);
  const options = { title: t('Open Wirewright project folder'), properties: ['openDirectory' as const] };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  const root = result.filePaths[0];
  if (result.canceled || !root) return null;
  try {
    return await openFolder(root);
  } catch (error) {
    await dialog.showMessageBox({ type: 'error', message: (error as Error).message });
    return null;
  }
});

ipcMain.handle('wirewright:openArchive', async (event) => {
  const win = windowOf(event);
  const pick = { title: t('Open a project archive'), properties: ['openFile' as const], filters: [{ name: 'Wirewright archive', extensions: ['zip'] }] };
  const file = win ? await dialog.showOpenDialog(win, pick) : await dialog.showOpenDialog(pick);
  const path = file.filePaths[0];
  if (file.canceled || !path) return null;
  try {
    const archive = readProjectArchive(new Uint8Array(await readFile(path)));
    // Projects are folders: the archive is unpacked into an empty one.
    const target = { title: t('Choose an empty folder to unpack the project into'), properties: ['openDirectory' as const, 'createDirectory' as const] };
    const folder = win ? await dialog.showOpenDialog(win, target) : await dialog.showOpenDialog(target);
    const root = folder.filePaths[0];
    if (folder.canceled || !root) return null;
    if (!(await confirmFolder(win, root))) return null;
    const entries = await readdir(root).catch(() => []);
    if (entries.some((e) => !e.startsWith('.'))) throw new Error(t('"{path}" is not empty. Choose an empty folder for a new project.', { path: root }));
    const storage = new NodeProjectStorage(root);
    for (const [name, content] of archive.files) await storage.write(name, content);
    return await openFolder(root);
  } catch (error) {
    await dialog.showMessageBox({ type: 'error', message: (error as Error).message });
    return null;
  }
});

/** A chosen folder that does not exist yet: "Create it?" (Create/Cancel). */
async function confirmFolder(win: BrowserWindow | undefined, path: string): Promise<boolean> {
  return ensureFolder(path, async (question) => {
    const options = { type: 'question' as const, buttons: [t('Create'), t('Cancel')], defaultId: 0, cancelId: 1, message: question, detail: t('Create it?') };
    const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
    return response === 0;
  });
}

ipcMain.handle('wirewright:newProject', async (event) => {
  const win = windowOf(event);
  const options = { title: t('Choose an empty folder for the new project'), properties: ['openDirectory' as const, 'createDirectory' as const] };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  const root = result.filePaths[0];
  if (result.canceled || !root) return null;
  try {
    if (!(await confirmFolder(win, root))) return null;
    return await openFolder(root, true);
  } catch (error) {
    await dialog.showMessageBox({ type: 'error', message: (error as Error).message });
    return null;
  }
});

ipcMain.handle('wirewright:read', (_e, id: string, path: string) => folders.read(id, path));
ipcMain.handle('wirewright:write', (_e, id: string, path: string, content: string) => folders.write(id, path, content));
ipcMain.handle('wirewright:remove', (_e, id: string, path: string) => folders.remove(id, path));
ipcMain.handle('wirewright:markOwnWrite', (_e, id: string) => folders.markOwnWrite(id));
ipcMain.handle('wirewright:watch', (event, id: string) =>
  folders.watch(id, () => {
    if (!event.sender.isDestroyed()) event.sender.send('wirewright:changed', id);
  }),
);

async function saveDialog(event: IpcMainInvokeEvent, defaultName: string, filters: Electron.FileFilter[]): Promise<string | undefined> {
  const win = windowOf(event);
  const options = { defaultPath: defaultName, filters };
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
  return result.canceled ? undefined : result.filePath;
}

ipcMain.handle('wirewright:saveFile', async (event, defaultName: string, content: string | Uint8Array, mimeType: string) => {
  const extension = defaultName.split('.').pop() ?? '*';
  const path = await saveDialog(event, defaultName, [{ name: mimeType, extensions: [extension] }]);
  if (path) await writeFile(path, content);
});

interface PdfSheet {
  scene: Parameters<typeof scenesToPdf>[0][number]['scene'];
  pageId: string;
  sheet: number;
  title: string;
}

/** Lets the user choose where to save a file; returns the path or null. */
ipcMain.handle('wirewright:chooseSavePath', async (event, defaultPath: string, extension: string) => {
  return (await saveDialog(event, defaultPath, [{ name: extension.toUpperCase(), extensions: [extension] }])) ?? null;
});

/** Writes the PDF to `path` (its folder is created), or asks where to save it when no path is given. */
ipcMain.handle('wirewright:exportPdf', async (event, defaultName: string, title: string, sheets: PdfSheet[], target?: string) => {
  const path = target ? resolve(target) : await saveDialog(event, defaultName, [{ name: 'PDF', extensions: ['pdf'] }]);
  if (!path) return;
  await mkdir(dirname(path), { recursive: true });
  const bytes = await scenesToPdf(
    sheets.map((s) => ({ scene: s.scene, destination: sheetDestination(s.pageId, s.sheet), title: s.title })),
    { title, resolve: (target) => sheetDestination(target.pageId, 0) },
  );
  await writeFile(path, bytes);
  void shell.openPath(path);
});

ipcMain.handle('wirewright:print', async (_event, svgPages: string[]) => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A3 landscape; margin: 0; }
    html, body { margin: 0; }
    .page { width: 420mm; height: 297mm; page-break-after: always; }
    .page svg { width: 420mm; height: 297mm; display: block; }
  </style></head><body>${svgPages.map((svg) => `<div class="page">${svg}</div>`).join('')}</body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise<void>((resolve) => {
    win.webContents.print({ printBackground: true, landscape: true }, () => resolve());
  });
  win.destroy();
});

// App settings (library folder, recent projects, machine settings) in the user data folder.
interface Settings {
  libraryFolder?: string;
  recent?: RecentEntry[];
  /** Access token of the MCP live mode (generated once). */
  mcpToken?: string;
  /** Defaults of this installation (see MachineSettings in @wirewright/core). */
  machine?: unknown;
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

async function readSettings(): Promise<Settings> {
  try {
    return JSON.parse(await readFile(settingsPath(), 'utf8')) as Settings;
  } catch {
    return {};
  }
}

async function writeSettings(settings: Settings): Promise<void> {
  await writeFile(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
}

/** Read-modify-write of the settings, one at a time. */
let settingsQueue: Promise<unknown> = Promise.resolve();
function updateSettings(change: (settings: Settings) => Settings): Promise<void> {
  const next = settingsQueue.then(async () => writeSettings(change(await readSettings())));
  settingsQueue = next.catch(() => undefined);
  return next;
}

ipcMain.handle('wirewright:machineSettings', async () => readMachineSettings((await readSettings()).machine));
ipcMain.handle('wirewright:setMachineSettings', (_event, machine: unknown) => {
  const valid = machineSettingsSchema.parse(machine);
  setTextLanguage(valid.uiLanguage, app.getLocale());
  return updateSettings((s) => ({ ...s, machine: valid })).then(() => applyLiveMode());
});

ipcMain.handle('wirewright:recentProjects', async () => describeRecent((await readSettings()).recent ?? []));

ipcMain.handle('wirewright:openRecent', async (_event, path: string) => {
  try {
    return await openFolder(path);
  } catch (error) {
    await dialog.showMessageBox({ type: 'error', message: (error as Error).message });
    return null;
  }
});

ipcMain.handle('wirewright:forgetRecent', (_event, path: string) => updateSettings((s) => ({ ...s, recent: removeRecent(s.recent ?? [], path) })));

ipcMain.handle('wirewright:libraryFolder', async () => (await readSettings()).libraryFolder ?? process.env.WIREWRIGHT_LIBRARY ?? null);

ipcMain.handle('wirewright:chooseLibraryFolder', async (event) => {
  const win = windowOf(event);
  const options = { title: t('Choose the shared library folder'), properties: ['openDirectory' as const, 'createDirectory' as const] };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  const folder = result.filePaths[0];
  if (result.canceled || !folder) return null;
  try {
    if (!(await confirmFolder(win, folder))) return null;
  } catch (error) {
    await dialog.showMessageBox({ type: 'error', message: (error as Error).message });
    return null;
  }
  await updateSettings((s) => ({ ...s, libraryFolder: folder }));
  return folder;
});

// ---------------------------------------------------------------------------
// MCP live mode: AI assistants work on the project open in the (first) editor window.

const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let nextRequest = 1;

/** Asks the editor window (renderer) and waits for its answer. */
function askEditor(kind: string, payload?: unknown): Promise<unknown> {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes('index.html')) ?? BrowserWindow.getAllWindows()[0];
  if (!win) return Promise.reject(new ToolError('The Wirewright window is closed.'));
  const id = nextRequest++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    win.webContents.send('wirewright:live', { id, kind, payload });
    setTimeout(() => {
      if (pending.delete(id)) reject(new ToolError('The editor did not answer in time.'));
    }, 30_000);
  });
}

ipcMain.handle('wirewright:liveReply', (_event, id: number, reply: { result?: unknown; error?: string }) => {
  const request = pending.get(id);
  pending.delete(id);
  if (!request) return;
  if (reply.error !== undefined) request.reject(new ToolError(reply.error));
  else request.resolve(reply.result);
});

const liveSession = new LiveSession({
  state: async () => (await askEditor('state')) as { state: ProjectState; folder?: string } | null,
  apply: async (label, patches, inverse) => void (await askEditor('apply', { label, patches, inverse })),
  sharedLibrary: async () => {
    const folder = (await readSettings()).libraryFolder ?? process.env.WIREWRIGHT_LIBRARY;
    return folder ? loadLibraryFolder(folder) : null;
  },
});
let liveServer: LiveMcpServer | undefined;

async function mcpToken(): Promise<string> {
  const token = (await readSettings()).mcpToken;
  if (token) return token;
  const created = randomBytes(24).toString('base64url');
  await updateSettings((s) => ({ ...s, mcpToken: created }));
  return created;
}

/** Starts, restarts or stops the live MCP server as the machine settings say. */
async function applyLiveMode(): Promise<void> {
  const mcp = readMachineSettings((await readSettings()).machine).mcp;
  liveServer ??= new LiveMcpServer(liveSession, await mcpToken());
  if (mcp?.enabled) await liveServer.start(mcp.port ?? DEFAULT_MCP_PORT);
  else await liveServer.stop();
}

ipcMain.handle('wirewright:liveStatus', async () => ({
  ...(liveServer?.status ?? { running: false, url: '' }),
  token: await mcpToken(),
  defaultPort: DEFAULT_MCP_PORT,
}));

ipcMain.handle('wirewright:loadSharedLibrary', async () => {
  const folder = (await readSettings()).libraryFolder ?? process.env.WIREWRIGHT_LIBRARY;
  return folder ? loadLibraryFolder(folder) : null;
});

ipcMain.handle('wirewright:saveToSharedLibrary', async (_event, entry: LibraryEntry) => {
  const folder = (await readSettings()).libraryFolder ?? process.env.WIREWRIGHT_LIBRARY;
  if (!folder) throw new Error(t('No library folder chosen (Library → Choose folder…)'));
  await saveLibraryEntry(folder, entry);
});

app.whenReady().then(async () => {
  setTextLanguage(readMachineSettings((await readSettings()).machine).uiLanguage, app.getLocale());
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]),
  );
  createWindow();
  await applyLiveMode().catch((error: unknown) => console.error('MCP live mode:', error));
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  folders.closeAll();
  if (process.platform !== 'darwin') app.quit();
});
