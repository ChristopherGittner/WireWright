import { describe, expect, it } from 'vitest';
import { bandHits, isCrossing, type Box } from './bounds.js';

describe('band selection', () => {
  const bounds = new Map<string, Box>([
    ['inside', { x1: 10, y1: 10, x2: 20, y2: 20 }],
    ['partly', { x1: 25, y1: 10, x2: 45, y2: 20 }],
    ['outside', { x1: 60, y1: 10, x2: 70, y2: 20 }],
    ['frame', { x1: 0, y1: 0, x2: 100, y2: 100 }],
  ]);
  const band: Box = { x1: 5, y1: 5, x2: 30, y2: 30 };
  const isFrame = (id: string) => id === 'frame';

  it('left to right (window) selects only what lies completely inside', () => {
    expect(isCrossing({ x: 5 }, band)).toBe(false);
    expect(bandHits(bounds, band, false, isFrame)).toEqual(['inside']);
  });

  it('right to left (crossing) selects everything the band touches; a frame only at its border', () => {
    expect(isCrossing({ x: 30 }, band)).toBe(true);
    expect(bandHits(bounds, band, true, isFrame)).toEqual(['inside', 'partly']);
    expect(bandHits(bounds, { x1: -5, y1: 40, x2: 10, y2: 50 }, true, isFrame)).toEqual(['frame']);
  });
});
