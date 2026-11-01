// IEC 81346 tags and their inheritance from boxes and pages.
// See docs/data-model.md, "Tags and device naming" and "Boxes".
import { boxesContaining, type Point } from './geometry.js';
import type { Library } from './library.js';
import { tagValueSchema, type Item, type SchematicPage, type Tag } from './schema.js';

const ASPECTS = [
  ['function', '='],
  ['location', '+'],
  ['product', '-'],
] as const;

export type Aspect = (typeof ASPECTS)[number][0];

/** `{ function: 'A1', location: 'CAB1', product: 'K1' }` → `=A1+CAB1-K1`. Missing aspects are left out. */
export function formatTag(tag: Tag): string {
  return ASPECTS.map(([aspect, prefix]) => (tag[aspect] ? prefix + tag[aspect] : '')).join('');
}

/** Parses `=A1+CAB1-K1`, `-K1`, `+CAB1` … Throws on invalid input. */
export function parseTag(text: string): Tag {
  const trimmed = text.trim();
  const tag: Tag = {};
  const pattern = /([=+-])([^=+-]*)/g;
  let consumed = 0;
  for (const match of trimmed.matchAll(pattern)) {
    if (match.index !== consumed) break;
    consumed += match[0].length;
    const aspect = ASPECTS.find(([, prefix]) => prefix === match[1])?.[0];
    const value = match[2] ?? '';
    if (!aspect || tag[aspect] !== undefined) throw new Error(`Invalid tag "${text}": aspect "${match[1]}" given twice`);
    if (!tagValueSchema.safeParse(value).success) throw new Error(`Invalid tag "${text}": "${value}" is not a valid tag value`);
    tag[aspect] = value;
  }
  if (consumed !== trimmed.length || consumed === 0) {
    throw new Error(`Invalid tag "${text}": expected something like "=A1+CAB1-K1"`);
  }
  return tag;
}

/**
 * The tag an item at `point` inherits: walks the boxes containing the point
 * from the innermost outwards, then the page structure. Device boxes pass on
 * all three aspects, structure boxes only `=` and `+`.
 */
export function tagContext(page: SchematicPage, point: Point, library: Library, excludeId?: string): Tag {
  const context: Tag = {};
  for (const box of boxesContaining(page, point, library, excludeId)) {
    const isDeviceBox = library.symbol(box.symbol)?.function === 'box.device';
    context.function ??= box.tag?.function;
    context.location ??= box.tag?.location;
    if (isDeviceBox) context.product ??= box.tag?.product;
  }
  context.function ??= page.structure?.function;
  context.location ??= page.structure?.location;
  return clean(context);
}

/**
 * Effective tags of frozen (unchanging) pages, per library: pages are immutable once the document
 * produced them, so a page object that did not change keeps its tags.
 */
const tagCache = new WeakMap<SchematicPage, WeakMap<Library, Map<Item, Tag>>>();

/** The full tag of an item after inheritance. */
export function effectiveTag(page: SchematicPage, item: Item, library: Library): Tag {
  const frozen = Object.isFrozen(page);
  let cache: Map<Item, Tag> | undefined;
  if (frozen) {
    let byLibrary = tagCache.get(page);
    if (!byLibrary) tagCache.set(page, (byLibrary = new WeakMap()));
    cache = byLibrary.get(library);
    if (!cache) byLibrary.set(library, (cache = new Map()));
    const hit = cache.get(item);
    if (hit) return { ...hit };
  }
  const context = tagContext(page, item, library, item.id);
  const tag = clean({
    function: item.tag?.function ?? context.function,
    location: item.tag?.location ?? context.location,
    product: item.tag?.product ?? context.product,
  });
  cache?.set(item, tag);
  return { ...tag };
}

/**
 * The aspects of `tag` that differ from `context`. Used both to store a tag
 * (only what differs from the page/box is stored) and to display it.
 */
export function relativeTag(tag: Tag, context: Tag): Tag {
  const result: Tag = {};
  for (const [aspect] of ASPECTS) {
    if (tag[aspect] !== undefined && tag[aspect] !== context[aspect]) result[aspect] = tag[aspect];
  }
  return result;
}

export function tagsEqual(a: Tag, b: Tag): boolean {
  return formatTag(a) === formatTag(b);
}

function clean(tag: Tag): Tag {
  const result: Tag = {};
  for (const [aspect] of ASPECTS) {
    if (tag[aspect] !== undefined) result[aspect] = tag[aspect];
  }
  return result;
}
