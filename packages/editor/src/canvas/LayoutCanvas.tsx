// Editor for cabinet layout pages: the mounting plate to scale with DIN rails, wire ducts and
// device footprints (see core/layout.ts). Coordinates of items are real millimetres on the plate;
// the sheet shows them at 1:scale.
import { CommandError, formatTag, layoutFootprint, layoutSize, pageFullName, parseTag, relativeTag, type Command, type LayoutPage } from '@wirewright/core';
import { layoutPlacement, renderContext, renderSheet, type Scene } from '@wirewright/render';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { tr } from '../i18n.js';
import { Icon } from '../icons.js';
import { useEditor, useStore } from '../store.js';
import { elementBounds, inside, pad, union, type Box } from './bounds.js';
import { SceneGraphics, SceneTexts } from './SceneView.js';

/** Snap of positions and lengths on the plate (real mm). */
const SNAP = 5;
/** A device dropped this close to a rail's centre line (real mm) sits on the rail. */
const RAIL_CATCH = 20;
/** Room of the device list on the right (px). */
const DEVICE_LIST_WIDTH = 190;

interface Point {
  x: number;
  y: number;
}

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Tool = { kind: 'select' } | { kind: 'rail' } | { kind: 'duct' } | { kind: 'cutout' } | { kind: 'device'; itemId: string };

/** Devices that usually sit in the door (listed first on a door). */
const DOOR_FUNCTIONS = new Set(['switch.pushbutton.no', 'switch.pushbutton.nc', 'switch.estop', 'switch.selector', 'lamp']);

type Drag =
  | { kind: 'move'; start: Point; itemIds: string[] }
  | { kind: 'draw'; start: Point }
  | { kind: 'band'; start: Point; additive: boolean }
  | { kind: 'pan'; screen: { x: number; y: number }; view: ViewBox };

