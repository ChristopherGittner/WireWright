// PLC cards that are not drawn yet: they belong to the project (PLC tab) and are kept in
// `project.plcCards` as ordinary card items with their full tag. The indices see them through a
// virtual page, so a card is a device with its channels whether or not it is drawn; placing it
// moves the item onto a page, deleting its drawing moves it back. See docs/data-model.md, "PLC".
import type { Item, ProjectState, SchematicPage } from './schema.js';

/** ID of the virtual page holding the cards that are not drawn. Not in `project.pages`. */
export const PLC_STORE_PAGE = 'p_plccards';

const EMPTY: readonly Item[] = Object.freeze([]);
const cache = new WeakMap<readonly Item[], SchematicPage>();

/** The virtual page with the cards not drawn yet (same object while the list is unchanged). */
export function plcStorePage(state: Pick<ProjectState, 'project'>): SchematicPage {
  const items = state.project.plcCards ?? EMPTY;
  let page = cache.get(items);
  if (!page) {
    page = { id: PLC_STORE_PAGE, type: 'schematic', name: 'PLC', items: items as Item[] };
    cache.set(items, page);
  }
  return page;
}

/** A page by ID, including the virtual card store. */
export function pageOrStore(state: ProjectState, pageId: string) {
  return pageId === PLC_STORE_PAGE ? plcStorePage(state) : state.pages[pageId];
}

/** All schematic pages (in project order) and the card store: everything that holds devices. */
export function devicePages(state: ProjectState): SchematicPage[] {
  const pages: SchematicPage[] = [];
  for (const id of state.project.pages) {
    const page = state.pages[id];
    if (page?.type === 'schematic') pages.push(page);
  }
  if (state.project.plcCards?.length) pages.push(plcStorePage(state));
  return pages;
}
