import { applyPatches, current, enablePatches, freeze, isDraft, produceWithPatches, type Patch } from 'immer';
import { z } from 'zod';
import { applyCommand, CommandError, type ApplyResult } from './commands/apply.js';
import { commandSchema, type Command } from './commands/schema.js';
import { checkProject } from './check.js';
import { buildConnectivity, type Connectivity } from './connectivity.js';
import { buildCrossReferences, type CrossReferences } from './crossrefs.js';
import { buildCableIndex, buildWireIndex, type CableIndex, type WireIndex } from './cables.js';
import { buildPlcIndex, type PlcIndex } from './plc.js';
import { buildTerminalStrips, type TerminalIndex } from './terminals.js';
import { buildSheets, type ReportContext, type SheetList } from './reports.js';
import { buildDeviceIndex, type DeviceIndex } from './devices.js';
import { issueKey, type Issue } from './issues.js';
import { LayeredLibrary, type Library } from './library.js';
import { checkEngineering } from './engineering.js';
import { checkLayouts } from './layout.js';
import type { ProjectLibrary, ProjectState } from './schema.js';

enablePatches();

interface HistoryEntry {
  label: string;
  patches: Patch[];
  inverse: Patch[];
}

/** Which files changed since the last save. */
export interface ChangeSet {
  project: boolean;
  pages: Set<string>;
  deletedPages: Set<string>;
  /** `library.json` (project-local library). */
  library: boolean;
}

export interface ApplyOptions {
  /** Shown in the undo history; default: the command type(s). */
  label?: string;
}

/**
 * An open project: current state, undo/redo history, change tracking for
 * saving, and cached derived data. All changes go through `apply`.
 */
export class ProjectDocument {
  #state: ProjectState;
  readonly #undo: HistoryEntry[] = [];
  readonly #redo: HistoryEntry[] = [];
  #changes: ChangeSet = emptyChanges();
  #devices?: { state: ProjectState; index: DeviceIndex };
  #connectivity?: { state: ProjectState; value: Connectivity };
  #crossReferences?: { state: ProjectState; value: CrossReferences };
  #check: { state: ProjectState; value: Issue[] } | undefined;
  #sheets?: { state: ProjectState; value: SheetList };
  #plc?: { state: ProjectState; value: PlcIndex };
  #cables?: { state: ProjectState; value: CableIndex };
  #wires?: { state: ProjectState; value: WireIndex };
  #terminals?: { state: ProjectState; value: TerminalIndex };
  #library?: { content: ProjectLibrary | undefined; value: Library };

  /** `baseLibrary`: standard library, plus the shared company library if there is one. */
  constructor(
    state: ProjectState,
    readonly baseLibrary: Library,
  ) {
    // Immutable like every state the document produces (and so cacheable per page).
    this.#state = freeze(state, true);
  }

  /** The base library with the project's own library (`library.json`) on top. */
  get library(): Library {
    const content = this.#state.library;
    if (!this.#library || this.#library.content !== content) this.#library = { content, value: layered(this.baseLibrary, content) };
    return this.#library.value;
  }

  get state(): ProjectState {
    return this.#state;
  }

  /**
   * Applies one command or a batch. A batch is atomic and becomes one undo
   * step: if any command fails, nothing changes and a CommandError is thrown.
   */
  apply(commands: Command | readonly Command[], options: ApplyOptions = {}): ApplyResult {
    const list = (Array.isArray(commands) ? commands : [commands]).map(validateCommand);
    const result: ApplyResult = { created: [], replaced: 0 };
    const [next, patches, inverse] = produceWithPatches(this.#state, (draft) => {
      for (const command of list) {
        // Commands earlier in the batch may have added to the project library.
        const content = isDraft(draft.library) ? (current(draft.library) as ProjectLibrary) : (draft.library as ProjectLibrary | undefined);
        applyCommand(draft, command, { library: layered(this.baseLibrary, content), result });
      }
    });
    if (patches.length === 0) return result;
    this.#state = next;
    this.#undo.push({ label: options.label ?? [...new Set(list.map((c) => c.type))].join(', '), patches, inverse });
    this.#redo.length = 0;
    this.#track(patches);
    return result;
  }

