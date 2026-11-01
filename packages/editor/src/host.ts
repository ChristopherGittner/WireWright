// What the editor needs from its environment. The desktop app (Electron)
// provides real folders, PDF export and printing; the browser host provides a
// demo project, folders through the File System Access API and downloads.
import type { DeviceDefinition, FrameDefinition, LibraryContent, MacroDefinition, MachineSettings, PartDefinition, ProjectStorage, SymbolDefinition } from '@wirewright/core';
import type { Scene } from '@wirewright/render';

export interface OpenedProject {
  storage: ProjectStorage;
  /** Folder name, shown in the title bar. */
  name: string;
  /** Full path of the project folder (desktop app), e.g. for the default export location. */
  folder?: string;
  /** Calls `onChange` when files change on disk from outside the editor. Returns an unsubscribe function. */
  watch?(onChange: () => void): () => void;
  /** Tells the watcher that the editor itself is writing, so the change is not reported back. */
  markOwnWrite?(): void;
}

export interface PdfSheet {
  scene: Scene;
  pageId: string;
  sheet: number;
  title: string;
}

export interface RecentProject {
  path: string;
  /** Folder name. */
  folder: string;
  /** Project name from project.json. */
  name?: string;
  /** ISO time of the last opening. */
  openedAt: string;
  /** The folder is gone or holds no project. */
  missing: boolean;
}

export interface ProjectHost {
  kind: 'browser' | 'desktop';
  /** Project to open at start (browser: the demo). */
  initial(): Promise<{ project: OpenedProject; create?: boolean } | null>;
  /** Lets the user pick an existing project folder. */
  openProject(): Promise<OpenedProject | null>;
  /**
   * Opens a project archive (`.wirewright.zip`): the desktop app unpacks it into a folder the user
   * chooses, the browser keeps it in memory.
   */
  openArchive?(): Promise<OpenedProject | null>;
  /** Lets the user pick an empty folder for a new project. */
  newProject(): Promise<OpenedProject | null>;
  /** The most recently opened projects, newest first; only in the desktop app. */
  recentProjects?(): Promise<RecentProject[]>;
  /** Opens a project from the recent list. */
  openRecent?(path: string): Promise<OpenedProject | null>;
  /** Removes a project from the recent list (the folder stays). */
  forgetRecent?(path: string): Promise<void>;
  /** Saves a file the user downloads/exports, asking where to put it. */
  saveFile(defaultName: string, content: string | Uint8Array, mimeType: string): Promise<void>;
  /** PDF export; only in the desktop app. */
  exportPdf?(defaultName: string, title: string, sheets: PdfSheet[], path?: string): Promise<void>;
  /** Lets the user choose a file to save to (desktop app); null when cancelled. */
  chooseSavePath?(defaultPath: string, extension: string): Promise<string | null>;
  /** Prints the given SVG pages; only in the desktop app. */
  print?(svgPages: string[]): Promise<void>;
  /** The shared (company) library from the library folder; only in the desktop app. */
  loadSharedLibrary?(): Promise<LibraryContent | null>;
  /** Current library folder, if one is set. */
  libraryFolder?(): Promise<string | null>;
  /** Lets the user choose the library folder. Returns the folder or null when cancelled. */
  chooseLibraryFolder?(): Promise<string | null>;
  /** Saves a device definition (`devices/<id>.json`) or a macro (`macros/<id>.json`) to the library folder. */
  saveToSharedLibrary?(entry: DeviceDefinition | MacroDefinition | PartDefinition | SymbolDefinition | FrameDefinition): Promise<void>;
  /**
   * Desktop app: "Save" in the unsaved-changes question when closing. `save` returns whether
   * everything was saved; the window then closes.
   */
  onSaveAndClose?(save: () => Promise<boolean>): void;
  /** Desktop app: the MCP live mode server (address and access token). */
  liveStatus?(): Promise<{ running: boolean; url: string; error?: string; token: string; defaultPort: number }>;
  /** Desktop app: requests of the MCP live mode (`state`: the open project; `apply`: changes as one undo step). */
  onLiveRequest?(handler: (kind: string, payload: unknown) => Promise<unknown>): void;
  /** Defaults of this installation (desktop: settings.json, browser: local storage). */
  machineSettings(): Promise<MachineSettings>;
  saveMachineSettings(settings: MachineSettings): Promise<void>;
}
