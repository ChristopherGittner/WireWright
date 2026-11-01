import { addRotation, ARCHIVE_EXTENSION, openIssues, functionLabel, localize, MapLibrary, pagePosition, placedFunctions, projectArchive, type GridSize, type Item } from '@wirewright/core';
import { standardLibraryContent } from '@wirewright/library';
import { useEffect, useState, type ReactNode } from 'react';
import { Canvas } from './canvas/Canvas.js';
import { Dialogs } from './dialogs/Dialogs.js';
import { usePaletteAction } from './dialogs/CommandPalette.js';
import { exportCsv } from './exports.js';
import { Icon, type IconName } from './icons.js';
import { PanelWindow } from './panelWindow.js';
import { defaultField } from './editing.js';
import { DevicesPanel, IssuesPanel, PagesPanel, PlcPanel, SymbolsPanel } from './panels/Panels.js';
import type { RecentProject } from './host.js';
import { startDeviceTool, startStyleBrush, useEditor, useStore, type EditorStore } from './store.js';
import { tr, trKeys } from './i18n.js';

type Tab = 'pages' | 'devices' | 'symbols' | 'plc' | 'issues';

const TAB_NAMES: Record<Tab, string> = { pages: 'Pages', devices: 'Devices', symbols: 'Symbols', plc: 'PLC', issues: 'Issues' };

function TabPanel({ tab }: { tab: Tab }) {
  switch (tab) {
    case 'pages':
      return <PagesPanel />;
    case 'devices':
      return <DevicesPanel />;
    case 'symbols':
      return <SymbolsPanel />;
    case 'plc':
      return <PlcPanel />;
    case 'issues':
      return <IssuesPanel />;
  }
}

const ALL_TABS: readonly Tab[] = ['pages', 'devices', 'symbols', 'plc', 'issues'];
const TAB_ICONS: Record<Tab, IconName> = { pages: 'tabPages', devices: 'tabDevices', symbols: 'tabSymbols', plc: 'tabPlc', issues: 'tabIssues' };
const TABS_STORAGE_KEY = 'wirewright.openTabs';

/** Which side panel tabs are open (remembered in this browser), which is shown and which are detached. */
export interface TabState {
  open: Tab[];
  active: Tab;
  detached: Tab[];
  /** Opens a tab (if closed) and shows it. */
  show: (t: Tab) => void;
  /** Toolbar: opens a closed tab, closes an open one. */
  toggle: (t: Tab) => void;
  close: (t: Tab) => void;
  detach: (t: Tab) => void;
  dock: (t: Tab) => void;
}

function useTabs(): TabState {
  const [open, setOpen] = useState<Tab[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(TABS_STORAGE_KEY) ?? 'null') as Tab[] | null;
      if (Array.isArray(saved)) return ALL_TABS.filter((t) => saved.includes(t));
    } catch {
      // storage unavailable: all tabs
    }
    return [...ALL_TABS];
  });
  const [active, setActive] = useState<Tab>(() => open[0] ?? 'pages');
  const [detached, setDetached] = useState<Tab[]>([]);
  const save = (next: Tab[]) => {
    setOpen(next);
    try {
      localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // not remembered
    }
  };
  const show = (t: Tab) => {
    if (!open.includes(t)) save(ALL_TABS.filter((x) => x === t || open.includes(x)));
    setActive(t);
  };
  const close = (t: Tab) => {
    const next = open.filter((x) => x !== t);
    save(next);
    setDetached((current) => current.filter((x) => x !== t));
    if (active === t) setActive(next.find((x) => !detached.includes(x)) ?? next[0] ?? 'pages');
  };
  return {
    open,
    active,
    detached,
    show,
    toggle: (t) => (open.includes(t) ? close(t) : show(t)),
    close,
    detach: (t) => setDetached((current) => (current.includes(t) ? current : [...current, t])),
    dock: (t) => setDetached((current) => current.filter((x) => x !== t)),
  };
}

