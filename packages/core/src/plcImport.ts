// Import of PLC tag names (and comments) back from the PLC project: TIA Portal tag table
// (.xlsx), Codesys global variable list, GX Works3 global labels, or Wirewright's own I/O list CSV.
// Rows are matched to the channels of a PLC by address. See docs/data-model.md, "PLC".
import { strFromU8, unzipSync } from 'fflate';
import type { Command } from './commands/schema.js';
import type { PlcIndex } from './plc.js';
import type { IoChannel, PlcStation, ProjectState, SchematicPage } from './schema.js';
import { localize } from './text.js';
import { parseCsv, setLanguage, xmlText } from './translations.js';

export interface PlcTagRow {
  address: string;
  name: string;
  comment?: string;
}

/** Reads tag rows from an exported tag table; the format follows from the content. */
export function readPlcTags(content: string | Uint8Array): PlcTagRow[] {
  if (typeof content !== 'string') {
    // Zip (xlsx) or text in bytes
    if (content[0] === 0x50 && content[1] === 0x4b) return rowsFromTable(readXlsx(content));
    content = strFromU8(content);
  }
  // A Codesys GVL declares `name AT %address : type;` (GX Works3 tables also contain VAR_GLOBAL).
  if (/^\s*[A-Za-z_]\w*\s+AT\s+%/im.test(content)) return readGvl(content);
  return rowsFromTable(parseCsv(content));
}

/** `name AT %IX0.0 : BOOL; (* comment *)` lines of a Codesys GVL (also `// comment`). */
function readGvl(text: string): PlcTagRow[] {
  const rows: PlcTagRow[] = [];
  const pattern = /^\s*([A-Za-z_][\w]*)\s+AT\s+(%[A-Za-z]+[\d.]+)\s*:\s*[^;]+;\s*(?:\(\*(.*?)\*\)|\/\/(.*))?/gm;
  for (const m of text.matchAll(pattern)) rows.push({ name: m[1]!, address: m[2]!, ...(cleanComment(m[3] ?? m[4]) ? { comment: cleanComment(m[3] ?? m[4])! } : {}) });
  return rows;
}

function cleanComment(text: string | undefined): string | undefined {
  // Wirewright's own exports append " – <card> <channel> pin <n>": not part of the function.
  const value = text?.trim().replace(/(?:^|\s+–\s+)\S+\s+(?:\S+\s+)?\S+\s+pin\s+\S+$/, '').trim();
  return value ? value : undefined;
}

const HEADERS = {
  name: /^(name|label name|symbol|tag name|symbolname|variable|variablenname|label)$/i,
  address: /^(logical address|address|adresse|logische adresse|operand|device|assign.*)$/i,
  comment: /^(comment|kommentar|function|funktion)$/i,
};

/** Rows of a table with a header row naming the tag name and address columns (comment optional). */
function rowsFromTable(table: readonly string[][]): PlcTagRow[] {
  const headerIndex = table.findIndex((row) => row.some((c) => HEADERS.name.test(c.trim())) && row.some((c) => HEADERS.address.test(c.trim())));
  if (headerIndex < 0) throw new Error('No tag table found: a header row with a name and an address column is needed');
  const header = table[headerIndex]!.map((c) => c.trim());
  const column = (pattern: RegExp) => header.findIndex((c) => pattern.test(c));
  const [name, address, comment] = [column(HEADERS.name), column(HEADERS.address), column(HEADERS.comment)];
  return table.slice(headerIndex + 1).flatMap((row) => {
    const tag = row[name]?.trim() ?? '';
    const at = row[address]?.trim() ?? '';
    if (!tag || !at) return [];
    const note = comment >= 0 ? row[comment]?.trim() : undefined;
    return [{ name: tag, address: at, ...(note ? { comment: note } : {}) }];
  });
}

/** Rows of the first sheet of an .xlsx file (shared and inline strings, numbers). */
export function readXlsx(bytes: Uint8Array): string[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => f.name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(f.name) });
  } catch (error) {
    throw new Error('Not an .xlsx file', { cause: error });
  }
  const sheetName = Object.keys(files)
    .filter((f) => f.startsWith('xl/worksheets/'))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))[0];
  if (!sheetName) throw new Error('The .xlsx file has no worksheet');
  const shared = files['xl/sharedStrings.xml'] ? [...strFromU8(files['xl/sharedStrings.xml']).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => cellText(m[1]!)) : [];
  const rows: string[][] = [];
  for (const row of strFromU8(files[sheetName]!).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cell of row[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cell[1]!;
      const body = cell[2] ?? '';
      const ref = /\br="([A-Z]+)\d+"/.exec(attributes)?.[1];
      const index = ref ? [...ref].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1 : cells.length;
      const type = /\bt="(\w+)"/.exec(attributes)?.[1];
      const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const text = type === 's' ? (shared[Number(value)] ?? '') : type === 'inlineStr' ? cellText(body) : value !== undefined ? xmlText(value) : '';
      while (cells.length < index) cells.push('');
      cells[index] = text;
    }
    rows.push(cells);
  }
  return rows.filter((r) => r.some((v) => v !== ''));
}

