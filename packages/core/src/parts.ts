// Parts database: exchange with ERP systems as a table (CSV or .xlsx). Columns are recognized
// by their (English or German) titles; unknown columns become free properties.
// See docs/data-model.md, "Parts database".
import { partId } from './library.js';
import { readXlsx } from './plcImport.js';
import type { PartDefinition } from './schema.js';
import { localize } from './text.js';
import { parseCsv } from './translations.js';

const COLUMNS = {
  manufacturer: /^(manufacturer|hersteller)$/i,
  partNumber: /^(part number|part no\.?|typ(e)?nummer|artikelnummer hersteller|bestellnummer|order code|mpn)$/i,
  description: /^(description|beschreibung|bezeichnung|text)$/i,
  orderNumber: /^(order number|manufacturer order number|bestellnummer hersteller)$/i,
  ean: /^(ean|gtin)$/i,
  erpNumber: /^(erp( number)?|erp-nummer|article number|artikelnummer|material( number)?|materialnummer|sap)$/i,
  unit: /^(unit|einheit|me)$/i,
  price: /^(price|list price|preis|listenpreis|einzelpreis|unit price)$/i,
  currency: /^(currency|währung|waehrung)$/i,
  priceUnit: /^(price unit|preiseinheit|pe)$/i,
  supplier: /^(supplier|lieferant)$/i,
  supplierNumber: /^(supplier number|supplier order number|lieferantennummer|bestellnummer lieferant)$/i,
  supplierPrice: /^(supplier price|einkaufspreis|ek|purchase price)$/i,
  deliveryDays: /^(delivery days|delivery time|lieferzeit)$/i,
  url: /^(url|link|datasheet|datenblatt)$/i,
} as const;

type Column = keyof typeof COLUMNS;

/** A number as written in German or English (`1.234,50`, `1,234.50`, `12,5`). */
export function parseAmount(text: string): number | undefined {
  const t = text.replace(/[^\d.,-]/g, '');
  if (!t) return undefined;
  const normalized = t.includes(',') && t.includes('.') ? (t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')) : t.replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}

/** Parts from a table: CSV text or .xlsx bytes, first row with a part number column is the header. */
export function readPartsTable(content: string | Uint8Array, language: string): PartDefinition[] {
  const table = typeof content === 'string' ? parseCsv(content) : content[0] === 0x50 && content[1] === 0x4b ? readXlsx(content) : parseCsv(new TextDecoder().decode(content));
  const headerIndex = table.findIndex((row) => row.some((c) => COLUMNS.partNumber.test(c.trim())));
  if (headerIndex < 0) throw new Error('No parts table found: a header row with a part number column is needed');
  const header = table[headerIndex]!.map((c) => c.trim());
  const columns = new Map<number, Column>();
  header.forEach((title, i) => {
    // The first column matching a field wins; "Bestellnummer" is the part number unless a
    // separate part number column exists.
    const field = (Object.keys(COLUMNS) as Column[]).find((k) => COLUMNS[k].test(title) && ![...columns.values()].includes(k));
    if (field) columns.set(i, field);
  });
  const parts = new Map<string, PartDefinition>();
  for (const row of table.slice(headerIndex + 1)) {
    const value = (field: Column) => {
      for (const [i, f] of columns) if (f === field) return row[i]?.trim() ?? '';
      return '';
    };
    const partNumber = value('partNumber');
    if (!partNumber) continue;
    const manufacturer = value('manufacturer');
    const part: PartDefinition = { id: partId(manufacturer, partNumber), manufacturer, partNumber };
    const set = <K extends keyof PartDefinition>(key: K, v: PartDefinition[K] | undefined | '') => {
      if (v !== undefined && v !== '') part[key] = v as PartDefinition[K];
    };
    const description = value('description');
    if (description) part.description = { [language]: description };
    set('orderNumber', value('orderNumber'));
    set('ean', value('ean'));
    set('erpNumber', value('erpNumber'));
    set('unit', value('unit'));
    set('price', parseAmount(value('price')));
    set('currency', value('currency'));
    set('priceUnit', parseAmount(value('priceUnit')) || undefined);
    set('url', value('url'));
    const supplier = value('supplier');
    if (supplier) {
      const days = parseAmount(value('deliveryDays'));
      const price = parseAmount(value('supplierPrice'));
      part.suppliers = [
        {
          name: supplier,
          ...(value('supplierNumber') ? { orderNumber: value('supplierNumber') } : {}),
          ...(price !== undefined ? { price, ...(value('currency') ? { currency: value('currency') } : {}) } : {}),
          ...(days !== undefined ? { deliveryDays: Math.round(days) } : {}),
        },
      ];
    }
    const properties = Object.fromEntries(header.flatMap((title, i) => (!columns.has(i) && title && row[i]?.trim() ? [[title, row[i]!.trim()]] : [])));
    if (Object.keys(properties).length > 0) part.properties = properties;
    parts.set(part.id, part);
  }
  return [...parts.values()];
}

/** Parts as a table with the columns read by `readPartsTable` (first supplier only). */
export function partsTable(parts: readonly PartDefinition[], language: string, languages: readonly string[]): string[][] {
  const header = ['Manufacturer', 'Part number', 'Description', 'Order number', 'EAN', 'ERP number', 'Unit', 'Price', 'Currency', 'Price unit', 'Supplier', 'Supplier number', 'Supplier price', 'Delivery days', 'URL'];
  const n = (v: number | undefined) => (v === undefined ? '' : String(v));
  return [
    header,
    ...parts.map((p) => {
      const s = p.suppliers?.[0];
      return [p.manufacturer, p.partNumber, localize(p.description, language, languages), p.orderNumber ?? '', p.ean ?? '', p.erpNumber ?? '', p.unit ?? '', n(p.price), p.currency ?? '', n(p.priceUnit), s?.name ?? '', s?.orderNumber ?? '', n(s?.price), n(s?.deliveryDays), p.url ?? ''];
    }),
  ];
}
