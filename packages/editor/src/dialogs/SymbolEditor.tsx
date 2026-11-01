// Graphical editor for symbol definitions (graphics, connection points, text fields, pin links)
// and page frames (graphics, title block fields, drawing area, columns and rows). Definitions are
// saved to the project library (library.json), optionally also to the shared library folder.
import {
  arcPath,
} from '@wirewright/render';
import {
  frameDefinitionSchema,
  localize,
  symbolDefinitionSchema,
  type ConnectionPoint,
  type FrameDefinition,
  type FrameField,
  type Graphic,
  type SymbolDefinition,
  type TextField,
} from '@wirewright/core';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { tr } from '../i18n.js';
import { Icon, type IconName } from '../icons.js';
import { useEditor, useStore } from '../store.js';
import { Field, LanguageFields, Modal, texts, toLocalized } from './common.js';

export type EditorMode = 'symbol' | 'frame';
type Tool = 'select' | 'line' | 'rect' | 'circle' | 'polyline' | 'text' | 'connection' | 'field' | 'links';
type Selection = { kind: 'graphic' | 'connection' | 'text' | 'field'; index: number } | null;
type Point = { x: number; y: number };
type Box = { x: number; y: number; w: number; h: number };

const DIRECTIONS = ['up', 'down', 'left', 'right'] as const;
const SYMBOL_FIELDS = ['tag', 'functionText', 'technicalData', 'xref', 'contactImage', 'name', 'text'];
const FRAME_SOURCES = [
  'project.name',
  'project.description',
  'project.properties.customer',
  'project.properties.drawingNumber',
  'project.properties.createdBy',
  'page.name',
  'page.fullName',
  'page.description',
  'page.structure',
  'page.index/project.pageCount',
  'page.properties.revision',
  'page.properties.date',
];

const NEW_SYMBOL: SymbolDefinition = {
  id: 'own.symbol',
  name: { de: 'Neues Symbol', en: 'New symbol' },
  category: 'own',
  function: 'own',
  defaultRole: 'main',
  letterCode: 'K',
  graphics: [{ type: 'rect', x: -4, y: -3, width: 8, height: 6 }],
  connections: [
    { id: '1', x: 0, y: -8, direction: 'up', designation: '1' },
    { id: '2', x: 0, y: 8, direction: 'down', designation: '2' },
  ],
  texts: [
    { field: 'tag', x: -6, y: -1, align: 'right' },
    { field: 'functionText', x: -6, y: 3, align: 'right' },
  ],
};

// ---------------------------------------------------------------------------
// Geometry helpers

function moveGraphic(g: Graphic, dx: number, dy: number): Graphic {
  switch (g.type) {
    case 'line':
      return { ...g, x1: g.x1 + dx, y1: g.y1 + dy, x2: g.x2 + dx, y2: g.y2 + dy };
    case 'polyline':
      return { ...g, points: g.points.map(([x, y]) => [x + dx, y + dy] as [number, number]) };
    case 'rect':
    case 'text':
      return { ...g, x: g.x + dx, y: g.y + dy };
    case 'circle':
    case 'arc':
      return { ...g, cx: g.cx + dx, cy: g.cy + dy };
  }
}

