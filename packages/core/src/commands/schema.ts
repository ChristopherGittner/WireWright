// Every change to a project is one of these commands (ADR-007). The editor,
// the MCP server and undo/redo all go through them.
import { z } from 'zod';
import {
  borderPinSchema,
  idSchema,
  itemSchema,
  localizedTextSchema,
  plcStationSchema,
  potentialSchema,
  mediumSchema,
  revisionSchema,
  layoutItemInputSchema,
  projectLibrarySchema,
  reportKindSchema,
  structureEntrySchema,
  rotationSchema,
  settingsSchema,
  tagValueSchema,
  tagSchema,
  textAlignSchema,
  textAngleSchema,
  textArrangementSchema,
  itemStyleSchema,
  ioChannelSchema,
} from '../schema.js';

const pageId = idSchema.describe('Page ID');
const itemIds = z.array(idSchema).min(1);

/** `undefined` keeps a value, `null` clears it. */
const tagUpdate = z.object({
  function: tagValueSchema.nullable().optional(),
  location: tagValueSchema.nullable().optional(),
  product: tagValueSchema.nullable().optional(),
});

const structureUpdate = z.object({
  function: tagValueSchema.nullable().optional(),
  location: tagValueSchema.nullable().optional(),
});

const stringMapUpdate = z.record(z.string(), z.string().nullable());

const pageName = z.string().min(1).regex(/^[^\r\n/]+$/, 'Page names may not contain "/" or line breaks');

