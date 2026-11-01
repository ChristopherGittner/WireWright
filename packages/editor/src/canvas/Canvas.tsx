import { CommandError, pageConnectionPoints, effectiveTag, itemRole, placeFunctionCommand, placedFunctions, placePlcCommand, relativeTag, tagContext, tagFromLeftNeighbour, type Command, type Rotation, type SchematicPage } from '@wirewright/core';
import { renderContext, renderSheet, type Scene } from '@wirewright/render';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { fieldCommands, fieldValue } from '../editing.js';
import { insertBreak, readBreaks, showBreaks } from '../lineInput.js';
import { PLC_DRAG_TYPE, startStyleBrush, SYMBOL_DRAG_TYPE, useEditor, useStore, type PlcDragPayload, type SymbolDragPayload } from '../store.js';
import { elementBounds, inside, itemBounds, pad, union, type Box } from './bounds.js';

/** Half size (mm) of the clickable spot of connection symbols such as corners. */
const JUNCTION_HIT = 1.5;
import { SceneGraphics, SceneTexts } from './SceneView.js';
import { LayoutCanvas } from './LayoutCanvas.js';
import { tr, trKeys } from '../i18n.js';
import { openBoxAsSymbol } from '../dialogs/Dialogs.js';

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Drag =
  | { kind: 'move'; start: Point; itemIds: string[] }
  | { kind: 'text'; start: Point; itemId: string; field: string; offset: { dx: number; dy: number } }
  | { kind: 'band'; start: Point; additive: boolean }
  | { kind: 'box'; start: Point }
  | { kind: 'pan'; screen: { x: number; y: number }; view: ViewBox };

interface Point {
  x: number;
  y: number;
}

/** The canvas of the current page: schematic and report sheets, or a cabinet layout. */
export function Canvas() {
  const doc = useEditor((s) => s.doc);
  useEditor((s) => s.version);
  const sheetKey = useEditor((s) => s.sheet);
  const page = doc && sheetKey ? doc.state.pages[sheetKey.pageId] : undefined;
  return page?.type === 'layout' ? <LayoutCanvas key={page.id} pageId={page.id} /> : <SchematicCanvas />;
}

