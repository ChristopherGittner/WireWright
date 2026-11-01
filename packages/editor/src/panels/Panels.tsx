import { placeSymbolTool, usePaletteAction } from '../dialogs/CommandPalette.js';
import {
  issueKey,
  type Issue,
  formatReference,
  localize,
  naturalCompare,
  pageFullName,
  pagePosition,
  type Graphic,
  type Page,
  type DeviceDefinition,
  type ProjectState,
  type Sheet,
  type StructureEntry,
  sameStructureGroup,
  type PlcCardInfo,
  type SchematicPage,
  channelLabel,
  type MacroDefinition,
  type SymbolDefinition,
} from '@wirewright/core';
import { arcPath } from '@wirewright/render';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../icons.js';
import { PLC_DRAG_TYPE, startDeviceTool, SYMBOL_DRAG_TYPE, useEditor, useStore, type PlcDragPayload, type SymbolDragPayload } from '../store.js';
import { issueText, tr } from '../i18n.js';

const PAGE_TREE_KEY = 'wirewright.pageTree';

interface PageTreeFunction {
  code?: string;
  locations: { code?: string; sheets: Sheet[] }[];
}

/** Sheets grouped by function, then location, in page order (pages without a function/location at their level). */
/** Pages being dragged in the page tree (the drag data cannot be read while dragging over). */
let draggedPages: string[] = [];
const PAGE_DRAG_TYPE = 'application/x-wirewright-pages';

function pageTree(sheets: readonly Sheet[], state: ProjectState): PageTreeFunction[] {
  const functions: PageTreeFunction[] = [];
  for (const sheet of sheets) {
    const structure = state.pages[sheet.pageId]?.structure;
    let fn = functions.find((f) => f.code === structure?.function);
    if (!fn) functions.push((fn = { ...(structure?.function !== undefined ? { code: structure.function } : {}), locations: [] }));
    let loc = fn.locations.find((l) => l.code === structure?.location);
    if (!loc) fn.locations.push((loc = { ...(structure?.location !== undefined ? { code: structure.location } : {}), sheets: [] }));
    loc.sheets.push(sheet);
  }
  return functions;
}

/** The description of a function/location code from the project structures. */
function structureDescription(list: readonly StructureEntry[] | undefined, code: string, language: string, languages: string[]): string {
  return localize(list?.find((e) => e.code === code)?.description, language, languages);
}

/**
 * Hides the browser's drag image: the canvas draws the real symbol under the mouse, and the
 * tile's picture would cover it. The empty element must be in the document while the drag starts.
 */
function hideDragImage(e: React.DragEvent) {
  const blank = document.createElement('div');
  blank.style.cssText = 'position:fixed;top:-10px;left:-10px;width:1px;height:1px;opacity:0';
  document.body.appendChild(blank);
  e.dataTransfer.setDragImage(blank, 0, 0);
  setTimeout(() => blank.remove(), 0);
}

/**
 * A clickable and draggable tile (symbols, macros). Not a <button>: Chromium does not start a
 * drag from a button with a real mouse, so it is an element with the button role instead.
 */
function DragTile(props: { className: string; title: string; onClick: () => void; onDragStart: (e: React.DragEvent) => void; onDragEnd: () => void; children: ReactNode }) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={`drag-tile ${props.className}`}
      title={props.title}
      draggable
      onClick={props.onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          props.onClick();
        }
      }}
      onDragStart={props.onDragStart}
      onDragEnd={props.onDragEnd}
    >
      {props.children}
    </div>
  );
}

