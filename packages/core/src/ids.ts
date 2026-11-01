const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A new random ID such as `p_8kq2m4x7tz` (prefix `p` for pages, `i` for items). */
export function newId(prefix: 'p' | 'i'): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let id = `${prefix}_`;
  for (const b of bytes) id += ALPHABET[b % ALPHABET.length];
  return id;
}