export const commandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('setProjectProperties'),
    name: z.string().optional(),
    description: localizedTextSchema.nullable().optional(),
    properties: stringMapUpdate.optional(),
  }),
  z.object({
    type: z.literal('setProjectSettings'),
    settings: settingsSchema.partial(),
  }),
  z.object({
    type: z.literal('setPotentials'),
    potentials: z.array(potentialSchema),
  }),
  z.object({
    /** A new cabinet layout page (mounting plate drawn to scale). */
    type: z.literal('createLayoutPage'),
    id: idSchema.optional(),
    name: pageName,
    description: localizedTextSchema.optional(),
    structure: z.object({ function: tagValueSchema.optional(), location: tagValueSchema.optional() }).optional(),
    plate: z.object({ width: z.number().positive(), height: z.number().positive() }),
    scale: z.number().positive(),
    surface: z.enum(['plate', 'door']).optional(),
    index: z.int().min(0).optional(),
  }),
  z.object({
    /** Plate size and scale of a layout page. */
    type: z.literal('setLayoutPage'),
    pageId,
    plate: z.object({ width: z.number().positive(), height: z.number().positive() }).optional(),
    scale: z.number().positive().optional(),
    surface: z.enum(['plate', 'door']).optional(),
  }),
  z.object({
    /** Adds a rail, duct, cutout or device to a mounting plate (ID optional), or replaces the item with that ID. */
    type: z.literal('setLayoutItem'),
    pageId,
    item: layoutItemInputSchema,
  }),
  z.object({ type: z.literal('moveLayoutItems'), pageId, itemIds: z.array(idSchema).min(1), dx: z.number(), dy: z.number() }),
  z.object({ type: z.literal('deleteLayoutItems'), pageId, itemIds: z.array(idSchema).min(1) }),
  z.object({
    /**
     * Releases a revision: adds it to the project and writes its name and date into the
     * properties (title block) of the given pages. The snapshot file is written by the caller.
     */
    type: z.literal('addRevision'),
    revision: revisionSchema,
    pageIds: z.array(idSchema),
  }),
  z.object({
    /** Fluid media of pipes (pneumatics, hydraulics). */
    type: z.literal('setMedia'),
    media: z.array(mediumSchema),
  }),
  z.object({
    type: z.literal('setPlcs'),
    plcs: z.array(plcStationSchema),
  }),
  z.object({
    type: z.literal('assignPlcAddresses'),
    /** Only cards of this PLC; default: all PLCs. */
    station: z.string().optional(),
    /** Only these cards (device tags, e.g. `=FB+CAB1-A10`); default: all cards. */
    devices: z.array(z.string()).optional(),
    /** Keep existing start addresses and only fill in missing ones (default false). */
    onlyMissing: z.boolean().optional(),
    /**
     * Distance between the start addresses of consecutive cards, in the PLC's address units
     * (bytes; Mitsubishi: points), e.g. 10 for I0.0, I10.0, I20.0 …; a larger card continues
     * right after itself. Default: packed.
     */
    step: z.int().min(1).optional(),
  }),
  z.object({
    type: z.literal('setTexts'),
    /** One language of multilingual texts, addressed by the keys of the translation table (`item:<page>:<item>:functionText` …). Empty value removes the language. */
    texts: z.array(z.object({ key: z.string().min(1), language: z.string().min(1), value: z.string() })).min(1),
  }),
  z.object({
    type: z.literal('renumberTerminals'),
    /** Full tag of the strip, e.g. `=FB+CAB1-X1`. */
    strip: z.string().min(1),
    /** First number (default 1). */
    start: z.int().min(0).optional(),
    /** Increment (default 1), e.g. 10 for 10, 20, 30 … */
    step: z.int().min(1).optional(),
  }),
  z.object({
    type: z.literal('numberWires'),
    /** Only wire markers on these pages; default: all pages. */
    pageIds: z.array(idSchema).optional(),
    /** Keep existing wire numbers and only fill in missing ones (default false). */
    onlyMissing: z.boolean().optional(),
  }),
  z.object({
    /** Removes definitions from the project's library.json (the standard and shared library are not changed). */
    type: z.literal('removeFromProjectLibrary'),
    kind: z.enum(['symbols', 'templates', 'devices', 'macros', 'parts', 'frames']),
    ids: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    type: z.literal('addToProjectLibrary'),
    /** Definitions copied into the project's library.json (replacing ones with the same ID). */
    content: projectLibrarySchema,
  }),
  z.object({
    type: z.literal('createPage'),
    id: idSchema.optional(),
    name: pageName,
    description: localizedTextSchema.optional(),
    structure: z.object({ function: tagValueSchema.optional(), location: tagValueSchema.optional() }).optional(),
    frame: z.string().optional(),
    /** Position in the page order; default: at the end. */
    index: z.int().min(0).optional(),
  }),
  z.object({
    type: z.literal('createReportPage'),
    id: idSchema.optional(),
    name: pageName,
    kind: reportKindSchema,
    form: z.string().optional(),
    description: localizedTextSchema.optional(),
    structure: z.object({ function: tagValueSchema.optional(), location: tagValueSchema.optional() }).optional(),
    index: z.int().min(0).optional(),
  }),
  z.object({ type: z.literal('deletePage'), pageId }),
  z.object({ type: z.literal('movePage'), pageId, index: z.int().min(0) }),
  z.object({
    /**
     * Adds a PLC card (I/O card, CPU or coupler) to the project without drawing it (PLC tab): from a
     * device definition of the library, or with its own channels. `tag` is the card's full tag
     * (e.g. { location: "CAB1", product: "A10" }); default: the next free -A<n> in `structure`, else
     * in the structure of the PLC's other cards. `slot` defaults to the PLC's next slot.
     */
    type: z.literal('addPlcCard'),
    id: idSchema.optional(),
    device: z.string().optional(),
    tag: tagSchema.optional(),
    station: z.string().optional(),
    slot: z.int().min(0).optional(),
    structure: z.object({ function: tagValueSchema.optional(), location: tagValueSchema.optional() }).optional(),
    channels: z.array(ioChannelSchema).optional(),
  }),
  z.object({
    /** Draws a card at a point: a card not drawn yet moves onto the page; a drawn one gets a further overview. */
    type: z.literal('placePlcCard'),
    itemId: idSchema,
    pageId,
    x: z.int(),
    y: z.int(),
  }),
  z.object({
    /** Removes PLC cards from the project: their data, wherever they are, and all their overviews. */
    type: z.literal('removePlcCards'),
    itemIds: z.array(idSchema).min(1),
  }),
  z.object({
    /**
     * Moves pages into another function/location (drag and drop in the page tree): sets their
     * structure (`null` clears an aspect, absent keeps it) and puts them before `before`, else
     * after the last page of their new group.
     */
    type: z.literal('movePages'),
    pageIds: z.array(idSchema).min(1),
    structure: structureUpdate.optional(),
    before: idSchema.optional(),
  }),
  z.object({
    type: z.literal('setPageProperties'),
    pageId,
    name: pageName.optional(),
    description: localizedTextSchema.nullable().optional(),
    structure: structureUpdate.optional(),
    properties: stringMapUpdate.optional(),
    frame: z.string().nullable().optional(),
  }),
  z.object({
    type: z.literal('placeSymbol'),
    pageId,
    id: idSchema.optional(),
    symbol: z.string().min(1),
    x: z.int(),
    y: z.int(),
    rotation: rotationSchema.optional(),
    mirror: z.boolean().optional(),
    width: z.int().min(1).optional(),
    height: z.int().min(1).optional(),
    tag: z.object({ function: tagValueSchema.optional(), location: tagValueSchema.optional(), product: tagValueSchema.optional() }).optional(),
    main: z.boolean().optional(),
    /** Device template whose contacts are copied onto the main function. */
    template: z.string().optional(),
    props: z.record(z.string(), z.unknown()).optional(),
    pins: z.record(z.string(), z.string()).optional(),
    borderPins: z.array(borderPinSchema).optional(),
    /** Name main functions automatically (default true). */
    autoName: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('placeItems'),
    pageId,
    /** Where the top-left item of the group lands. */
    x: z.int(),
    y: z.int(),
    /** Items to place (copied items, macro content) … */
    items: z.array(itemSchema).min(1).optional(),
    /** … or the ID of a macro in the library. */
    macro: z.string().optional(),
    /** New names for devices whose main function is placed (default true); their contacts follow. */
    renameDevices: z.boolean().optional(),
  }),
  z.object({ type: z.literal('moveItems'), pageId, itemIds, dx: z.int(), dy: z.int() }),
  z.object({ type: z.literal('rotateItems'), pageId, itemIds, rotation: rotationSchema }),
  z.object({ type: z.literal('mirrorItems'), pageId, itemIds }),
  z.object({ type: z.literal('deleteItems'), pageId, itemIds }),
  z.object({
    type: z.literal('setItemProperties'),
    pageId,
    itemId: idSchema,
    /** Merged into the item's props; `null` removes a key. */
    props: z.record(z.string(), z.unknown()).optional(),
    main: z.boolean().nullable().optional(),
    pins: stringMapUpdate.optional(),
    pinPotentials: stringMapUpdate.optional(),
    width: z.int().min(1).optional(),
    height: z.int().min(1).optional(),
    borderPins: z.array(borderPinSchema).optional(),
    /** Device boxes only: pin link groups; `null` removes them. */
    links: z.array(z.array(z.string())).nullable().optional(),
  }),
  z.object({
    type: z.literal('setItemTag'),
    pageId,
    itemId: idSchema,
    /** New stored tag aspects; `null` makes an aspect inherit again. */
    tag: tagUpdate,
  }),
  z.object({
    type: z.literal('moveItemText'),
    pageId,
    itemId: idSchema,
    field: z.string().min(1),
    /** Offset from the default position (angle and alignment stay); `null` resets the text completely. */
    offset: z.object({ dx: z.number(), dy: z.number() }).nullable(),
  }),
  z.object({
    /**
     * Overview pages of a PLC: a view of each of its cards (in slot order), packed in columns on
     * new pages marked as its overview. Again later, it adds only cards that are not shown there yet.
     */
    type: z.literal('generatePlcOverview'),
    station: z.string().min(1),
    /** Structure of the new pages; default: that of the first card's page. */
    structure: z.object({ function: tagValueSchema.optional(), location: tagValueSchema.optional() }).optional(),
  }),
  z.object({
    /** Accepts issues (by `issueKey`): they stay listed, greyed out, and no longer count. */
    type: z.literal('acknowledgeIssues'),
    keys: z.array(z.string().min(1)).min(1),
    note: z.string().optional(),
    date: z.string().optional(),
  }),
  z.object({ type: z.literal('unacknowledgeIssues'), keys: z.array(z.string().min(1)).min(1) }),
  z.object({
    /** Style brush: gives the items the text layout of another item (replaces theirs). */
    type: z.literal('applyItemStyle'),
    pageId,
    itemIds: z.array(idSchema).min(1),
    style: itemStyleSchema,
  }),
  z.object({
    type: z.literal('setTextArrangement'),
    pageId,
    itemId: idSchema,
    /** `null`: back to the symbol definition's layout. Resets the own position, angle and alignment of the arranged texts. */
    arrangement: textArrangementSchema.nullable(),
  }),
  z.object({
    type: z.literal('setItemTextStyle'),
    pageId,
    itemId: idSchema,
    field: z.string().min(1),
    /** Angle against the sheet (90: reads from bottom to top); `null` back to the default (upright, or the text arrangement's). */
    angle: textAngleSchema.nullable().optional(),
    /** Alignment along the reading direction; `null` back to the symbol's default. */
    align: textAlignSchema.nullable().optional(),
  }),
  z.object({
    type: z.literal('renameDevice'),
    /** Current full tag, e.g. `=A1+CAB1-5K3`. */
    device: z.string().min(1),
    /** New full tag. */
    to: z.string().min(1),
  }),
  z.object({
    type: z.literal('setStructures'),
    /** Functions (=) and locations (+) with descriptions; their order sorts the pages. */
    structures: z.object({ function: z.array(structureEntrySchema), location: z.array(structureEntrySchema) }),
  }),
  z.object({
    type: z.literal('renumberPages'),
    /** Pages to rename; they are numbered in project page order. */
    pageIds: z.array(idSchema).min(1),
    /** Text before the number, e.g. `1.` for 1.1, 1.2 … */
    prefix: z.string().regex(/^[^\r\n/]*$/, 'The prefix may not contain "/" or line breaks').optional(),
    start: z.int().min(0).optional(),
    step: z.int().min(1).optional(),
  }),
  z.object({
    type: z.literal('renumberDevices'),
    /** Pages whose devices are renumbered; default: all pages. */
    pageIds: z.array(idSchema).optional(),
    /** Devices (full tags) that keep their names. */
    exclude: z.array(z.string()).optional(),
  }),
  z.object({ type: z.literal('applyDeviceTemplate'), pageId, itemId: idSchema, template: z.string().min(1) }),
  z.object({
    type: z.literal('replaceTexts'),
    find: z.string().min(1),
    replace: z.string(),
    fields: z.array(z.enum(['product', 'functionText', 'technicalData', 'pageDescription'])).min(1),
    pageIds: z.array(idSchema).optional(),
    /** Only this language of translated texts; default: all languages. */
    language: z.string().optional(),
    matchCase: z.boolean().optional(),
  }),
]);

export type Command = z.infer<typeof commandSchema>;
export type CommandType = Command['type'];
export type CommandOf<T extends CommandType> = Extract<Command, { type: T }>;
