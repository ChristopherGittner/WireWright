import { exportFormats, exportPlc, ProjectDocument } from '@wirewright/core';
import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createDemoProject, createStandardLibrary } from './index.js';

const library = createStandardLibrary();

function demo(family?: 'codesys' | 'mitsubishi') {
  const doc = new ProjectDocument(createDemoProject(library), library);
  if (family) {
    doc.apply({ type: 'setPlcs', plcs: [{ name: 'PLC1', family, ...(family === 'mitsubishi' ? { mitsubishiSeries: 'fx' as const } : {}) }] });
    doc.apply({ type: 'assignPlcAddresses' });
  }
  return doc;
}

describe('PLC exports', () => {
  it('offers the CSV I/O list and the vendor format of the PLC family', () => {
    expect(exportFormats({ name: 'A', family: 'siemens' })).toEqual(['csv', 'tia']);
    expect(exportFormats({ name: 'A', family: 'mitsubishi' })).toEqual(['csv', 'gxworks3']);
  });

  it('I/O list as CSV', () => {
    const file = exportPlc(demo().reportContext(), 'PLC1', 'csv', 'de');
    expect(file.fileName).toBe('Förderband_FB-100-PLC1-io-list.csv');
    const lines = (file.content as string).split('\r\n');
    expect(lines[0]).toBe('﻿SPS;Karte;Kanal;Klemme;Adresse;Symbol;Typ;Funktion;Verwendet');
    expect(lines[2]).toBe('PLC1;=FB+CAB1-4A1;DI 2;5;I10.1;DI2_4A1;BOOL;Störung quittieren;=FB+CAB1/5.4');
    expect(lines).toHaveLength(16 + 2);
  });

  it('TIA Portal tag table as xlsx', () => {
    const file = exportPlc(demo().reportContext(), 'PLC1', 'tia', 'en');
    const files = unzipSync(file.content as Uint8Array);
    expect(Object.keys(files).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']);
    expect(strFromU8(files['xl/workbook.xml']!)).toContain('name="PLC Tags"');
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']!);
    expect(sheet).toContain('<t xml:space="preserve">Logical Address</t>');
    expect(sheet).toContain('<t xml:space="preserve">%I10.1</t>');
    expect(sheet).toContain('<t xml:space="preserve">Acknowledge fault</t>');
    expect(sheet.match(/<row /g)).toHaveLength(17);
  });

  it('Codesys GVL with direct addresses', () => {
    const gvl = exportPlc(demo('codesys').reportContext(), 'PLC1', 'codesys', 'de').content as string;
    expect(gvl).toContain('VAR_GLOBAL\n');
    expect(gvl).toContain('\tDI2_4A1 AT %IX0.1 : BOOL; (* Störung quittieren – =FB+CAB1-4A1 DI 2 pin 5 *)');
    expect(gvl).toContain('\tDO1_4A6 AT %QX0.0 : BOOL;');
    expect(gvl.trimEnd().endsWith('END_VAR')).toBe(true);
  });

  it('GX Works3 global labels with octal X/Y devices (FX)', () => {
    const doc = demo('mitsubishi');
    const text = exportPlc(doc.reportContext(), 'PLC1', 'gxworks3', 'en').content as string;
    const rows = text.replace('﻿', '').trim().split('\r\n').map((r) => r.split('\t'));
    expect(rows[0]).toEqual(['Label Name', 'Data Type', 'Class', 'Assign (Device/Label)', 'Initial Value', 'Constant', 'Comment']);
    expect(rows[2]).toEqual(['DI2_4A1', 'Bit', 'VAR_GLOBAL', 'X1', '', '', 'Acknowledge fault']);
    expect(rows.find((r) => r[0] === 'DI8_4A1')?.[3]).toBe('X7');
    expect(rows.find((r) => r[0] === 'DO1_4A6')?.[3]).toBe('Y0');
    expect(() => exportPlc(doc.reportContext(), 'PLC1', 'tia', 'en')).toThrow(/not a Siemens PLC/);
  });
});
