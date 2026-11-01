// Translations: every multilingual text of a project (function texts,
// technical data, page/project/PLC descriptions, PLC channel functions) as a
// table with one column per project language, plus CSV/ODS export and import.
//
// Texts are addressed by keys (`item:<page>:<item>:functionText` …). The
// translation table groups identical texts, so a text used many times is
// translated once. Import matches rows by the text in the source language
// (the project's first language) and fills in the other languages.
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Library } from './library.js';
import { formatReference, pageFullName, pagePosition } from './references.js';
import { naturalCompare } from './reports.js';
import type { LocalizedText, ProjectState } from './schema.js';
import { effectiveTag, formatTag } from './tags.js';

export type TranslationField = 'functionText' | 'technicalData' | 'freeText' | 'pageDescription' | 'projectDescription' | 'plcDescription' | 'channelFunction';

export interface TextEntry {
  /** Address of the text, used by the `setTexts` command. */
  key: string;
  field: TranslationField;
  /** Where the text is used, e.g. `=FB+CAB1-3Q2 (/3.2)`. */
  where: string;
  /** Text per project language ('' when missing). A language-neutral text appears in every language. */
  values: Record<string, string>;
  /** Page to jump to, if any. */
  pageId?: string;
  itemId?: string;
}

export interface TextGroup {
  /** The same text (in all languages) used at all these places. */
  entries: TextEntry[];
  values: Record<string, string>;
}

const FIELD_LABELS: Record<TranslationField, string> = {
  functionText: 'Function text',
  technicalData: 'Technical data',
  freeText: 'Text',
  pageDescription: 'Page description',
  projectDescription: 'Project description',
  plcDescription: 'PLC description',
  channelFunction: 'Channel function',
};

export function textFieldLabel(field: TranslationField): string {
  return FIELD_LABELS[field];
}

function perLanguage(text: LocalizedText | undefined, languages: readonly string[]): Record<string, string> {
  return Object.fromEntries(languages.map((l) => [l, typeof text === 'string' ? text : (text?.[l] ?? '')]));
}

/** All multilingual texts of the project that have a value in at least one language. */
export function collectTexts(state: ProjectState, library: Library): TextEntry[] {
  const { settings } = state.project;
  const languages = settings.languages;
  const entries: TextEntry[] = [];
  const add = (entry: Omit<TextEntry, 'values'>, text: LocalizedText | undefined) => {
    const values = perLanguage(text, languages);
    if (Object.values(values).some((v) => v !== '')) entries.push({ ...entry, values });
  };
  add({ key: 'project:description', field: 'projectDescription', where: 'Project' }, state.project.description);
  for (const plc of state.project.plcs) add({ key: `plc:${plc.name}:description`, field: 'plcDescription', where: `PLC ${plc.name}` }, plc.description);
  for (const pageId of state.project.pages) {
    const page = state.pages[pageId];
    if (!page) continue;
    add({ key: `page:${page.id}:description`, field: 'pageDescription', where: pageFullName(page), pageId: page.id }, page.description);
    if (page.type !== 'schematic') continue;
    for (const item of page.items) {
      const props = item.props;
      if (!props) continue;
      const where = () => {
        const tag = formatTag(effectiveTag(page, item, library));
        const ref = formatReference(page, pagePosition(page, item, settings, library), settings, page.structure);
        return tag ? `${tag} (${ref})` : ref;
      };
      const at = { pageId: page.id, itemId: item.id };
      if (props.functionText !== undefined) add({ key: `item:${page.id}:${item.id}:functionText`, field: 'functionText', where: where(), ...at }, props.functionText);
      if (props.technicalData !== undefined) add({ key: `item:${page.id}:${item.id}:technicalData`, field: 'technicalData', where: where(), ...at }, props.technicalData);
      if (props.text !== undefined && library.symbol(item.symbol)?.function === 'text') {
        const ref = formatReference(page, pagePosition(page, item, settings, library), settings, page.structure);
        add({ key: `item:${page.id}:${item.id}:text`, field: 'freeText', where: `${pageFullName(page)} (${ref})`, ...at }, props.text);
      }
      props.plc?.channels.forEach((channel, i) => {
        if (channel.function === undefined) return;
        add({ key: `channel:${page.id}:${item.id}:${i}`, field: 'channelFunction', where: `${where()} ${channel.kind} ${channel.channel}`, ...at }, channel.function);
      });
    }
  }
  return entries;
}

