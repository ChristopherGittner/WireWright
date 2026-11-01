// Command palette (Ctrl+K): one search field for toolbar actions, pages, devices and symbols.
// Toolbar buttons register themselves as actions (usePaletteAction), so the palette always offers
// what the toolbar offers, with the same labels and enabled state.
import { localize, type SymbolDefinition } from '@wirewright/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { tr, trKeys } from '../i18n.js';
import { useEditor, useStore, type EditorStore } from '../store.js';

export interface PaletteAction {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  run: () => void;
}

const actions = new Map<string, PaletteAction>();

/** Offers an action in the command palette while the component is shown. */
export function usePaletteAction(action: PaletteAction): void {
  useEffect(() => {
    actions.set(action.label, action);
    return () => {
      if (actions.get(action.label) === action) actions.delete(action.label);
    };
  });
}

type Kind = 'action' | 'page' | 'device' | 'symbol';

interface Entry {
  kind: Kind;
  label: string;
  detail?: string;
  /** Lower-case text the query is matched against. */
  haystack: string;
  run: () => void;
}

const KIND_LABEL: Record<Kind, string> = { action: 'Action', page: 'Page', device: 'Device', symbol: 'Symbol' };
const MAX_RESULTS = 60;

/** Places a library symbol with the matching tool (as a click in the Symbols tab does). */
export function placeSymbolTool(store: EditorStore, s: SymbolDefinition): void {
  if (s.generator === 'cable') store.set({ tool: { kind: 'cable', symbol: s.id } });
  else if (s.resizable) store.set({ tool: { kind: 'box', symbol: s.id as 'wirewright.box.structure' | 'wirewright.box.device' } });
  else store.set({ tool: { kind: 'place', symbol: s.id, rotation: 0, mirror: false } });
}

function entries(store: EditorStore): Entry[] {
  const doc = store.state.doc;
  const list: Entry[] = [];
  for (const a of actions.values()) {
    if (a.disabled) continue;
    list.push({ kind: 'action', label: a.label, ...(a.shortcut ? { detail: trKeys(a.shortcut) } : {}), haystack: a.label.toLowerCase(), run: a.run });
  }
  if (!doc) return list;
  const { languages } = doc.state.project.settings;
  const language = store.state.language;
  for (const sheet of doc.sheets().sheets) {
    const page = doc.state.pages[sheet.pageId];
    const description = localize(page?.description, language, languages);
    list.push({ kind: 'page', label: sheet.fullName, detail: description, haystack: `${sheet.fullName} ${sheet.name} ${description}`.toLowerCase(), run: () => store.navigate(sheet.pageId, sheet.sheet) });
  }
  for (const device of doc.devices().devices.values()) {
    if (!device.main) continue;
    const page = doc.state.pages[device.main.pageId];
    const item = page?.type === 'schematic' ? page.items.find((i) => i.id === device.main!.itemId) : undefined;
    const text = localize(item?.props?.functionText, language, languages);
    const main = device.main;
    list.push({ kind: 'device', label: device.key, detail: text, haystack: `${device.key} ${text}`.toLowerCase(), run: () => store.navigate(main.pageId, 0, main.itemId) });
  }
  for (const s of store.library.symbols()) {
    if (s.generator === 'plcCard' || s.function === 'text') continue;
    const name = localize(s.name, language, ['en']);
    list.push({ kind: 'symbol', label: name, detail: s.id, haystack: `${name} ${s.id} ${s.function}`.toLowerCase(), run: () => placeSymbolTool(store, s) });
  }
  return list;
}

/** All words of the query in the entry; entries starting with the query first, then by kind. */
function search(all: readonly Entry[], query: string): Entry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return all.filter((e) => e.kind === 'action').slice(0, MAX_RESULTS);
  const order: Kind[] = ['action', 'page', 'device', 'symbol'];
  const q = query.trim().toLowerCase();
  return all
    .filter((e) => words.every((w) => e.haystack.includes(w)))
    .map((e) => ({ e, rank: (e.label.toLowerCase().startsWith(q) ? 0 : 10) + order.indexOf(e.kind) }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, MAX_RESULTS)
    .map((r) => r.e);
}

export function CommandPalette() {
  const store = useStore();
  const version = useEditor((s) => s.version);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const all = useMemo(() => entries(store), [store, version]);
  const results = useMemo(() => search(all, query), [all, query]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const close = () => store.set({ dialog: null });
  const run = (entry: Entry | undefined) => {
    if (!entry) return;
    close();
    entry.run();
  };

  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label={tr('Command palette')}>
        <input
          autoFocus
          placeholder={tr('Search actions, pages, devices, symbols …')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') close();
            else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter') run(results[active]);
          }}
        />
        <ul ref={listRef}>
          {results.map((entry, i) => (
            <li key={`${entry.kind}:${entry.label}:${entry.detail ?? ''}:${i}`} className={i === active ? 'active' : ''} onMouseEnter={() => setActive(i)} onClick={() => run(entry)}>
              <span className={`palette-kind ${entry.kind}`}>{tr(KIND_LABEL[entry.kind])}</span>
              <span className="palette-label">{entry.label}</span>
              {entry.detail && <span className="palette-detail">{entry.detail}</span>}
            </li>
          ))}
          {results.length === 0 && <li className="empty">{tr('Nothing found')}</li>}
        </ul>
      </div>
    </div>
  );
}
