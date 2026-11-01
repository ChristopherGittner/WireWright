// BMEcat catalogs (versions 1.2 and 2005) with ECLASS or ETIM features: products become parts
// of the parts database. Dimensions, rated voltage and rated current are taken from the features
// (recognized by name or code, or as mapped by the user); all other features are kept as part
// properties, and the ECLASS/ETIM class as the part's classification.
// See docs/data-model.md, "Parts database".
import { unzipSync } from 'fflate';
import { partId } from './library.js';
import { parseAmount } from './parts.js';
import type { PartDefinition } from './schema.js';
import { child, children, childText, decodeXml, descendants, parseXml, type XmlElement } from './xml.js';

/** Part fields a catalog feature can fill. `ignore` drops the feature; `property` keeps it as a property. */
export const FEATURE_TARGETS = ['width', 'height', 'depth', 'ratedVoltage', 'ratedCurrent', 'property', 'ignore'] as const;
export type FeatureTarget = (typeof FEATURE_TARGETS)[number];

/** Feature (by code or name, as in the file) → target; remembered per machine. */
export type FeatureMapping = Record<string, FeatureTarget>;

export interface CatalogFeature {
  /** FNAME as in the file: an ECLASS IRDI (`0173-1#02-AAB381#005`), an ETIM code (`EF000008`) or a name. */
  key: string;
  /** Readable name: the feature template's name or the feature description, when the file has one. */
  name?: string;
  values: string[];
  unit?: string;
}

export interface CatalogProduct {
  supplierPid: string;
  manufacturer: string;
  manufacturerPid: string;
  descriptions: Record<string, string>;
  ean?: string;
  orderUnit?: string;
  priceQuantity?: number;
  price?: { amount: number; currency?: string };
  url?: string;
  classification: { system: string; id: string }[];
  features: CatalogFeature[];
}

export interface Catalog {
  version: string;
  /** Catalog language as an ISO 639-1 code (`de`). */
  language: string;
  supplier: string;
  currency?: string;
  products: CatalogProduct[];
}

/** A feature of the catalog with how often it occurs, an example and its target. */
export interface FeatureSummary {
  key: string;
  name?: string;
  unit?: string;
  count: number;
  example: string;
  /** Recognized automatically or from the mapping; undefined: kept as a property. */
  target?: FeatureTarget;
  /** The target comes from the mapping (not recognized automatically). */
  mapped: boolean;
}

const LANGUAGES: Record<string, string> = { deu: 'de', ger: 'de', eng: 'en', fra: 'fr', fre: 'fr', ita: 'it', spa: 'es', nld: 'nl', dut: 'nl', pol: 'pl', ces: 'cs', cze: 'cs', por: 'pt', swe: 'sv', dan: 'da', fin: 'fi', tur: 'tr', rus: 'ru', zho: 'zh', chi: 'zh' };
const language = (code: string | undefined, fallback: string) => (code ? (LANGUAGES[code.toLowerCase()] ?? code.toLowerCase().slice(0, 2)) : fallback);

/** Whether the bytes are a BMEcat file (XML with a BMECAT root, or a .zip containing one). */
export function isBmecat(bytes: Uint8Array): boolean {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    try {
      return readZipXml(bytes).slice(0, 4000).includes('BMECAT');
    } catch {
      return false;
    }
  }
  return new TextDecoder('latin1').decode(bytes.subarray(0, 4000)).includes('BMECAT');
}

function readZipXml(bytes: Uint8Array): string {
  const files = unzipSync(bytes, { filter: (f) => /\.xml$/i.test(f.name) });
  const name = Object.keys(files).sort((a, b) => files[b]!.length - files[a]!.length)[0];
  if (!name) throw new Error('The .zip file contains no XML file');
  return decodeXml(files[name]!);
}