function graphicBox(g: Graphic): Box {
  switch (g.type) {
    case 'line':
      return { x: Math.min(g.x1, g.x2), y: Math.min(g.y1, g.y2), w: Math.abs(g.x2 - g.x1), h: Math.abs(g.y2 - g.y1) };
    case 'polyline': {
      const xs = g.points.map((p) => p[0]);
      const ys = g.points.map((p) => p[1]);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    case 'rect':
      return { x: g.x, y: g.y, w: g.width, h: g.height };
    case 'circle':
    case 'arc':
      return { x: g.cx - g.r, y: g.cy - g.r, w: 2 * g.r, h: 2 * g.r };
    case 'text':
      return { x: g.x, y: g.y - (g.size ?? 2.5), w: g.text.length * (g.size ?? 2.5) * 0.55, h: g.size ?? 2.5 };
  }
}

/** The view around everything drawn, at least ±20 mm (symbols). */
function fitSymbol(def: SymbolDefinition): Box {
  const boxes = [
    ...def.graphics.map(graphicBox),
    ...def.connections.map((c) => ({ x: c.x, y: c.y, w: 0, h: 0 })),
    ...def.texts.map((t) => ({ x: t.x - 12, y: t.y - 4, w: 24, h: 5 })),
    { x: -20, y: -20, w: 40, h: 40 },
  ];
  const x1 = Math.min(...boxes.map((b) => b.x)) - 6;
  const y1 = Math.min(...boxes.map((b) => b.y)) - 6;
  const x2 = Math.max(...boxes.map((b) => b.x + b.w)) + 6;
  const y2 = Math.max(...boxes.map((b) => b.y + b.h)) + 6;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Pin-link groups as pairs to draw: each pin to the next of its group. */
function linkPairs(links: readonly (readonly string[])[]): [string, string][] {
  return links.flatMap((group) => group.slice(1).map((pin, i) => [group[i]!, pin] as [string, string]));
}

/** Links with `a` and `b` joined (or `b` taken out of `a`'s group when they are already linked). */
function toggleLink(links: readonly (readonly string[])[], a: string, b: string): string[][] {
  const groups = links.map((g) => [...g]);
  const ga = groups.find((g) => g.includes(a));
  const gb = groups.find((g) => g.includes(b));
  if (ga && ga === gb) {
    ga.splice(ga.indexOf(b), 1);
    return groups.filter((g) => g.length > 1);
  }
  if (ga && gb) {
    ga.push(...gb);
    return groups.filter((g) => g !== gb);
  }
  if (ga) ga.push(b);
  else if (gb) gb.push(a);
  else groups.push([a, b]);
  return groups;
}

// ---------------------------------------------------------------------------
// The editor

export function SymbolEditorDialog({ mode, id, initial }: { mode: EditorMode; id?: string | undefined; initial?: SymbolDefinition | undefined }) {
  const store = useStore();
  const doc = useEditor((s) => s.doc)!;
  const language = useEditor((s) => s.language);
  const { languages } = doc.state.project.settings;
  const library = doc.library;
  const startFrame = (): FrameDefinition => {
    const base = library.frame(id ?? doc.state.project.settings.defaultFrame) ?? library.frames()[0]!;
    return structuredClone(id ? base : { ...base, id: 'own.frame', name: { de: 'Eigener Rahmen', en: 'Own frame' } });
  };
  const [symbol, setSymbol] = useState<SymbolDefinition>(() => structuredClone(initial ?? ((id && library.symbol(id)) || NEW_SYMBOL)));
  const [frame, setFrame] = useState<FrameDefinition>(startFrame);
  const [tool, setTool] = useState<Tool>('select');
  const [selection, setSelection] = useState<Selection>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ start: Point; end: Point; points?: [number, number][] } | null>(null);
  const [drag, setDrag] = useState<{ start: Point; original: Graphic | ConnectionPoint | TextField | FrameField } | null>(null);
  const [view, setView] = useState<Box>(() => (mode === 'symbol' ? fitSymbol(symbol) : { x: -5, y: -5, w: frame.size.width + 10, h: frame.size.height + 10 }));
  const [shared, setShared] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);

  const graphics = mode === 'symbol' ? symbol.graphics : frame.graphics;
  const setGraphics = (next: Graphic[]) => (mode === 'symbol' ? setSymbol({ ...symbol, graphics: next }) : setFrame({ ...frame, graphics: next }));
  const step = mode === 'symbol' ? 0.5 : 1;
  const snap = (p: Point, grid = step): Point => ({ x: Math.round(p.x / grid) * grid, y: Math.round(p.y / grid) * grid });
  const toLocal = (e: { clientX: number; clientY: number }): Point => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  };

  const selected = useMemo(() => {
    if (!selection) return undefined;
    if (selection.kind === 'graphic') return graphics[selection.index];
    if (selection.kind === 'connection') return symbol.connections[selection.index];
    if (selection.kind === 'text') return symbol.texts[selection.index];
    return frame.fields[selection.index];
  }, [selection, graphics, symbol, frame]);

  const replaceSelected = (value: Graphic | ConnectionPoint | TextField | FrameField) => {
    if (!selection) return;
    const swap = <T,>(list: readonly T[]) => list.map((x, i) => (i === selection.index ? (value as T) : x));
    if (selection.kind === 'graphic') setGraphics(swap(graphics));
    else if (selection.kind === 'connection') setSymbol({ ...symbol, connections: swap(symbol.connections) });
    else if (selection.kind === 'text') setSymbol({ ...symbol, texts: swap(symbol.texts) });
    else setFrame({ ...frame, fields: swap(frame.fields) });
  };
  const removeSelected = () => {
    if (!selection) return;
    const without = <T,>(list: readonly T[]) => list.filter((_, i) => i !== selection.index);
    if (selection.kind === 'graphic') setGraphics(without(graphics));
    else if (selection.kind === 'connection') {
      const pin = symbol.connections[selection.index]!.id;
      setSymbol({
        ...symbol,
        connections: without(symbol.connections),
        ...(symbol.links ? { links: symbol.links.map((g) => g.filter((p) => p !== pin)).filter((g) => g.length > 1) } : {}),
      });
    } else if (selection.kind === 'text') setSymbol({ ...symbol, texts: without(symbol.texts) });
    else setFrame({ ...frame, fields: without(frame.fields) });
    setSelection(null);
  };

  // Delete removes the selection, Escape ends the drawing tool (not while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeSelected();
      }
      if (e.key === 'Enter' && draft?.points && draft.points.length >= 2) finishPolyline();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const finishPolyline = () => {
    if (draft?.points && draft.points.length >= 2) setGraphics([...graphics, { type: 'polyline', points: draft.points }]);
    setDraft(null);
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const raw = toLocal(e);
    const p = snap(raw);
    const target = e.target as SVGElement;
    const kind = target.dataset.kind as NonNullable<Selection>['kind'] | undefined;
    const index = target.dataset.index !== undefined ? Number(target.dataset.index) : -1;
    switch (tool) {
      case 'select': {
        if (!kind || index < 0) return setSelection(null);
        setSelection({ kind, index });
        const original = kind === 'graphic' ? graphics[index] : kind === 'connection' ? symbol.connections[index] : kind === 'text' ? symbol.texts[index] : frame.fields[index];
        if (original) {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          setDrag({ start: p, original: structuredClone(original) });
        }
        return;
      }
      case 'line':
      case 'rect':
      case 'circle':
        (e.target as Element).setPointerCapture?.(e.pointerId);
        return setDraft({ start: p, end: p });
      case 'polyline':
        if (e.detail >= 2) return finishPolyline();
        return setDraft({ start: draft?.start ?? p, end: p, points: [...(draft?.points ?? []), [p.x, p.y]] });
      case 'text':
        setGraphics([...graphics, { type: 'text', x: p.x, y: p.y, text: 'Text', size: 2.5 }]);
        setSelection({ kind: 'graphic', index: graphics.length });
        return setTool('select');
      case 'connection': {
        // Connection points lie on whole millimetres; the direction points away from the middle.
        const q = snap(raw, 1);
        const ids = new Set(symbol.connections.map((c) => c.id));
        let n = symbol.connections.length + 1;
        while (ids.has(String(n))) n++;
        const direction = Math.abs(q.x) > Math.abs(q.y) ? (q.x < 0 ? 'left' : 'right') : q.y < 0 ? 'up' : 'down';
        setSymbol({ ...symbol, connections: [...symbol.connections, { id: String(n), x: q.x, y: q.y, direction, designation: String(n) }] });
        setSelection({ kind: 'connection', index: symbol.connections.length });
        return;
      }
      case 'field':
        if (mode === 'symbol') {
          const used = new Set(symbol.texts.map((t) => t.field));
          const field = SYMBOL_FIELDS.find((f) => !used.has(f)) ?? 'tag';
          setSymbol({ ...symbol, texts: [...symbol.texts, { field, x: p.x, y: p.y }] });
          setSelection({ kind: 'text', index: symbol.texts.length });
        } else {
          setFrame({ ...frame, fields: [...frame.fields, { source: 'page.description', x: p.x, y: p.y, size: 3.5 }] });
          setSelection({ kind: 'field', index: frame.fields.length });
        }
        return setTool('select');
      case 'links': {
        if (kind !== 'connection') return setLinkFrom(null);
        const pin = symbol.connections[index]!.id;
        if (!linkFrom || linkFrom === pin) return setLinkFrom(linkFrom === pin ? null : pin);
        setSymbol({ ...symbol, links: toggleLink(symbol.links ?? [], linkFrom, pin) });
        return setLinkFrom(null);
      }
    }
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const p = snap(toLocal(e));
    if (draft && !draft.points) setDraft({ ...draft, end: p });
    else if (draft?.points) setDraft({ ...draft, end: p });
    if (drag && selection) {
      const dx = p.x - drag.start.x;
      const dy = p.y - drag.start.y;
      const o = drag.original;
      if (selection.kind === 'graphic') replaceSelected(moveGraphic(o as Graphic, dx, dy));
      else if (selection.kind === 'connection') {
        const c = o as ConnectionPoint;
        replaceSelected({ ...c, x: Math.round(c.x + dx), y: Math.round(c.y + dy) });
      } else {
        const t = o as TextField | FrameField;
        replaceSelected({ ...t, x: t.x + dx, y: t.y + dy });
      }
    }
  };

  const onPointerUp = () => {
    if (draft && !draft.points) {
      const { start: a, end: b } = draft;
      if (a.x !== b.x || a.y !== b.y) {
        const shape: Graphic =
          tool === 'line'
            ? { type: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y }
            : tool === 'rect'
              ? { type: 'rect', x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
              : { type: 'circle', cx: a.x, cy: a.y, r: Math.max(0.5, Math.hypot(b.x - a.x, b.y - a.y)) };
        setGraphics([...graphics, shape]);
        setSelection({ kind: 'graphic', index: graphics.length });
      }
      setDraft(null);
    }
    setDrag(null);
  };

  const onWheel = (e: React.WheelEvent) => {
    const p = toLocal(e);
    const f = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    setView({ x: p.x - (p.x - view.x) * f, y: p.y - (p.y - view.y) * f, w: view.w * f, h: view.h * f });
  };

  const save = async () => {
    const result = mode === 'symbol' ? symbolDefinitionSchema.safeParse(symbol) : frameDefinitionSchema.safeParse(frame);
    const problems = result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    if (mode === 'symbol') {
      const ids = symbol.connections.map((c) => c.id);
      const twice = ids.filter((pin, i) => ids.indexOf(pin) !== i);
      if (twice.length > 0) problems.push(tr('Pin IDs used twice: {pins}', { pins: [...new Set(twice)].join(', ') }));
    }
    setErrors(problems);
    if (!result.success || problems.length > 0) return;
    const definition = result.data;
    const content = mode === 'symbol' ? { symbols: [definition as SymbolDefinition] } : { frames: [definition as FrameDefinition] };
    if (!store.apply({ type: 'addToProjectLibrary', content }, mode === 'symbol' ? 'save symbol' : 'save frame')) return;
    if (shared && store.host.saveToSharedLibrary) {
      try {
        await store.host.saveToSharedLibrary(definition);
      } catch (error) {
        return store.notify(tr('Could not save to the library folder: {error}', { error: (error as Error).message }), true);
      }
    }
    store.notify(tr('Saved {name} to the library', { name: definition.id }));
  };

  const open = (value: string) => {
    if (mode === 'symbol') {
      const def = library.symbol(value);
      setSymbol(structuredClone(def ?? NEW_SYMBOL));
      setView(fitSymbol(def ?? NEW_SYMBOL));
    } else {
      const def = library.frame(value);
      if (def) {
        setFrame(structuredClone(def));
        setView({ x: -5, y: -5, w: def.size.width + 10, h: def.size.height + 10 });
      }
    }
    setSelection(null);
  };

  const editable = mode === 'symbol' ? library.symbols().filter((s) => !s.generator && !s.resizable) : library.frames();
  const own = new Set((mode === 'symbol' ? doc.state.library?.symbols : doc.state.library?.frames)?.map((d) => d.id) ?? []);
  const currentId = mode === 'symbol' ? symbol.id : frame.id;
  const tools: [Tool, IconName, string][] = [
    ['select', 'toolSelect', tr('Select and move (Delete removes)')],
    ['line', 'toolLine', tr('Line: drag')],
    ['rect', 'toolRect', tr('Rectangle: drag')],
    ['circle', 'toolCircle', tr('Circle: drag from the centre')],
    ['polyline', 'toolPolyline', tr('Polyline: click the points, double-click or Enter ends')],
    ['text', 'toolText', tr('Fixed text: click')],
    ...(mode === 'symbol'
      ? ([
          ['connection', 'toolConnection', tr('Connection point: click (on whole millimetres)')],
          ['field', 'toolField', tr('Text field (tag, function text …): click')],
          ['links', 'toolLinks', tr('Pin links: click one pin, then another (again: unlink)')],
        ] as [Tool, IconName, string][])
      : ([['field', 'toolField', tr('Title block field: click')]] as [Tool, IconName, string][])),
  ];

  const stroke = Math.max(view.w / 400, 0.18);
  const grid = mode === 'symbol' ? 4 : 10;
  const gridLines: ReactNode[] = [];
  for (let x = Math.ceil(view.x / grid) * grid; x <= view.x + view.w; x += grid) {
    gridLines.push(<line key={`x${x}`} x1={x} y1={view.y} x2={x} y2={view.y + view.h} stroke={x === 0 && mode === 'symbol' ? '#9fb3c8' : '#e3e9ef'} strokeWidth={stroke * 0.6} />);
  }
  for (let y = Math.ceil(view.y / grid) * grid; y <= view.y + view.h; y += grid) {
    gridLines.push(<line key={`y${y}`} x1={view.x} y1={y} x2={view.x + view.w} y2={y} stroke={y === 0 && mode === 'symbol' ? '#9fb3c8' : '#e3e9ef'} strokeWidth={stroke * 0.6} />);
  }
  const isSelected = (kind: NonNullable<Selection>['kind'], index: number) => selection?.kind === kind && selection.index === index;
  const color = (on: boolean) => (on ? '#1e6fff' : '#111');
  const hit = Math.max(view.w / 120, 1);

  return (
    <Modal title={mode === 'symbol' ? tr('Symbol editor') : tr('Frame editor')} full>
      <div className="symbol-editor">
        <div className="symbol-editor-main">
          <div className="symbol-editor-tools" role="toolbar">
            {tools.map(([t, icon, label]) => (
              <button key={t} type="button" className={tool === t ? 'pressed' : undefined} title={label} aria-label={label} onClick={() => (setTool(t), setDraft(null), setLinkFrom(null))}>
                <Icon name={icon} />
              </button>
            ))}
            <span className="hint">{tools.find(([t]) => t === tool)?.[2]}</span>
          </div>
          <svg
            ref={svgRef}
            className="symbol-editor-canvas"
            viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
            preserveAspectRatio="xMidYMid meet"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onWheel={onWheel}
            fontFamily="Arial, Helvetica, sans-serif"
            style={{ cursor: tool === 'select' ? 'default' : 'crosshair' }}
          >
            <rect x={view.x} y={view.y} width={view.w} height={view.h} fill="#fff" />
            {gridLines}
            {mode === 'frame' && (
              <g pointerEvents="none" stroke="#00a3a3" strokeWidth={stroke} fill="none" strokeDasharray={`${stroke * 6} ${stroke * 4}`}>
                <rect x={0} y={0} width={frame.size.width} height={frame.size.height} stroke="#9fb3c8" />
                <rect x={frame.drawingArea.x} y={frame.drawingArea.y} width={frame.drawingArea.width} height={frame.drawingArea.height} />
              </g>
            )}
            {graphics.map((g, i) => (
              <GraphicView key={i} g={g} color={color(isSelected('graphic', i))} width={stroke * 1.6} index={i} hit={hit} />
            ))}
            {mode === 'symbol' &&
              symbol.texts.map((t, i) => (
                <text key={`t${i}`} x={t.x} y={t.y} fontSize={t.size ?? 2.5} fill={isSelected('text', i) ? '#1e6fff' : '#8a5a00'} textAnchor={anchor(t.align)} data-kind="text" data-index={i} style={{ cursor: 'move' }}>
                  {fieldSample(t.field)}
                </text>
              ))}
            {mode === 'frame' &&
              frame.fields.map((f, i) => (
                <text key={`f${i}`} x={f.x} y={f.y} fontSize={f.size ?? 2.5} fill={isSelected('field', i) ? '#1e6fff' : '#8a5a00'} textAnchor={anchor(f.align)} data-kind="field" data-index={i} style={{ cursor: 'move' }}>
                  {`[${f.source}]`}
                </text>
              ))}
            {mode === 'symbol' && (
              <g>
                {linkPairs(symbol.links ?? []).map(([a, b], i) => {
                  const pa = symbol.connections.find((c) => c.id === a);
                  const pb = symbol.connections.find((c) => c.id === b);
                  return pa && pb ? <line key={i} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="#e07000" strokeWidth={stroke * 1.4} strokeDasharray={`${stroke * 4} ${stroke * 3}`} pointerEvents="none" /> : null;
                })}
                {symbol.connections.map((c, i) => {
                  const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[c.direction];
                  const on = isSelected('connection', i) || linkFrom === c.id;
                  return (
                    <g key={`c${i}`}>
                      <line x1={c.x} y1={c.y} x2={c.x + d[0]! * 2} y2={c.y + d[1]! * 2} stroke={on ? '#1e6fff' : '#d0021b'} strokeWidth={stroke * 1.6} pointerEvents="none" />
                      <circle cx={c.x} cy={c.y} r={hit * 0.6} fill={on ? '#1e6fff' : '#d0021b'} fillOpacity={0.8} data-kind="connection" data-index={i} style={{ cursor: 'pointer' }} />
                      <text x={c.x + 1.2} y={c.y - 1} fontSize={1.8} fill="#d0021b" pointerEvents="none">
                        {c.designation ?? c.id}
                      </text>
                    </g>
                  );
                })}
              </g>
            )}
            {draft && (
              <g pointerEvents="none" stroke="#1e6fff" strokeWidth={stroke * 1.4} fill="none">
                {tool === 'line' && <line x1={draft.start.x} y1={draft.start.y} x2={draft.end.x} y2={draft.end.y} />}
                {tool === 'rect' && <rect x={Math.min(draft.start.x, draft.end.x)} y={Math.min(draft.start.y, draft.end.y)} width={Math.abs(draft.end.x - draft.start.x)} height={Math.abs(draft.end.y - draft.start.y)} />}
                {tool === 'circle' && <circle cx={draft.start.x} cy={draft.start.y} r={Math.hypot(draft.end.x - draft.start.x, draft.end.y - draft.start.y)} />}
                {draft.points && <polyline points={[...draft.points, [draft.end.x, draft.end.y]].map((p) => p.join(',')).join(' ')} />}
              </g>
            )}
          </svg>
        </div>
        <div className="symbol-editor-side">
          <Field label={mode === 'symbol' ? tr('Start from symbol') : tr('Start from frame')}>
            <select value={editable.some((d) => d.id === currentId) ? currentId : ''} onChange={(e) => open(e.target.value)}>
              <option value="">{mode === 'symbol' ? tr('– new symbol –') : tr('– choose –')}</option>
              {editable.map((d) => (
                <option key={d.id} value={d.id}>
                  {localize(d.name, language, ['en'])} ({d.id})
                </option>
              ))}
            </select>
          </Field>
          {mode === 'symbol' ? (
            <SymbolProperties symbol={symbol} onChange={setSymbol} languages={languages} />
          ) : (
            <FrameProperties frame={frame} onChange={setFrame} languages={languages} />
          )}
          {selected && (
            <fieldset>
              <legend>{tr('Selected')}</legend>
              <ElementProperties kind={selection!.kind} value={selected} onChange={replaceSelected} connections={symbol.connections} />
              <button type="button" onClick={removeSelected}>
                {tr('Remove')}
              </button>
            </fieldset>
          )}
          {errors.length > 0 && (
            <ul className="error">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <div className="translations-tools">
            <button type="button" className="primary" onClick={() => void save()}>
              {mode === 'symbol' ? tr('Save symbol') : tr('Save frame')}
            </button>
            {store.host.saveToSharedLibrary && (
              <label className="check">
                <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> {tr('Also save to the shared library folder')}
              </label>
            )}
          </div>
          <p className="hint">
            {own.has(currentId)
              ? tr('This ID is in the project library: saving replaces it.')
              : tr('Saved to the project library (library.json). An ID of the standard library is replaced for this project only.')}
          </p>
        </div>
      </div>
    </Modal>
  );
}

function anchor(align: 'left' | 'center' | 'right' | undefined) {
  return align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
}

/** What a text field shows in the editor. */
function fieldSample(field: string): string {
  if (field.startsWith('pin:')) return field.slice(4);
  return { tag: '-K1', functionText: 'Function', technicalData: 'Technical data', xref: '/1.2', contactImage: '[contact image]', name: 'Name', text: 'Text' }[field] ?? `[${field}]`;
}

function GraphicView({ g, color, width, index, hit }: { g: Graphic; color: string; width: number; index: number; hit: number }) {
  const data = { 'data-kind': 'graphic', 'data-index': index, style: { cursor: 'move' } };
  const fill = 'fill' in g && g.fill ? color : 'none';
  // A wide transparent outline makes thin lines easy to click.
  const outline = { stroke: 'transparent', strokeWidth: hit, fill: 'none', pointerEvents: 'stroke' as const, ...data };
  switch (g.type) {
    case 'line':
      return (
        <g>
          <line x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} stroke={color} strokeWidth={width} pointerEvents="none" />
          <line x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} {...outline} />
        </g>
      );
    case 'polyline': {
      const points = g.points.map((p) => p.join(',')).join(' ');
      const Shape = g.closed ? 'polygon' : 'polyline';
      return (
        <g>
          <Shape points={points} stroke={color} strokeWidth={width} fill={fill} pointerEvents="none" />
          <Shape points={points} {...outline} />
        </g>
      );
    }
    case 'rect':
      return (
        <g>
          <rect x={g.x} y={g.y} width={g.width} height={g.height} stroke={color} strokeWidth={width} fill={fill} pointerEvents="none" />
          <rect x={g.x} y={g.y} width={g.width} height={g.height} {...outline} />
        </g>
      );
    case 'circle':
      return (
        <g>
          <circle cx={g.cx} cy={g.cy} r={g.r} stroke={color} strokeWidth={width} fill={fill} pointerEvents="none" />
          <circle cx={g.cx} cy={g.cy} r={g.r} {...outline} />
        </g>
      );
    case 'arc':
      return (
        <g>
          <path d={arcPath(g.cx, g.cy, g.r, g.start, g.end)} stroke={color} strokeWidth={width} fill="none" pointerEvents="none" />
          <path d={arcPath(g.cx, g.cy, g.r, g.start, g.end)} {...outline} />
        </g>
      );
    case 'text':
      return (
        <text x={g.x} y={g.y} fontSize={g.size ?? 2.5} fill={color} textAnchor={anchor(g.align)} {...data}>
          {g.text}
        </text>
      );
  }
}