  /**
   * A copy of this document with the commands applied, without changing this
   * document or its history. Used for live previews while dragging or placing.
   */
  preview(commands: Command | readonly Command[]): { doc: ProjectDocument; result: ApplyResult } {
    const doc = new ProjectDocument(this.#state, this.baseLibrary);
    const result = doc.apply(commands);
    return { doc, result };
  }

  /** Number of undo steps (to collect the steps made after a point with `stepsSince`). */
  get historyLength(): number {
    return this.#undo.length;
  }

  /**
   * The changes of the undo steps after `length` as one step: patches in order and the inverse
   * patches in reverse order. Used to hand changes made on a copy to another document.
   */
  stepsSince(length: number): { patches: Patch[]; inverse: Patch[] } {
    const steps = this.#undo.slice(length);
    return { patches: steps.flatMap((s) => s.patches), inverse: steps.reverse().flatMap((s) => s.inverse) };
  }

  /** Applies changes made on a copy of this state (see `stepsSince`) as one undo step. */
  applyStep(label: string, patches: readonly Patch[], inverse: readonly Patch[]): void {
    if (patches.length === 0) return;
    this.#state = applyPatches(this.#state, patches as Patch[]);
    this.#undo.push({ label, patches: [...patches], inverse: [...inverse] });
    this.#redo.length = 0;
    this.#track(patches as Patch[]);
  }

  get canUndo(): boolean {
    return this.#undo.length > 0;
  }

  get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  /** Label of the step `undo()` would revert. */
  get undoLabel(): string | undefined {
    return this.#undo.at(-1)?.label;
  }

  get redoLabel(): string | undefined {
    return this.#redo.at(-1)?.label;
  }

  undo(): boolean {
    const entry = this.#undo.pop();
    if (!entry) return false;
    this.#state = applyPatches(this.#state, entry.inverse);
    this.#redo.push(entry);
    this.#track(entry.inverse);
    return true;
  }

  redo(): boolean {
    const entry = this.#redo.pop();
    if (!entry) return false;
    this.#state = applyPatches(this.#state, entry.patches);
    this.#undo.push(entry);
    this.#track(entry.patches);
    return true;
  }

  /** Devices derived from the current state (cached until the next change). */
  devices(): DeviceIndex {
    if (this.#devices?.state !== this.#state) {
      this.#devices = { state: this.#state, index: buildDeviceIndex(this.#state, this.library) };
    }
    return this.#devices.index;
  }

  /** Autoconnect lines, nets and potentials (cached until the next change). */
  connectivity(): Connectivity {
    if (this.#connectivity?.state !== this.#state) {
      this.#connectivity = { state: this.#state, value: buildConnectivity(this.#state, this.library) };
    }
    return this.#connectivity.value;
  }

  /** Cross-references and contact images (cached until the next change). */
  crossReferences(): CrossReferences {
    if (this.#crossReferences?.state !== this.#state) {
      this.#crossReferences = { state: this.#state, value: buildCrossReferences(this.#state, this.library, this.devices()) };
    }
    return this.#crossReferences.value;
  }

  /** PLC cards, channels, addresses and functions (cached until the next change). */
  plc(): PlcIndex {
    if (this.#plc?.state !== this.#state) {
      this.#plc = { state: this.#state, value: buildPlcIndex(this.#state, this.library, this.devices(), this.connectivity()) };
    }
    return this.#plc.value;
  }

  /** Cables with their core assignments (cached until the next change). */
  cables(): CableIndex {
    if (this.#cables?.state !== this.#state) {
      this.#cables = { state: this.#state, value: buildCableIndex(this.#state, this.library, this.devices(), this.connectivity()) };
    }
    return this.#cables.value;
  }

  /** Wires (conductors) with numbers, colors and cross-sections (cached until the next change). */
  wires(): WireIndex {
    if (this.#wires?.state !== this.#state) {
      this.#wires = { state: this.#state, value: buildWireIndex(this.#state, this.library, this.connectivity(), this.cables()) };
    }
    return this.#wires.value;
  }

  /** Terminal strips with their terminals, bridges and targets (cached until the next change). */
  terminals(): TerminalIndex {
    if (this.#terminals?.state !== this.#state) {
      this.#terminals = { state: this.#state, value: buildTerminalStrips(this.#state, this.library, this.devices(), this.connectivity()) };
    }
    return this.#terminals.value;
  }

  /** Everything reports are generated from. */
  reportContext(): ReportContext {
    return {
      state: this.#state,
      library: this.library,
      devices: this.devices(),
      connectivity: this.connectivity(),
      crossReferences: this.crossReferences(),
      plc: this.plc(),
      cables: this.cables(),
      wires: this.wires(),
      terminals: this.terminals(),
    };
  }

  /** All sheets in page order, with report rows (cached until the next change). */
  sheets(): SheetList {
    if (this.#sheets?.state !== this.#state) {
      this.#sheets = { state: this.#state, value: buildSheets(this.reportContext()) };
    }
    return this.#sheets.value;
  }

  /** All problems of the project (cached per state); acknowledged ones are marked. */
  check(): Issue[] {
    if (this.#check?.state === this.#state) return this.#check.value;
    const issues = checkProject(this.#state, this.library, {
      devices: this.devices(),
      connectivity: this.connectivity(),
      extraIssues: [...this.crossReferences().issues, ...this.plc().issues, ...this.cables().issues, ...this.wires().issues, ...this.terminals().issues, ...this.sheets().issues, ...checkLayouts(this.#state, this.devices()), ...checkEngineering(this.#state, this.library, { devices: this.devices(), connectivity: this.connectivity(), plc: this.plc(), wires: this.wires() })],
    });
    const accepted = new Map((this.#state.project.acknowledged ?? []).map((a) => [a.key, a]));
    const value =
      accepted.size === 0
        ? issues
        : issues.map((issue) => {
            const a = accepted.get(issueKey(issue));
            return a ? { ...issue, acknowledged: { ...(a.note ? { note: a.note } : {}), ...(a.date ? { date: a.date } : {}) } } : issue;
          });
    this.#check = { state: this.#state, value };
    return value;
  }

  get hasChanges(): boolean {
    const c = this.#changes;
    return c.project || c.library || c.pages.size > 0 || c.deletedPages.size > 0;
  }

  /** Returns the changes since the last call and starts tracking anew (call after saving). */
  takeChanges(): ChangeSet {
    const changes = this.#changes;
    this.#changes = emptyChanges();
    return changes;
  }

  #track(patches: readonly Patch[]): void {
    for (const { op, path } of patches) {
      if (path[0] === 'project') {
        this.#changes.project = true;
      } else if (path[0] === 'library') {
        this.#changes.library = true;
      } else if (path[0] === 'pages' && path.length >= 2) {
        const id = String(path[1]);
        if (path.length === 2 && op === 'remove') {
          this.#changes.pages.delete(id);
          this.#changes.deletedPages.add(id);
        } else {
          this.#changes.pages.add(id);
          this.#changes.deletedPages.delete(id);
        }
      }
    }
  }
}

function emptyChanges(): ChangeSet {
  return { project: false, pages: new Set(), deletedPages: new Set(), library: false };
}

function validateCommand(command: unknown): Command {
  const result = commandSchema.safeParse(command);
  if (!result.success) throw new CommandError(`Invalid command:\n${z.prettifyError(result.error)}`);
  return result.data;
}

/**
 * The same library object for the same base and project library content, so documents of the same
 * state (previews while dragging) share the per-page caches keyed by library.
 */
const layeredCache = new WeakMap<Library, WeakMap<ProjectLibrary, Library>>();

function layered(base: Library, content: ProjectLibrary | undefined): Library {
  if (!content) return base;
  let byContent = layeredCache.get(base);
  if (!byContent) layeredCache.set(base, (byContent = new WeakMap()));
  let library = byContent.get(content);
  if (!library) byContent.set(content, (library = new LayeredLibrary(base, content)));
  return library;
}