/** Identical texts grouped, sorted by the source language (the first project language). */
export function groupTexts(entries: readonly TextEntry[], languages: readonly string[]): TextGroup[] {
  const groups = new Map<string, TextGroup>();
  for (const entry of entries) {
    const id = JSON.stringify(languages.map((l) => entry.values[l] ?? ''));
    const group = groups.get(id);
    if (group) group.entries.push(entry);
    else groups.set(id, { entries: [entry], values: entry.values });
  }
  const source = languages[0] ?? '';
  return [...groups.values()].sort((a, b) => naturalCompare(a.values[source] || '\uffff', b.values[source] || '\uffff') || naturalCompare(JSON.stringify(a.values), JSON.stringify(b.values)));
}

/**
 * Sets one language of a multilingual text. A language-neutral (plain string)
 * text becomes one text per project language first. An empty value removes
 * the language; `undefined` is returned when no language is left.
 */
export function setLanguage(text: LocalizedText | undefined, language: string, value: string, languages: readonly string[]): LocalizedText | undefined {
  const values: Record<string, string> = typeof text === 'string' ? Object.fromEntries(languages.map((l) => [l, text])) : { ...text };
  if (value === '') delete values[language];
  else values[language] = value;
  return Object.keys(values).length > 0 ? values : undefined;
}

// ---------------------------------------------------------------------------
// Export and import

export type TranslationFormat = 'csv' | 'ods';

/** One row per distinct text: one column per language, then where it is used (for information). */
export function translationTable(groups: readonly TextGroup[], languages: readonly string[]): string[][] {
  return [
    [...languages, 'Used at'],
    ...groups.map((g) => [...languages.map((l) => g.values[l] ?? ''), g.entries.map((e) => `${e.where} – ${FIELD_LABELS[e.field]}`).join('; ')]),
  ];
}

export function exportTranslations(
  groups: readonly TextGroup[],
  languages: readonly string[],
  format: TranslationFormat,
  baseName = 'translations',
): { fileName: string; content: string | Uint8Array; mimeType: string } {
  const table = translationTable(groups, languages);
  if (format === 'csv') return { fileName: `${baseName}.csv`, content: tableToCsv(table), mimeType: 'text/csv' };
  return { fileName: `${baseName}.ods`, content: toOds(table), mimeType: 'application/vnd.oasis.opendocument.spreadsheet' };
}

/** Reads a translation table (first sheet, first row = header) from CSV text or ODS bytes. */
export function readTranslationTable(content: string | Uint8Array, format: TranslationFormat): string[][] {
  if (format === 'csv') return parseCsv(typeof content === 'string' ? content : strFromU8(content));
  return readOds(typeof content === 'string' ? strToU8(content) : content);
}

export interface TranslationImport {
  /** Texts to change (for the `setTexts` command). */
  texts: { key: string; language: string; value: string }[];
  /** Rows whose source text was found in the project. */
  matched: number;
  /** Source texts of rows that match no text of the project. */
  unmatched: string[];
  /** Languages found in the header. */
  languages: string[];
}

/**
 * Matches the rows of an imported table to the project's texts by the
 * source language (the project's first language) and returns the changes
 * for the other languages. Empty cells change nothing.
 */
export function planTranslationImport(table: readonly string[][], entries: readonly TextEntry[], projectLanguages: readonly string[]): TranslationImport {
  const source = projectLanguages[0];
  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase());
  const columns = projectLanguages.map((l) => ({ language: l, index: header.indexOf(l.toLowerCase()) })).filter((c) => c.index >= 0);
  const sourceColumn = columns.find((c) => c.language === source);
  if (!source || !sourceColumn) throw new Error(`The table needs a column "${source ?? '?'}" (the project's first language) to find the texts.`);
  const bySource = new Map<string, TextEntry[]>();
  for (const entry of entries) {
    const text = entry.values[source]?.trim();
    if (text) bySource.set(text, [...(bySource.get(text) ?? []), entry]);
  }
  const result: TranslationImport = { texts: [], matched: 0, unmatched: [], languages: columns.map((c) => c.language) };
  const rows = table.slice(1).filter((row) => (row[sourceColumn.index] ?? '').trim() !== '');
  const cells = (row: readonly string[]) => columns.map(({ index }) => (row[index] ?? '').trim());
  // A source text can have several translations (one per group). A row equal to the current
  // translations of a text confirms that text, so a changed row only updates the others.
  const unchanged = new Set(rows.map((row) => JSON.stringify(cells(row))));
  const signature = (entry: TextEntry) => JSON.stringify(columns.map(({ language }) => (entry.values[language] ?? '').trim()));
  const confirmed = (entry: TextEntry) => unchanged.has(signature(entry));
  const confirmedBy = (row: readonly string[]) => (entry: TextEntry) => signature(entry) === JSON.stringify(cells(row));
  for (const row of rows) {
    const text = (row[sourceColumn.index] ?? '').trim();
    const all = bySource.get(text);
    if (!all) {
      result.unmatched.push(text);
      continue;
    }
    result.matched++;
    // A row equal to the current translations of a text changes nothing.
    if (all.some(confirmedBy(row))) continue;
    const targets = all.filter((entry) => !confirmed(entry));
    for (const { language, index } of columns) {
      const value = (row[index] ?? '').trim();
      if (language === source || value === '') continue;
      for (const entry of targets) if (entry.values[language] !== value) result.texts.push({ key: entry.key, language, value });
    }
  }
  return result;
}

