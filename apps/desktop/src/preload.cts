// Bridges the editor's ProjectHost interface (packages/editor/src/host.ts) to
// the main process. Runs sandboxed, so it only uses contextBridge and ipcRenderer.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- sandboxed preload scripts must be CommonJS
import electron = require('electron');

const { contextBridge, ipcRenderer } = electron;
type IpcRendererEvent = electron.IpcRendererEvent;

interface FolderInfo {
  id: string;
  name: string;
  folder: string;
}

function opened(info: FolderInfo | null) {
  if (!info) return null;
  const { id, name, folder } = info;
  return {
    name,
    folder,
    storage: {
      read: (path: string) => ipcRenderer.invoke('wirewright:read', id, path),
      write: (path: string, content: string) => ipcRenderer.invoke('wirewright:write', id, path, content),
      remove: (path: string) => ipcRenderer.invoke('wirewright:remove', id, path),
    },
    watch(onChange: () => void) {
      const listener = (_event: IpcRendererEvent, changed: string) => {
        if (changed === id) onChange();
      };
      ipcRenderer.on('wirewright:changed', listener);
      void ipcRenderer.invoke('wirewright:watch', id);
      return () => ipcRenderer.removeListener('wirewright:changed', listener);
    },
    markOwnWrite: () => void ipcRenderer.invoke('wirewright:markOwnWrite', id),
  };
}

contextBridge.exposeInMainWorld('wirewrightHost', {
  kind: 'desktop',
  async initial() {
    const project = opened(await ipcRenderer.invoke('wirewright:startFolder'));
    return project ? { project } : null;
  },
  openProject: async () => opened(await ipcRenderer.invoke('wirewright:openProject')),
  newProject: async () => opened(await ipcRenderer.invoke('wirewright:newProject')),
  openArchive: async () => opened(await ipcRenderer.invoke('wirewright:openArchive')),
  recentProjects: () => ipcRenderer.invoke('wirewright:recentProjects'),
  openRecent: async (path: string) => opened(await ipcRenderer.invoke('wirewright:openRecent', path)),
  forgetRecent: (path: string) => ipcRenderer.invoke('wirewright:forgetRecent', path),
  saveFile: (defaultName: string, content: string | Uint8Array, mimeType: string) => ipcRenderer.invoke('wirewright:saveFile', defaultName, content, mimeType),
  exportPdf: (defaultName: string, title: string, sheets: unknown[], path?: string) => ipcRenderer.invoke('wirewright:exportPdf', defaultName, title, sheets, path),
  chooseSavePath: (defaultPath: string, extension: string) => ipcRenderer.invoke('wirewright:chooseSavePath', defaultPath, extension),
  print: (svgPages: string[]) => ipcRenderer.invoke('wirewright:print', svgPages),
  loadSharedLibrary: () => ipcRenderer.invoke('wirewright:loadSharedLibrary'),
  libraryFolder: () => ipcRenderer.invoke('wirewright:libraryFolder'),
  chooseLibraryFolder: () => ipcRenderer.invoke('wirewright:chooseLibraryFolder'),
  saveToSharedLibrary: (device: unknown) => ipcRenderer.invoke('wirewright:saveToSharedLibrary', device),
  onSaveAndClose: (save: () => Promise<boolean>) => {
    ipcRenderer.on('wirewright:saveAndClose', () => {
      void save().then((saved) => saved && window.close());
    });
  },
  machineSettings: () => ipcRenderer.invoke('wirewright:machineSettings'),
  liveStatus: () => ipcRenderer.invoke('wirewright:liveStatus'),
  onLiveRequest: (handler: (kind: string, payload: unknown) => Promise<unknown>) => {
    ipcRenderer.on('wirewright:live', (_event: IpcRendererEvent, request: { id: number; kind: string; payload: unknown }) => {
      handler(request.kind, request.payload).then(
        (result) => ipcRenderer.invoke('wirewright:liveReply', request.id, { result }),
        (error: unknown) => ipcRenderer.invoke('wirewright:liveReply', request.id, { error: (error as Error).message }),
      );
    });
  },
  saveMachineSettings: (machine: unknown) => ipcRenderer.invoke('wirewright:setMachineSettings', machine),
});