export function LayoutCanvas({ pageId }: { pageId: string }) {
  const store = useStore();
  const doc = useEditor((s) => s.doc)!;
  useEditor((s) => s.version);
  const language = useEditor((s) => s.language);
  const page = doc.state.pages[pageId] as LayoutPage;

  const svgRef = useRef<SVGSVGElement>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [view, setView] = useState<ViewBox>({ x: -10, y: -10, w: 440, h: 317 });
  const [tool, setTool] = useState<Tool>({ kind: 'select' });
  const [selection, setSelection] = useState<string[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [preview, setPreview] = useState<Command[] | null>(null);
  const [band, setBand] = useState<Box | null>(null);
  const [ductWidth, setDuctWidth] = useState(60);
  const [filter, setFilter] = useState('');
  const spaceDown = useRef(false);

  const placement = layoutPlacement(store.library, doc.state.project.settings.defaultFrame, page);
  const { k } = placement;
  /** Sheet mm → plate mm and back. */
  const toPlate = (p: Point): Point => ({ x: (p.x - placement.x) / k, y: (p.y - placement.y) / k });
  const snap = (v: number) => Math.round(v / SNAP) * SNAP;
  const snapPoint = (p: Point): Point => ({ x: snap(p.x), y: snap(p.y) });

  const displayDoc = useMemo(() => {
    if (!preview) return doc;
    try {
      return doc.preview(preview).doc;
    } catch (error) {
      if (error instanceof CommandError) return doc;
      throw error;
    }
  }, [doc, doc.state, preview]);
  const scene: Scene | null = useMemo(() => {
    const ctx = renderContext(displayDoc);
    const sheet = ctx.sheets.find((s) => s.pageId === pageId);
    return sheet ? renderSheet(ctx, sheet, { language }) : null;
  }, [displayDoc, displayDoc.state, pageId, language]);
  const bounds = useMemo(() => {
    const map = new Map<string, Box>();
    for (const e of scene?.elements ?? []) {
      if ((e.kind === 'rect' || e.kind === 'circle') && e.meta?.role === 'layout' && e.meta.itemId) map.set(e.meta.itemId, union(map.get(e.meta.itemId), elementBounds(e)));
    }
    return map;
  }, [scene]);

  // The devices that can go on the plate: those with a main function, of the plate's location (if it has one).
  const devices = useMemo(() => {
    const index = doc.devices();
    const placed = new Map(page.items.flatMap((i) => (i.kind === 'device' ? [[index.byItem.get(i.itemId), i.id] as const] : [])));
    // Devices on other plates or doors.
    const elsewhere = new Map<string, string>();
    for (const other of Object.values(doc.state.pages)) {
      if (other.type !== 'layout' || other.id === page.id) continue;
      for (const i of other.items) if (i.kind === 'device') elsewhere.set(index.byItem.get(i.itemId) ?? '', pageFullName(other));
    }
    const location = page.structure?.location;
    const context = parseTag(formatTag(page.structure ?? {}));
    const door = page.surface === 'door';
    const isDoorDevice = (pageId: string, itemId: string) => {
      const p = doc.state.pages[pageId];
      const item = p?.type === 'schematic' ? p.items.find((i) => i.id === itemId) : undefined;
      return item ? DOOR_FUNCTIONS.has(store.library.symbol(item.symbol)?.function ?? '') : false;
    };
    return [...index.devices.values()]
      .filter((d) => d.main && (!location || d.tag.location === location))
      .map((d) => ({ key: d.key, label: formatTag(relativeTag(d.tag, context)), itemId: d.main!.itemId, placed: placed.get(d.key), elsewhere: elsewhere.get(d.key), first: door && isDoorDevice(d.main!.pageId, d.main!.itemId) }))
      .sort((a, b) => Number(b.first) - Number(a.first) || a.key.localeCompare(b.key, undefined, { numeric: true }));
  }, [doc, doc.state, page]);

  useLayoutEffect(() => {
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => entry && setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(container);
    return () => observer.disconnect();
  }, [container]);
  /** Fits the sheet into the canvas left of the device list. */
  const fit = () => {
    if (!scene) return;
    const margin = 8;
    const free = Math.max(size.width - DEVICE_LIST_WIDTH, size.width / 2);
    const w = scene.width + 2 * margin;
    const h = scene.height + 2 * margin;
    const aspect = free / Math.max(size.height, 1);
    const view = w / h > aspect ? { x: -margin, y: -margin - (w / aspect - h) / 2, w, h: w / aspect } : { x: -margin - (h * aspect - w) / 2, y: -margin, w: h * aspect, h };
    setView({ ...view, w: (view.w * size.width) / free });
  };
  useEffect(fit, [pageId, size.width, size.height, scene?.width]);
  const viewBox = { ...view, h: view.w / (size.width / Math.max(size.height, 1)) };
  const scale = size.width / viewBox.w; // px per sheet mm

  const apply = (commands: Command | Command[], label: string) => store.apply(commands, label);
  const itemsOf = (ids: readonly string[]) => page.items.filter((i) => ids.includes(i.id));

  /** A device placed with its centre at `at` (plate mm), caught by a rail nearby. */
  const deviceCommand = (itemId: string, at: Point): Command => {
    const probe = { id: 'probe', kind: 'device' as const, itemId, x: 0, y: 0 };
    const f = layoutFootprint(doc.state, store.library, doc.devices(), probe, page.surface);
    let x = snap(at.x - f.width / 2);
    let y = snap(at.y - f.height / 2);
    for (const rail of page.items) {
      if (rail.kind !== 'rail') continue;
      const s = layoutSize(rail);
      if (!rail.vertical && Math.abs(rail.y + s.height / 2 - at.y) <= RAIL_CATCH && at.x >= rail.x && at.x <= rail.x + s.width) {
        y = rail.y + s.height / 2 - f.height / 2;
        x = Math.round(at.x - f.width / 2);
        break;
      }
      if (rail.vertical && Math.abs(rail.x + s.width / 2 - at.x) <= RAIL_CATCH && at.y >= rail.y && at.y <= rail.y + s.height) {
        x = rail.x + s.width / 2 - f.width / 2;
        y = Math.round(at.y - f.height / 2);
        break;
      }
    }
    return { type: 'setLayoutItem', pageId, item: { kind: 'device', itemId, x, y } };
  };
  /** A rail or duct drawn from `a` to `b` (plate mm): along the longer side. */
  const drawCommand = (kind: 'rail' | 'duct', a: Point, b: Point): Command | undefined => {
    const vertical = Math.abs(b.y - a.y) > Math.abs(b.x - a.x);
    const length = vertical ? Math.abs(b.y - a.y) : Math.abs(b.x - a.x);
    if (length < SNAP) return undefined;
    const x = vertical ? a.x : Math.min(a.x, b.x);
    const y = vertical ? Math.min(a.y, b.y) : a.y;
    const item = kind === 'rail' ? { kind, x, y, length, ...(vertical ? { vertical } : {}) } : { kind, x, y, length, width: ductWidth, ...(vertical ? { vertical } : {}) };
    return { type: 'setLayoutItem', pageId, item };
  };
  /** A cutout dragged from `a` to `b` (plate mm). */
  const cutoutCommand = (a: Point, b: Point): Command | undefined => {
    const width = Math.abs(b.x - a.x);
    const height = Math.abs(b.y - a.y);
    if (width < SNAP || height < SNAP) return undefined;
    return { type: 'setLayoutItem', pageId, item: { kind: 'cutout', x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width, height } };
  };

  const toSheet = (clientX: number, clientY: number): Point => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  };

  const deleteSelection = () => {
    if (selection.length === 0) return;
    apply({ type: 'deleteLayoutItems', pageId, itemIds: selection }, 'delete');
    setSelection([]);
  };
  /** Turns devices by 90° and rails/ducts between horizontal and vertical. */
  const turnSelection = () => {
    const commands: Command[] = itemsOf(selection).map((item) =>
      item.kind === 'device'
        ? { type: 'setLayoutItem', pageId, item: { ...item, turned: !item.turned } }
        : item.kind === 'cutout'
          ? { type: 'setLayoutItem', pageId, item: { ...item, width: item.height, height: item.width } }
          : { type: 'setLayoutItem', pageId, item: { ...item, vertical: !item.vertical } },
    );
    if (commands.length) apply(commands, 'turn');
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (store.state.dialog || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      if (e.code === 'Space') spaceDown.current = true;
      if (e.key === 'Home') fit();
      if (e.key === 'Escape') {
        setTool({ kind: 'select' });
        setPreview(null);
        setSelection([]);
      }
      if (e.key === 'Delete' || e.key === 'Backspace') deleteSelection();
      if (e.key === 'r' || e.key === 'R') turnSelection();
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        setSelection(page.items.map((i) => i.id));
      }
      const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (arrow && selection.length > 0) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : SNAP;
        apply({ type: 'moveLayoutItems', pageId, itemIds: selection, dx: arrow[0]! * step, dy: arrow[1]! * step }, 'move');
      }
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
  // Items that were deleted (undo, MCP) leave the selection.
  useEffect(() => setSelection((s) => s.filter((id) => page.items.some((i) => i.id === id))), [page]);

  if (!scene) return <div className="canvas empty">{tr('No page')}</div>;

  const onWheel = (e: React.WheelEvent) => {
    const p = toSheet(e.clientX, e.clientY);
    const factor = Math.exp(e.deltaY * 0.0015);
    setView((v) => {
      const w = Math.min(Math.max(v.w * factor, 20), 2000);
      const f = w / v.w;
      return { x: p.x - (p.x - v.x) * f, y: p.y - (p.y - v.y) * f, w, h: v.h * f };
    });
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (e.button === 1 || (e.button === 0 && spaceDown.current)) {
      setDrag({ kind: 'pan', screen: { x: e.clientX, y: e.clientY }, view });
      return;
    }
    if (e.button !== 0) return;
    const sheetPoint = toSheet(e.clientX, e.clientY);
    const p = toPlate(sheetPoint);
    if (tool.kind === 'device') {
      const result = apply(deviceCommand(tool.itemId, p), 'place device');
      setPreview(null);
      setTool({ kind: 'select' });
      if (result) setSelection(result.created);
      return;
    }
    if (tool.kind === 'rail' || tool.kind === 'duct' || tool.kind === 'cutout') {
      setDrag({ kind: 'draw', start: snapPoint(p) });
      return;
    }
    const itemId = (e.target as SVGElement).dataset.hit;
    if (itemId) {
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      let items = selection;
      if (additive) items = items.includes(itemId) ? items.filter((i) => i !== itemId) : [...items, itemId];
      else if (!items.includes(itemId)) items = [itemId];
      setSelection(items);
      if (!additive) setDrag({ kind: 'move', start: p, itemIds: items });
      return;
    }
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!additive) setSelection([]);
    setDrag({ kind: 'band', start: sheetPoint, additive });
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (drag?.kind === 'pan') {
      const dx = ((e.clientX - drag.screen.x) * drag.view.w) / size.width;
      const dy = ((e.clientY - drag.screen.y) * drag.view.w) / size.width;
      setView({ ...drag.view, x: drag.view.x - dx, y: drag.view.y - dy });
      return;
    }
    const sheetPoint = toSheet(e.clientX, e.clientY);
    const p = toPlate(sheetPoint);
    if (tool.kind === 'device' && !drag) {
      setPreview([deviceCommand(tool.itemId, p)]);
      return;
    }
    if (!drag) return;
    if (drag.kind === 'move') {
      const dx = snap(p.x - drag.start.x);
      const dy = snap(p.y - drag.start.y);
      setPreview(dx || dy ? [{ type: 'moveLayoutItems', pageId, itemIds: drag.itemIds, dx, dy }] : null);
    } else if (drag.kind === 'draw' && (tool.kind === 'rail' || tool.kind === 'duct' || tool.kind === 'cutout')) {
      const command = tool.kind === 'cutout' ? cutoutCommand(drag.start, snapPoint(p)) : drawCommand(tool.kind, drag.start, snapPoint(p));
      setPreview(command ? [command] : null);
    } else if (drag.kind === 'band') {
      setBand({ x1: Math.min(drag.start.x, sheetPoint.x), y1: Math.min(drag.start.y, sheetPoint.y), x2: Math.max(drag.start.x, sheetPoint.x), y2: Math.max(drag.start.y, sheetPoint.y) });
    }
  };

  const onPointerUp = () => {
    if (drag?.kind === 'move' && preview) apply(preview, 'move');
    if (drag?.kind === 'draw' && preview) {
      const result = apply(preview, tool.kind === 'rail' ? 'new DIN rail' : tool.kind === 'cutout' ? 'new cutout' : 'new wire duct');
      if (result) setSelection(result.created);
    }
    if (drag?.kind === 'band' && band) {
      const hits = [...bounds].filter(([, b]) => inside(b, band)).map(([id]) => id);
      setSelection((s) => (drag.additive ? [...new Set([...s, ...hits])] : hits));
    }
    setDrag(null);
    setBand(null);
    if (tool.kind !== 'device') setPreview(null);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const itemId = (e.target as SVGElement).dataset.hit;
    if (itemId) store.set({ dialog: { kind: 'layoutItem', pageId, itemId } });
  };

  const choose = (next: Tool) => {
    setTool(next);
    setPreview(null);
  };
  const cursor = tool.kind === 'select' ? (drag?.kind === 'pan' ? 'grabbing' : 'default') : 'crosshair';
  const shown = filter ? devices.filter((d) => d.label.toLowerCase().includes(filter.toLowerCase())) : devices;

  return (
    <div className="canvas layout-canvas" ref={setContainer}>
      <svg
        ref={svgRef}
        width={size.width}
        height={size.height}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => tool.kind === 'device' && setPreview(null)}
        onDoubleClick={onDoubleClick}
        style={{ cursor }}
        fontFamily="Arial, Helvetica, sans-serif"
      >
        <rect x={0} y={0} width={scene.width} height={scene.height} fill="#ffffff" className="sheet" />
        <SceneGraphics elements={scene.elements} />
        <SceneTexts elements={scene.elements} interactive={false} />
        <g className="hit">
          {/* Rails and ducts below devices, so devices on a rail are hit first. */}
          {[...bounds]
            .sort(([a], [b]) => Number(page.items.find((i) => i.id === a)?.kind === 'device') - Number(page.items.find((i) => i.id === b)?.kind === 'device'))
            .map(([id, b]) => (
              <rect key={id} data-hit={id} {...rectOf(b)} fill="transparent" pointerEvents={tool.kind === 'select' ? 'all' : 'none'} />
            ))}
        </g>
        <g className="selection" pointerEvents="none">
          {selection.map((id) => {
            const b = bounds.get(id);
            return b ? <rect key={id} {...rectOf(pad(b, 0.6))} fill="rgba(30,111,255,0.08)" stroke="#1e6fff" strokeWidth={Math.max(0.2, 1.2 / scale)} /> : null;
          })}
          {band && <rect {...rectOf(band)} fill="rgba(30,111,255,0.08)" stroke="#1e6fff" strokeWidth={1 / scale} />}
        </g>
      </svg>
      <div className="layout-tools" role="toolbar" aria-label={tr('Cabinet layout')}>
        <button className={tool.kind === 'select' ? 'active' : ''} title={tr('Select and move (Esc)')} onClick={() => choose({ kind: 'select' })}>
          <Icon name="toolSelect" />
        </button>
        {page.surface !== 'door' && (
          <>
            <button className={tool.kind === 'rail' ? 'active' : ''} title={tr('Draw a DIN rail (drag)')} onClick={() => choose({ kind: 'rail' })}>
              {tr('Rail')}
            </button>
            <button className={tool.kind === 'duct' ? 'active' : ''} title={tr('Draw a wire duct (drag)')} onClick={() => choose({ kind: 'duct' })}>
              {tr('Duct')}
            </button>
          </>
        )}
        <button className={tool.kind === 'cutout' ? 'active' : ''} title={tr('Draw a cutout, e.g. for an HMI or a fan (drag)')} onClick={() => choose({ kind: 'cutout' })}>
          {tr('Cutout')}
        </button>
        {tool.kind === 'duct' && (
          <label title={tr('Width of new wire ducts (mm)')}>
            <input type="number" min={10} step={5} value={ductWidth} onChange={(e) => setDuctWidth(Math.max(10, Number(e.target.value) || 60))} /> mm
          </label>
        )}
        <span className="hint">{tr('R turns, Del deletes, double-click edits')}</span>
      </div>
      <div className="layout-devices">
        <div className="layout-devices-title">{tr('Devices')}</div>
        <input placeholder={tr('Filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <ul>
          {shown.map((d) => (
            <li
              key={d.key}
              className={[d.placed ? 'placed' : d.elsewhere ? 'elsewhere' : '', tool.kind === 'device' && tool.itemId === d.itemId ? 'active' : ''].join(' ').trim()}
              title={
                d.placed
                  ? tr('{device} is on this page: click to select it', { device: d.key })
                  : d.elsewhere
                    ? tr('{device} is already on page {page}; click, then click here to place it here as well', { device: d.key, page: d.elsewhere })
                    : tr('Click, then click on the plate to place {device}', { device: d.key })
              }
              onClick={() => (d.placed ? (choose({ kind: 'select' }), setSelection([d.placed])) : choose({ kind: 'device', itemId: d.itemId }))}
            >
              {d.label}
              {d.placed && <span className="check">✓</span>}
              {!d.placed && d.elsewhere && <span className="elsewhere-mark">{d.elsewhere}</span>}
            </li>
          ))}
          {shown.length === 0 && <li className="empty">{tr('No devices')}</li>}
        </ul>
      </div>
    </div>
  );
}

function rectOf(b: Box) {
  return { x: b.x1, y: b.y1, width: b.x2 - b.x1, height: b.y2 - b.y1 };
}