/** An icon button of a side panel; the label is its tooltip. */
function PanelButton(props: { icon: IconName; label: string; onClick: () => void; disabled?: boolean; className?: string }) {
  usePaletteAction({ label: props.label, ...(props.disabled ? { disabled: true } : {}), run: props.onClick });
  return (
    <button className={props.className ?? 'panel-icon'} title={props.label} aria-label={props.label} disabled={props.disabled} onClick={props.onClick}>
      <Icon name={props.icon} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Pages

export function PagesPanel() {
  const store = useStore();
  const doc = useEditor((s) => s.doc);
  useEditor((s) => s.version);
  const current = useEditor((s) => s.sheet);
  const language = useEditor((s) => s.language);
  const pageSelection = useEditor((s) => s.pageSelection);
  const [renaming, setRenaming] = useState<{ pageId: string; value: string } | null>(null);
  /** Drop target while pages are dragged in the tree (row or node key). */
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(PAGE_TREE_KEY) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  if (!doc) return null;
  const { state } = doc;
  const sheets = doc.sheets().sheets;

  const currentIndex = current ? state.project.pages.indexOf(current.pageId) : -1;
  // With project structures, pages stay sorted by structure: they move only within their group.
  const neighbourBlocked = (delta: number) => {
    if (!state.project.structures || currentIndex < 0) return false;
    const other = state.pages[state.project.pages[currentIndex + delta] ?? ''];
    return other !== undefined && !sameStructureGroup(state.pages[state.project.pages[currentIndex]!], other);
  };
  const upBlocked = neighbourBlocked(-1);
  const downBlocked = neighbourBlocked(1);
  const selectedPages = new Set(pageSelection);
  /** Click: open the page; Ctrl+click: add/remove; Shift+click: range from the current page. */
  const clickPage = (e: React.MouseEvent, pageId: string, sheet: number) => {
    if (e.ctrlKey || e.metaKey) {
      const base = selectedPages.size > 0 ? selectedPages : new Set(current ? [current.pageId] : []);
      const next = new Set(base);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return store.set({ pageSelection: state.project.pages.filter((id) => next.has(id)) });
    }
    if (e.shiftKey && current) {
      const [a, b] = [state.project.pages.indexOf(current.pageId), state.project.pages.indexOf(pageId)].sort((x, y) => x - y);
      return store.set({ pageSelection: state.project.pages.slice(a!, b! + 1) });
    }
    store.navigate(pageId, sheet);
    store.set({ pageSelection: [] });
  };
  const currentPage = current ? state.pages[current.pageId] : undefined;

  const addPage = () => {
    const numbers = Object.values(state.pages).map((p) => Number.parseInt(p.name, 10)).filter((n) => !Number.isNaN(n));
    const name = String(Math.max(0, ...numbers) + 1);
    const structure = currentPage?.type === 'schematic' ? currentPage.structure : undefined;
    const result = store.apply({ type: 'createPage', name, ...(structure ? { structure } : {}), index: currentIndex + 1 }, 'new page');
    if (result) store.navigate(result.created[0]!);
  };
  const move = (delta: number) => current && store.apply({ type: 'movePage', pageId: current.pageId, index: Math.max(0, currentIndex + delta) }, 'move page');
  const remove = () => {
    if (!current || !currentPage) return;
    if (!confirm(`Delete page ${pageFullName(currentPage)}?`)) return;
    store.apply({ type: 'deletePage', pageId: current.pageId }, 'delete page');
    const next = state.project.pages.filter((id) => id !== current.pageId)[Math.max(0, currentIndex - 1)];
    store.set({ sheet: next ? { pageId: next, sheet: 0 } : null });
  };
  // Tree: function → location → pages. Collapsed nodes are remembered in this browser.
  const toggleNode = (key: string) => {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setCollapsed(next);
    try {
      localStorage.setItem(PAGE_TREE_KEY, JSON.stringify([...next]));
    } catch {
      // not remembered
    }
  };
  // Changes since a compared revision (Revisions dialog).
  const compare = useEditor((s) => s.compare);
  const changes = compare ? store.changes() : null;
  // Drag and drop of pages onto another page (before it, taking its structure) or onto a
  // function/location node (into that group).
  const dragStart = (e: React.DragEvent, pageId: string) => {
    draggedPages = selectedPages.has(pageId) ? [...selectedPages] : [pageId];
    e.dataTransfer.setData(PAGE_DRAG_TYPE, draggedPages.join(','));
    e.dataTransfer.effectAllowed = 'move';
  };
  const dropZone = (key: string, target: () => { structure: { function?: string | null; location?: string | null }; before?: string }) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!draggedPages.length || !e.dataTransfer.types.includes(PAGE_DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dropTarget !== key) setDropTarget(key);
    },
    onDragLeave: () => setDropTarget((t) => (t === key ? null : t)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDropTarget(null);
      const pageIds = draggedPages;
      draggedPages = [];
      if (pageIds.length === 0) return;
      const { structure, before } = target();
      store.apply({ type: 'movePages', pageIds, structure, ...(before && !pageIds.includes(before) ? { before } : {}) }, 'move pages');
    },
  });
  const dragEnd = () => {
    draggedPages = [];
    setDropTarget(null);
  };
  /** A page (sheet) in the tree: its short name; the full name is the tooltip. */
  const pageRow = (sheet: Sheet, depth: number) => {
    const page = state.pages[sheet.pageId]!;
    const active = current?.pageId === sheet.pageId && current.sheet === sheet.sheet;
    return (
      <li
        key={`${sheet.pageId}:${sheet.sheet}`}
        className={[`page-row depth-${depth}`, active ? 'active' : '', selectedPages.has(sheet.pageId) ? 'selected' : '', dropTarget === `p:${sheet.pageId}` ? 'drop-before' : ''].join(' ').trim()}
        draggable={renaming?.pageId !== sheet.pageId}
        onDragStart={(e) => dragStart(e, sheet.pageId)}
        onDragEnd={dragEnd}
        {...dropZone(`p:${sheet.pageId}`, () => ({ structure: { function: page.structure?.function ?? null, location: page.structure?.location ?? null }, before: sheet.pageId }))}
        title={sheet.fullName}
        onClick={(e) => clickPage(e, sheet.pageId, sheet.sheet)}
        onDoubleClick={() => store.set({ dialog: { kind: 'page', pageId: sheet.pageId } })}
      >
        <span className={`badge ${page.type}`}>{page.type === 'report' ? 'R' : page.type === 'layout' ? 'L' : 'S'}</span>
        {renaming?.pageId === sheet.pageId && sheet.sheet === 0 ? (
          <input
            autoFocus
            value={renaming.value}
            onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') setRenaming(null);
            }}
            onBlur={commitRename}
          />
        ) : (
          <span className="name">{sheet.name}</span>
        )}
        <span className="description">{localize(page.description, language, state.project.settings.languages)}</span>
        {changes && (changes.addedPages.includes(sheet.pageId) || changes.changedPages.includes(sheet.pageId)) && (
          <span className="changed-mark" title={tr(changes.addedPages.includes(sheet.pageId) ? 'New since revision {name}' : 'Changed since revision {name}', { name: compare!.name })}>
            Δ
          </span>
        )}
      </li>
    );
  };
  const commitRename = () => {
    if (renaming && renaming.value.trim()) store.apply({ type: 'setPageProperties', pageId: renaming.pageId, name: renaming.value.trim() }, 'rename page');
    setRenaming(null);
  };

  return (
    <div className="panel">
      <div className="panel-tools">
        <PanelButton icon="addPage" label={tr('New schematic page after the current one')} onClick={addPage} />
        <PanelButton icon="addReport" label={tr('New report page')} onClick={() => store.set({ dialog: { kind: 'newReport' } })} />
        <PanelButton icon="addLayout" label={tr('New cabinet layout (mounting plate or door)')} onClick={() => store.set({ dialog: { kind: 'newLayout' } })} />
        <PanelButton icon="pageProperties" label={tr('Page properties')} disabled={!current} onClick={() => current && store.set({ dialog: { kind: 'page', pageId: current.pageId } })} />
        <PanelButton icon="up" label={upBlocked ? tr('Move page up – the page above belongs to another function/location (change the page structure to move it there)') : tr('Move page up')} disabled={currentIndex <= 0 || upBlocked} onClick={() => move(-1)} />
        <PanelButton icon="down" label={downBlocked ? tr('Move page down – the page below belongs to another function/location (change the page structure to move it there)') : tr('Move page down')} disabled={currentIndex < 0 || currentIndex >= state.project.pages.length - 1 || downBlocked} onClick={() => move(1)} />
        <PanelButton icon="delete" label={tr('Delete page')} disabled={!current} onClick={remove} />
        <PanelButton icon="renumber" label={tr('Renumber pages (Ctrl/Shift+click to select pages first)')} onClick={() => store.set({ dialog: { kind: 'renumberPages' } })} />
      </div>
      <ul className="tree" tabIndex={0} onKeyDown={(e) => {
        if (e.key === 'F2' && current && currentPage) setRenaming({ pageId: current.pageId, value: currentPage.name });
      }}>
        {pageTree(sheets, state).map((fn) => {
          const fnKey = `f:${fn.code ?? ''}`;
          const fnOpen = !collapsed.has(fnKey);
          const locations = (
            <>
              {fn.locations.map((loc) => {
                const locKey = `${fnKey}/l:${loc.code ?? ''}`;
                const locOpen = !collapsed.has(locKey);
                const rows = loc.sheets.map((sheet) => pageRow(sheet, loc.code !== undefined ? 2 : fn.code !== undefined ? 1 : 0));
                if (loc.code === undefined) return <Fragment key={locKey}>{rows}</Fragment>;
                return (
                  <Fragment key={locKey}>
                    <li
                      className={`tree-node depth-${fn.code !== undefined ? 1 : 0}${dropTarget === locKey ? ' drop-into' : ''}`}
                      onClick={() => toggleNode(locKey)}
                      title={`+${loc.code}`}
                      {...dropZone(locKey, () => ({ structure: { function: fn.code ?? null, location: loc.code! } }))}
                    >
                      <span className="chevron">{locOpen ? '▾' : '▸'}</span>
                      <span className="name">+{loc.code}</span>
                      <span className="description">{structureDescription(state.project.structures?.location, loc.code, language, state.project.settings.languages)}</span>
                    </li>
                    {locOpen && rows}
                  </Fragment>
                );
              })}
            </>
          );
          if (fn.code === undefined) return <Fragment key={fnKey}>{locations}</Fragment>;
          return (
            <Fragment key={fnKey}>
              <li
                className={`tree-node depth-0${dropTarget === fnKey ? ' drop-into' : ''}`}
                onClick={() => toggleNode(fnKey)}
                title={`=${fn.code}`}
                {...dropZone(fnKey, () => ({ structure: { function: fn.code! } }))}
              >
                <span className="chevron">{fnOpen ? '▾' : '▸'}</span>
                <span className="name">={fn.code}</span>
                <span className="description">{structureDescription(state.project.structures?.function, fn.code, language, state.project.settings.languages)}</span>
              </li>
              {fnOpen && locations}
            </Fragment>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Devices

const FUNCTION_LABELS: Record<string, string> = {
  'relay.coil': 'Coil',
  'contactor.coil': 'Coil',
  'contact.no': 'NO contact',
  'contact.nc': 'NC contact',
  'contact.co': 'Changeover',
  'contactor.main': 'Main contacts',
  terminal: 'Terminal',
  'box.device': 'Device box',
};

export function DevicesPanel() {
  const store = useStore();
  const doc = useEditor((s) => s.doc);
  useEditor((s) => s.version);
  const language = useEditor((s) => s.language);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  if (!doc) return null;
  const { state } = doc;
  const { settings } = state.project;
  const items = new Map<string, { page: Page; x: number; y: number; props?: Record<string, unknown> }>();
  for (const page of Object.values(state.pages)) {
    if (page.type === 'schematic') for (const i of page.items) items.set(i.id, { page, x: i.x, y: i.y, ...(i.props ? { props: i.props } : {}) });
  }
  const needle = filter.toLowerCase();
  const devices = [...doc.devices().devices.values()]
    .map((d) => ({ device: d, text: localize(d.main ? (items.get(d.main.itemId)?.props?.functionText as never) : undefined, language, settings.languages) }))
    .filter(({ device, text }) => !needle || device.key.toLowerCase().includes(needle) || text.toLowerCase().includes(needle))
    .sort((a, b) => naturalCompare(a.device.key, b.device.key));

  return (
    <div className="panel">
      <div className="panel-tools">
        <input className="search" placeholder={tr('Filter devices…')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <PanelButton icon="renumber" label={tr('Renumber devices by page and column (choose pages, review changes)')} onClick={() => store.set({ dialog: { kind: 'renumber' } })} />
      </div>
      <ul className="tree">
        {devices.map(({ device, text }) => (
          <li key={device.key} className="device">
            <div
              className="row"
              tabIndex={0}
              onClick={() => setOpen(open === device.key ? null : device.key)}
              onDoubleClick={() => store.set({ dialog: { kind: 'renameDevice', device: device.key } })}
              onKeyDown={(e) => e.key === 'F2' && store.set({ dialog: { kind: 'renameDevice', device: device.key } })}
            >
              <span className="caret">{open === device.key ? '▾' : '▸'}</span>
              <span className="name">{device.key}</span>
              <span className="description">{text}</span>
              <button
                className="row-action"
                title={tr('Save this device as a device definition in the library')}
                onClick={(e) => {
                  e.stopPropagation();
                  store.set({ dialog: { kind: 'saveDevice', device: device.key } });
                }}
              >
                {tr('⇢ Library')}
              </button>
            </div>
            {open === device.key && (
              <ul>
                {device.functions.map((f) => {
                  const entry = items.get(f.itemId)!;
                  const ref = formatReference(entry.page, pagePosition(entry.page, entry, settings, store.library), settings);
                  return (
                    <li key={f.itemId} onClick={() => store.navigate(f.pageId, 0, f.itemId)}>
                      <span className="name">{ref}</span>
                      <span className="description">
                        {tr(FUNCTION_LABELS[f.function] ?? f.function)}
                        {f.role === 'main' ? ' (main)' : ''}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Symbols

/** Readable names and order of the library categories; other categories follow alphabetically. */
const SYMBOL_CATEGORIES: [string, string][] = [
  ['connections', 'Connections'],
  ['contacts', 'Contacts'],
  ['relays', 'Relays and contactors'],
  ['switches', 'Switches and buttons'],
  ['protection', 'Protection'],
  ['consumers', 'Consumers'],
  ['power', 'Power supply'],
  ['terminals', 'Terminals'],
  ['sensors', 'Sensors'],
  ['plc', 'PLC'],
  ['cables', 'Cables'],
  ['boxes', 'Boxes'],
  ['fluid', 'Pneumatics and hydraulics'],
  ['pipes', 'Pipe connections'],
  ['texts', 'Texts'],
];
const MACRO_CATEGORIES: [string, string][] = [
  ['control', 'Control circuits'],
  ['terminals', 'Terminals, bridged'],
  ['terminals3', 'Terminals with 3 connections, bridged'],
];
const DEVICE_CATEGORIES: [string, string][] = [
  ['plc.cpu', 'PLC: CPUs, controllers, couplers'],
  ['plc.siemens.s71500', 'PLC: Siemens S7-1500 / ET 200MP'],
  ['plc.siemens.et200sp', 'PLC: Siemens ET 200SP'],
  ['plc.wago', 'PLC: WAGO 750'],
  ['plc.beckhoff', 'PLC: Beckhoff EtherCAT terminals'],
  ['plc', 'PLC I/O cards'],
  ['relays', 'Relays and contactors'],
  ['cables', 'Cables'],
];

/** Items grouped by category in the given order (unknown categories alphabetically, then "Other"). */
function byCategory<T>(items: readonly T[], category: (item: T) => string | undefined, known: [string, string][]): { key: string; label: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = category(item) ?? '';
    map.set(key, [...(map.get(key) ?? []), item]);
  }
  const labels = new Map(known);
  const order = (key: string) => (labels.has(key) ? known.findIndex(([k]) => k === key) : key === '' ? 2000 : 1000);
  return [...map]
    .sort(([a], [b]) => order(a) - order(b) || naturalCompare(a, b))
    .map(([key, list]) => ({ key, label: tr(labels.get(key) ?? (key ? key[0]!.toUpperCase() + key.slice(1) : 'Other')), items: list }));
}

const TREE_STORAGE_KEY = 'wirewright.symbolTree';

/** Open groups of the symbol tree, remembered in this browser (only a convenience). */
function useOpenGroups(): [Set<string>, (key: string) => void] {
  const [open, setOpen] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(TREE_STORAGE_KEY);
      if (saved) return new Set(JSON.parse(saved) as string[]);
    } catch {
      // storage unavailable: use the default
    }
    return new Set(['symbols', 'symbols/connections']);
  });
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(TREE_STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // not remembered
      }
      return next;
    });
  return [open, toggle];
}

function TreeGroup(props: { id: string; label: string; count: number; depth: 0 | 1; open: boolean; onToggle: (id: string) => void; hint?: string; children: ReactNode }) {
  return (
    <div className={`tree-group depth-${props.depth}`}>
      <button className="tree-group-head" aria-expanded={props.open} onClick={() => props.onToggle(props.id)} title={props.hint}>
        <span className="chevron">{props.open ? '▾' : '▸'}</span>
        <span className="label">{props.label}</span>
        <span className="count">{props.count}</span>
      </button>
      {props.open && <div className="tree-group-body">{props.children}</div>}
    </div>
  );
}

export function SymbolsPanel() {
  const store = useStore();
  const tool = useEditor((s) => s.tool);
  const language = useEditor((s) => s.language);
  // Saved devices and macros change the library.
  useEditor((s) => s.version);
  const [query, setQuery] = useState('');
  const [openGroups, toggle] = useOpenGroups();
  const needle = query.trim().toLowerCase();
  const matches = (...values: (string | undefined | Record<string, string>)[]) =>
    !needle ||
    values.some((v) => (typeof v === 'string' ? [v] : v ? Object.values(v) : []).some((t) => t.toLowerCase().includes(needle)));

  const symbols = useMemo(
    () => byCategory(store.library.symbols().filter((s) => matches(s.id, s.function, s.letterCode, s.name)), (s) => s.category, SYMBOL_CATEGORIES),
    [needle, store.library],
  );
  const devices = useMemo(
    () => byCategory(store.library.devices().filter((d) => matches(d.id, d.manufacturer, d.partNumber, d.name)), (d) => d.category, DEVICE_CATEGORIES),
    [needle, store.library],
  );
  const macros = useMemo(
    () => byCategory(store.library.macros().filter((m) => matches(m.id, m.category, m.name)), (m) => m.category, MACRO_CATEGORIES),
    [needle, store.library],
  );

  // While searching, every group with a match is open.
  const isOpen = (id: string) => needle !== '' || openGroups.has(id);
  const total = (groups: { items: unknown[] }[]) => groups.reduce((n, g) => n + g.items.length, 0);

  // Drag and drop onto the page (alternative to click and click).
  const dragSymbol = (e: React.DragEvent, payload: SymbolDragPayload) => {
    e.dataTransfer.setData(SYMBOL_DRAG_TYPE, JSON.stringify(payload));
    e.dataTransfer.setData('text/plain', payload.symbol ?? payload.macro ?? '');
    e.dataTransfer.effectAllowed = 'copy';
    hideDragImage(e);
    store.symbolDrag = payload;
  };
  const dragEnd = () => {
    store.symbolDrag = null;
  };
  const choose = (s: SymbolDefinition) => placeSymbolTool(store, s);

  const section = (
    root: string,
    label: string,
    groups: { key: string; label: string; items: unknown[] }[],
    body: (group: { key: string; items: unknown[] }) => ReactNode,
    hint?: string,
  ) =>
    groups.length > 0 && (
      <TreeGroup id={root} label={tr(label)} count={total(groups)} depth={0} open={isOpen(root)} onToggle={toggle} {...(hint ? { hint: tr(hint) } : {})}>
        {groups.map((g) => (
          <TreeGroup key={g.key} id={`${root}/${g.key}`} label={g.label} count={g.items.length} depth={1} open={isOpen(`${root}/${g.key}`)} onToggle={toggle}>
            {body(g)}
          </TreeGroup>
        ))}
      </TreeGroup>
    );

  return (
    <div className="panel">
      <div className="panel-tools">
        <input id="symbol-search" className="search" placeholder={tr('Search symbols… (Insert)')} value={query} onChange={(e) => setQuery(e.target.value)} />
        <PanelButton
          icon="symbolEditor"
          label={tr('Symbol editor: new symbol, or a copy of the symbol chosen for placing')}
          onClick={() => store.set({ dialog: { kind: 'symbolEditor', mode: 'symbol', ...(tool.kind === 'place' ? { id: tool.symbol } : {}) } })}
        />
      </div>
      <div className="symbols">
        {section('symbols', 'Symbols', symbols, (g) => (
          <div className="grid">
            {(g.items as SymbolDefinition[]).map((s) => {
              const active = (tool.kind === 'place' || tool.kind === 'box' || tool.kind === 'cable') && tool.symbol === s.id;
              return (
                <DragTile
                  key={s.id}
                  className={active ? 'symbol active' : 'symbol'}
                  title={`${localize(s.name, language, ['en'])}\n${s.id}\n${tr('Click, then click on the page – or drag it onto the page')}`}
                  onClick={() => choose(s)}
                  onDragStart={(e) => dragSymbol(e, { symbol: s.id })}
                  onDragEnd={dragEnd}
                >
                  <SymbolIcon symbol={s} />
                  <span>{localize(s.name, language, ['en'])}</span>
                </DragTile>
              );
            })}
          </div>
        ))}
        {section(
          'devices',
          'Devices',
          devices,
          (g) => (
            <div className="device-list">
              {(g.items as DeviceDefinition[]).map((d) => (
                <button
                  key={d.id}
                  className={tool.kind === 'device' && tool.device === d.id ? 'device-entry active' : 'device-entry'}
                  title={`${localize(d.description, language, ['en'])}\n${d.id}`.trim()}
                  onClick={() => startDeviceTool(store, d.id)}
                >
                  <span className="name">{localize(d.name, language, ['en'])}</span>
                  <span className="description">
                    {[d.manufacturer, d.partNumber].filter(Boolean).join(' ')} · {d.functions.length} {tr('functions')}
                  </span>
                </button>
              ))}
            </div>
          ),
          'Devices as bought, with all their symbols; while placing, Tab steps to the next function',
        )}
        {section('macros', 'Macros', macros, (g) => (
          <div className="device-list">
            {(g.items as MacroDefinition[]).map((m) => (
              <DragTile
                key={m.id}
                className={tool.kind === 'macro' && tool.macro === m.id ? 'device-entry active' : 'device-entry'}
                title={`${localize(m.description, language, ['en'])}\n${m.id}\n${tr('Click, then click on the page – or drag it onto the page')}`.trim()}
                onClick={() => store.set({ tool: { kind: 'macro', macro: m.id } })}
                onDragStart={(e) => dragSymbol(e, { macro: m.id })}
                onDragEnd={dragEnd}
              >
                <span className="name">{localize(m.name, language, ['en'])}</span>
                <span className="description">{m.items.length} {tr('items')}</span>
              </DragTile>
            ))}
          </div>
        ))}
        {total(symbols) + total(devices) + total(macros) === 0 && <p className="hint">{tr('Nothing found for "{query}".', { query })}</p>}
      </div>
    </div>
  );
}

function SymbolIcon({ symbol }: { symbol: SymbolDefinition }) {
  if (symbol.function === 'text') {
    return (
      <svg viewBox="0 0 22 16" width="44" height="32">
        <text x={11} y={12} fontSize={10} textAnchor="middle" fill="#222" fontFamily="Arial, Helvetica, sans-serif">
          {tr('Aa')}
        </text>
      </svg>
    );
  }
  if (symbol.generator === 'cable') {
    return (
      <svg viewBox="-2 -6 24 12" width="44" height="32">
        <line x1={0} y1={0} x2={20} y2={0} stroke="#222" strokeWidth={0.6} />
        <line x1={0} y1={-2} x2={0} y2={2} stroke="#222" strokeWidth={0.6} />
        <line x1={20} y1={-2} x2={20} y2={2} stroke="#222" strokeWidth={0.6} />
        {[5, 10, 15].map((x) => (
          <line key={x} x1={x} y1={-4} x2={x} y2={4} stroke="#999" strokeWidth={0.4} />
        ))}
      </svg>
    );
  }
  if (symbol.generator === 'plcCard') {
    return (
      <svg viewBox="-3 -1 22 26" width="44" height="32">
        <rect x={0} y={0} width={16} height={24} fill="none" stroke="#222" strokeWidth={0.6} />
        {[4, 8, 12, 16, 20].map((y) => (
          <line key={y} x1={y === 4 ? 0 : -2} y1={y} x2={y === 4 ? 16 : 0} y2={y} stroke="#222" strokeWidth={0.5} />
        ))}
      </svg>
    );
  }
  if (symbol.resizable) {
    const dash = symbol.function === 'box.structure' ? '3 1 0.6 1' : '2 1.2';
    const color = symbol.function === 'box.structure' ? '#00A3A3' : '#000';
    return (
      <svg viewBox="-2 -2 24 16" width="44" height="32">
        <rect x={0} y={0} width={20} height={12} fill="none" stroke={color} strokeWidth={0.6} strokeDasharray={dash} />
      </svg>
    );
  }
  const xs: number[] = [];
  const ys: number[] = [];
  for (const c of symbol.connections) {
    xs.push(c.x);
    ys.push(c.y);
  }
  // Connection symbols (corners, T-junctions …) show the wires they join, so the direction is visible.
  const stubs = symbol.function.startsWith('connection.')
    ? symbol.connections.map((c) => {
        const [dx, dy] = STUB[c.direction];
        xs.push(c.x + dx);
        ys.push(c.y + dy);
        return { x1: c.x, y1: c.y, x2: c.x + dx, y2: c.y + dy };
      })
    : [];
  for (const g of symbol.graphics) graphicPoints(g, xs, ys);
  const minX = Math.min(...xs, -2) - 1;
  const minY = Math.min(...ys, -2) - 1;
  const w = Math.max(Math.max(...xs, 2) + 1 - minX, 6);
  const h = Math.max(Math.max(...ys, 2) + 1 - minY, 6);
  const side = Math.max(w, h * 1.375);
  return (
    <svg viewBox={`${minX - (side - w) / 2} ${minY - (side / 1.375 - h) / 2} ${side} ${side / 1.375}`} width="44" height="32">
      {symbol.graphics.map((g, i) => (
        <GraphicIcon key={i} g={g} />
      ))}
      {stubs.map((l, i) => (
        <line key={`s${i}`} {...l} stroke="#1e6fff" strokeWidth={0.5} strokeLinecap="round" />
      ))}
      {symbol.connections.length > 0 && symbol.graphics.length === 0 && stubs.length === 0 && <circle cx={0} cy={0} r={1} fill="#1e6fff" />}
    </svg>
  );
}

const STUB: Record<'up' | 'down' | 'left' | 'right', [number, number]> = { up: [0, -4], down: [0, 4], left: [-4, 0], right: [4, 0] };

function graphicPoints(g: Graphic, xs: number[], ys: number[]) {
  switch (g.type) {
    case 'line':
      xs.push(g.x1, g.x2);
      ys.push(g.y1, g.y2);
      return;
    case 'polyline':
      for (const [x, y] of g.points) {
        xs.push(x);
        ys.push(y);
      }
      return;
    case 'rect':
      xs.push(g.x, g.x + g.width);
      ys.push(g.y, g.y + g.height);
      return;
    case 'circle':
    case 'arc':
      xs.push(g.cx - g.r, g.cx + g.r);
      ys.push(g.cy - g.r, g.cy + g.r);
      return;
    case 'text':
      xs.push(g.x);
      ys.push(g.y);
  }
}

function GraphicIcon({ g }: { g: Graphic }) {
  const stroke = { stroke: '#222', strokeWidth: 0.5, fill: 'none' };
  switch (g.type) {
    case 'line':
      return <line x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} {...stroke} />;
    case 'polyline':
      return g.closed ? <polygon points={g.points.join(' ')} {...stroke} fill={g.fill ? '#222' : 'none'} /> : <polyline points={g.points.join(' ')} {...stroke} />;
    case 'rect':
      return <rect x={g.x} y={g.y} width={g.width} height={g.height} {...stroke} fill={g.fill ? '#222' : 'none'} />;
    case 'circle':
      return <circle cx={g.cx} cy={g.cy} r={g.r} {...stroke} fill={g.fill ? '#222' : 'none'} />;
    case 'arc':
      return <path d={arcPath(g.cx, g.cy, g.r, g.start, g.end)} {...stroke} />;
    case 'text':
      return (
        <text x={g.x} y={g.y} fontSize={g.size ?? 2.5} textAnchor={g.align === 'center' ? 'middle' : g.align === 'right' ? 'end' : 'start'} fill="#222">
          {g.text}
        </text>
      );
  }
}

// ---------------------------------------------------------------------------
// PLC: PLCs, their I/O cards and channels. Drag a channel onto the page to place its I/O point,
// a card to place a further overview of it.

export function PlcPanel() {
  const store = useStore();
  const doc = useEditor((s) => s.doc);
  const tool = useEditor((s) => s.tool);
  useEditor((s) => s.version);
  const language = useEditor((s) => s.language);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  if (!doc) return null;
  const { plcs, settings } = doc.state.project;
  const cards = [...doc.plc().cards].sort((a, b) => (a.slot ?? 1e9) - (b.slot ?? 1e9) || naturalCompare(a.device, b.device));
  const groups: { key: string; name: string; description?: string; cards: PlcCardInfo[] }[] = [
    ...plcs.map((p) => ({
      key: p.name,
      name: p.name,
      ...(p.description ? { description: localize(p.description, language, settings.languages) } : {}),
      cards: cards.filter((c) => c.station?.name === p.name),
    })),
  ];
  const unassigned = cards.filter((c) => !c.station);
  if (unassigned.length > 0) groups.push({ key: '\u0000', name: 'Without PLC', cards: unassigned });
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const drag = (e: React.DragEvent, payload: PlcDragPayload) => {
    e.dataTransfer.setData(PLC_DRAG_TYPE, JSON.stringify(payload));
    e.dataTransfer.setData('text/plain', payload.channel === undefined ? 'PLC card' : 'PLC channel');
    e.dataTransfer.effectAllowed = 'copy';
    hideDragImage(e);
    store.plcDrag = payload;
  };
  const dragEnd = () => {
    store.plcDrag = null;
  };
  // Short references (relative to the card's page structure), e.g. /5.2.
  const reference = (target: { pageId: string; itemId: string }, from: string) => {
    const page = doc.state.pages[target.pageId] as SchematicPage;
    const item = page.items.find((i) => i.id === target.itemId)!;
    return formatReference(page, pagePosition(page, item, settings, store.library), settings, doc.state.pages[from]?.structure);
  };
  const armed = (payload: PlcDragPayload) =>
    tool.kind === 'plc' && tool.payload.itemId === payload.itemId && tool.payload.channel === payload.channel;
  /** Click: place it with the next click on a page (alternative to dragging). */
  const arm = (payload: PlcDragPayload) => store.set({ tool: armed(payload) ? { kind: 'select' } : { kind: 'plc', payload } });

  return (
    <div className="panel">
      <div className="panel-tools">
        <PanelButton icon="settings" label={tr('Add or edit PLCs (Project settings → PLCs)')} onClick={() => store.set({ dialog: { kind: 'project' } })} />
        <span className="hint">{tr('Drag (or click, then click on the page) a card or an input/output. ✓ = already drawn.')}</span>
      </div>
      <ul className="tree plc-tree">
        {groups.length === 0 && <li className="empty">{tr('No PLCs yet. Add one in Project settings → PLCs.')}</li>}
        {groups.map((g) => (
          <li key={g.key} className="plc-station">
            <div className="plc-station-head">
              <span className="name">{g.key === '\u0000' ? tr(g.name) : g.name}</span>
              {g.description && <span className="description">{g.description}</span>}
              {g.key !== '\u0000' && (
                <>
                  <PanelButton icon="addCard" className="icon-button" label={tr('Add I/O cards to {name}', { name: g.name })} onClick={() => store.set({ dialog: { kind: 'addPlcCard', station: g.name } })} />
                  <PanelButton
                    icon="plcOverview"
                    className="icon-button"
                    label={tr('Generate overview pages of {name}: draws all its cards that are not drawn yet', { name: g.name })}
                    onClick={() => {
                      const result = store.apply({ type: 'generatePlcOverview', station: g.name }, 'generate PLC overview');
                      if (!result) return;
                      const page = result.created.find((id) => doc.state.pages[id]);
                      if (page) store.navigate(page);
                      else store.notify('All cards are drawn already');
                    }}
                  />
                  <PanelButton icon="renumber" className="icon-button" label={tr('Number the addresses of {name} (and exports)', { name: g.name })} onClick={() => store.set({ dialog: { kind: 'plc', station: g.name } })} />
                </>
              )}
            </div>
            <ul>
              {g.cards.length === 0 && <li className="empty">{tr('No cards assigned.')}</li>}
              {g.cards.map((card) => {
                const isOpen = open.has(card.itemId);
                const drawn = card.drawings.length > 0;
                const refs = card.drawings.map((d) => ({ ...d, text: reference(d, store.state.sheet?.pageId ?? '') }));
                return (
                  <li key={card.itemId} className={['plc-card', drawn ? '' : 'not-drawn', card.drawings.length > 1 ? 'drawn-twice' : ''].join(' ').trim()}>
                    <div
                      className={armed({ pageId: card.pageId, itemId: card.itemId }) ? 'plc-card-head armed' : 'plc-card-head'}
                      draggable
                      onDragStart={(e) => drag(e, { pageId: card.pageId, itemId: card.itemId })}
                      onDragEnd={dragEnd}
                      onClick={() => arm({ pageId: card.pageId, itemId: card.itemId })}
                      onDoubleClick={() => refs[0] && store.navigate(refs[0].pageId, 0, refs[0].itemId)}
                      title={
                        drawn
                          ? tr('Drawn at {refs}. Drag onto a page (or click, then click on the page) to draw it once more (reported as a warning); double-click to show it.', { refs: refs.map((r) => r.text).join(', ') })
                          : tr('Not drawn yet. Drag it onto a page (or click, then click on the page) to draw the card there.')
                      }
                    >
                      <button
                        className="chevron"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(card.itemId);
                        }}
                        aria-expanded={isOpen}
                        aria-label={isOpen ? tr('Close') : tr('Open')}
                      >
                        {isOpen ? '▾' : '▸'}
                      </button>
                      <span className="placed-mark" aria-label={drawn ? 'drawn' : 'not drawn'}>{drawn ? '✓' : '●'}</span>
                      <span className="name">{card.device}</span>
                      {card.slot !== undefined && <span className="description">{tr('slot')} {card.slot}</span>}
                      {!drawn && <span className="not-drawn-label">{tr('not drawn')}</span>}
                      {refs.map((r) => (
                        <button
                          key={r.itemId}
                          className="card-ref"
                          title={tr('Show the drawing at {ref}', { ref: r.text })}
                          onClick={(e) => {
                            e.stopPropagation();
                            store.navigate(r.pageId, 0, r.itemId);
                          }}
                        >
                          {r.text}
                        </button>
                      ))}
                      <span className="count">{card.channels.length}</span>
                      <button
                        className="card-remove"
                        title={tr('Remove the card from the project (with its drawings)')}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(tr('Remove {device} from the project, with all its drawings?', { device: card.device }))) store.apply({ type: 'removePlcCards', itemIds: [card.itemId] }, 'remove PLC card');
                        }}
                      >
                        ×
                      </button>
                    </div>
                    {isOpen && (
                      <ul className="plc-channels">
                        {card.channels.map((c, i) => {
                          const payload = { pageId: card.pageId, itemId: card.itemId, channel: i };
                          const placed = c.slaves.length > 0;
                          return (
                            <li
                              key={i}
                              className={[placed ? 'placed' : 'free', armed(payload) ? 'armed' : ''].join(' ').trim()}
                              // A channel is drawn once: drawn ones are only shown (double-click).
                              draggable={!placed}
                              onDragStart={(e) => drag(e, payload)}
                              onDragEnd={dragEnd}
                              onClick={() => !placed && arm(payload)}
                              onDoubleClick={() => c.slaves[0] && store.navigate(c.slaves[0].pageId, 0, c.slaves[0].itemId)}
                              title={
                                placed
                                  ? tr('Drawn at {refs}; double-click to show it.', { refs: c.slaves.map((s) => reference(s, card.pageId)).join(', ') })
                                  : tr('Not drawn yet. Drag onto a page, or click and then click on the page, to place it.')
                              }
                            >
                              <span className="placed-mark" aria-label={placed ? 'drawn' : 'free'}>{placed ? '✓' : ''}</span>
                              <span className={`io-kind ${c.channel.kind.toLowerCase()}`}>{channelLabel(c.channel)}</span>
                              <span className="address">{c.address ?? ''}</span>
                              <span className="description">{localize(c.function, language, settings.languages)}</span>
                              <span className="refs">{c.slaves.map((s) => reference(s, card.pageId)).join(' ')}</span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Issues

export function IssuesPanel() {
  const store = useStore();
  const doc = useEditor((s) => s.doc);
  useEditor((s) => s.version);
  const [showInfo, setShowInfo] = useState(false);
  if (!doc) return null;
  const all = doc.check().filter((i) => showInfo || i.severity !== 'info');
  const order = { error: 0, warning: 1, info: 2 };
  const sorted = (list: Issue[]) => [...list].sort((a, b) => order[a.severity] - order[b.severity]);
  const open = sorted(all.filter((i) => !i.acknowledged));
  const accepted = sorted(all.filter((i) => i.acknowledged));
  const row = (issue: Issue, i: number) => (
    <li key={`${issueKey(issue)}:${i}`} className={issue.acknowledged ? `${issue.severity} acknowledged` : issue.severity} onClick={() => issue.pageId && store.navigate(issue.pageId, 0, issue.itemId)}>
      <span className={`dot ${issue.severity}`} />
      <span className="message">
        {issueText(issue)}
        {issue.acknowledged?.note && <span className="ack-note"> – {issue.acknowledged.note}</span>}
      </span>
      {issue.acknowledged ? (
        <button
          className="issue-ack"
          title={tr('Take back: count this problem again')}
          onClick={(e) => {
            e.stopPropagation();
            store.apply({ type: 'unacknowledgeIssues', keys: [issueKey(issue)] }, 'take back acknowledgement');
          }}
        >
          ↺
        </button>
      ) : (
        <button
          className="issue-ack"
          title={tr('Acknowledge: checked and intended (shown greyed out, no longer counted)')}
          onClick={(e) => {
            e.stopPropagation();
            store.set({ dialog: { kind: 'acknowledge', keys: [issueKey(issue)], text: issueText(issue) } });
          }}
        >
          ✓
        </button>
      )}
    </li>
  );
  return (
    <div className="panel">
      <div className="panel-tools">
        <label>
          <input type="checkbox" checked={showInfo} onChange={(e) => setShowInfo(e.target.checked)} /> {tr('Show hints')}
        </label>
      </div>
      <ul className="tree issues">
        {open.length === 0 && <li className="empty">{tr('No problems found.')}</li>}
        {open.map(row)}
        {accepted.length > 0 && <li className="issues-heading">{tr('Acknowledged ({count})', { count: accepted.length })}</li>}
        {accepted.map(row)}
      </ul>
    </div>
  );
}

