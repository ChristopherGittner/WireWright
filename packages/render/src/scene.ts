// A scene is a flat list of drawing primitives in page millimetres. The
// editor draws it as SVG elements, the PDF export as PDF graphics and the MCP
// server as an image. Metadata ties elements back to items and to
// cross-reference targets (for clicks and PDF links).

export interface Stroke {
  color: string;
  /** Line width in mm. */
  width: number;
  /** Dash pattern in mm. */
  dash?: number[];
}

export interface ElementMeta {
  role: 'frame' | 'symbol' | 'text' | 'connection' | 'xref' | 'box' | 'report' | 'contactImage' | 'links' | 'layout';
  itemId?: string;
  /** Text field of the item (`tag`, `functionText`, `pin:A1` …). */
  field?: string;
  /** Jump target of a cross-reference. */
  target?: { pageId: string; itemId: string };
  /** Connection lines: point keys and potential. */
  connection?: { a: string; b: string; potential?: string; conflict?: boolean };
}

export type TextAlign = 'left' | 'center' | 'right';

export type SceneElement =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: Stroke; meta?: ElementMeta }
  | { kind: 'polyline'; points: [number, number][]; closed?: boolean; stroke?: Stroke; fill?: string; meta?: ElementMeta }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; stroke?: Stroke; fill?: string; meta?: ElementMeta }
  | { kind: 'circle'; cx: number; cy: number; r: number; stroke?: Stroke; fill?: string; meta?: ElementMeta }
  /** Angles in degrees, clockwise from +x, drawn clockwise from start to end. */
  | { kind: 'arc'; cx: number; cy: number; r: number; start: number; end: number; stroke: Stroke; meta?: ElementMeta }
  /**
   * `y` is the text baseline; `size` is the font size in mm. `angle` turns the text around
   * (x, y) against the sheet: 90 reads from bottom to top, 270 from top to bottom.
   */
  | { kind: 'text'; x: number; y: number; text: string; size: number; color: string; align: TextAlign; bold?: boolean; angle?: TextAngle; meta?: ElementMeta };

export type TextAngle = 0 | 90 | 270;

export interface Scene {
  width: number;
  height: number;
  elements: SceneElement[];
}

export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Outline of a scene element (texts estimated). */
export function elementBox(e: SceneElement): Box {
  switch (e.kind) {
    case 'line':
      return { x1: Math.min(e.x1, e.x2), y1: Math.min(e.y1, e.y2), x2: Math.max(e.x1, e.x2), y2: Math.max(e.y1, e.y2) };
    case 'polyline': {
      const xs = e.points.map((p) => p[0]);
      const ys = e.points.map((p) => p[1]);
      return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
    }
    case 'rect':
      return { x1: e.x, y1: e.y, x2: e.x + e.width, y2: e.y + e.height };
    case 'circle':
    case 'arc':
      return { x1: e.cx - e.r, y1: e.cy - e.r, x2: e.cx + e.r, y2: e.cy + e.r };
    case 'text':
      return textBox(e);
  }
}

/** Rough outline of a text (estimated width), turned by its angle. */
export function textBox(e: { x: number; y: number; text: string; size: number; align: TextAlign; angle?: TextAngle }): { x1: number; y1: number; x2: number; y2: number } {
  const w = estimateTextWidth(e.text, e.size);
  // Along the reading direction: start and end; across it: from the baseline up and down.
  const start = e.align === 'left' ? 0 : e.align === 'center' ? -w / 2 : -w;
  const [up, down] = [e.size * 0.8, e.size * 0.2];
  switch (e.angle ?? 0) {
    case 90:
      return { x1: e.x - up, y1: e.y - start - w, x2: e.x + down, y2: e.y - start };
    case 270:
      return { x1: e.x - down, y1: e.y + start, x2: e.x + up, y2: e.y + start + w };
    default:
      return { x1: e.x + start, y1: e.y - up, x2: e.x + start + w, y2: e.y + down };
  }
}

/** Rough text width in mm for a sans-serif font, used to fit table cells. */
export function estimateTextWidth(text: string, size: number): number {
  return text.length * size * 0.55;
}

/** Shortens text with an ellipsis so it fits into `width` mm. */
export function fitText(text: string, size: number, width: number): string {
  if (estimateTextWidth(text, size) <= width) return text;
  const chars = Math.max(1, Math.floor(width / (size * 0.55)) - 1);
  return text.slice(0, chars) + '…';
}
