// Macros: reusable pieces of circuit. A macro stores items with positions
// relative to its top-left item; `placeItems` places it with new device names.
import { CommandError } from './commands/apply.js';
import type { LocalizedText, MacroDefinition, SchematicPage } from './schema.js';

export interface MacroMeta {
  id: string;
  name: LocalizedText;
  description?: LocalizedText;
  category?: string;
}

/** A macro from items of a page. Positions start at (0, 0); wire numbers and PLC start addresses are left out. */
export function macroFromItems(page: SchematicPage, itemIds: readonly string[], meta: MacroMeta): MacroDefinition {
  const ids = new Set(itemIds);
  const items = page.items.filter((i) => ids.has(i.id));
  if (items.length === 0) throw new CommandError('A macro needs at least one item', { template: 'A macro needs at least one item' });
  const minX = Math.min(...items.map((i) => i.x));
  const minY = Math.min(...items.map((i) => i.y));
  return {
    ...meta,
    items: items.map((item) => {
      const copy = structuredClone(item);
      copy.x -= minX;
      copy.y -= minY;
      if (copy.props?.wire?.number !== undefined) delete copy.props.wire.number;
      if (copy.props?.plc?.start !== undefined) delete copy.props.plc.start;
      return copy;
    }),
  };
}