export function App() {
  const store = useStore();
  const doc = useEditor((s) => s.doc);
  // Machine settings hold the UI language: render everything again when they change.
  useEditor((s) => s.machine);
  const tabs = useTabs();
  useKeyboard(store, tabs.show);

  if (!doc) return <Welcome />;
  const { open, active: tab, detached } = tabs;
  // Tabs in the side panel: open and not in their own window. Without any, the panel is hidden.
  const docked = open.filter((t) => !detached.includes(t));
  const shown = docked.includes(tab) ? tab : docked[0];

  return (
    <div className="app">
      <Toolbar tabs={tabs} />
      <div className={docked.length > 0 ? 'main' : 'main no-sidebar'}>
        {docked.length > 0 && shown && (
          <aside className="sidebar">
            <nav className="sidebar-tabs">
              {docked.map((t) => (
                <span key={t} className={t === shown ? 'sidebar-tab active' : 'sidebar-tab'}>
                  <button className="tab-name" onClick={() => tabs.show(t)}>
                    {t === 'issues' ? <IssuesLabel /> : tr(TAB_NAMES[t])}
                  </button>
                  <button className="tab-close" onClick={() => tabs.close(t)} title={tr('Close {name} (reopen it from the toolbar)', { name: tr(TAB_NAMES[t]) })} aria-label={tr('Close {name}', { name: tr(TAB_NAMES[t]) })}>
                    <Icon name="close" />
                  </button>
                </span>
              ))}
              <button
                className="pop-out"
                title={tr('Open "{name}" in its own window', { name: tr(TAB_NAMES[shown]) })}
                aria-label={tr('Open "{name}" in its own window', { name: tr(TAB_NAMES[shown]) })}
                onClick={() => tabs.detach(shown)}
              >
                <Icon name="popOut" />
              </button>
            </nav>
            <TabPanel tab={shown} />
          </aside>
        )}
        {detached.map((t) => (
          <PanelWindow key={t} store={store} name={t} title={tr(TAB_NAMES[t])} onClose={() => tabs.dock(t)}>
            <TabPanel tab={t} />
          </PanelWindow>
        ))}
        <Canvas />
      </div>
      <StatusBar />
      <Dialogs />
    </div>
  );
}

