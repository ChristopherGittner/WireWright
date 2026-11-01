// A small, dependency-free XML reader for catalog exchange files (BMEcat): elements with
// attributes, text, CDATA and entities; comments, processing instructions and DOCTYPE are skipped.
// Element and attribute names are kept without namespace prefix. Not validating.

export interface XmlElement {
  /** Local name (without namespace prefix). */
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  /** The element's own text (entities decoded, whitespace kept). */
  text: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code] ?? match;
  });
}

const localName = (name: string) => name.slice(name.indexOf(':') + 1);

/** Text of XML bytes: the encoding from the declaration (UTF-8 by default, e.g. ISO-8859-1). */
export function decodeXml(bytes: Uint8Array): string {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
  const encoding = /<\?xml[^>]*encoding=["']([\w-]+)["']/i.exec(head)?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

export function parseXml(text: string): XmlElement {
  const root: XmlElement = { name: '#document', attributes: {}, children: [], text: '' };
  const stack: XmlElement[] = [root];
  let i = 0;
  const length = text.length;
  while (i < length) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i) stack.at(-1)!.text += decodeEntities(text.slice(i, lt));
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      i = end < 0 ? length : end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      stack.at(-1)!.text += text.slice(lt + 9, end < 0 ? length : end);
      i = end < 0 ? length : end + 3;
      continue;
    }
    if (text[lt + 1] === '?' || text[lt + 1] === '!') {
      // Declarations, processing instructions, DOCTYPE (with an internal subset in brackets).
      let end = text.indexOf('>', lt);
      const bracket = text.indexOf('[', lt);
      if (text.startsWith('<!DOCTYPE', lt) && bracket >= 0 && bracket < end) end = text.indexOf(']>', bracket) + 1;
      i = end < 0 ? length : end + 1;
      continue;
    }
    const gt = findTagEnd(text, lt);
    if (gt < 0) throw new Error(`Unclosed tag at position ${lt}`);
    if (text[lt + 1] === '/') {
      const name = localName(text.slice(lt + 2, gt).trim());
      // Close up to the matching element (tolerates stray closing tags).
      for (let s = stack.length - 1; s > 0; s--) {
        if (stack[s]!.name === name) {
          stack.length = s;
          break;
        }
      }
      i = gt + 1;
      continue;
    }
    const selfClosing = text[gt - 1] === '/';
    const inner = text.slice(lt + 1, selfClosing ? gt - 1 : gt);
    const nameEnd = inner.search(/[\s/]|$/);
    const element: XmlElement = { name: localName(inner.slice(0, nameEnd)), attributes: {}, children: [], text: '' };
    for (const m of inner.slice(nameEnd).matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
      element.attributes[localName(m[1]!)] = decodeEntities(m[3] ?? m[4] ?? '');
    }
    stack.at(-1)!.children.push(element);
    if (!selfClosing) stack.push(element);
    i = gt + 1;
  }
  return root;
}

/** End of a tag: the `>` that is not inside a quoted attribute value. */
function findTagEnd(text: string, from: number): number {
  let quote: string | undefined;
  for (let i = from + 1; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = undefined;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return i;
  }
  return -1;
}

/** The first child with one of the names. */
export function child(element: XmlElement | undefined, ...names: string[]): XmlElement | undefined {
  return element?.children.find((c) => names.includes(c.name));
}

/** All children with one of the names. */
export function children(element: XmlElement | undefined, ...names: string[]): XmlElement[] {
  return element?.children.filter((c) => names.includes(c.name)) ?? [];
}

/** Trimmed text of the first child with one of the names. */
export function childText(element: XmlElement | undefined, ...names: string[]): string {
  return child(element, ...names)?.text.trim() ?? '';
}

/** All descendants with the name, depth first. */
export function descendants(element: XmlElement, name: string, found: XmlElement[] = []): XmlElement[] {
  for (const c of element.children) {
    if (c.name === name) found.push(c);
    else descendants(c, name, found);
  }
  return found;
}
