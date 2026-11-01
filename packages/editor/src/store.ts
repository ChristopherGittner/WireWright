// Editor state outside React: the open document, current sheet, selection,
// tool and view settings. Components subscribe with `useEditor(selector)`.
import {
  CommandError,
  itemStyle,
  effectiveTag,
  loadProject,
  MapLibrary,
  placedFunctions,
  ProjectDocument,
  saveProject,
  type ApplyResult,
  type Command,
  type GridSize,
  type Item,
  type Library,
  type LibraryContent,
  type MachineSettings,
  type ProjectState,
  type ProjectChanges,
  type Revision,
  compareProjects,
  loadRevisionSnapshot,
  pagesForRevision,
  saveRevisionSnapshot,
  type SymbolDefinition,
  type PlcTagImport,
  type Rotation,
  type SchematicPage,
  type Tag,
  type Catalog,
  type ItemStyle,
} from '@wirewright/core';
import { standardLibraryContent } from '@wirewright/library';
import { createContext, useContext, useSyncExternalStore } from 'react';
import type { OpenedProject, ProjectHost } from './host.js';
import { issueText, tr } from './i18n.js';

export type Tool =
  | { kind: 'select' }
  | { kind: 'place'; symbol: string; rotation: Rotation; mirror: boolean }
  | { kind: 'box'; symbol: 'wirewright.box.structure' | 'wirewright.box.device' }
  /** Drawing a cable definition line by dragging across the conductors. */
  | { kind: 'cable'; symbol: string }
  /** Placing the functions of a device definition one after another; Tab switches the function. */
  | { kind: 'device'; device: string; index: number; rotation: Rotation; mirror: boolean; tag?: Tag }
  /** Placing a macro (click places it; its devices get new names). */
  | { kind: 'macro'; macro: string }
  /** Placing a PLC channel (I/O point) or a card view chosen in the PLC tab (click on the page). */
  | { kind: 'plc'; payload: PlcDragPayload }
  /**
   * Pasted items following the mouse until a click places them. `origin` is the top-left of the
   * copied items; X/Y lock the copy to the original's horizontal/vertical position.
   */
  | { kind: 'paste'; items: Item[]; origin: { x: number; y: number }; lockX: boolean; lockY: boolean }
  /** Style brush: the text layout of `from`; each clicked symbol (or band) gets it, until Esc. */
  | { kind: 'brush'; style: ItemStyle; from: string };

export interface Selection {
  items: string[];
  /** A single text of an item (tag, function text, pin …), selected by clicking on it. */
  text?: {
    itemId: string;
    field: string;
    /** A selected cross-reference: where it points (F follows it). */
    target?: { pageId: string; itemId: string };
  };
}

export type Dialog =
  | { kind: 'item'; pageId: string; itemIds: string[]; /** Just placed (free text: Cancel removes it again). */ isNew?: boolean }
  | { kind: 'page'; pageId: string }
  | { kind: 'project' }
  | { kind: 'find' }
  | { kind: 'placeAuxiliary'; command: Extract<Command, { type: 'placeSymbol' }> }
  | { kind: 'structureBox'; command: Extract<Command, { type: 'placeSymbol' }> }
  | { kind: 'newReport' }
  | { kind: 'newLayout' }
  | { kind: 'palette' }
  | { kind: 'addPlcCard'; station: string }
  | { kind: 'acknowledge'; keys: string[]; text: string }
  | { kind: 'catalogImport'; catalog: Catalog; fileName: string }
  | { kind: 'layoutItem'; pageId: string; itemId: string }
  | { kind: 'renameDevice'; device: string }
  | { kind: 'externalChange' }
  | { kind: 'shortcuts' }
  | { kind: 'plc'; /** PLC to show first. */ station?: string }
  | { kind: 'library' }
  | { kind: 'saveDevice'; device: string }
  | { kind: 'wires' }
  | { kind: 'terminals' }
  | { kind: 'saveMacro' }
  | { kind: 'translations' }
  | { kind: 'renumber' }
  | { kind: 'renumberPages' }
  | { kind: 'export'; mode: 'pdf' | 'print' | 'svg' }
  | { kind: 'machine' }
  | { kind: 'parts'; select?: string }
  | { kind: 'revisions' }
  | { kind: 'symbolEditor'; mode: 'symbol' | 'frame'; id?: string; /** A prepared definition to start from (e.g. from a device box). */ initial?: SymbolDefinition }
  | { kind: 'plcImport'; station: string; plan: PlcTagImport; comments: boolean };