/** Reads a BMEcat catalog (XML text or bytes, also zipped). */
export function readBmecat(content: string | Uint8Array): Catalog {
  const text = typeof content === 'string' ? content : content[0] === 0x50 && content[1] === 0x4b ? readZipXml(content) : decodeXml(content);
  const root = parseXml(text).children.find((c) => c.name === 'BMECAT');
  if (!root) throw new Error('Not a BMEcat file (no BMECAT element)');
  const header = child(root, 'HEADER');
  const catalog = child(header, 'CATALOG');
  const lang = language(childText(catalog, 'LANGUAGE') || undefined, 'de');
  const supplier = childText(child(header, 'SUPPLIER'), 'SUPPLIER_NAME');
  const currency = childText(catalog, 'CURRENCY') || undefined;

  // Names of features from the feature templates of the file (ECLASS/ETIM codes → names).
  const templateNames = new Map<string, string>();
  for (const t of descendants(root, 'FEATURE_TEMPLATE')) {
    const name = childText(t, 'FT_NAME');
    const id = childText(t, 'FT_ID') || name;
    if (id && name && name !== id) templateNames.set(id, name);
  }

  const body = children(root, 'T_NEW_CATALOG', 'T_UPDATE_PRODUCTS', 'T_UPDATE_PRICES')[0];
  const items = body ? [...children(body, 'PRODUCT'), ...children(body, 'ARTICLE')] : [];
  const products = items.map((item) => readProduct(item, lang, supplier, templateNames));
  return { version: root.attributes.version ?? '', language: lang, supplier, ...(currency ? { currency } : {}), products };
}

function readProduct(item: XmlElement, lang: string, supplier: string, templateNames: Map<string, string>): CatalogProduct {
  const details = child(item, 'PRODUCT_DETAILS', 'ARTICLE_DETAILS');
  const supplierPid = childText(item, 'SUPPLIER_PID', 'SUPPLIER_AID');
  const descriptions: Record<string, string> = {};
  for (const d of children(details, 'DESCRIPTION_SHORT')) {
    const text = d.text.trim();
    if (text) descriptions[language(d.attributes.lang, lang)] ??= text;
  }
  const ean =
    children(details, 'INTERNATIONAL_PID')
      .find((p) => /gtin|ean/i.test(p.attributes.type ?? 'gtin'))
      ?.text.trim() || childText(details, 'EAN');
  const order = child(item, 'PRODUCT_ORDER_DETAILS', 'ARTICLE_ORDER_DETAILS');
  const priceQuantity = parseAmount(childText(order, 'PRICE_QUANTITY'));
  const price = readPrice(child(item, 'PRODUCT_PRICE_DETAILS', 'ARTICLE_PRICE_DETAILS'));
  const url = readDatasheet(child(item, 'MIME_INFO'));

  const classification: { system: string; id: string }[] = [];
  const features: CatalogFeature[] = [];
  for (const block of children(item, 'PRODUCT_FEATURES', 'ARTICLE_FEATURES')) {
    const system = childText(block, 'REFERENCE_FEATURE_SYSTEM_NAME');
    const group = childText(block, 'REFERENCE_FEATURE_GROUP_ID') || childText(block, 'REFERENCE_FEATURE_GROUP_NAME');
    if (system && group) classification.push({ system, id: group });
    for (const f of children(block, 'FEATURE')) {
      const key = childText(f, 'FNAME');
      if (!key) continue;
      const values = children(f, 'FVALUE')
        .map((v) => v.text.trim())
        .filter(Boolean);
      const name = templateNames.get(key) ?? (childText(f, 'FDESCR') || undefined);
      const unit = childText(f, 'FUNIT') || undefined;
      features.push({ key, ...(name ? { name } : {}), values, ...(unit ? { unit } : {}) });
    }
  }
  return {
    supplierPid,
    manufacturer: childText(details, 'MANUFACTURER_NAME') || supplier,
    manufacturerPid: childText(details, 'MANUFACTURER_PID', 'MANUFACTURER_AID'),
    descriptions,
    ...(ean ? { ean } : {}),
    ...(childText(order, 'ORDER_UNIT') ? { orderUnit: childText(order, 'ORDER_UNIT') } : {}),
    ...(priceQuantity ? { priceQuantity } : {}),
    ...(price ? { price } : {}),
    ...(url ? { url } : {}),
    classification,
    features,
  };
}

