import type { ElementMeta, Scene, SceneElement, Stroke } from './scene.js';

export interface SvgOptions {
  /** Page background (default white; `none` for transparent). */
  background?: string;
  /** Write `data-*` attributes with item IDs and link targets (default true). */
  metadata?: boolean;
}

export const FONT_FAMILY = 'Arial, Helvetica, sans-serif';

/** A scene as a standalone SVG document in millimetres. */
export function sceneToSvg(scene: Scene, options: SvgOptions = {}): string {
  const background = options.background ?? '#ffffff';
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}mm" height="${scene.height}mm" viewBox="0 0 ${scene.width} ${scene.height}" font-family="${FONT_FAMILY}">`,
  ];
  if (background !== 'none') parts.push(`<rect width="${scene.width}" height="${scene.height}" fill="${background}"/>`);
  for (const e of scene.elements) parts.push(elementToSvg(e, options.metadata ?? true));
  parts.push('</svg>');
  return parts.join('\n');
}

export function elementToSvg(e: SceneElement, metadata = true): string {
  const data = metadata ? metaAttributes(e.meta) : '';
  switch (e.kind) {
    case 'line':
      return `<line x1="${n(e.x1)}" y1="${n(e.y1)}" x2="${n(e.x2)}" y2="${n(e.y2)}"${stroke(e.stroke)}${data}/>`;
    case 'polyline': {
      const tag = e.closed ? 'polygon' : 'polyline';
      return `<${tag} points="${e.points.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}"${paint(e.stroke, e.fill)}${data}/>`;
    }
    case 'rect':
      return `<rect x="${n(e.x)}" y="${n(e.y)}" width="${n(e.width)}" height="${n(e.height)}"${paint(e.stroke, e.fill)}${data}/>`;
    case 'circle':
      return `<circle cx="${n(e.cx)}" cy="${n(e.cy)}" r="${n(e.r)}"${paint(e.stroke, e.fill)}${data}/>`;
    case 'arc':
      return `<path d="${arcPath(e.cx, e.cy, e.r, e.start, e.end)}" fill="none"${stroke(e.stroke)}${data}/>`;
    case 'text': {
      const anchor = { left: 'start', center: 'middle', right: 'end' }[e.align];
      const weight = e.bold ? ' font-weight="bold"' : '';
      const turn = e.angle ? ` transform="rotate(${-e.angle} ${n(e.x)} ${n(e.y)})"` : '';
      return `<text x="${n(e.x)}" y="${n(e.y)}" font-size="${n(e.size)}" fill="${e.color}" text-anchor="${anchor}"${weight}${turn}${data}>${escapeXml(e.text)}</text>`;
    }
  }
}

/** SVG path for an arc drawn clockwise (screen coordinates) from `start` to `end` degrees. */
export function arcPath(cx: number, cy: number, r: number, start: number, end: number): string {
  const rad = (a: number) => (a * Math.PI) / 180;
  const sweep = (((end - start) % 360) + 360) % 360 || 360;
  const sx = cx + r * Math.cos(rad(start));
  const sy = cy + r * Math.sin(rad(start));
  const ex = cx + r * Math.cos(rad(start + sweep));
  const ey = cy + r * Math.sin(rad(start + sweep));
  if (sweep === 360) {
    const mx = cx - r * Math.cos(rad(start));
    const my = cy - r * Math.sin(rad(start));
    return `M ${n(sx)} ${n(sy)} A ${n(r)} ${n(r)} 0 1 1 ${n(mx)} ${n(my)} A ${n(r)} ${n(r)} 0 1 1 ${n(sx)} ${n(sy)}`;
  }
  return `M ${n(sx)} ${n(sy)} A ${n(r)} ${n(r)} 0 ${sweep > 180 ? 1 : 0} 1 ${n(ex)} ${n(ey)}`;
}

function stroke(s: Stroke | undefined): string {
  if (!s) return '';
  const dash = s.dash ? ` stroke-dasharray="${s.dash.map(n).join(' ')}"` : '';
  return ` stroke="${s.color}" stroke-width="${n(s.width)}" stroke-linecap="round"${dash}`;
}

function paint(s: Stroke | undefined, fill: string | undefined): string {
  return `${stroke(s)} fill="${fill ?? 'none'}"`;
}

function metaAttributes(meta: ElementMeta | undefined): string {
  if (!meta) return '';
  let out = ` data-role="${meta.role}"`;
  if (meta.itemId) out += ` data-item="${meta.itemId}"`;
  if (meta.field) out += ` data-field="${escapeXml(meta.field)}"`;
  if (meta.target) out += ` data-target-page="${meta.target.pageId}" data-target-item="${meta.target.itemId}"`;
  return out;
}

function n(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

export function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
