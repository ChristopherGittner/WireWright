// Reading and writing a single text of an item, for F2 inline editing.
import {
  effectiveTag,
  formatTag,
  localize,
  parseTag,
  relativeTag,
  tagContext,
  withTranslation,
  type Command,
  type Item,
  type Library,
  type ProjectState,
  type SchematicPage,
} from '@wirewright/core';

/** The field F2 edits when a whole item is selected. */
export function defaultField(item: Item, library: Library): string | undefined {
  const def = library.symbol(item.symbol);
  if (!def) return undefined;
  if (def.function === 'connection.interruption' || def.function === 'connection.potential' || def.function === 'connection.potentialDefinition') return 'name';
  if (def.function === 'connection.break') return 'text';
  return 'tag';
}

export function fieldValue(state: ProjectState, page: SchematicPage, item: Item, field: string, library: Library, language: string): string {
  if (field === 'tag') {
    const def = library.symbol(item.symbol);
    if (def?.function === 'box.structure') return formatTag({ ...(item.tag?.function ? { function: item.tag.function } : {}), ...(item.tag?.location ? { location: item.tag.location } : {}) });
    return formatTag(relativeTag(effectiveTag(page, item, library), tagContext(page, item, library, item.id)));
  }
  if (field === 'functionText' || field === 'technicalData') {
    return localize(item.props?.[field], language, state.project.settings.languages);
  }
  if (field.startsWith('pin:')) {
    const pin = field.slice(4);
    const border = item.borderPins?.find((p) => p.id === pin);
    if (border) return border.designation;
    return item.pins?.[pin] ?? library.symbol(item.symbol)?.connections.find((c) => c.id === pin)?.designation ?? '';
  }
  const value = item.props?.[field];
  return typeof value === 'string' ? value : '';
}

/** Commands that set one text field. Throws with a readable message for invalid tags. */
export function fieldCommands(state: ProjectState, page: SchematicPage, item: Item, field: string, value: string, library: Library, language: string): Command[] {
  const pageId = page.id;
  const itemId = item.id;
  if (field === 'tag') {
    const tag = value.trim() === '' ? {} : parseTag(value);
    return [
      {
        type: 'setItemTag',
        pageId,
        itemId,
        tag: { function: tag.function ?? null, location: tag.location ?? null, product: tag.product ?? null },
      },
    ];
  }
  if (field === 'functionText' || field === 'technicalData') {
    const text = value === '' ? null : withTranslation(item.props?.[field], language, value, state.project.settings.languages);
    return [{ type: 'setItemProperties', pageId, itemId, props: { [field]: text } }];
  }
  if (field.startsWith('pin:')) {
    const pin = field.slice(4);
    if (item.borderPins?.some((p) => p.id === pin)) {
      return [{ type: 'setItemProperties', pageId, itemId, borderPins: item.borderPins.map((p) => (p.id === pin ? { ...p, designation: value } : p)) }];
    }
    return [{ type: 'setItemProperties', pageId, itemId, pins: { [pin]: value === '' ? null : value } }];
  }
  return [{ type: 'setItemProperties', pageId, itemId, props: { [field]: value === '' ? null : value } }];
}