export interface SheetKey {
  pageId: string;
  sheet: number;
}

export interface EditorState {
  doc: ProjectDocument | null;
  /** Increases with every change of the document (the document object itself stays the same). */
  version: number;
  /** Text being edited in place (F2). */
  inlineEdit: { itemId: string; field: string } | null;
  project: OpenedProject | null;
  sheet: SheetKey | null;
  selection: Selection;
  /** Pages selected in the page navigator (Ctrl/Shift+click), e.g. for renumbering. */
  pageSelection: string[];

  tool: Tool;
  grid: GridSize;
  showLinks: boolean;
  /** PDF export and printing in black and white instead of potential colors. */
  monochrome: boolean;
  language: string;
  /** Defaults of this installation (Machine settings), loaded from the host at start. */
  machine: MachineSettings;
  /** A revision the drawing is compared with (changes are highlighted), with its snapshot. */
  compare: { name: string; state: ProjectState } | null;
  dirty: boolean;
  dialog: Dialog | null;
  /** Short status message (errors from commands, "Saved" …). */
  message: { text: string; error: boolean } | null;
  /** Ask the canvas to center on an item; the nonce makes repeated requests distinct. */
  focus: { itemId: string; nonce: number } | null;
  /** Cursor position on the page in mm (snapped), for the status bar and pasting. */
  cursor: { x: number; y: number } | null;
}

/** Standard library, plus the shared company library when the host provides one. */
let baseLibrary: Library = new MapLibrary(standardLibraryContent());

/** A PLC card (or one of its channels) dragged from the PLC tab onto a page. */
export interface PlcDragPayload {
  pageId: string;
  itemId: string;
  channel?: number;
}

/** MIME type of a PLC drag (the payload as JSON). */
export const PLC_DRAG_TYPE = 'application/x-wirewright-plc';

/** A symbol or macro dragged from the Symbols tab onto a page. */
export interface SymbolDragPayload {
  symbol?: string;
  macro?: string;
}

export const SYMBOL_DRAG_TYPE = 'application/x-wirewright-symbol';

/** Per-folder view state (not part of the project data): the page open last. */
const VIEW_FILE = 'view.json';

async function readLastPage(project: OpenedProject): Promise<string | undefined> {
  try {
    const raw = await project.storage.read(VIEW_FILE);
    const page = raw ? (JSON.parse(raw) as { page?: unknown }).page : undefined;
    return typeof page === 'string' ? page : undefined;
  } catch {
    return undefined;
  }
}

export class EditorStore {
  /**
   * The PLC drag in progress. Not part of the rendered state: changing it must not re-render the
   * app while the browser drags (that made dragging flicker and could lose the drop).
   */
  plcDrag: PlcDragPayload | null = null;
  /** The symbol/macro drag in progress (same reason). */
  symbolDrag: SymbolDragPayload | null = null;