function Welcome() {
  const store = useStore();
  const { host } = store;
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const reload = () => void host.recentProjects?.().then(setRecent);
  useEffect(reload, [host]);
  const open = async (path: string) => {
    const project = await host.openRecent?.(path);
    if (project) await store.open(project);
    else reload();
  };
  const forget = async (path: string) => {
    await host.forgetRecent?.(path);
    reload();
  };
  return (
    <div className="welcome">
      <img className="welcome-icon" src="./favicon.svg" alt="" width={96} height={96} />
      <h1>{tr('Wirewright')}</h1>
      <p>{tr('Free electrical plans')}</p>
      <div className="welcome-buttons">
        <button onClick={() => void host.openProject().then((p) => p && store.open(p))}>{tr('Open project folder…')}</button>
        <button onClick={() => void host.newProject().then((p) => p && store.open(p))}>{tr('New project…')}</button>
        {host.openArchive && <button onClick={() => void host.openArchive!().then((p) => p && store.open(p))}>{tr('Open archive…')}</button>}
        <button onClick={() => store.set({ dialog: { kind: 'machine' } })}>
          <Icon name="machine" /> {tr('Machine settings…')}
        </button>
      </div>
      {recent.length > 0 && (
        <section className="recent">
          <h4>{tr('Recent projects')}</h4>
          <ul>
            {recent.map((r) => (
              <li key={r.path} className={r.missing ? 'missing' : undefined}>
                <button className="recent-open" onClick={() => void open(r.path)} disabled={r.missing} title={r.missing ? tr('Folder not found') : tr('Open {path}', { path: r.path })}>
                  <span className="name">{r.name ?? r.folder}</span>
                  <span className="path">{r.path}</span>
                  <span className="date">{r.missing ? 'not found' : new Date(r.openedAt).toLocaleDateString()}</span>
                </button>
                <button className="recent-forget" onClick={() => void forget(r.path)} title={tr('Remove from the list (the folder stays)')} aria-label={tr('Remove from the list')}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Dialogs />
    </div>
  );
}

/** A group of toolbar buttons with a small caption below. */
function ToolSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="tool-section" role="group" aria-label={label}>
      <div className="tool-buttons">{children}</div>
      <span className="tool-section-label">{label}</span>
    </div>
  );
}

/** An icon-only toolbar button; the name (and shortcut) is its tooltip. */
function ToolButton(props: { icon: IconName; label: string; shortcut?: string; disabled?: boolean; pressed?: boolean; onClick: () => void }) {
  usePaletteAction({ label: props.label, ...(props.shortcut ? { shortcut: props.shortcut } : {}), ...(props.disabled ? { disabled: true } : {}), run: props.onClick });
  return (
    <button
      type="button"
      className={props.pressed ? 'tool on' : 'tool'}
      title={props.shortcut ? `${props.label} (${trKeys(props.shortcut)})` : props.label}
      aria-label={props.label}
      {...(props.pressed !== undefined ? { 'aria-pressed': props.pressed } : {})}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Icon name={props.icon} />
    </button>
  );
}

function IssuesLabel() {
  const doc = useEditor((s) => s.doc);
  useEditor((s) => s.version);
  const issues = openIssues(doc?.check() ?? []);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  return (
    <>
      {tr('Issues')}
      {errors > 0 && <span className="count error">{errors}</span>}
      {warnings > 0 && <span className="count warning">{warnings}</span>}
    </>
  );
}

function Toolbar({ tabs }: { tabs: TabState }) {
  const compare = useEditor((s) => s.compare);
  const store = useStore();
  const doc = useEditor((s) => s.doc)!;
  useEditor((s) => s.version);
  const grid = useEditor((s) => s.grid);
  const showLinks = useEditor((s) => s.showLinks);
  const language = useEditor((s) => s.language);
  const dirty = useEditor((s) => s.dirty);
  const sheet = useEditor((s) => s.sheet);
  const selected = useEditor((s) => s.selection.items.length);
  const tool = useEditor((s) => s.tool);
  const project = useEditor((s) => s.project);
  const page = sheet ? doc.state.pages[sheet.pageId] : undefined;
  const { host } = store;

  return (
    <header className="toolbar">
      <span className="logo">
        <img src="./favicon.svg" alt="" width={22} height={22} />
        {tr('Wirewright')}
      </span>
      <span className="project-name" title={project?.name}>
        {doc.state.project.name}
        {dirty ? ' •' : ''}
      </span>
      <ToolSection label={tr('File')}>
        <ToolButton icon="newProject" label={tr('New project')} onClick={() => void host.newProject().then((p) => p && store.open(p))} />
        <ToolButton icon="open" label={tr('Open project folder')} shortcut="Ctrl+O" onClick={() => void host.openProject().then((p) => p && store.open(p))} />
        <ToolButton icon="save" label={tr('Save')} shortcut="Ctrl+S" disabled={!dirty} onClick={() => void store.save()} />
        <ToolButton icon="archive" label={tr('Save as archive: the whole project in one file (.wirewright.zip)')} onClick={() => void saveArchive(store)} />
        {host.openArchive && <ToolButton icon="unarchive" label={tr('Open a project archive (.wirewright.zip)')} onClick={() => void host.openArchive!().then((p) => p && store.open(p))} />}
      </ToolSection>
      <ToolSection label={tr('Edit')}>
        <ToolButton icon="undo" label={doc.undoLabel ? `${tr('Undo')}: ${tr(doc.undoLabel)}` : tr('Undo')} shortcut="Ctrl+Z" disabled={!doc.canUndo} onClick={() => store.undo()} />
        <ToolButton icon="redo" label={doc.redoLabel ? `${tr('Redo')}: ${tr(doc.redoLabel)}` : tr('Redo')} shortcut="Ctrl+Y" disabled={!doc.canRedo} onClick={() => store.redo()} />
        <ToolButton
          icon="brush"
          label={tr('Style brush: copy the text layout (positions, angles, arrangement) of the selected symbol to others; click them, Esc ends')}
          shortcut="Ctrl+Shift+C"
          pressed={tool.kind === 'brush'}
          disabled={tool.kind !== 'brush' && selected !== 1}
          onClick={() => (tool.kind === 'brush' ? store.set({ tool: { kind: 'select' } }) : startStyleBrush(store))}
        />
        <ToolButton icon="find" label={tr('Find and replace')} shortcut="Ctrl+H" onClick={() => store.set({ dialog: { kind: 'find' } })} />
        <ToolButton icon="renumber" label={tr('Renumber devices by page and column')} onClick={() => store.set({ dialog: { kind: 'renumber' } })} />
      </ToolSection>
      <ToolSection label={tr('View')}>
        <label className="tool-select" title={tr('Snap grid (G)')}>
          <Icon name="grid" />
          <select aria-label={tr('Snap grid')} value={grid} onChange={(e) => store.set({ grid: Number(e.target.value) as GridSize })}>
            {[1, 2, 4, 8].map((g) => (
              <option key={g} value={g}>
                {g} {tr('mm')}
              </option>
            ))}
          </select>
        </label>
        <ToolButton icon="links" label={tr('Show pin links')} shortcut="L" pressed={showLinks} onClick={() => store.set({ showLinks: !showLinks })} />
        <label className="tool-select" title={tr('Display language')}>
          <Icon name="language" />
          <select aria-label={tr('Display language')} value={language} onChange={(e) => store.set({ language: e.target.value })}>
            {doc.state.project.settings.languages.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
      </ToolSection>
      <ToolSection label={tr('Project')}>
        <ToolButton icon="wires" label={tr('Wires: numbering and wire list')} onClick={() => store.set({ dialog: { kind: 'wires' } })} />
        <ToolButton icon="terminals" label={tr('Terminal strips: designations, bridges, targets')} onClick={() => store.set({ dialog: { kind: 'terminals' } })} />
        <ToolButton icon="plc" label={tr('PLC: addresses and exports (I/O list, TIA, Codesys, GX Works3)')} onClick={() => store.set({ dialog: { kind: 'plc' } })} />
        <ToolButton icon="library" label={tr('Device library')} onClick={() => store.set({ dialog: { kind: 'library' } })} />
        <ToolButton icon="parts" label={tr('Parts database: descriptions, prices, suppliers, ERP numbers')} onClick={() => store.set({ dialog: { kind: 'parts' } })} />
        <ToolButton icon="revisions" label={tr('Revisions: release, compare (changes highlighted)')} pressed={compare !== null} onClick={() => store.set({ dialog: { kind: 'revisions' } })} />
        <ToolButton icon="saveMacro" label={tr('Save selection as macro')} disabled={selected === 0} onClick={() => store.set({ dialog: { kind: 'saveMacro' } })} />
        <ToolButton icon="translations" label={tr('Translations: all texts in all languages, CSV/ODS export and import')} onClick={() => store.set({ dialog: { kind: 'translations' } })} />
        <ToolButton icon="settings" label={tr('Project settings, potentials and PLCs')} onClick={() => store.set({ dialog: { kind: 'project' } })} />
        <ToolButton icon="machine" label={tr('Machine settings: defaults of this computer for new projects')} onClick={() => store.set({ dialog: { kind: 'machine' } })} />
      </ToolSection>
      <ToolSection label={tr('Output')}>
        {host.exportPdf ? (
          <ToolButton icon="pdf" label={tr('Export as PDF (pages, black and white, location)')} onClick={() => store.set({ dialog: { kind: 'export', mode: 'pdf' } })} />
        ) : (
          <ToolButton icon="svg" label={tr('Export pages as SVG')} onClick={() => store.set({ dialog: { kind: 'export', mode: 'svg' } })} />
        )}
        <ToolButton icon="csv" label={tr('Export this report as CSV')} disabled={page?.type !== 'report'} onClick={() => page?.type === 'report' && exportCsv(store, page)} />
        {host.print && <ToolButton icon="print" label={tr('Print (pages, black and white)')} onClick={() => store.set({ dialog: { kind: 'export', mode: 'print' } })} />}
      </ToolSection>
      <ToolSection label={tr('Panels')}>
        {ALL_TABS.map((t) => (
          <ToolButton
            key={t}
            icon={TAB_ICONS[t]}
            label={tr(tabs.detached.includes(t) ? '{name} panel (own window)' : '{name} panel', { name: tr(TAB_NAMES[t]) })}
            pressed={tabs.open.includes(t)}
            onClick={() => tabs.toggle(t)}
          />
        ))}
      </ToolSection>
      <ToolSection label={tr('Help')}>
        <ToolButton icon="shortcuts" label={tr('Keyboard shortcuts')} shortcut="? or F1" onClick={() => store.set({ dialog: { kind: 'shortcuts' } })} />
      </ToolSection>
    </header>
  );
}

function StatusBar() {
  const store = useStore();
  const doc = useEditor((s) => s.doc)!;
  const cursor = useEditor((s) => s.cursor);
  const grid = useEditor((s) => s.grid);
  const tool = useEditor((s) => s.tool);
  const message = useEditor((s) => s.message);
  const sheet = useEditor((s) => s.sheet);
  const selection = useEditor((s) => s.selection);
  const language = useEditor((s) => s.language);
  const page = sheet ? doc.state.pages[sheet.pageId] : undefined;
  const position = page && cursor ? pagePosition(page, cursor, doc.state.project.settings, store.library) : undefined;
  const toolText =
    tool.kind === 'place'
      ? tr('Placing {name} – click to place, R rotate, M mirror, Esc to stop', { name: localize(store.library.symbol(tool.symbol)?.name, language, ['en']) })
      : tool.kind === 'box'
        ? tr('Drag a rectangle for the box – Esc to cancel')
        : tool.kind === 'cable'
          ? tr('Drag a line across the conductors of the cable – Esc to cancel')
        : tool.kind === 'device'
          ? deviceToolText(store, tool.device, tool.index, language)
        : tool.kind === 'brush'
          ? tr('Style brush from {from} – click symbols (or drag a band) to give them its text layout; also on other pages; Esc ends', { from: tool.from })
        : tool.kind === 'paste'
          ? tr('Pasting {count} item(s) – click to place; X: same x as the original{x}, Y: same y{y}; Esc cancels', { count: tool.items.length, x: tool.lockX ? tr(' (on)') : '', y: tool.lockY ? tr(' (on)') : '' })
          : selection.items.length > 0
          ? tr('{count} selected – F2 edit, R rotate, M mirror, Del delete, double-click for properties', { count: selection.items.length })
          : tr('Ready');
  return (
    <footer className="statusbar">
      <span>{toolText}</span>
      {message && <span className={message.error ? 'message error' : 'message'}>{message.text}</span>}
      <span className="spacer" />
      {cursor && (
        <span>
          x {cursor.x} y {cursor.y} {tr('mm')}{position ? ` · column ${position.column}${position.row}` : ''}
        </span>
      )}
      <span>{tr('grid')} {grid} {tr('mm')}</span>
    </footer>
  );
}

function deviceToolText(store: EditorStore, deviceId: string, index: number, language: string): string {
  const def = store.library.device(deviceId);
  const doc = store.state.doc;
  if (!def || !doc) return '';
  const tool = store.state.tool;
  const tag = tool.kind === 'device' ? tool.tag : undefined;
  let placed = new Set<number>();
  if (tag?.product) {
    const key = [...doc.devices().devices.values()].find((d) => d.tag.product === tag.product && d.tag.function === tag.function && d.tag.location === tag.location);
    placed = placedFunctions(def, key, doc.state);
  }
  const name = localize(def.name, language, ['en']);
  const fn = functionLabel(def, index, store.library, language);
  return `${name}: ${fn} (${index + 1}/${def.functions.length}${placed.has(index) ? ', already placed' : ''}) – Tab next function, click to place, R rotate, Esc stop`;
}

// ---------------------------------------------------------------------------
// Keyboard

const CORNERS = ['wirewright.connection.corner.right-down', 'wirewright.connection.corner.down-left', 'wirewright.connection.corner.left-up', 'wirewright.connection.corner.up-right'] as const;
const TEES = ['wirewright.connection.tee.right-down-left', 'wirewright.connection.tee.down-left-up', 'wirewright.connection.tee.left-up-right', 'wirewright.connection.tee.up-right-down'] as const;

function useKeyboard(store: EditorStore, setTab: (t: Tab) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = store.state;
      if (!s.doc || s.dialog || s.inlineEdit) return;
      const target = e.target as HTMLElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const page = store.currentPage();
      const key = e.key.toLowerCase();

      if (ctrl && key === 's') return void (e.preventDefault(), store.save());
      if (ctrl && key === 'o') return void (e.preventDefault(), store.host.openProject().then((p) => p && store.open(p)));
      if (ctrl && key === 'z' && !e.shiftKey) return void (e.preventDefault(), store.undo());
      if ((ctrl && key === 'y') || (ctrl && e.shiftKey && key === 'z')) return void (e.preventDefault(), store.redo());
      if (ctrl && key === 'h') return void (e.preventDefault(), store.set({ dialog: { kind: 'find' } }));
      if (ctrl && e.shiftKey && key === 'c') return void (e.preventDefault(), startStyleBrush(store));
      if (ctrl && key === 'k') return void (e.preventDefault(), store.set({ dialog: { kind: 'palette' } }));
      if (ctrl && key === 'c') return store.copy();
      if (ctrl && key === 'x') return store.cut();
      if (ctrl && key === 'v') return store.paste();
      if (ctrl && key === 'a' && page) return void (e.preventDefault(), store.select({ items: page.items.map((i) => i.id) }));
      if (ctrl) return;

      if (e.key === 'PageDown') return void (e.preventDefault(), store.step(1));
      if (e.key === 'PageUp') return void (e.preventDefault(), store.step(-1));
      if (e.key === 'Escape') return store.set({ tool: { kind: 'select' }, selection: { items: [] } });
      if (key === 'g') return store.set({ grid: ({ 1: 2, 2: 4, 4: 8, 8: 1 } as const)[s.grid] });
      if (key === 'l') return store.set({ showLinks: !s.showLinks });
      if (e.key === '?' || e.key === 'F1') return void (e.preventDefault(), store.set({ dialog: { kind: 'shortcuts' } }));
      // F5 corner, F6 T-junction, F7 interruption point: placing; pressing again turns the junction.
      const junctions: Record<string, readonly string[]> = { F5: CORNERS, F6: TEES, F7: ['wirewright.connection.interruption'] };
      if (junctions[e.key]) {
        e.preventDefault();
        const list = junctions[e.key]!;
        const current = s.tool.kind === 'place' ? list.indexOf(s.tool.symbol) : -1;
        const symbol = list[(current + 1) % list.length]!;
        return store.set({ tool: { kind: 'place', symbol, rotation: 0, mirror: false } });
      }
      if (e.key === 'Insert') {
        setTab('symbols');
        setTimeout(() => document.getElementById('symbol-search')?.focus(), 0);
        return;
      }
      if (s.tool.kind === 'paste' && (key === 'x' || key === 'y')) {
        // Keep the pasted copy at the original's horizontal (X) or vertical (Y) position.
        const lock = key === 'x' ? { lockX: !s.tool.lockX } : { lockY: !s.tool.lockY };
        return store.set({ tool: { ...s.tool, ...lock } });
      }
      if (s.tool.kind === 'place' || s.tool.kind === 'device') {
        if (key === 'r') return store.set({ tool: { ...s.tool, rotation: addRotation(s.tool.rotation, 90) } });
        if (key === 'm') return store.set({ tool: { ...s.tool, mirror: !s.tool.mirror } });
      }
      if (e.key === 'Tab' && s.tool.kind === 'device') {
        // Next (Shift: previous) function of the device being placed.
        e.preventDefault();
        const def = store.library.device(s.tool.device);
        if (!def) return;
        const count = def.functions.length;
        return store.set({ tool: { ...s.tool, index: (s.tool.index + (e.shiftKey ? count - 1 : 1)) % count } });
      }
      if (e.key === 'Tab' && page && s.selection.items.length === 1) {
        // Continue placing the functions of the selected device.
        e.preventDefault();
        const itemId = s.selection.items[0]!;
        const key = s.doc.devices().byItem.get(itemId);
        const main = key ? s.doc.devices().devices.get(key)?.main : undefined;
        const mainItem = main ? (s.doc.state.pages[main.pageId] as { items: Item[] }).items.find((i) => i.id === main.itemId) : undefined;
        const deviceId = mainItem?.props?.device ?? page.items.find((i) => i.id === itemId)?.props?.device;
        if (deviceId) startDeviceTool(store, deviceId, { pageId: page.id, itemId });
        else store.notify('This device was not placed from the device library', true);
        return;
      }
      if (!page || s.selection.items.length === 0) return;
      if (key === 'f') return store.follow();
      if (key === 'r' && s.selection.text) {
        // A selected text (Ctrl+click) turns on its own: 90° → 270° → back to its default, against the sheet.
        const { itemId, field } = s.selection.text;
        const current = page.items.find((i) => i.id === itemId)?.texts?.[field]?.angle;
        const next = current === 90 ? 270 : current === 270 ? null : 90;
        return void store.apply({ type: 'setItemTextStyle', pageId: page.id, itemId, field, angle: next }, 'rotate text');
      }
      if (key === 'r') return void store.apply({ type: 'rotateItems', pageId: page.id, itemIds: s.selection.items, rotation: 90 }, 'rotate');
      if (key === 'm') return void store.apply({ type: 'mirrorItems', pageId: page.id, itemIds: s.selection.items }, 'mirror');
      if (e.key === 'Delete' || e.key === 'Backspace') return void store.apply({ type: 'deleteItems', pageId: page.id, itemIds: s.selection.items }, 'delete');
      if (e.key === 'F2') {
        e.preventDefault();
        const text = s.selection.text;
        if (text) return store.set({ inlineEdit: text });
        const item = page.items.find((i) => i.id === s.selection.items[0]);
        // Free text is edited in its dialog (several lines, style).
        if (item && store.library.symbol(item.symbol)?.function === 'text') return store.set({ dialog: { kind: 'item', pageId: page.id, itemIds: [item.id] } });
        const field = item && defaultField(item, store.library);
        if (item && field) store.set({ inlineEdit: { itemId: item.id, field }, selection: { items: [item.id], text: { itemId: item.id, field } } });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, setTab]);
}

/** The whole project as one file (archive), saved where the user chooses. */
async function saveArchive(store: EditorStore): Promise<void> {
  const doc = store.state.doc;
  if (!doc) return;
  try {
    const bytes = await projectArchive(doc.state, doc.library, new MapLibrary(standardLibraryContent()));
    const name = (doc.state.project.name || 'project').replace(/[^\p{L}\p{N}._-]+/gu, '_');
    await store.host.saveFile(`${name}${ARCHIVE_EXTENSION}`, bytes, 'application/zip');
  } catch (error) {
    store.notify(tr('Saving the archive failed: {error}', { error: (error as Error).message }), true);
  }
}