// ---------------------------------------------------------------------------
// Property panels

function Num({ label, value, onChange, step = 0.5 }: { label: string; value: number | undefined; onChange: (v: number) => void; step?: number }) {
  return (
    <Field label={label}>
      <input type="number" step={step} value={value ?? ''} onChange={(e) => e.target.value !== '' && Number.isFinite(Number(e.target.value)) && onChange(Number(e.target.value))} />
    </Field>
  );
}

function AlignSelect({ value, onChange }: { value: 'left' | 'center' | 'right' | undefined; onChange: (v: 'left' | 'center' | 'right' | undefined) => void }) {
  return (
    <Field label={tr('Alignment')}>
      <select value={value ?? 'left'} onChange={(e) => onChange(e.target.value === 'left' ? undefined : (e.target.value as 'center' | 'right'))}>
        <option value="left">{tr('Left')}</option>
        <option value="center">{tr('Centered')}</option>
        <option value="right">{tr('Right')}</option>
      </select>
    </Field>
  );
}

function ElementProperties({
  kind,
  value,
  onChange,
  connections,
}: {
  kind: NonNullable<Selection>['kind'];
  value: Graphic | ConnectionPoint | TextField | FrameField;
  onChange: (v: Graphic | ConnectionPoint | TextField | FrameField) => void;
  connections: readonly ConnectionPoint[];
}) {
  if (kind === 'connection') {
    const c = value as ConnectionPoint;
    return (
      <>
        <div className="tag-fields">
          <Field label={tr('Pin ID')}>
            <input value={c.id} onChange={(e) => onChange({ ...c, id: e.target.value })} />
          </Field>
          <Field label={tr('Designation')}>
            <input value={c.designation ?? ''} onChange={(e) => onChange({ ...c, designation: e.target.value || undefined })} />
          </Field>
        </div>
        <div className="tag-fields">
          <Num label="x" value={c.x} step={1} onChange={(x) => onChange({ ...c, x: Math.round(x) })} />
          <Num label="y" value={c.y} step={1} onChange={(y) => onChange({ ...c, y: Math.round(y) })} />
          <Field label={tr('Direction')}>
            <select value={c.direction} onChange={(e) => onChange({ ...c, direction: e.target.value as ConnectionPoint['direction'] })}>
              {DIRECTIONS.map((d) => (
                <option key={d} value={d}>
                  {tr({ up: 'Up', down: 'Down', left: 'Left', right: 'Right' }[d])}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </>
    );
  }
  if (kind === 'text') {
    const t = value as TextField;
    const fields = [...SYMBOL_FIELDS, ...connections.map((c) => `pin:${c.id}`)];
    return (
      <>
        <Field label={tr('Shows')}>
          <select value={t.field} onChange={(e) => onChange({ ...t, field: e.target.value })}>
            {fields.map((f) => (
              <option key={f} value={f}>
                {f.startsWith('pin:') ? `${tr('Pin')} ${f.slice(4)}` : f}
              </option>
            ))}
          </select>
        </Field>
        <div className="tag-fields">
          <Num label="x" value={t.x} onChange={(x) => onChange({ ...t, x })} />
          <Num label="y" value={t.y} onChange={(y) => onChange({ ...t, y })} />
          <Num label={tr('Size (mm)')} value={t.size} step={0.25} onChange={(size) => onChange({ ...t, size })} />
        </div>
        <AlignSelect value={t.align} onChange={(align) => onChange(align ? { ...t, align } : (({ align: _a, ...rest }) => rest)(t))} />
      </>
    );
  }
  if (kind === 'field') {
    const f = value as FrameField;
    return (
      <>
        <Field label={tr('Shows')}>
          <input list="frame-sources" value={f.source} onChange={(e) => onChange({ ...f, source: e.target.value })} />
          <datalist id="frame-sources">
            {FRAME_SOURCES.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
        <div className="tag-fields">
          <Num label="x" value={f.x} onChange={(x) => onChange({ ...f, x })} />
          <Num label="y" value={f.y} onChange={(y) => onChange({ ...f, y })} />
          <Num label={tr('Size (mm)')} value={f.size} step={0.25} onChange={(size) => onChange({ ...f, size })} />
          <Num label={tr('Height (mm)')} value={f.height} onChange={(height) => onChange({ ...f, height })} />
        </div>
        <AlignSelect value={f.align} onChange={(align) => onChange(align ? { ...f, align } : (({ align: _a, ...rest }) => rest)(f))} />
      </>
    );
  }
  const g = value as Graphic;
  return (
    <>
      <div className="tag-fields">
        {g.type === 'line' && (
          <>
            <Num label="x1" value={g.x1} onChange={(x1) => onChange({ ...g, x1 })} />
            <Num label="y1" value={g.y1} onChange={(y1) => onChange({ ...g, y1 })} />
            <Num label="x2" value={g.x2} onChange={(x2) => onChange({ ...g, x2 })} />
            <Num label="y2" value={g.y2} onChange={(y2) => onChange({ ...g, y2 })} />
          </>
        )}
        {g.type === 'rect' && (
          <>
            <Num label="x" value={g.x} onChange={(x) => onChange({ ...g, x })} />
            <Num label="y" value={g.y} onChange={(y) => onChange({ ...g, y })} />
            <Num label={tr('Width (mm)')} value={g.width} onChange={(width) => onChange({ ...g, width })} />
            <Num label={tr('Height (mm)')} value={g.height} onChange={(height) => onChange({ ...g, height })} />
          </>
        )}
        {(g.type === 'circle' || g.type === 'arc') && (
          <>
            <Num label="x" value={g.cx} onChange={(cx) => onChange({ ...g, cx })} />
            <Num label="y" value={g.cy} onChange={(cy) => onChange({ ...g, cy })} />
            <Num label="r" value={g.r} onChange={(r) => r > 0 && onChange({ ...g, r })} />
          </>
        )}
        {g.type === 'arc' && (
          <>
            <Num label={tr('Start (°)')} value={g.start} step={15} onChange={(start) => onChange({ ...g, start })} />
            <Num label={tr('End (°)')} value={g.end} step={15} onChange={(end) => onChange({ ...g, end })} />
          </>
        )}
        {g.type === 'text' && (
          <>
            <Num label="x" value={g.x} onChange={(x) => onChange({ ...g, x })} />
            <Num label="y" value={g.y} onChange={(y) => onChange({ ...g, y })} />
            <Num label={tr('Size (mm)')} value={g.size} step={0.25} onChange={(size) => onChange({ ...g, size })} />
          </>
        )}
      </div>
      {g.type === 'text' && (
        <>
          <Field label={tr('Text')}>
            <input value={g.text} onChange={(e) => onChange({ ...g, text: e.target.value })} />
          </Field>
          <AlignSelect value={g.align} onChange={(align) => onChange(align ? { ...g, align } : (({ align: _a, ...rest }) => rest)(g))} />
        </>
      )}
      {g.type === 'polyline' && (
        <>
          <Field label={tr('Points (x,y x,y …)')}>
            <input
              defaultValue={g.points.map((p) => p.join(',')).join(' ')}
              onBlur={(e) => {
                const points = e.target.value
                  .trim()
                  .split(/\s+/)
                  .map((p) => p.split(',').map(Number) as [number, number])
                  .filter((p) => p.length === 2 && p.every(Number.isFinite));
                if (points.length >= 2) onChange({ ...g, points });
              }}
            />
          </Field>
          <label className="check">
            <input type="checkbox" checked={g.closed === true} onChange={(e) => onChange({ ...g, closed: e.target.checked || undefined })} /> {tr('Closed')}
          </label>
        </>
      )}
      {(g.type === 'rect' || g.type === 'circle' || g.type === 'polyline') && (
        <label className="check">
          <input type="checkbox" checked={g.fill === true} onChange={(e) => onChange({ ...g, fill: e.target.checked || undefined })} /> {tr('Filled')}
        </label>
      )}
    </>
  );
}

function SymbolProperties({ symbol, onChange, languages }: { symbol: SymbolDefinition; onChange: (s: SymbolDefinition) => void; languages: string[] }) {
  const store = useStore();
  const functions = [...new Set(store.library.symbols().map((s) => s.function))].sort();
  const categories = [...new Set(store.library.symbols().map((s) => s.category))].sort();
  const linkMode = symbol.links === undefined ? 'all' : symbol.links.length === 0 ? 'none' : 'drawn';
  return (
    <>
      <div className="tag-fields">
        <Field label="ID">
          <input value={symbol.id} onChange={(e) => onChange({ ...symbol, id: e.target.value })} />
        </Field>
        <Field label={tr('Category')}>
          <input list="sym-categories" value={symbol.category} onChange={(e) => onChange({ ...symbol, category: e.target.value })} />
        </Field>
      </div>
      <datalist id="sym-categories">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <LanguageFields label={tr('Name')} values={texts(symbol.name, languages)} onChange={(v) => onChange({ ...symbol, name: toLocalized(v) ?? symbol.id })} />
      <div className="tag-fields">
        <Field label={tr('Function')}>
          <input list="sym-functions" value={symbol.function} onChange={(e) => onChange({ ...symbol, function: e.target.value })} />
        </Field>
        <Field label={tr('Role')}>
          <select value={symbol.defaultRole} onChange={(e) => onChange({ ...symbol, defaultRole: e.target.value as SymbolDefinition['defaultRole'] })}>
            <option value="main">{tr('Main function (master)')}</option>
            <option value="auxiliary">{tr('Auxiliary function')}</option>
            <option value="none">{tr('No device')}</option>
          </select>
        </Field>
        <Field label={tr('Letter code')}>
          <input value={symbol.letterCode ?? ''} onChange={(e) => onChange({ ...symbol, letterCode: e.target.value || undefined })} />
        </Field>
      </div>
      <datalist id="sym-functions">
        {functions.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      <Field label={tr('Pin links (potential passes through)')}>
        <select
          value={linkMode}
          onChange={(e) => {
            const next = { ...symbol };
            if (e.target.value === 'all') delete next.links;
            else if (e.target.value === 'none') next.links = [];
            else next.links = symbol.links && symbol.links.length > 0 ? symbol.links : [];
            onChange(next);
          }}
        >
          <option value="all">{tr('All pins linked')}</option>
          <option value="none">{tr('No pins linked')}</option>
          <option value="drawn">{tr('As drawn (link tool)')}</option>
        </select>
      </Field>
      {symbol.links && symbol.links.length > 0 && <p className="hint">{symbol.links.map((g) => g.join('–')).join(', ')}</p>}
      {symbol.defaultRole === 'main' && (
        <label className="check">
          <input type="checkbox" checked={symbol.hasContactImage === true} onChange={(e) => onChange({ ...symbol, hasContactImage: e.target.checked || undefined })} /> {tr('Shows a contact image of its contacts')}
        </label>
      )}
    </>
  );
}

function FrameProperties({ frame, onChange, languages }: { frame: FrameDefinition; onChange: (f: FrameDefinition) => void; languages: string[] }) {
  const area = frame.drawingArea;
  return (
    <>
      <Field label="ID">
        <input value={frame.id} onChange={(e) => onChange({ ...frame, id: e.target.value })} />
      </Field>
      <LanguageFields label={tr('Name')} values={texts(frame.name, languages)} onChange={(v) => onChange({ ...frame, name: toLocalized(v) ?? frame.id })} />
      <div className="tag-fields">
        <Num label={tr('Width (mm)')} value={frame.size.width} step={1} onChange={(width) => width > 0 && onChange({ ...frame, size: { ...frame.size, width } })} />
        <Num label={tr('Height (mm)')} value={frame.size.height} step={1} onChange={(height) => height > 0 && onChange({ ...frame, size: { ...frame.size, height } })} />
      </div>
      <fieldset>
        <legend>{tr('Drawing area')}</legend>
        <div className="tag-fields">
          <Num label="x" value={area.x} step={1} onChange={(x) => onChange({ ...frame, drawingArea: { ...area, x } })} />
          <Num label="y" value={area.y} step={1} onChange={(y) => onChange({ ...frame, drawingArea: { ...area, y } })} />
          <Num label={tr('Width (mm)')} value={area.width} step={1} onChange={(width) => width > 0 && onChange({ ...frame, drawingArea: { ...area, width } })} />
          <Num label={tr('Height (mm)')} value={area.height} step={1} onChange={(height) => height > 0 && onChange({ ...frame, drawingArea: { ...area, height } })} />
        </div>
      </fieldset>
      <fieldset>
        <legend>{tr('Columns and rows')}</legend>
        <div className="tag-fields">
          <Num label={tr('Columns')} value={frame.columns.count} step={1} onChange={(count) => count >= 1 && onChange({ ...frame, columns: { ...frame.columns, count: Math.round(count), width: area.width / Math.round(count), x: area.x } })} />
          <Field label={tr('Row labels')}>
            <input
              defaultValue={frame.rows.labels.join(',')}
              onBlur={(e) => {
                const labels = e.target.value.split(',').map((l) => l.trim()).filter(Boolean);
                if (labels.length > 0) onChange({ ...frame, rows: { labels, y: area.y, height: area.height / labels.length } });
              }}
            />
          </Field>
        </div>
        <p className="hint">{tr('Columns and rows divide the drawing area evenly; they drive the border labels, cross-references and page-column device names.')}</p>
      </fieldset>
    </>
  );
}