function SchematicCanvas() {
  const store = useStore();
  const doc = useEditor((s) => s.doc);
  useEditor((s) => s.version);
  const sheetKey = useEditor((s) => s.sheet);
  const tool = useEditor((s) => s.tool);
  const grid = useEditor((s) => s.grid);
  const showLinks = useEditor((s) => s.showLinks);
  const language = useEditor((s) => s.language);
  const selection = useEditor((s) => s.selection);
  const focus = useEditor((s) => s.focus);
  const inlineEdit = useEditor((s) => s.inlineEdit);

  const svgRef = useRef<SVGSVGElement>(null);
  // A state (not a ref), so the size observer starts when the container appears:
  // without a page the canvas renders a placeholder first.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [view, setView] = useState<ViewBox>({ x: -10, y: -10, w: 440, h: 317 });
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [preview, setPreview] = useState<Command[] | null>(null);
  /**
   * While something is dragged from a panel, a transparent layer covers the canvas and receives
   * the drop. Without it the drop goes to the element under the mouse at the browser's last
   * target check, which can be a ghost element that was redrawn since then (the drop is lost).
   */
  const compare = useEditor((s) => s.compare);
  const [dropLayer, setDropLayer] = useState(false);
  /** Right-click menu on symbols, in screen coordinates relative to the canvas. */
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [band, setBand] = useState<Box | null>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const spaceDown = useRef(false);
  const lastDragAt = useRef<Point | null>(null);

  const page = doc && sheetKey ? doc.state.pages[sheetKey.pageId] : undefined;
  const editable = page?.type === 'schematic';

  // The document shown: with the preview commands of a drag or of the symbol being placed.
  const displayDoc = useMemo(() => {
    if (!doc || !preview) return doc;
    try {
      return doc.preview(preview).doc;
    } catch (error) {
      if (error instanceof CommandError) return doc;
      throw error;
    }
  }, [doc, doc?.state, preview]);

  const scene: Scene | null = useMemo(() => {
    if (!displayDoc || !sheetKey) return null;
    const ctx = renderContext(displayDoc);
    const sheet = ctx.sheets.find((s) => s.pageId === sheetKey.pageId && s.sheet === sheetKey.sheet) ?? ctx.sheets.find((s) => s.pageId === sheetKey.pageId);
    return sheet ? renderSheet(ctx, sheet, { showLinks, language, junctionStubs: true, placeholders: true }) : null;
  }, [displayDoc, displayDoc?.state, sheetKey, showLinks, language]);

  const bounds = useMemo(() => {
    const map = scene ? itemBounds(scene.elements) : new Map<string, Box>();
    // Symbols that draw (almost) nothing themselves, like corners (only the wires meeting there) or
    // T-junctions (a dot), get a small area around their point, so they can be clicked.
    const shown = displayDoc && sheetKey ? displayDoc.state.pages[sheetKey.pageId] : undefined;
    if (shown?.type === 'schematic') {
      for (const item of shown.items) {
        if (!store.library.symbol(item.symbol)?.function.startsWith('connection.')) continue;
        const spot = { x1: item.x - JUNCTION_HIT, y1: item.y - JUNCTION_HIT, x2: item.x + JUNCTION_HIT, y2: item.y + JUNCTION_HIT };
        map.set(item.id, union(map.get(item.id), spot));
      }
    }
    return map;
  }, [scene, displayDoc, displayDoc?.state, sheetKey]);
  // Alignment guides while moving or placing: connection points of the moving symbols that line up
  // with a pin of another symbol (green when the two face each other, so autoconnect joins them).
  const guides = useMemo(() => {
    if (!preview || !displayDoc || page?.type !== 'schematic') return [];
    const shown = displayDoc.state.pages[page.id];
    if (shown?.type !== 'schematic') return [];
    const before = new Set(page.items.map((i) => i.id));
    const moving = new Set(drag?.kind === 'move' ? drag.itemIds : shown.items.filter((i) => !before.has(i.id)).map((i) => i.id));
    if (moving.size === 0) return [];
    const points = pageConnectionPoints(shown, store.library);
    const fixed = points.filter((q) => !moving.has(q.itemId));
    const lines = new Map<string, { x1: number; y1: number; x2: number; y2: number; joins: boolean }>();
    for (const m of points) {
      if (!moving.has(m.itemId)) continue;
      let column: (typeof points)[number] | undefined;
      let row: (typeof points)[number] | undefined;
      for (const o of fixed) {
        if (o.medium !== m.medium) continue;
        if (o.x === m.x && o.y !== m.y && (!column || Math.abs(o.y - m.y) < Math.abs(column.y - m.y))) column = o;
        if (o.y === m.y && o.x !== m.x && (!row || Math.abs(o.x - m.x) < Math.abs(row.x - m.x))) row = o;
      }
      const add = (o: (typeof points)[number], joins: boolean) => {
        const key = [m.x, m.y, o.x, o.y].join(',');
        if (!lines.has(key)) lines.set(key, { x1: m.x, y1: m.y, x2: o.x, y2: o.y, joins });
      };
      if (column) add(column, (column.y > m.y && m.direction === 'down' && column.direction === 'up') || (column.y < m.y && m.direction === 'up' && column.direction === 'down'));
      if (row) add(row, (row.x > m.x && m.direction === 'right' && row.direction === 'left') || (row.x < m.x && m.direction === 'left' && row.direction === 'right'));
    }
    return [...lines.values()];
  }, [preview, displayDoc, displayDoc?.state, page, drag]);
  // Problems on this page, shown as markers next to the affected items (hints only in the issues list).
  const markers = useMemo(() => {
    if (!displayDoc || !sheetKey) return [];
    const worst = new Map<string, 'error' | 'warning'>();
    for (const issue of displayDoc.check()) {
      if (issue.pageId !== sheetKey.pageId || !issue.itemId || issue.severity === 'info' || issue.acknowledged) continue;
      if (worst.get(issue.itemId) !== 'error') worst.set(issue.itemId, issue.severity);
    }
    return [...worst];
  }, [displayDoc, displayDoc?.state, sheetKey]);
  const isBox = (itemId: string) => {
    const item = editable ? page.items.find((i) => i.id === itemId) : undefined;
    return item ? store.library.symbol(item.symbol)?.resizable === true : false;
  };

  // Fit the page when the container size or the page changes.
  useLayoutEffect(() => {
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [container]);

  const fit = () => {
    if (!scene) return;
    const margin = 8;
    const w = scene.width + 2 * margin;
    const h = scene.height + 2 * margin;
    const aspect = size.width / Math.max(size.height, 1);
    if (w / h > aspect) setView({ x: -margin, y: -margin - (w / aspect - h) / 2, w, h: w / aspect });
    else setView({ x: -margin - (h * aspect - w) / 2, y: -margin, w: h * aspect, h });
  };
  useEffect(fit, [sheetKey?.pageId, size.width, size.height, scene?.width]);

  // Keep the aspect ratio of the view equal to the container.
  const viewBox = useMemo(() => {
    const aspect = size.width / Math.max(size.height, 1);
    const h = view.w / aspect;
    return { ...view, h };
  }, [view, size]);

  // Center on an item when asked (jump to cross-reference target). Once per request: the
  // bounds change with every preview (placing, dragging), which must not move the view again.
  const focused = useRef<number | null>(null);
  useEffect(() => {
    if (!focus || focused.current === focus.nonce) return;
    const b = bounds.get(focus.itemId);
    if (!b) return; // the target page is not drawn yet
    focused.current = focus.nonce;
    const cx = (b.x1 + b.x2) / 2;
    const cy = (b.y1 + b.y2) / 2;
    setView((v) => {
      const w = Math.min(v.w, 160);
      const h = w / (size.width / Math.max(size.height, 1));
      return { x: cx - w / 2, y: cy - h / 2, w, h };
    });
  }, [focus?.nonce, bounds]);

  /** The command placing a PLC channel or card view (PLC tab) at a snapped point of this page. */
  function plcCommandAt(payload: PlcDragPayload, at: Point) {
    if (!doc || page?.type !== 'schematic') return undefined;
    try {
      // A card: drawn here (from the PLC tab's cards), or a further drawing if it is drawn already.
      if (payload.channel === undefined) return { type: 'placePlcCard' as const, itemId: payload.itemId, pageId: page.id, x: at.x, y: at.y };
      return placePlcCommand(doc.state, store.library, { pageId: payload.pageId, itemId: payload.itemId }, { pageId: page.id, x: at.x, y: at.y }, payload.channel);
    } catch {
      return undefined;
    }
  }

  // Ghost of the symbol (or device function) being placed.
  useEffect(() => {
    if ((tool.kind !== 'place' && tool.kind !== 'device' && tool.kind !== 'macro' && tool.kind !== 'plc' && tool.kind !== 'paste') || !hover || !editable) {
      if (!drag) setPreview(null);
      return;
    }
    if (tool.kind === 'place') {
      setPreview([{ type: 'placeSymbol', pageId: page.id, symbol: tool.symbol, x: hover.x, y: hover.y, rotation: tool.rotation, mirror: tool.mirror }]);
    } else if (tool.kind === 'plc') {
      const command = plcCommandAt(tool.payload, hover);
      setPreview(command ? [command] : null);
    } else if (tool.kind === 'paste') {
      const at = store.pastePoint(hover);
      setPreview([{ type: 'placeItems', pageId: page.id, items: tool.items, x: at.x, y: at.y }]);
    } else if (tool.kind === 'macro') {
      const macro = store.library.macro(tool.macro);
      setPreview(macro ? [{ type: 'placeItems', pageId: page.id, items: macro.items, x: hover.x, y: hover.y }] : null);
    } else {
      const command = deviceCommand(page, hover);
      setPreview(command ? [command] : null);
    }
  }, [tool, hover?.x, hover?.y, editable, page?.id]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) spaceDown.current = true;
      if (e.key === 'Home' && !(e.target instanceof HTMLInputElement)) fit();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  });

  if (!doc || !page || !scene) return <div className="canvas empty">{tr('No page')}</div>;

  const toPage = (clientX: number, clientY: number): Point => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  };
  const snap = (p: Point): Point => ({ x: Math.round(p.x / grid) * grid, y: Math.round(p.y / grid) * grid });
  const scale = size.width / viewBox.w; // px per mm

  const onWheel = (e: React.WheelEvent) => {
    const p = toPage(e.clientX, e.clientY);
    const factor = Math.exp(e.deltaY * 0.0015);
    setView((v) => {
      const w = Math.min(Math.max(v.w * factor, 20), 2000);
      const f = w / v.w;
      return { x: p.x - (p.x - v.x) * f, y: p.y - (p.y - v.y) * f, w, h: v.h * f };
    });
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (inlineEdit) store.set({ inlineEdit: null });
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (e.button === 1 || (e.button === 0 && spaceDown.current)) {
      setDrag({ kind: 'pan', screen: { x: e.clientX, y: e.clientY }, view });
      return;
    }
    if (e.button !== 0) return;
    const p = toPage(e.clientX, e.clientY);
    const target = e.target as SVGElement;
    const itemId = target.dataset.item ?? target.dataset.hit;
    const field = target.dataset.field;

    if (!editable) return;
    if (tool.kind === 'place') {
      placeSymbol(snap(p));
      return;
    }
    if (tool.kind === 'device') {
      placeDeviceFunction(snap(p));
      return;
    }
    if (tool.kind === 'macro') {
      placeMacro(snap(p));
      return;
    }
    if (tool.kind === 'paste') {
      const at = store.pastePoint(snap(p));
      const result = store.apply({ type: 'placeItems', pageId: page.id, items: tool.items, x: at.x, y: at.y }, 'paste');
      if (result) store.set({ tool: { kind: 'select' }, selection: { items: result.created } });
      return;
    }
    if (tool.kind === 'plc') {
      const command = plcCommandAt(tool.payload, snap(p));
      const result = command && store.apply(command, 'place PLC symbol');
      // Placed once: back to selecting (a channel is drawn only once).
      if (result) store.set({ tool: { kind: 'select' }, selection: { items: result.created } });
      return;
    }
    if (tool.kind === 'box' || tool.kind === 'cable') {
      setDrag({ kind: 'box', start: snap(p) });
      return;
    }
    if (tool.kind === 'brush') {
      // A click gives the symbol the brush's text layout; a band gives it to all symbols inside.
      if (itemId) store.apply({ type: 'applyItemStyle', pageId: page.id, itemIds: [itemId], style: tool.style }, 'copy style');
      else setDrag({ kind: 'band', start: p, additive: false });
      return;
    }
    // A click anywhere on a symbol (also on its texts) selects and moves the whole symbol.
    // Ctrl+click on a text (tag, function text, pin, cross-reference …) selects only that text,
    // to move it or edit it with F2; on a cross-reference, F then follows it.
    const textOnly = (e.ctrlKey || e.metaKey) && (!!field || target.dataset.role === 'xref');
    // A cross-reference: select it and remember where it points, so F can follow it.
    const { targetPage, targetItem } = target.dataset;
    if (textOnly && itemId && targetPage && targetItem && target.dataset.role === 'xref') {
      const item = page.items.find((i) => i.id === itemId);
      store.select({ items: [itemId], text: { itemId, field: field ?? 'xref', target: { pageId: targetPage, itemId: targetItem } } });
      if (field) setDrag({ kind: 'text', start: p, itemId, field, offset: item?.texts?.[field] ?? { dx: 0, dy: 0 } });
      return;
    }
    if (textOnly && field && itemId && target.dataset.role !== 'box') {
      const item = page.items.find((i) => i.id === itemId);
      store.select({ items: [itemId], text: { itemId, field } });
      if (target.dataset.role === 'text') setDrag({ kind: 'text', start: p, itemId, field, offset: item?.texts?.[field] ?? { dx: 0, dy: 0 } });
      return;
    }
    if (itemId) {
      // Shift+click (and Ctrl+click on the symbol's graphics) adds to or removes from the selection.
      const additive = e.shiftKey || ((e.ctrlKey || e.metaKey) && !field);
      let items = selection.items;
      if (additive) items = items.includes(itemId) ? items.filter((i) => i !== itemId) : [...items, itemId];
      else if (!items.includes(itemId)) items = [itemId];
      store.select({ items });
      if (!additive) setDrag({ kind: 'move', start: snap(p), itemIds: items });
      return;
    }
    if (!(e.ctrlKey || e.metaKey || e.shiftKey)) store.select({ items: [] });
    setDrag({ kind: 'band', start: p, additive: e.ctrlKey || e.metaKey || e.shiftKey });
  };

  // Drag and drop from the PLC tab: a channel places its I/O point, a card a further overview.
  const plcCommand = (drag: PlcDragPayload | null, clientX: number, clientY: number) =>
    drag && editable ? plcCommandAt(drag, snap(toPage(clientX, clientY))) : undefined;
  const isPlcDrag = (e: React.DragEvent) => store.plcDrag !== null || e.dataTransfer.types.includes(PLC_DRAG_TYPE);
  const isSymbolDrag = (e: React.DragEvent) => store.symbolDrag !== null || e.dataTransfer.types.includes(SYMBOL_DRAG_TYPE);
  /** Ghost of a symbol or macro dragged from the Symbols tab. */
  const symbolCommand = (drag: SymbolDragPayload | null, at: Point): Command | undefined => {
    if (!drag || !editable) return undefined;
    if (drag.symbol) return { type: 'placeSymbol', pageId: page.id, symbol: drag.symbol, x: at.x, y: at.y };
    const macro = drag.macro ? store.library.macro(drag.macro) : undefined;
    return macro ? { type: 'placeItems', pageId: page.id, items: macro.items, x: at.x, y: at.y } : undefined;
  };
  const onDragEnter = (e: React.DragEvent) => {
    if ((isSymbolDrag(e) || isPlcDrag(e)) && editable) setDropLayer(true);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (isSymbolDrag(e) && editable) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      const at = snap(toPage(e.clientX, e.clientY));
      if (lastDragAt.current && lastDragAt.current.x === at.x && lastDragAt.current.y === at.y) return;
      lastDragAt.current = at;
      const command = symbolCommand(store.symbolDrag, at);
      setPreview(command ? [command] : null);
      return;
    }
    if (!isPlcDrag(e) || !editable) return;
    // Accept on every event (the browser asks continuously), but redraw the ghost only when the
    // snapped position changes.
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const at = snap(toPage(e.clientX, e.clientY));
    if (lastDragAt.current && lastDragAt.current.x === at.x && lastDragAt.current.y === at.y) return;
    lastDragAt.current = at;
    const command = plcCommand(store.plcDrag, e.clientX, e.clientY);
    setPreview(command ? [command] : null);
  };
  const onDragLeave = (e: React.DragEvent) => {
    // Moving over elements inside the canvas also fires dragleave: only leaving the canvas counts.
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    lastDragAt.current = null;
    setDropLayer(false);
    setPreview(null);
  };
  const onDrop = (e: React.DragEvent) => {
    setDropLayer(false);
    if (isSymbolDrag(e)) {
      e.preventDefault();
      let drag = store.symbolDrag;
      try {
        drag ??= JSON.parse(e.dataTransfer.getData(SYMBOL_DRAG_TYPE)) as SymbolDragPayload;
      } catch {
        drag = null;
      }
      lastDragAt.current = null;
      store.symbolDrag = null;
      setPreview(null);
      const at = snap(toPage(e.clientX, e.clientY));
      if (drag?.symbol) placeSymbolAt(drag.symbol, at);
      else if (drag?.macro) placeMacroAt(drag.macro, at);
      return;
    }
    if (!isPlcDrag(e)) return;
    e.preventDefault();
    let drag = store.plcDrag;
    try {
      drag ??= JSON.parse(e.dataTransfer.getData(PLC_DRAG_TYPE)) as PlcDragPayload;
    } catch {
      drag = null;
    }
    const command = plcCommand(drag, e.clientX, e.clientY);
    lastDragAt.current = null;
    store.plcDrag = null;
    setPreview(null);
    if (!command) return;
    const result = store.apply(command, 'place PLC symbol');
    if (result) store.select({ items: result.created });
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const p = toPage(e.clientX, e.clientY);
    const s = snap(p);
    if (!hover || hover.x !== s.x || hover.y !== s.y) {
      setHover(s);
      store.set({ cursor: s });
    }
    if (!drag || !editable) {
      if (drag?.kind === 'pan') pan(e);
      return;
    }
    switch (drag.kind) {
      case 'pan':
        return pan(e);
      case 'move': {
        const dx = s.x - drag.start.x;
        const dy = s.y - drag.start.y;
        setPreview(dx || dy ? [{ type: 'moveItems', pageId: page.id, itemIds: drag.itemIds, dx, dy }] : null);
        return;
      }
      case 'text': {
        const dx = Math.round((p.x - drag.start.x) * 2) / 2;
        const dy = Math.round((p.y - drag.start.y) * 2) / 2;
        setPreview(dx || dy ? [{ type: 'moveItemText', pageId: page.id, itemId: drag.itemId, field: drag.field, offset: { dx: drag.offset.dx + dx, dy: drag.offset.dy + dy } }] : null);
        return;
      }
      case 'band':
      case 'box': {
        const a = drag.kind === 'box' ? drag.start : drag.start;
        const b = drag.kind === 'box' ? s : p;
        setBand({ x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y) });
        return;
      }
    }
  };

  const pan = (e: ReactPointerEvent) => {
    if (drag?.kind !== 'pan') return;
    const dx = (e.clientX - drag.screen.x) / scale;
    const dy = (e.clientY - drag.screen.y) / scale;
    setView({ ...drag.view, x: drag.view.x - dx, y: drag.view.y - dy });
  };

  const onPointerUp = () => {
    if (drag && editable) {
      if ((drag.kind === 'move' || drag.kind === 'text') && preview) store.apply(preview, drag.kind === 'move' ? 'move' : 'move text');
      if (drag.kind === 'band' && band && tool.kind === 'brush') {
        const hits = [...bounds].filter(([, b]) => inside(b, band)).map(([id]) => id);
        if (hits.length > 0) store.apply({ type: 'applyItemStyle', pageId: page.id, itemIds: hits, style: tool.style }, 'copy style');
      } else if (drag.kind === 'band' && band) {
        const hits = [...bounds].filter(([, b]) => inside(b, band)).map(([id]) => id);
        store.select({ items: drag.additive ? [...new Set([...selection.items, ...hits])] : hits });
      }
      if (drag.kind === 'box' && band && tool.kind === 'box') createBox(band);
      if (drag.kind === 'box' && band && tool.kind === 'cable') createCable(drag.start, band);
    }
    setDrag(null);
    setBand(null);
    if (tool.kind !== 'place') setPreview(null);
  };

  const placeSymbol = (at: Point) => {
    if (tool.kind !== 'place' || !editable) return;
    placeSymbolAt(tool.symbol, at, tool.rotation, tool.mirror);
  };
  /** Places a symbol (click with the place tool, or drop from the Symbols tab). */
  const placeSymbolAt = (symbol: string, at: Point, rotation: Rotation = 0, mirror = false) => {
    if (!editable) return;
    const command: Extract<Command, { type: 'placeSymbol' }> = { type: 'placeSymbol', pageId: page.id, symbol, x: at.x, y: at.y, rotation, mirror };
    const def = store.library.symbol(symbol);
    // A contact belongs to the device box it is in, or to the nearest device to its left at the same
    // height; only without either the editor asks for the device.
    const hasDevice = tagContext(page, at, store.library).product !== undefined || tagFromLeftNeighbour(page, at, store.library) !== undefined;
    if (def && itemRole({ id: 'i_x', symbol: def.id, x: 0, y: 0, rotation: 0, mirror: false }, def) === 'auxiliary' && !hasDevice) {
      store.set({ dialog: { kind: 'placeAuxiliary', command } });
    } else {
      const result = store.apply(command, 'place');
      if (result) store.select({ items: result.created });
      // A placed text asks for its content right away.
      if (result && def?.function === 'text') store.set({ dialog: { kind: 'item', pageId: page.id, itemIds: result.created, isNew: true } });
    }
  };

  /** Places the macro of the macro tool; the first placement copies it into the project library. */
  const placeMacro = (at: Point) => {
    if (tool.kind !== 'macro') return;
    placeMacroAt(tool.macro, at);
  };
  /** Places a macro (click with the macro tool, or drop from the Symbols tab). */
  const placeMacroAt = (macroId: string, at: Point) => {
    if (!editable || !doc) return;
    const macro = store.library.macro(macroId);
    if (!macro) return;
    const inProject = doc.state.library?.macros?.some((m) => m.id === macro.id);
    const place: Command = { type: 'placeItems', pageId: page.id, macro: macro.id, x: at.x, y: at.y };
    const commands: Command[] = inProject ? [place] : [{ type: 'addToProjectLibrary', content: { macros: [macro] } }, place];
    const result = store.apply(commands, 'place macro');
    if (result) store.select({ items: result.created });
  };

  /** The command placing the current function of the device tool at `at`, with the device's tag relative to the page. */
  function deviceCommand(target: SchematicPage, at: Point): Extract<Command, { type: 'placeSymbol' }> | undefined {
    if (tool.kind !== 'device') return undefined;
    const def = store.library.device(tool.device);
    if (!def) return undefined;
    const tag = tool.tag ? relativeTag(tool.tag, tagContext(target, at, store.library)) : undefined;
    return placeFunctionCommand(def, tool.index, store.library, {
      pageId: target.id,
      x: at.x,
      y: at.y,
      rotation: tool.rotation,
      mirror: tool.mirror,
      ...(tag && Object.keys(tag).length > 0 ? { tag } : {}),
    });
  }

  /**
   * Places the current function of the device tool. The first placement copies
   * the definition into the project library; the device's tag is remembered so
   * the following functions (Tab) join the same device.
   */
  const placeDeviceFunction = (at: Point) => {
    if (tool.kind !== 'device' || !editable || !doc) return;
    const def = store.library.device(tool.device);
    const command = deviceCommand(page, at);
    if (!def || !command) return;
    const isMain = command.main === true;
    if (!isMain && !tool.tag && !tagFromLeftNeighbour(page, at, store.library) && tagContext(page, at, store.library).product === undefined) {
      store.notify('Place the main function first, or press Tab to choose it', true);
      return;
    }
    const inProject = doc.state.library?.devices?.some((d) => d.id === def.id);
    const commands: Command[] = inProject ? [command] : [{ type: 'addToProjectLibrary', content: { devices: [def] } }, command];
    const result = store.apply(commands, 'place');
    const id = result?.created[0];
    if (!id) return;
    const placedPage = doc.state.pages[page.id] as SchematicPage;
    const item = placedPage.items.find((i) => i.id === id)!;
    const tag = effectiveTag(placedPage, item, store.library);
    const key = doc.devices().byItem.get(id);
    const placed = placedFunctions(def, key ? doc.devices().devices.get(key) : undefined, doc.state);
    const next = def.functions.findIndex((_, i) => !placed.has(i) && i > tool.index);
    const wrap = def.functions.findIndex((_, i) => !placed.has(i));
    const index = next >= 0 ? next : wrap;
    if (index < 0) store.set({ tool: { kind: 'select' }, selection: { items: [id] } });
    else store.set({ tool: { ...tool, index, tag } });
  };

  /** A cable line from the drag: horizontal or vertical, whichever is longer; then its properties to choose the type. */
  const createCable = (start: Point, rect: Box) => {
    if (tool.kind !== 'cable' || !editable) return;
    const line = cableLineOf(start, rect);
    const horizontal = line.y1 === line.y2;
    const length = Math.max(horizontal ? line.x2 - line.x1 : line.y2 - line.y1, 8);
    const result = store.apply(
      { type: 'placeSymbol', pageId: page.id, symbol: tool.symbol, x: line.x1, y: line.y1, ...(horizontal ? { width: length } : { height: length }) },
      'cable',
    );
    const id = result?.created[0];
    store.set({ tool: { kind: 'select' } });
    if (id) store.set({ selection: { items: [id] }, dialog: { kind: 'item', pageId: page.id, itemIds: [id] } });
  };

  const createBox = (rect: Box) => {
    if (tool.kind !== 'box' || !editable) return;
    const width = Math.max(rect.x2 - rect.x1, 8);
    const height = Math.max(rect.y2 - rect.y1, 8);
    const command: Extract<Command, { type: 'placeSymbol' }> = { type: 'placeSymbol', pageId: page.id, symbol: tool.symbol, x: rect.x1, y: rect.y1, width, height };
    if (tool.symbol === 'wirewright.box.structure') store.set({ dialog: { kind: 'structureBox', command } });
    else {
      const result = store.apply(command, 'device box');
      if (result) store.select({ items: result.created });
    }
    store.set({ tool: { kind: 'select' } });
  };

  // Right-click: a symbol joins the selection (or becomes it) and the menu opens; a placing
  // tool is cancelled instead.
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!editable) return;
    if (tool.kind !== 'select') return store.set({ tool: { kind: 'select' } });
    const target = e.target as SVGElement;
    const itemId = target.dataset.item ?? target.dataset.hit;
    if (!itemId) return setMenu(null);
    if (!selection.items.includes(itemId)) store.select({ items: [itemId] });
    const host = container?.getBoundingClientRect();
    setMenu({ x: e.clientX - (host?.left ?? 0), y: e.clientY - (host?.top ?? 0) });
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const target = e.target as SVGElement;
    const { targetPage, targetItem } = target.dataset;
    if (targetPage && targetItem) {
      store.navigate(targetPage, 0, targetItem);
      return;
    }
    const itemId = target.dataset.item ?? target.dataset.hit;
    if (itemId && editable) store.set({ dialog: { kind: 'item', pageId: page.id, itemIds: selection.items.includes(itemId) ? selection.items : [itemId] } });
  };

  // Changes since the compared revision: new symbols green, changed orange, removed ones a red ×.
  const pageChanges = compare ? store.changes()?.items.get(page.id) : undefined;

  // Selection overlay
  const selected = new Set(selection.items);
  const selectedText = selection.text
    ? scene.elements.find((e) => {
        const { text } = selection;
        if (e.kind !== 'text' || e.meta?.itemId !== text!.itemId) return false;
        // Several cross-references of one symbol share a field; the target tells them apart.
        if (text!.target) return e.meta.role === 'xref' && e.meta.target?.pageId === text!.target.pageId && e.meta.target.itemId === text!.target.itemId;
        return e.meta.field === text!.field;
      })
    : undefined;

  const gridPx = grid * scale;
  const cursor = tool.kind === 'brush' ? 'copy' : tool.kind === 'place' || tool.kind === 'box' || tool.kind === 'device' || tool.kind === 'cable' || tool.kind === 'macro' || tool.kind === 'plc' || tool.kind === 'paste' ? 'crosshair' : drag?.kind === 'pan' ? 'grabbing' : 'default';

  return (
    <div className="canvas" ref={setContainer} onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      {/* A cancelled drag (Esc) may end without dragleave: any pointer movement removes the layer. */}
      {dropLayer && <div className="drop-layer" onPointerMove={() => setDropLayer(false)} />}
      <svg
        ref={svgRef}
        width={size.width}
        height={size.height}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => (tool.kind === 'place' || tool.kind === 'device' || tool.kind === 'macro' || tool.kind === 'plc' || tool.kind === 'paste') && setHover(null)}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        style={{ cursor }}
        fontFamily="Arial, Helvetica, sans-serif"
      >
        <defs>
          <pattern id="grid" width={grid} height={grid} patternUnits="userSpaceOnUse">
            <circle cx={0} cy={0} r={Math.max(0.12, 0.6 / scale)} fill="#b8c2cc" />
          </pattern>
        </defs>
        <rect x={0} y={0} width={scene.width} height={scene.height} fill="#ffffff" className="sheet" />
        {editable && gridPx >= 5 && <rect x={0} y={0} width={scene.width} height={scene.height} fill="url(#grid)" pointerEvents="none" />}
        <SceneGraphics elements={scene.elements} />
        {editable && (
          <g className="hit">
            {[...bounds].map(([id, b]) =>
              isBox(id) ? (
                <rect key={id} data-hit={id} data-role="box" x={b.x1} y={b.y1} width={b.x2 - b.x1} height={b.y2 - b.y1} fill="none" stroke="transparent" strokeWidth={Math.max(1.5, 6 / scale)} pointerEvents="stroke" />
              ) : (
                <rect key={id} data-hit={id} {...rectOf(pad(b, 1))} fill="transparent" pointerEvents="all" />
              ),
            )}
          </g>
        )}
        <SceneTexts elements={scene.elements} interactive={editable} />
        <g className="selection" pointerEvents="none">
          {[...selected].map((id) => {
            const b = bounds.get(id);
            return b ? <rect key={id} {...rectOf(pad(b, 1.2))} fill="rgba(30,111,255,0.06)" stroke="#1e6fff" strokeWidth={Math.max(0.2, 1.2 / scale)} strokeDasharray={`${2 / scale * 2} ${1.5 / scale * 2}`} /> : null;
          })}
          {pageChanges && (
            <g className="revision-changes" pointerEvents="none" fill="none" strokeWidth={Math.max(0.25, 1.2 / scale)} strokeDasharray={`${3 / scale} ${2 / scale}`}>
              {[...pageChanges.added.map((id) => [id, '#2e9e44'] as const), ...pageChanges.changed.map((id) => [id, '#e08600'] as const)].map(([id, color]) => {
                const b = bounds.get(id);
                return b ? <rect key={`rev-${id}`} {...rectOf(pad(b, 1.5))} stroke={color} /> : null;
              })}
              {pageChanges.removed.map((item) => (
                <g key={`rev-x-${item.id}`} stroke="#d32f2f" strokeDasharray="none">
                  <line x1={item.x - 2.5} y1={item.y - 2.5} x2={item.x + 2.5} y2={item.y + 2.5} />
                  <line x1={item.x - 2.5} y1={item.y + 2.5} x2={item.x + 2.5} y2={item.y - 2.5} />
                </g>
              ))}
            </g>
          )}
          {markers.map(([id, severity]) => {
            const b = bounds.get(id);
            return b ? <circle key={`m-${id}`} cx={b.x2 + 1.5} cy={b.y1 - 1} r={Math.max(0.9, 4 / scale)} fill={severity === 'error' ? '#d32f2f' : '#e08600'} opacity={0.85} /> : null;
          })}
          {guides.length > 0 && (
            <g className="guides">
              {guides.map((g, i) => (
                <line key={i} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} stroke={g.joins ? '#1e9e3a' : '#d6249f'} strokeWidth={Math.max(0.15, 1 / scale)} strokeDasharray={g.joins ? undefined : `${3 / scale} ${2 / scale}`} opacity={0.8} />
              ))}
            </g>
          )}
          {selectedText && <rect {...rectOf(pad(elementBounds(selectedText), 0.4))} fill="rgba(255,170,0,0.25)" stroke="#ff9800" strokeWidth={Math.max(0.15, 1 / scale)} />}
          {band && tool.kind === 'cable' && (
            <line
              {...cableLineOf(drag?.kind === 'box' ? drag.start : { x: band.x1, y: band.y1 }, band)}
              stroke="#1e6fff"
              strokeWidth={Math.max(0.3, 1.5 / scale)}
            />
          )}
          {band && tool.kind !== 'cable' && <rect {...rectOf(band)} fill={tool.kind === 'box' ? 'rgba(0,163,163,0.08)' : 'rgba(30,111,255,0.08)'} stroke={tool.kind === 'box' ? '#00a3a3' : '#1e6fff'} strokeWidth={1 / scale} />}
          {(tool.kind === 'place' || tool.kind === 'box' || tool.kind === 'device' || tool.kind === 'cable' || tool.kind === 'macro' || tool.kind === 'plc' || tool.kind === 'paste') && hover && (
            <g stroke="#1e6fff" strokeWidth={0.8 / scale}>
              <line x1={hover.x - 3} y1={hover.y} x2={hover.x + 3} y2={hover.y} />
              <line x1={hover.x} y1={hover.y - 3} x2={hover.x} y2={hover.y + 3} />
            </g>
          )}
        </g>
      </svg>
      {inlineEdit && editable && <InlineEditor key={`${inlineEdit.itemId}:${inlineEdit.field}`} svg={svgRef.current} scene={scene} />}
      {menu && selection.items.length > 0 && <ItemMenu at={menu} pageId={page.id} itemIds={selection.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** Right-click menu for the selected symbols. */
function ItemMenu({ at, pageId, itemIds, onClose }: { at: { x: number; y: number }; pageId: string; itemIds: string[]; onClose: () => void }) {
  const store = useStore();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', close, true);
    window.addEventListener('wheel', onClose, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', close, true);
      window.removeEventListener('wheel', onClose, true);
    };
  }, [onClose]);
  const run = (action: () => void) => () => {
    onClose();
    action();
  };
  const several = itemIds.length > 1;
  const page = store.currentPage();
  const single = !several ? page?.items.find((i) => i.id === itemIds[0]) : undefined;
  const deviceBox = single !== undefined && store.library.symbol(single.symbol)?.function === 'box.device';
  return (
    <div className="context-menu" role="menu" ref={ref} style={{ left: at.x, top: at.y }}>
      <button role="menuitem" onClick={run(() => store.set({ dialog: { kind: 'item', pageId, itemIds } }))}>
        {several ? tr('Edit {count} items…', { count: itemIds.length }) : tr('Edit…')}
      </button>
      {deviceBox && (
        <button role="menuitem" onClick={run(() => openBoxAsSymbol(store, pageId, itemIds[0]!))}>
          {tr('Turn into a library symbol…')}
        </button>
      )}
      {!several && (
        <button role="menuitem" onClick={run(() => startStyleBrush(store))}>
          {tr('Copy style (brush)')} <kbd>{trKeys('Ctrl+Shift+C')}</kbd>
        </button>
      )}
      <button role="menuitem" onClick={run(() => store.apply({ type: 'rotateItems', pageId, itemIds, rotation: 90 }, 'rotate'))}>
        {tr('Rotate')} <kbd>R</kbd>
      </button>
      <button role="menuitem" onClick={run(() => store.apply({ type: 'mirrorItems', pageId, itemIds }, 'mirror'))}>
        {tr('Mirror')} <kbd>M</kbd>
      </button>
      <button role="menuitem" className="danger" onClick={run(() => store.apply({ type: 'deleteItems', pageId, itemIds }, 'delete'))}>
        {tr('Delete')} <kbd>{trKeys('Delete')}</kbd>
      </button>
    </div>
  );
}