/** The list price (net list, else the first): the price of the lowest quantity. */
function readPrice(details: XmlElement | undefined): { amount: number; currency?: string } | undefined {
  const prices = children(details, 'PRODUCT_PRICE', 'ARTICLE_PRICE');
  const preference = ['net_list', 'net_customer', 'gros_list', 'nrp'];
  const rank = (p: XmlElement) => {
    const i = preference.indexOf(p.attributes.price_type ?? '');
    return (i < 0 ? preference.length : i) * 1e9 + (parseAmount(childText(p, 'LOWER_BOUND')) ?? 0);
  };
  const best = [...prices].sort((a, b) => rank(a) - rank(b))[0];
  const amount = best ? parseAmount(childText(best, 'PRICE_AMOUNT')) : undefined;
  if (amount === undefined) return undefined;
  const currency = childText(best, 'PRICE_CURRENCY');
  return { amount, ...(currency ? { currency } : {}) };
}

function readDatasheet(mime: XmlElement | undefined): string | undefined {
  const entries = children(mime, 'MIME');
  const sheet = entries.find((m) => /data_sheet|datasheet/i.test(childText(m, 'MIME_PURPOSE'))) ?? entries.find((m) => /pdf/i.test(childText(m, 'MIME_TYPE')));
  const source = childText(sheet, 'MIME_SOURCE');
  return /^https?:\/\//i.test(source) ? source : undefined;
}

// ---------------------------------------------------------------------------
// Feature recognition

/**
 * Features recognized without a mapping: by readable name (German and English, as in ECLASS and
 * ETIM), or by ETIM feature code. ECLASS properties are identified by IRDI codes that vary with the
 * ECLASS version; they are recognized by their name when the file has one, else they are mapped in
 * the import dialog once and remembered.
 */
const RECOGNIZED: { target: FeatureTarget; name?: RegExp; codes?: string[] }[] = [
  { target: 'width', name: /^(breite|width|gerätebreite|device width|einbaubreite|baubreite)\b/i, codes: ['EF000008'] },
  { target: 'height', name: /^(höhe|hoehe|height|gerätehöhe|device height|bauhöhe)\b/i, codes: ['EF000040'] },
  { target: 'depth', name: /^(tiefe|depth|gerätetiefe|device depth|einbautiefe|bautiefe)\b/i, codes: ['EF000049'] },
  {
    target: 'ratedVoltage',
    name: /(steuerspeisespannung|control supply voltage|spulenspannung|coil voltage|bemessungssteuerspannung|rated control voltage|betätigungsspannung|actuating voltage|bemessungsspannung|rated voltage|nennspannung|nominal voltage|betriebsspannung|operating voltage)/i,
  },
  { target: 'ratedCurrent', name: /(bemessungsstrom|rated current|nennstrom|nominal current|bemessungsbetriebsstrom|rated operational current|einstellbereich|setting range)/i },
];

/** The target of a feature: the mapping first (by code, then by name), else recognition. */
export function featureTarget(feature: Pick<CatalogFeature, 'key' | 'name'>, mapping: FeatureMapping = {}): { target?: FeatureTarget; mapped: boolean } {
  const mapped = mapping[feature.key] ?? (feature.name ? mapping[feature.name] : undefined);
  if (mapped) return { target: mapped, mapped: true };
  const code = feature.key.toUpperCase();
  const label = feature.name ?? feature.key;
  const hit = RECOGNIZED.find((r) => r.codes?.includes(code) || r.name?.test(label));
  return hit ? { target: hit.target, mapped: false } : { mapped: false };
}

