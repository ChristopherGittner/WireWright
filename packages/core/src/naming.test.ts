import { describe, expect, it } from 'vitest';
import { columnAt, formatDeviceName, proposeDeviceName, rowAt } from './naming.js';
import { defaultSettings } from './project.js';
import type { SchematicPage } from './schema.js';
import { column, frame, library } from './test/fixtures.js';

const page: SchematicPage = { id: 'p_a', type: 'schematic', name: '5', items: [] };
const context = { function: 'SG', location: '10' };

describe('columns and rows', () => {
  it('maps coordinates to the frame grid', () => {
    expect(columnAt(frame, column(1))).toBe(1);
    expect(columnAt(frame, column(3))).toBe(3);
    expect(columnAt(frame, 0)).toBe(1);
    expect(columnAt(frame, 999)).toBe(10);
    expect(rowAt(frame, 20)).toBe('A');
    expect(rowAt(frame, 100)).toBe('C');
  });
});

describe('formatDeviceName', () => {
  it('fills placeholders with optional zero padding', () => {
    const vars = { letter: 'K', page: '5', column: 3, row: 'B', counter: 7 };
    expect(formatDeviceName('{page}{letter}{column}', vars)).toBe('5K3');
    expect(formatDeviceName('{letter}{page}{column:2}', vars)).toBe('K503');
    expect(formatDeviceName('{letter}{counter}', vars)).toBe('K7');
  });
});

describe('proposeDeviceName', () => {
  const base = { settings: defaultSettings(), library, page, at: { x: column(3), y: 100 }, letter: 'K', context };

  it('page/column scheme: -5K3, then -5K3.1, -5K3.2', () => {
    expect(proposeDeviceName({ ...base, taken: new Set() })).toBe('5K3');
    expect(proposeDeviceName({ ...base, taken: new Set(['=SG+10-5K3']) })).toBe('5K3.1');
    expect(proposeDeviceName({ ...base, taken: new Set(['=SG+10-5K3', '=SG+10-5K3.1']) })).toBe('5K3.2');
  });

  it('the same name in another structure is free', () => {
    expect(proposeDeviceName({ ...base, taken: new Set(['=AA+20-5K3']) })).toBe('5K3');
  });

  it('counter scheme uses the lowest free number', () => {
    const settings = defaultSettings();
    settings.deviceNaming = { scheme: 'counter', format: '{letter}{counter}', duplicateSuffix: '.{n}' };
    expect(proposeDeviceName({ ...base, settings, taken: new Set(['=SG+10-K1', '=SG+10-K3']) })).toBe('K2');
  });
});