/** Text of a shared string or inline string: all its `<t>` runs. */
function cellText(xml: string): string {
  return [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => xmlText(m[1]!)).join('');
}

/** Address in a comparable form: no `%` or spaces, upper case, German Siemens mnemonics as international, no leading zeros. */
export function normalizePlcAddress(address: string, station: PlcStation): string {
  let a = address.replace(/[%\s]/g, '').toUpperCase();
  if (station.family === 'siemens') a = a.replace(/^E/, 'I').replace(/^A/, 'Q');
  return a.replace(/^([A-Z]+)0+(?=\d)/, '$1');
}

export interface PlcTagChange {
  /** Card device tag and channel label, for display. */
  card: string;
  channel: string;
  address: string;
  pageId: string;
  cardItemId: string;
  /** Index in the card's `plc.channels`. */
  index: number;
  name: { from: string; to: string } | undefined;
  comment: { from: string; to: string } | undefined;
}

export interface PlcTagImport {
  changes: PlcTagChange[];
  /** Rows whose address is not a channel of the PLC. */
  unmatched: PlcTagRow[];
  /** Rows matching a channel that need no change. */
  unchanged: number;
}

/**
 * Compares tag rows with the channels of a PLC (by address). Names become the channels' tag
 * names; with `comments`, comments become their function (in `language`) where they differ.
 */
export function planPlcTagImport(
  state: ProjectState,
  plc: PlcIndex,
  stationName: string,
  rows: readonly PlcTagRow[],
  options: { comments: boolean; language: string },
): PlcTagImport {
  const station = state.project.plcs.find((s) => s.name === stationName);
  if (!station) throw new Error(`PLC "${stationName}" not found`);
  const { languages } = state.project.settings;
  const byAddress = new Map<string, { card: PlcIndex['cards'][number]; index: number; info: PlcIndex['cards'][number]['channels'][number] }>();
  for (const card of plc.cards) {
    if (card.station?.name !== station.name) continue;
    card.channels.forEach((info, index) => {
      if (info.address) byAddress.set(normalizePlcAddress(info.address, station), { card, index, info });
    });
  }
  const changes: PlcTagChange[] = [];
  const unmatched: PlcTagRow[] = [];
  let unchanged = 0;
  for (const row of rows) {
    const hit = byAddress.get(normalizePlcAddress(row.address, station));
    if (!hit) {
      unmatched.push(row);
      continue;
    }
    const { card, index, info } = hit;
    const name = row.name !== info.name ? { from: info.name, to: row.name } : undefined;
    const current = localize(info.function, options.language, languages);
    const comment = options.comments && row.comment !== undefined && row.comment !== current ? { from: current, to: row.comment } : undefined;
    if (!name && !comment) {
      unchanged++;
      continue;
    }
    changes.push({
      card: card.device,
      channel: info.channel.label ?? `${info.channel.kind} ${info.channel.channel}`,
      address: info.address!,
      pageId: card.pageId,
      cardItemId: card.itemId,
      index,
      name,
      comment,
    });
  }
  return { changes, unmatched, unchanged };
}

/** Commands writing the chosen changes into the cards (one per card; views follow their master). */
export function plcTagImportCommands(state: ProjectState, changes: readonly PlcTagChange[], language: string): Command[] {
  const { languages } = state.project.settings;
  const byCard = new Map<string, PlcTagChange[]>();
  for (const change of changes) byCard.set(change.cardItemId, [...(byCard.get(change.cardItemId) ?? []), change]);
  return [...byCard].map(([itemId, list]) => {
    const pageId = list[0]!.pageId;
    const card = (state.pages[pageId] as SchematicPage).items.find((i) => i.id === itemId)!;
    const plc = structuredClone(card.props!.plc!);
    for (const change of list) {
      const channel: IoChannel = plc.channels[change.index]!;
      if (change.name) channel.name = change.name.to;
      if (change.comment) {
        const text = setLanguage(channel.function, language, change.comment.to, languages);
        if (text === undefined) delete channel.function;
        else channel.function = text;
      }
    }
    return { type: 'setItemProperties', pageId, itemId, props: { plc } } as Command;
  });
}
