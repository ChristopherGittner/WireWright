// Colors and line styles. Potential colors follow docs/data-model.md:
// L black, N light blue, PE green dashed, 24V/0V dark blue, no potential red.
import type { Medium, Potential, PotentialType } from '@wirewright/core';
import type { Stroke } from './scene.js';

export const COLORS = {
  symbol: '#000000',
  text: '#000000',
  frame: '#000000',
  structureBox: '#00A3A3',
  noPotential: '#E00000',
  conflict: '#FF00FF',
  links: '#FF8C00',
  /** Texts taken over from elsewhere (e.g. a PLC channel's function from the wired sensor). */
  inherited: '#555555',
  reportHeader: '#E8E8E8',
};

export const WIDTH = { symbol: 0.25, connection: 0.25, frame: 0.35, thin: 0.13 };

export const DASH = {
  dash: [2, 1.2],
  dashdot: [4, 1, 0.6, 1],
};

/** Default line color per potential type (a potential's own `line.color` overrides it). */
export const TYPE_COLORS: Record<PotentialType, string> = {
  L: '#000000',
  N: '#3FA9F5',
  PE: '#1E9E3A',
  PEN: '#1E9E3A',
  '+': '#D0021B',
  '-': '#00008B',
  signal: '#000000',
  other: '#000000',
};

export const TEXT_SIZE = { tag: 2.5, functionText: 2.5, pin: 1.8, xref: 2, name: 2.5, small: 2, free: 3 };

/** Line style of a connection carrying `potential` (by name). */
/** Pipes without a medium (or a medium without its own color). */
export const PIPE_COLOR = '#808080';

/** Line of a pipe: the medium's color and style, gray by default; two media meeting are a conflict. */
export function pipeStroke(medium: string | undefined, conflict: boolean, media: readonly Medium[], monochrome = false): Stroke {
  if (monochrome) return { color: '#000000', width: WIDTH.connection };
  if (conflict) return { color: COLORS.conflict, width: WIDTH.connection * 2 };
  const def = medium === undefined ? undefined : media.find((m) => m.name === medium);
  const style = def?.line?.style ?? (def?.type === 'pilot' ? 'dash' : 'solid');
  return { color: def?.line?.color ?? PIPE_COLOR, width: WIDTH.connection, ...(style === 'solid' ? {} : { dash: DASH[style] }) };
}

export function connectionStroke(potential: string | undefined, conflict: boolean, potentials: readonly Potential[], monochrome = false): Stroke {
  if (monochrome) return { color: '#000000', width: WIDTH.connection };
  if (conflict) return { color: COLORS.conflict, width: WIDTH.connection * 2 };
  if (potential === undefined) return { color: COLORS.noPotential, width: WIDTH.connection };
  const def = potentials.find((p) => p.name === potential);
  const type = def?.type ?? 'other';
  const color = def?.line?.color ?? TYPE_COLORS[type];
  const style = def?.line?.style ?? (type === 'PE' || type === 'PEN' ? 'dash' : 'solid');
  return { color, width: WIDTH.connection, ...(style === 'solid' ? {} : { dash: DASH[style] }) };
}