/** All features of the catalog with count, an example value and their target. */
export function catalogFeatures(catalog: Catalog, mapping: FeatureMapping = {}): FeatureSummary[] {
  const byKey = new Map<string, FeatureSummary>();
  for (const product of catalog.products) {
    for (const f of product.features) {
      const entry = byKey.get(f.key);
      if (entry) {
        entry.count++;
        continue;
      }
      const { target, mapped } = featureTarget(f, mapping);
      byKey.set(f.key, { key: f.key, ...(f.name ? { name: f.name } : {}), ...(f.unit ? { unit: f.unit } : {}), count: 1, example: f.values.join(', '), ...(target ? { target } : {}), mapped });
    }
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || (a.name ?? a.key).localeCompare(b.name ?? b.key));
}

// ---------------------------------------------------------------------------
// Units (UN/CEFACT common codes as used in BMEcat, or plain symbols)

const LENGTH: Record<string, number> = { MMT: 1, MM: 1, CMT: 10, CM: 10, DMT: 100, DM: 100, MTR: 1000, M: 1000, INH: 25.4, IN: 25.4 };
const VOLTAGE: Record<string, number> = { VLT: 1, V: 1, KVT: 1000, KV: 1000, '2Z': 0.001, MV: 0.001 };
const CURRENT: Record<string, number> = { AMP: 1, A: 1, '4K': 0.001, MA: 0.001, B22: 1000, KA: 1000 };

const factor = (table: Record<string, number>, unit: string | undefined, fallback = 1) => (unit ? (table[unit.toUpperCase()] ?? fallback) : fallback);
const round = (v: number) => Math.round(v * 1000) / 1000;

/** Numbers of a value: "15,5" → [15.5]; "24 ... 240" or "4-6,3" → [24, 240]. */
function numbers(value: string): number[] {
  return [...value.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(',', '.')));
}

/** Kind of voltage from a feature name or value: AC, DC or UC (both). */
function voltageKind(text: string): 'AC' | 'DC' | 'UC' | undefined {
  const ac = /\bAC\b|wechsel|alternating|~/i.test(text);
  const dc = /\bDC\b|gleich|direct/i.test(text);
  if (/\bUC\b|AC\s*\/\s*DC|AC\s*\/\s*DC|allstrom/i.test(text) || (ac && dc)) return 'UC';
  return ac ? 'AC' : dc ? 'DC' : undefined;
}

const formatNumber = (v: number) => String(round(v));

/** The rated voltage text ("24 V DC", "24 V UC", "24 V – 240 V UC") from the voltage features. */
function ratedVoltageText(features: CatalogFeature[]): string | undefined {
  const kindFeature = features.find((f) => /spannungsart|voltage type|art der spannung|type of voltage/i.test(f.name ?? f.key));
  const fallbackKind = kindFeature ? voltageKind(kindFeature.values.join(' ')) : undefined;
  const found: { values: number[]; kind?: 'AC' | 'DC' | 'UC' }[] = [];
  for (const f of features) {
    const values = f.values.flatMap(numbers).map((v) => round(v * factor(VOLTAGE, f.unit))).filter((v) => v > 0);
    if (values.length === 0) continue;
    const kind = voltageKind(`${f.name ?? f.key} ${f.values.join(' ')}`) ?? fallbackKind;
    found.push({ values: [Math.min(...values), Math.max(...values)], ...(kind ? { kind } : {}) });
  }
  if (found.length === 0) return undefined;
  const ranges = new Set(found.map((f) => f.values.join('-')));
  const kinds = new Set(found.map((f) => f.kind).filter(Boolean));
  const kind = kinds.size > 1 ? (ranges.size === 1 ? 'UC' : undefined) : [...kinds][0];
  if (ranges.size > 1) {
    // Different voltages for AC and DC: all of them (the voltage check skips such parts).
    return found.map((f) => `${f.values[0] === f.values[1] ? formatNumber(f.values[0]!) : `${formatNumber(f.values[0]!)}–${formatNumber(f.values[1]!)}`} V${f.kind ? ` ${f.kind}` : ''}`).join(' / ');
  }
  const [low, high] = found[0]!.values as [number, number];
  const value = low === high ? `${formatNumber(low)} V` : `${formatNumber(low)} V – ${formatNumber(high)} V`;
  return kind ? `${value} ${kind}` : value;
}