/** Horizontal or vertical line through the drag start, along the longer side of the dragged rectangle. */
function cableLineOf(start: Point, rect: Box) {
  return rect.x2 - rect.x1 >= rect.y2 - rect.y1
    ? { x1: rect.x1, y1: start.y, x2: rect.x2, y2: start.y }
    : { x1: start.x, y1: rect.y1, x2: start.x, y2: rect.y2 };
}

function rectOf(b: Box) {
  return { x: b.x1, y: b.y1, width: b.x2 - b.x1, height: b.y2 - b.y1 };
}

/** Text box over the canvas for F2 editing. */
function InlineEditor({ svg, scene }: { svg: SVGSVGElement | null; scene: Scene }) {
  const store = useStore();
  const edit = useEditor((s) => s.inlineEdit)!;
  const doc = useEditor((s) => s.doc)!;
  const language = useEditor((s) => s.language);
  const page = store.currentPage()!;
  const item = page.items.find((i) => i.id === edit.itemId);
  const [value, setValue] = useState(() => (item ? fieldValue(doc.state, page, item, edit.field, store.library, language) : ''));
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  if (!item || !svg) return null;

  const element = scene.elements.find((e) => e.meta?.itemId === item.id && e.meta.field === edit.field && e.kind === 'text');
  const anchor = element ? elementBounds(element) : (() => {
    const b = itemBounds(scene.elements).get(item.id);
    return b ? { ...b, y1: b.y1 - 3 } : { x1: item.x, y1: item.y, x2: item.x, y2: item.y };
  })();
  const ctm = svg.getScreenCTM();
  const host = svg.getBoundingClientRect();
  const pt = svg.createSVGPoint();
  pt.x = anchor.x1;
  pt.y = anchor.y1;
  const screen = ctm ? pt.matrixTransform(ctm) : { x: 0, y: 0 };

  const commit = () => {
    try {
      const commands = fieldCommands(doc.state, page, item, edit.field, value, store.library, language);
      store.apply(commands, 'edit text');
    } catch (error) {
      store.notify((error as Error).message, true);
    }
    store.set({ inlineEdit: null });
  };

  return (
    <input
      ref={inputRef}
      className="inline-edit"
      style={{ left: screen.x - host.left - 4, top: screen.y - host.top - 6 }}
      value={showBreaks(value)}
      title={tr('Enter applies, Ctrl+Enter: line break (¶), Tab: next text, Esc: cancel')}
      onChange={(e) => setValue(readBreaks(e.target.value))}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (insertBreak(e)) return;
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') store.set({ inlineEdit: null });
        if (e.key === 'Tab') {
          e.preventDefault();
          commit();
          const fields = [...new Set(scene.elements.filter((x) => x.kind === 'text' && x.meta?.itemId === item.id && x.meta.role === 'text').map((x) => x.meta!.field!))];
          const next = fields[(fields.indexOf(edit.field) + 1) % fields.length];
          if (next) store.set({ inlineEdit: { itemId: item.id, field: next }, selection: { items: [item.id], text: { itemId: item.id, field: next } } });
        }
      }}
      onBlur={() => store.state.inlineEdit && commit()}
    />
  );
}

