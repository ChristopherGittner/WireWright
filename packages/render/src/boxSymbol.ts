// A device box turned into a library symbol: the box outline, the graphics of everything inside
// it (symbols and the wires between them, without their texts), the border pins as connection
// points, the box's pin links, and its tag and function text above it.
import { boxRect, containsPoint, effectiveTag, type Graphic, type SchematicPage, type SymbolDefinition } from '@wirewright/core';
import { renderPage, type RenderContext } from './render.js';
import type { SceneElement } from './scene.js';

const r2 = (v: number) => Math.round(v * 100) / 100;

export function symbolFromDeviceBox(ctx: RenderContext, pageId: string, itemId: string): SymbolDefinition {
  const page = ctx.state.pages[pageId] as SchematicPage | undefined;
  const box = page?.items.find((i) => i.id === itemId);
  if (!page || !box || ctx.library.symbol(box.symbol)?.function !== 'box.device') throw new Error('Not a device box');
  const rect = boxRect(box);
  // Origin in the middle of the box, on whole millimetres (connection points must be).
  const ox = Math.round(rect.x + rect.width / 2);
  const oy = Math.round(rect.y + rect.height / 2);
  const inside = new Set(page.items.filter((i) => i.id !== box.id && containsPoint(rect, i)).map((i) => i.id));
  const within = (x: number, y: number) => containsPoint(rect, { x, y });
  const graphics: Graphic[] = [{ type: 'rect', x: rect.x - ox, y: rect.y - oy, width: rect.width, height: rect.height }];
  for (const e of renderPage(ctx, pageId).elements) {
    const own = e.meta?.itemId !== undefined && inside.has(e.meta.itemId) && e.meta.role === 'symbol' && e.meta.field !== 'stub';
    const wire = e.meta?.role === 'connection' && e.kind === 'line' && within(e.x1, e.y1) && within(e.x2, e.y2);
    if (!own && !wire) continue;
    const g = toGraphic(e, ox, oy);
    if (g) graphics.push(g);
  }
  const tag = effectiveTag(page, box, ctx.library);
  const letter = tag.product?.match(/[A-Z]+/i)?.[0];
  const outward = { left: 'left', right: 'right', top: 'up', bottom: 'down' } as const;
  return {
    id: `own.${(tag.product ?? 'box').replace(/[^A-Za-z0-9]+/g, '').toLowerCase() || 'box'}`,
    name: { de: `Gerät ${tag.product ?? ''}`.trim(), en: `Device ${tag.product ?? ''}`.trim() },
    category: 'own',
    function: 'device',
    defaultRole: 'main',
    ...(letter ? { letterCode: letter.toUpperCase() } : {}),
    graphics,
    connections: (box.borderPins ?? []).map((pin) => {
      const at = { left: [rect.x, rect.y + pin.offset], right: [rect.x + rect.width, rect.y + pin.offset], top: [rect.x + pin.offset, rect.y], bottom: [rect.x + pin.offset, rect.y + rect.height] }[pin.side];
      return { id: pin.id, x: Math.round(at[0]! - ox), y: Math.round(at[1]! - oy), direction: outward[pin.side], designation: pin.designation };
    }),
    // A device box passes potentials only along its links; the symbol keeps exactly those.
    links: structuredClone(box.links ?? []),
    texts: [
      { field: 'tag', x: rect.x - ox, y: rect.y - oy - 4.5 },
      { field: 'functionText', x: rect.x - ox, y: rect.y - oy - 1 },
    ],
  };
}

function toGraphic(e: SceneElement, ox: number, oy: number): Graphic | undefined {
  switch (e.kind) {
    case 'line':
      return { type: 'line', x1: r2(e.x1 - ox), y1: r2(e.y1 - oy), x2: r2(e.x2 - ox), y2: r2(e.y2 - oy) };
    case 'polyline':
      return { type: 'polyline', points: e.points.map(([x, y]) => [r2(x - ox), r2(y - oy)] as [number, number]), ...(e.closed ? { closed: true } : {}), ...(e.fill && e.fill !== 'none' ? { fill: true } : {}) };
    case 'rect':
      return { type: 'rect', x: r2(e.x - ox), y: r2(e.y - oy), width: r2(e.width), height: r2(e.height), ...(e.fill && e.fill !== 'none' ? { fill: true } : {}) };
    case 'circle':
      return { type: 'circle', cx: r2(e.cx - ox), cy: r2(e.cy - oy), r: e.r, ...(e.fill && e.fill !== 'none' ? { fill: true } : {}) };
    case 'arc':
      return { type: 'arc', cx: r2(e.cx - ox), cy: r2(e.cy - oy), r: e.r, start: e.start, end: e.end };
    case 'text':
      // Texts drawn as part of a symbol (e.g. "M 3~"); tags, pins and other fields are left out.
      return { type: 'text', x: r2(e.x - ox), y: r2(e.y - oy), text: e.text, size: e.size, ...(e.align !== 'left' ? { align: e.align } : {}) };
  }
}