const ORDER_UNITS: Record<string, string> = { C62: 'pcs', PCE: 'pcs', H87: 'pcs', EA: 'pcs', MTR: 'm', PK: 'pack', SET: 'set', KGM: 'kg' };

/** Parts from the catalog's products, with features mapped to part fields. */
export function catalogParts(catalog: Catalog, mapping: FeatureMapping = {}): PartDefinition[] {
  const parts = new Map<string, PartDefinition>();
  for (const product of catalog.products) {
    const partNumber = product.manufacturerPid || product.supplierPid;
    if (!partNumber) continue;
    const manufacturer = product.manufacturer;
    const part: PartDefinition = { id: partId(manufacturer, partNumber), manufacturer, partNumber };
    if (Object.keys(product.descriptions).length > 0) part.description = product.descriptions;
    if (product.ean) part.ean = product.ean;
    if (product.orderUnit) part.unit = ORDER_UNITS[product.orderUnit.toUpperCase()] ?? product.orderUnit;
    if (product.url) part.url = product.url;
    if (product.classification.length > 0) part.classification = product.classification;

    const price = product.price;
    const fromManufacturer = !catalog.supplier || catalog.supplier.toLowerCase() === manufacturer.toLowerCase();
    if (fromManufacturer) {
      if (product.supplierPid && product.supplierPid !== partNumber) part.orderNumber = product.supplierPid;
      if (price) {
        part.price = price.amount;
        const currency = price.currency ?? catalog.currency;
        if (currency) part.currency = currency;
        if (product.priceQuantity && product.priceQuantity !== 1) part.priceUnit = product.priceQuantity;
      }
    } else {
      // A wholesaler's catalog: its article number and price belong to the supplier.
      const currency = price?.currency ?? catalog.currency;
      part.suppliers = [
        {
          name: catalog.supplier,
          ...(product.supplierPid ? { orderNumber: product.supplierPid } : {}),
          ...(price ? { price: round(price.amount / (product.priceQuantity ?? 1)), ...(currency ? { currency } : {}) } : {}),
        },
      ];
    }

    const voltages: CatalogFeature[] = [];
    const properties: Record<string, string> = {};
    for (const f of product.features) {
      const { target } = featureTarget(f, mapping);
      const first = f.values.flatMap(numbers);
      if ((target === 'width' || target === 'height' || target === 'depth') && first.length > 0) {
        part[target] = round(first[0]! * factor(LENGTH, f.unit));
      } else if (target === 'ratedCurrent' && first.length > 0) {
        part.ratedCurrent = round(Math.max(...first) * factor(CURRENT, f.unit));
      } else if (target === 'ratedVoltage') {
        voltages.push(f);
      } else if (target !== 'ignore' && f.values.length > 0) {
        properties[f.name ?? f.key] = `${f.values.join(', ')}${f.unit ? ` ${f.unit}` : ''}`;
      }
    }
    const voltage = ratedVoltageText(voltages);
    if (voltage) part.ratedVoltage = voltage;
    if (Object.keys(properties).length > 0) part.properties = properties;
    parts.set(part.id, part);
  }
  return [...parts.values()];
}

/**
 * An imported part over an existing one: the import's fields win, properties and suppliers are
 * merged (a supplier of the same name is replaced), fields only the existing part has stay
 * (e.g. the ERP number).
 */
export function mergePart(existing: PartDefinition | undefined, imported: PartDefinition): PartDefinition {
  if (!existing) return imported;
  const suppliers = [...(existing.suppliers ?? []).filter((s) => !imported.suppliers?.some((i) => i.name === s.name)), ...(imported.suppliers ?? [])];
  const properties = { ...existing.properties, ...imported.properties };
  return {
    ...existing,
    ...imported,
    ...(existing.description || imported.description ? { description: typeof existing.description === 'object' && typeof imported.description === 'object' ? { ...existing.description, ...imported.description } : (imported.description ?? existing.description)! } : {}),
    ...(suppliers.length > 0 ? { suppliers } : {}),
    ...(Object.keys(properties).length > 0 ? { properties } : {}),
  };
}
