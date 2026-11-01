import { describe, expect, it } from 'vitest';
import { parseAmount, partsTable, readPartsTable } from './parts.js';

describe('parts database tables', () => {
  it('reads an ERP list with German titles, numbers and unknown columns', () => {
    const csv = 'Hersteller;Bestellnummer;Bezeichnung;Materialnummer;Preis;Währung;Preiseinheit;Lieferant;Lieferantennummer;Lieferzeit;Lagerort\n' + 'Finder;40.52.9.024.0000;Relais 2W 24V DC;100234;1.234,50;EUR;100;Elektro AG;EA-1;5;R3\n' + ';;ohne Nummer\n';
    expect(readPartsTable(csv, 'de')).toEqual([
      {
        id: 'Finder:40.52.9.024.0000',
        manufacturer: 'Finder',
        partNumber: '40.52.9.024.0000',
        description: { de: 'Relais 2W 24V DC' },
        erpNumber: '100234',
        price: 1234.5,
        currency: 'EUR',
        priceUnit: 100,
        suppliers: [{ name: 'Elektro AG', orderNumber: 'EA-1', deliveryDays: 5 }],
        properties: { Lagerort: 'R3' },
      },
    ]);
  });

  it('writes a table it reads back', () => {
    const parts = [{ id: 'WAGO:750-430', manufacturer: 'WAGO', partNumber: '750-430', description: { en: '8 DI 24 V' }, price: 48.9, currency: 'EUR', suppliers: [{ name: 'Distrib', price: 41, deliveryDays: 2 }] }];
    const csv = partsTable(parts, 'en', ['en']).map((r) => r.join(';')).join('\n');
    expect(readPartsTable(csv, 'en')).toEqual([{ ...parts[0], suppliers: [{ name: 'Distrib', price: 41, currency: 'EUR', deliveryDays: 2 }] }]);
  });

  it('understands both number formats', () => {
    expect([parseAmount('1.234,50'), parseAmount('1,234.50'), parseAmount('12,5'), parseAmount('7 €'), parseAmount('')]).toEqual([1234.5, 1234.5, 12.5, 7, undefined]);
  });

  it('needs a part number column', () => {
    expect(() => readPartsTable('a;b\n1;2', 'de')).toThrow(/part number/);
  });
});