// CSV (semicolon separated, UTF-8 with BOM, like the report export)

/** A table as CSV (UTF-8 with BOM, quoted where needed). */
export function tableToCsv(table: readonly string[][], delimiter = ';'): string {
  const escape = (value: string) => (/["\r\n]/.test(value) || value.includes(delimiter) ? `"${value.replace(/"/g, '""')}"` : value);
  return '\ufeff' + table.map((row) => row.map(escape).join(delimiter)).join('\r\n') + '\r\n';
}

/** Parses CSV with `;`, `,` or tabs (whichever the first line uses most), quoted fields and line breaks in quotes. */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\ufeff/, '');
  const firstLine = input.split(/\r?\n/, 1)[0] ?? '';
  const count = (d: string) => firstLine.split(d).length - 1;
  const delimiter = [';', '\t', ','].reduce((best, d) => (count(d) > count(best) ? d : best), ';');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v !== ''));
}

// ODS (OpenDocument spreadsheet): a zip with content.xml

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function toOds(table: readonly string[][]): Uint8Array {
  const cell = (value: string) =>
    `<table:table-cell office:value-type="string">${value
      .split('\n')
      .map((line) => `<text:p>${xmlEscape(line)}</text:p>`)
      .join('')}</table:table-cell>`;
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2">
<office:body><office:spreadsheet><table:table table:name="Translations">
${table.map((row) => `<table:table-row>${row.map(cell).join('')}</table:table-row>`).join('\n')}
</table:table></office:spreadsheet></office:body></office:document-content>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`;
  // The mimetype entry must come first and be stored uncompressed.
  return zipSync({
    mimetype: [strToU8('application/vnd.oasis.opendocument.spreadsheet'), { level: 0 }],
    'META-INF/manifest.xml': strToU8(manifest),
    'content.xml': strToU8(content),
  });
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function xmlText(xml: string): string {
  return xml
    .replace(/<text:s(?:\s+text:c="(\d+)")?\s*\/>/g, (_, n: string | undefined) => ' '.repeat(Number(n ?? 1)))
    .replace(/<text:tab\s*\/>/g, '\t')
    .replace(/<text:line-break\s*\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (m, e: string) =>
      e.startsWith('#x') ? String.fromCodePoint(parseInt(e.slice(2), 16)) : e.startsWith('#') ? String.fromCodePoint(Number(e.slice(1))) : (XML_ENTITIES[e] ?? m),
    );
}

/** Reads the first sheet of an ODS file as rows of strings. */
function readOds(bytes: Uint8Array): string[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => f.name === 'content.xml' });
  } catch (error) {
    throw new Error('Not an ODS file', { cause: error });
  }
  const content = files['content.xml'];
  if (!content) throw new Error('Not an ODS file (content.xml missing)');
  const xml = strFromU8(content);
  const table = xml.match(/<table:table\b[^>]*>([\s\S]*?)<\/table:table>/)?.[1] ?? '';
  const rows: string[][] = [];
  for (const rowMatch of table.matchAll(/<table:table-row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-row>)/g)) {
    const repeatRows = Math.min(Number(rowMatch[1]?.match(/table:number-rows-repeated="(\d+)"/)?.[1] ?? 1), 1000);
    const row: string[] = [];
    for (const cellMatch of (rowMatch[2] ?? '').matchAll(/<table:(?:covered-)?table-cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:(?:covered-)?table-cell>)/g)) {
      const repeat = Math.min(Number(cellMatch[1]?.match(/table:number-columns-repeated="(\d+)"/)?.[1] ?? 1), 1000);
      const paragraphs = [...(cellMatch[2] ?? '').matchAll(/<text:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/text:p>)/g)].map((p) => xmlText(p[1] ?? ''));
      const value = paragraphs.join('\n');
      for (let i = 0; i < repeat; i++) row.push(value);
    }
    while (row.length > 0 && row.at(-1) === '') row.pop();
    for (let i = 0; i < repeatRows; i++) rows.push([...row]);
  }
  return rows.filter((r) => r.some((v) => v !== ''));
}