  #state: EditorState = {
    doc: null,
    version: 0,
    inlineEdit: null,
    project: null,
    sheet: null,
    selection: { items: [] },
    pageSelection: [],
    tool: { kind: 'select' },
    grid: 4,
    showLinks: false,
    monochrome: false,
    language: 'de',
    machine: {},
    compare: null,
    dirty: false,
    dialog: null,
    message: null,
    focus: null,
    cursor: null,
  };
  readonly #listeners = new Set<() => void>();
  #clipboard: { items: Item[] } | null = null;
  #unwatch: (() => void) | undefined;
  #messageTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(readonly host: ProjectHost) {}

  get state(): EditorState {
    return this.#state;
  }

  /** The library of the open project (standard + shared + project library). */
  get library(): Library {
    return this.#state.doc?.library ?? baseLibrary;
  }

  /** Reloads the shared library from the host (desktop: the library folder). */
  async loadSharedLibrary(): Promise<void> {
    let shared: LibraryContent | null = null;
    try {
      shared = (await this.host.loadSharedLibrary?.()) ?? null;
    } catch (error) {
      this.notify(tr('Shared library: {error}', { error: (error as Error).message }), true);
    }
    baseLibrary = new MapLibrary(standardLibraryContent(), ...(shared ? [shared] : []));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  set(patch: Partial<EditorState>): void {
    const previous = this.#state.sheet;
    this.#state = { ...this.#state, ...patch };
    for (const l of this.#listeners) l();
    if (patch.sheet && patch.sheet.pageId !== previous?.pageId) this.#rememberPage();
  }

  #viewTimer: ReturnType<typeof setTimeout> | undefined;

  /** Remembers the open page in the project folder (view.json), shortly after it changes. */
  #rememberPage(): void {
    clearTimeout(this.#viewTimer);
    this.#viewTimer = setTimeout(() => {
      const { project, sheet } = this.#state;
      if (!project || !sheet) return;
      project.markOwnWrite?.();
      project.storage.write(VIEW_FILE, JSON.stringify({ page: sheet.pageId }, null, 2) + '\n').catch(() => {
        // read-only folder: the page is simply not remembered
      });
    }, 800);
  }

  // -------------------------------------------------------------------------
  // Project

  async open(project: OpenedProject): Promise<void> {
    try {
      await this.loadSharedLibrary();
      const doc = new ProjectDocument(await loadProject(project.storage), baseLibrary);
      this.#unwatch?.();
      this.#unwatch = project.watch?.(() => this.#onExternalChange());
      const first = doc.state.project.pages.find((id) => doc.state.pages[id]?.type === 'schematic') ?? doc.state.project.pages[0];
      // The page open when the project was last used (view.json), if it still exists.
      const last = await readLastPage(project);
      const start = last && doc.state.pages[last] ? last : first;
      this.set({
        doc,
        version: this.#state.version + 1,
        project,
        sheet: start ? { pageId: start, sheet: 0 } : null,
        selection: { items: [] },
        pageSelection: [],
        compare: null,
        tool: { kind: 'select' },
        language: doc.state.project.settings.displayLanguage,
        grid: doc.state.project.settings.defaultGridMm,
        dirty: false,
        dialog: null,
      });
      document.title = `${doc.state.project.name} – Wirewright`;
    } catch (error) {
      this.notify(tr('Could not open project: {error}', { error: (error as Error).message }), true);
    }
  }

  /**
   * Releases a revision: marks the pages changed since the previous one (all for the first) with
   * its name and date, writes the snapshot `revisions/<name>.json` and saves the project.
   */
  async createRevision(revision: Revision): Promise<boolean> {
    const { doc, project } = this.#state;
    if (!doc || !project) return false;
    const previousName = doc.state.project.revisions?.at(-1)?.name;
    const previous = previousName ? await loadRevisionSnapshot(project.storage, previousName).catch(() => undefined) : undefined;
    if (!this.apply({ type: 'addRevision', revision, pageIds: pagesForRevision(previous, doc.state) }, 'release revision')) return false;
    try {
      project.markOwnWrite?.();
      await saveRevisionSnapshot(project.storage, revision.name, this.#state.doc!.state);
    } catch (error) {
      this.notify(tr('Saving the revision failed: {error}', { error: (error as Error).message }), true);
      return false;
    }
    await this.save();
    return true;
  }

  /** Highlights the changes since a revision (null: no comparison). */
  async compareWith(name: string | null): Promise<void> {
    const project = this.#state.project;
    if (!name || !project) return this.set({ compare: null });
    try {
      const state = await loadRevisionSnapshot(project.storage, name);
      if (!state) return this.notify(tr('The snapshot of revision {name} is missing (revisions/{name}.json)', { name }), true);
      this.set({ compare: { name, state } });
    } catch (error) {
      this.notify((error as Error).message, true);
    }
  }

  #changes?: { now: ProjectState; before: ProjectState; value: ProjectChanges };
  /** Changes since the compared revision (cached), or null when not comparing. */
  changes(): ProjectChanges | null {
    const { doc, compare } = this.#state;
    if (!doc || !compare) return null;
    if (this.#changes?.now !== doc.state || this.#changes.before !== compare.state) {
      this.#changes = { now: doc.state, before: compare.state, value: compareProjects(compare.state, doc.state) };
    }
    return this.#changes.value;
  }

  async save(): Promise<void> {
    const { doc, project } = this.#state;
    if (!doc || !project) return;
    try {
      project.markOwnWrite?.();
      await saveProject(project.storage, doc.state, doc.takeChanges());
      this.set({ dirty: false });
      this.notify('Saved');
    } catch (error) {
      this.notify(tr('Saving failed: {error}', { error: (error as Error).message }), true);
    }
  }

  /** Reloads from disk, keeping the current page if it still exists. */
  async reload(): Promise<void> {
    const { project, sheet } = this.#state;
    if (!project) return;
    await this.open(project);
    if (sheet && this.#state.doc?.state.pages[sheet.pageId]) this.set({ sheet });
  }

  #onExternalChange(): void {
    if (this.#state.dirty) this.set({ dialog: { kind: 'externalChange' } });
    else void this.reload();
  }

  // -------------------------------------------------------------------------
  // Commands

  /** Applies commands as one undo step. Shows errors instead of throwing. */
  apply(commands: Command | Command[], label?: string): ApplyResult | null {
    const { doc } = this.#state;
    if (!doc) return null;
    try {
      const result = doc.apply(commands, label ? { label } : {});
      this.set({ version: this.#state.version + 1, dirty: doc.hasChanges || this.#state.dirty, selection: this.#validSelection() });
      return result;
    } catch (error) {
      if (error instanceof CommandError) {
        this.notify(issueText(error), true);
        return null;
      }
      throw error;
    }
  }

  /** Changes made elsewhere on a copy of the open state (MCP live mode), as one undo step. */
  applyStep(label: string, patches: Parameters<ProjectDocument['applyStep']>[1], inverse: Parameters<ProjectDocument['applyStep']>[2]): void {
    const doc = this.#state.doc;
    if (!doc) throw new Error('No project is open');
    doc.applyStep(label, patches, inverse);
    this.set({ version: this.#state.version + 1, dirty: true, selection: this.#validSelection() });
  }

  undo(): void {
    if (this.#state.doc?.undo()) this.set({ version: this.#state.version + 1, dirty: true, selection: this.#validSelection() });
  }

  redo(): void {
    if (this.#state.doc?.redo()) this.set({ version: this.#state.version + 1, dirty: true, selection: this.#validSelection() });
  }

  #validSelection(): Selection {
    const page = this.currentPage();
    const ids = new Set(page?.items.map((i) => i.id) ?? []);
    const { selection } = this.#state;
    return {
      items: selection.items.filter((id) => ids.has(id)),
      ...(selection.text && ids.has(selection.text.itemId) ? { text: selection.text } : {}),
    };
  }

  // -------------------------------------------------------------------------
  // Navigation and selection

  currentPage(): SchematicPage | undefined {
    const { doc, sheet } = this.#state;
    const page = sheet && doc?.state.pages[sheet.pageId];
    return page && page.type === 'schematic' ? page : undefined;
  }

  navigate(pageId: string, sheet = 0, itemId?: string): void {
    this.set({
      sheet: { pageId, sheet },
      selection: itemId ? { items: [itemId] } : { items: [] },
      focus: itemId ? { itemId, nonce: Date.now() } : null,
      tool: this.#state.tool.kind === 'place' || this.#state.tool.kind === 'brush' ? this.#state.tool : { kind: 'select' },
    });
  }

  /**
   * F (follow): jumps to where the selected cross-reference points, or from
   * the selected symbol to its master (the device's main function, the PLC
   * card of an I/O point) or to the partner of an interruption point.
   */
  follow(): void {
    const { doc, selection } = this.#state;
    if (!doc) return;
    const target = selection.text?.target;
    if (target) return this.navigate(target.pageId, 0, target.itemId);
    if (selection.items.length !== 1) return this.notify('Select one symbol or one cross-reference to follow', true);
    const itemId = selection.items[0]!;
    const devices = doc.devices();
    const key = devices.byItem.get(itemId);
    const main = key ? devices.devices.get(key)?.main : undefined;
    if (main && main.itemId !== itemId) return this.navigate(main.pageId, 0, main.itemId);
    if (main) return this.notify('This is the master. Select one of its cross-references and press F to follow it.');
    const reference = doc.crossReferences().byItem.get(itemId)?.references[0];
    if (reference) return this.navigate(reference.target.pageId, 0, reference.target.itemId);
    this.notify(key ? `${key} has no master placed` : 'Nothing to follow', true);
  }

  /** Previous/next sheet in page order. */
  step(delta: number): void {
    const { doc, sheet } = this.#state;
    if (!doc || !sheet) return;
    const sheets = doc.sheets().sheets;
    const index = sheets.findIndex((s) => s.pageId === sheet.pageId && s.sheet === sheet.sheet);
    const next = sheets[Math.min(Math.max(index + delta, 0), sheets.length - 1)];
    if (next) this.navigate(next.pageId, next.sheet);
  }

  select(selection: Selection): void {
    this.set({ selection });
  }

  notify(text: string, error = false): void {
    clearTimeout(this.#messageTimer);
    this.set({ message: { text: tr(text), error } });
    this.#messageTimer = setTimeout(() => this.set({ message: null }), error ? 6000 : 2500);
  }

  // -------------------------------------------------------------------------
  // Clipboard

  copy(): void {
    const page = this.currentPage();
    if (!page) return;
    const ids = new Set(this.#state.selection.items);
    const items = page.items.filter((i) => ids.has(i.id));
    if (items.length > 0) this.#clipboard = { items: structuredClone(items) };
  }

  cut(): void {
    const page = this.currentPage();
    this.copy();
    if (page && this.#state.selection.items.length > 0) {
      this.apply({ type: 'deleteItems', pageId: page.id, itemIds: this.#state.selection.items }, 'cut');
    }
  }

  /**
   * Pastes at the cursor. Copied devices get new names and the copied contacts
   * follow them; contacts copied without their coil keep their device tag.
   */
  /** Ctrl+V: the copied items follow the mouse; a click places them (see the 'paste' tool). */
  paste(): void {
    const page = this.currentPage();
    const clip = this.#clipboard;
    if (!page || !clip || clip.items.length === 0) return;
    const origin = { x: Math.min(...clip.items.map((i) => i.x)), y: Math.min(...clip.items.map((i) => i.y)) };
    this.set({ tool: { kind: 'paste', items: clip.items, origin, lockX: false, lockY: false }, selection: { items: [] } });
  }

  /** Where pasted items land for a mouse position: X/Y locks keep the original's x or y. */
  pastePoint(at: { x: number; y: number }): { x: number; y: number } {
    const tool = this.#state.tool;
    if (tool.kind !== 'paste') return at;
    return { x: tool.lockX ? tool.origin.x : at.x, y: tool.lockY ? tool.origin.y : at.y };
  }
}

/**
 * Starts placing a device's functions. With `fromItem`, continues an already
 * drawn device (its tag) at its first function that is not placed yet.
 */
/** Starts the style brush with the text layout of the selected symbol. */
export function startStyleBrush(store: EditorStore): void {
  const page = store.currentPage();
  const item = page?.items.find((i) => i.id === store.state.selection.items[0]);
  if (!page || !item || store.state.selection.items.length !== 1) return;
  const label = store.state.doc?.devices().byItem.get(item.id) ?? item.symbol;
  store.set({ tool: { kind: 'brush', style: itemStyle(item), from: label } });
}

export function startDeviceTool(store: EditorStore, deviceId: string, fromItem?: { pageId: string; itemId: string }): void {
  const def = store.library.device(deviceId);
  const doc = store.state.doc;
  if (!def || !doc) return;
  let tag: Tag | undefined;
  let placed = new Set<number>();
  if (fromItem) {
    const page = doc.state.pages[fromItem.pageId] as SchematicPage;
    const item = page.items.find((i) => i.id === fromItem.itemId);
    if (item) tag = effectiveTag(page, item, store.library);
    const key = doc.devices().byItem.get(fromItem.itemId);
    placed = placedFunctions(def, key ? doc.devices().devices.get(key) : undefined, doc.state);
  }
  const index = def.functions.findIndex((_, i) => !placed.has(i));
  store.set({ tool: { kind: 'device', device: deviceId, index: Math.max(index, 0), rotation: 0, mirror: false, ...(tag ? { tag } : {}) }, selection: { items: [] } });
}

export const StoreContext = createContext<EditorStore | null>(null);

export function useStore(): EditorStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('EditorStore missing');
  return store;
}

/** Subscribes to a slice of the editor state. */
export function useEditor<T>(selector: (state: EditorState) => T): T {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, () => selector(store.state));
}
