import { arcPath, type SceneElement } from '@wirewright/render';
import { memo, type ReactElement } from 'react';

/** Data attributes used for hit-testing (clicks on texts and cross-references). */
function dataProps(e: SceneElement): Record<string, string> {
  const m = e.meta;
  if (!m) return {};
  const props: Record<string, string> = { 'data-role': m.role };
  if (m.itemId) props['data-item'] = m.itemId;
  if (m.field) props['data-field'] = m.field;
  if (m.target) {
    props['data-target-page'] = m.target.pageId;
    props['data-target-item'] = m.target.itemId;
  }
  return props;
}

function strokeProps(e: SceneElement) {
  if (!('stroke' in e) || !e.stroke) return { stroke: 'none' };
  return {
    stroke: e.stroke.color,
    strokeWidth: e.stroke.width,
    strokeLinecap: 'round' as const,
    ...(e.stroke.dash ? { strokeDasharray: e.stroke.dash.join(' ') } : {}),
  };
}

export function renderElement(e: SceneElement, key: number, interactiveText: boolean): ReactElement {
  const common = { key, ...dataProps(e) };
  switch (e.kind) {
    case 'line':
      return <line {...common} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} {...strokeProps(e)} pointerEvents="none" />;
    case 'polyline': {
      const points = e.points.map((p) => p.join(',')).join(' ');
      const fill = e.fill ?? 'none';
      return e.closed ? (
        <polygon {...common} points={points} fill={fill} {...strokeProps(e)} pointerEvents="none" />
      ) : (
        <polyline {...common} points={points} fill={fill} {...strokeProps(e)} pointerEvents="none" />
      );
    }
    case 'rect':
      return <rect {...common} x={e.x} y={e.y} width={e.width} height={e.height} fill={e.fill ?? 'none'} {...strokeProps(e)} pointerEvents="none" />;
    case 'circle':
      return <circle {...common} cx={e.cx} cy={e.cy} r={e.r} fill={e.fill ?? 'none'} {...strokeProps(e)} pointerEvents="none" />;
    case 'arc':
      return <path {...common} d={arcPath(e.cx, e.cy, e.r, e.start, e.end)} fill="none" {...strokeProps(e)} pointerEvents="none" />;
    case 'text': {
      const clickable = interactiveText && (e.meta?.role === 'text' || e.meta?.role === 'xref');
      return (
        <text
          {...common}
          x={e.x}
          y={e.y}
          fontSize={e.size}
          fill={e.color}
          fontWeight={e.bold ? 'bold' : undefined}
          textAnchor={({ left: 'start', center: 'middle', right: 'end' } as const)[e.align]}
          transform={e.angle ? `rotate(${-e.angle} ${e.x} ${e.y})` : undefined}
          pointerEvents={clickable ? 'bounding-box' : 'none'}
          className={e.meta?.role === 'xref' ? 'xref' : undefined}
        >
          {e.text}
        </text>
      );
    }
  }
}

/** Graphics without texts (drawn below the hit areas). */
export const SceneGraphics = memo(function SceneGraphics({ elements }: { elements: readonly SceneElement[] }) {
  return <g>{elements.map((e, i) => (e.kind === 'text' ? null : renderElement(e, i, false)))}</g>;
});

/** Texts (drawn on top, clickable). */
export const SceneTexts = memo(function SceneTexts({ elements, interactive }: { elements: readonly SceneElement[]; interactive: boolean }) {
  return <g>{elements.map((e, i) => (e.kind === 'text' ? renderElement(e, i, interactive) : null))}</g>;
});
