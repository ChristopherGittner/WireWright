// Schemas for everything Wirewright stores: project files, pages, items and library
// definitions. The TypeScript types are inferred from these, so validation and
// types never drift apart. See docs/data-model.md.
import { z } from 'zod';

/** Stable IDs: one lowercase letter, underscore, lowercase letters/digits (`p_8kq2m4x7tz`). Used as file names. */
export const idSchema = z.string().regex(/^[a-z]_[a-z0-9]{1,40}$/, 'IDs look like "p_8kq2m4x7tz"');

/** One aspect of an IEC 81346 tag, stored without its prefix (`A1`, `CAB1`, `5K3.1`). */
export const tagValueSchema = z
  .string()
  .regex(/^[\p{L}\p{N}_.]+$/u, 'Tag values may only contain letters, digits, "." and "_"');

export const tagSchema = z.object({
  function: tagValueSchema.optional(),
  location: tagValueSchema.optional(),
  product: tagValueSchema.optional(),
});

export const structureSchema = z.object({
  function: tagValueSchema.optional(),
  location: tagValueSchema.optional(),
});

/** A plain string means "the same in every language". */
export const localizedTextSchema = z.union([z.string(), z.record(z.string(), z.string())]);

/** A function (=) or location (+) code with its description, e.g. `CAB1` "Cabinet 1". */
export const structureEntrySchema = z.object({
  code: tagValueSchema,
  description: localizedTextSchema.optional(),
});

export type StructureEntry = z.infer<typeof structureEntrySchema>;


export const rotationSchema = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);

export const gridSchema = z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8)]);

export const partSchema = z.object({
  manufacturer: z.string(),
  partNumber: z.string(),
  quantity: z.number().positive(),
});

export const contactTemplateEntrySchema = z.object({
  function: z.string(),
  pins: z.array(z.string()),
});

export const ioKindSchema = z.enum(['DI', 'DO', 'AI', 'AO']);

/** One channel of a PLC I/O card. The channel number and the terminal pin differ (WAGO 750-430: input 2 is pin 5). */
export const ioChannelSchema = z.object({
  /** Channel number as printed on the card (WAGO counts from 1, Siemens from 0). */
  channel: z.int().min(0),
  kind: ioKindSchema,
  /** Terminal point on the card. */
  pin: z.string().min(1),
  /**
   * Further terminals that belong to this channel, e.g. the clock output of a safety input (drawn
   * before `pin`) or the sensor supply +24 V / 0 V of a 3-conductor input (`after`: drawn after it).
   * `label` is the terminal's name on the module (T1, 24 V, 0V …).
   */
  extraPins: z.array(z.object({ pin: z.string().min(1), label: z.string().optional(), after: z.boolean().optional() })).optional(),
  /** Name of the channel's own terminal on the module, when it differs from the channel label (e.g. "I1", "O1+"). */
  pinLabel: z.string().optional(),
  /** Label on drawings, default `DI 1`. */
  label: z.string().optional(),
  /** PLC tag name for exports. */
  name: z.string().optional(),
  dataType: z.string().optional(),
  /** Function of this channel; default: the function of the symbol wired to it. */
  function: localizedTextSchema.optional(),
  /** Explicit address, overrides the derived one. */
  address: z.string().optional(),
});

export const ioStartSchema = z.object({
  DI: z.int().min(0).optional(),
  DO: z.int().min(0).optional(),
  AI: z.int().min(0).optional(),
  AO: z.int().min(0).optional(),
});

/** PLC data of an I/O card (on the card's main function). */
export const plcCardSchema = z.object({
  /** Name of the PLC station the card belongs to. */
  station: z.string().optional(),
  /** Position in the station, used to order cards when numbering addresses. */
  slot: z.int().optional(),
  /** Start address per kind: byte address (Siemens, Codesys) or point number (Mitsubishi). */
  start: ioStartSchema.optional(),
  channels: z.array(ioChannelSchema),
});

export const cableCoreSchema = z.object({
  /** Unique within the cable: the core number, or `PE`. */
  id: z.string().min(1),
  /** Printed number, for numbered cores. */
  number: z.string().optional(),
  /** IEC 60757 color code (BK, BN, BU, GY, GNYE …). */
  color: z.string().optional(),
  /** mm², when different from the cable's. */
  crossSection: z.number().positive().optional(),
});

/** A cable (on the main function of the cable device: its first definition line). */
export const cableSchema = z.object({
  /** Type designation, e.g. "ÖLFLEX CLASSIC 110 5G1.5". */
  type: z.string().optional(),
  /** Cross-section of all cores in mm². */
  crossSection: z.number().positive().optional(),
  outerDiameterMm: z.number().positive().optional(),
  coreIdentification: z.enum(['numbers', 'colors', 'both']).optional(),
  cores: z.array(cableCoreSchema),
  shield: z.boolean().optional(),
  lengthM: z.number().positive().optional(),
});

/** Properties of one wire (conductor), stored on a wire marker (connection definition point). */
export const wireSchema = z.object({
  number: z.string().optional(),
  color: z.string().optional(),
  crossSection: z.number().positive().optional(),
  /** Core of the cable this wire runs in. */
  core: z.string().optional(),
});

// Loose: data of later features is preserved even before it is modelled here.
export const itemPropsSchema = z.looseObject({
  functionText: localizedTextSchema.optional(),
  technicalData: localizedTextSchema.optional(),
  parts: z.array(partSchema).optional(),
  contacts: z.array(contactTemplateEntrySchema).optional(),
  /** I/O card (main function of the card). */
  plc: plcCardSchema.optional(),
  /** PLC I/O point (slave): the card channel it shows. */
  channel: z.int().min(0).optional(),
  /** Device definition the item was placed from. */
  device: z.string().optional(),
  /** Cable data (main function of a cable). */
  cable: cableSchema.optional(),
  /** Wire marker: number, color, cross-section, cable core of the conductor. */
  wire: wireSchema.optional(),
  /** Terminal: designation within its strip. */
  terminal: z.string().optional(),
  /** Terminal: terminals of a strip with the same bridge label are bridged. */
  bridge: z.string().optional(),
  /** Show the device name even when the symbol to the left already shows it (default: hidden there). */
  showTag: z.boolean().optional(),
  /**
   * A further overview of a PLC card (not its master): `of` is the item ID of the card master,
   * `channels` a copy of its channels (kept in sync), so the view has the same pins.
   */
  plcView: z.object({ of: idSchema, channels: z.array(ioChannelSchema) }).optional(),
  /** Free text: the text (multilingual, lines separated by \n); break point: its label. */
  text: localizedTextSchema.optional(),
  /** Free text: alignment to the item's point, color (#rrggbb, default black) and size in mm (default 3). */
  textStyle: z
    .object({
      align: z.enum(['left', 'center', 'right']).optional(),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      size: z.number().positive().max(50).optional(),
    })
    .optional(),
});

export const borderPinSchema = z.object({
  id: z.string().min(1),
  side: z.enum(['left', 'right', 'top', 'bottom']),
  offset: z.int(),
  designation: z.string(),
});

/** Text angles against the sheet: 90 reads from bottom to top, 270 from top to bottom. */
export const textAngleSchema = z.union([z.literal(0), z.literal(90), z.literal(270)]);
export const textAlignSchema = z.enum(['left', 'center', 'right']);

/**
 * Placement of one text field of an item, overriding the symbol definition: offset from the
 * default position, angle against the sheet and alignment along the reading direction.
 */
/**
 * Arrangement of an item's label texts as one block next to its graphics: the side, and the
 * angle of the texts against the sheet (e.g. above, 90°: standing above the symbol, reading
 * from bottom to top). Centered on the symbol along that side.
 */
export const textArrangementSchema = z.object({
  side: z.enum(['left', 'right', 'above', 'below']),
  angle: textAngleSchema,
});
export type TextArrangement = z.infer<typeof textArrangementSchema>;

/** Texts placed by an arrangement, in this order. */
export const ARRANGED_TEXT_FIELDS = ['tag', 'name', 'functionText', 'technicalData', 'text', 'xref'] as const;

export const textOffsetSchema = z.object({
  dx: z.number(),
  dy: z.number(),
  angle: textAngleSchema.optional(),
  align: textAlignSchema.optional(),
});

/** The text layout of an item: own text positions, angles, alignments and the label arrangement (style brush). */
export const itemStyleSchema = z.object({
  texts: z.record(z.string(), textOffsetSchema).optional(),
  textArrangement: textArrangementSchema.optional(),
});
export type ItemStyle = z.infer<typeof itemStyleSchema>;

export const itemSchema = z.object({
  id: idSchema,
  symbol: z.string().min(1),
  x: z.int(),
  y: z.int(),
  rotation: rotationSchema,
  mirror: z.boolean(),
  width: z.int().min(1).optional(),
  height: z.int().min(1).optional(),
  tag: tagSchema.optional(),
  main: z.boolean().optional(),
  pins: z.record(z.string(), z.string()).optional(),
  pinPotentials: z.record(z.string(), z.string()).optional(),
  borderPins: z.array(borderPinSchema).optional(),
  /** Device boxes: which border pins are linked inside the box (default: none). */
  links: z.array(z.array(z.string())).optional(),
  texts: z.record(z.string(), textOffsetSchema).optional(),
  /** Where the label texts (tag, name, function text, technical data, cross-references) go; absent: as in the symbol definition. */
  textArrangement: textArrangementSchema.optional(),
  props: itemPropsSchema.optional(),
});

const pageBase = {
  id: idSchema,
  name: z.string().min(1).regex(/^[^\r\n/]+$/, 'Page names may not contain "/" or line breaks'),
  description: localizedTextSchema.optional(),
  structure: structureSchema.optional(),
  properties: z.record(z.string(), z.string()).optional(),
  frame: z.string().optional(),
};

export const schematicPageSchema = z.object({
  ...pageBase,
  type: z.literal('schematic'),
  items: z.array(itemSchema),
});

export const reportKindSchema = z.enum([
  'pageIndex',
  'deviceIndex',
  'bom',
  'terminalList',
  'terminalDiagram',
  'wireList',
  'plcIoList',
  'plcOverview',
  'cableOverview',
  'cableDiagram',
  'titlePage',
  'structureOverview',
  'revisions',
  'mountingPlate',
]);

export const reportPageSchema = z.object({
  ...pageBase,
  type: z.literal('report'),
  report: z.object({ kind: reportKindSchema, form: z.string().optional() }),
});

/**
 * Items of a cabinet layout (mounting plate), in real millimetres from the plate's top-left
 * corner: DIN rails and wire ducts (`x`, `y` = top-left, along `length`, vertical when set) and
 * device footprints (the device of a main function, `x`, `y` = top-left of the footprint).
 */
const layoutRail = { kind: z.literal('rail'), x: z.number(), y: z.number(), length: z.number().positive(), vertical: z.boolean().optional(), profile: z.enum(['TS35', 'TS15']).optional() };
const layoutDuct = { kind: z.literal('duct'), x: z.number(), y: z.number(), length: z.number().positive(), width: z.number().positive(), vertical: z.boolean().optional() };
const layoutDevice = {
  kind: z.literal('device'),
  /** The device's main function (its ID stays when the device is renamed). */
  itemId: idSchema,
  x: z.number(),
  y: z.number(),
  /** Turned by 90° (footprint width and height swapped). */
  turned: z.boolean().optional(),
  /** Footprint when the part has no dimensions (mm). */
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  /** Outline: round (pushbuttons, lamps on a door; diameter = width) or rectangular. Default: round on a door without part dimensions. */
  shape: z.enum(['rect', 'round']).optional(),
};
/** A rectangular cutout (HMI, fan, window), mainly on doors. */
const layoutCutout = { kind: z.literal('cutout'), x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive(), label: z.string().optional() };
/** A layout item as given to commands: the ID may be left out (a new one is made). */
export const layoutItemInputSchema = z.discriminatedUnion('kind', [
  z.object({ id: idSchema.optional(), ...layoutRail }),
  z.object({ id: idSchema.optional(), ...layoutDuct }),
  z.object({ id: idSchema.optional(), ...layoutDevice }),
  z.object({ id: idSchema.optional(), ...layoutCutout }),
]);

export const layoutItemSchema = z.discriminatedUnion('kind', [
  z.object({ id: idSchema, ...layoutRail }),
  z.object({ id: idSchema, ...layoutDuct }),
  z.object({ id: idSchema, ...layoutDevice }),
  z.object({ id: idSchema, ...layoutCutout }),
]);

export type LayoutItem = z.infer<typeof layoutItemSchema>;

/** A 2D cabinet layout: the mounting plate drawn to scale with rails, ducts and devices. */
export const layoutPageSchema = z.object({
  ...pageBase,
  type: z.literal('layout'),
  /** What is laid out: the mounting plate (default) or the front of the enclosure door. */
  surface: z.enum(['plate', 'door']).optional(),
  /** Real size of the mounting plate or door (mm). */
  plate: z.object({ width: z.number().positive(), height: z.number().positive() }),
  /** Drawing scale 1:`scale`. */
  scale: z.number().positive(),
  items: z.array(layoutItemSchema),
});

export const pageSchema = z.discriminatedUnion('type', [schematicPageSchema, reportPageSchema, layoutPageSchema]);

export const potentialTypeSchema = z.enum(['L', 'N', 'PE', 'PEN', '+', '-', 'signal', 'other']);

export const lineStyleSchema = z.enum(['solid', 'dash', 'dashdot']);

export const potentialSchema = z.object({
  name: z.string().min(1),
  type: potentialTypeSchema,
  voltage: z.string().optional(),
  line: z.object({ color: z.string().optional(), style: lineStyleSchema.optional() }).optional(),
  wire: z.object({ color: z.string().optional(), crossSection: z.number().positive().optional() }).optional(),
});

/** A fluid medium carried by pipes: compressed air, exhaust, hydraulic oil … */
export const mediumSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['pressure', 'exhaust', 'pilot', 'vacuum', 'hydraulicPressure', 'hydraulicReturn', 'other']),
  /** e.g. "6 bar" */
  pressure: z.string().optional(),
  line: z.object({ color: z.string().optional(), style: lineStyleSchema.optional() }).optional(),
});

export type Medium = z.infer<typeof mediumSchema>;

export const settingsSchema = z.object({
  defaultGridMm: gridSchema,
  defaultFrame: z.string(),
  deviceNaming: z.object({
    scheme: z.enum(['pageColumn', 'counter']),
    format: z.string().min(1),
    duplicateSuffix: z.string().includes('{n}'),
  }),
  crossReferences: z.object({
    format: z.string().min(1),
    structure: z.enum(['always', 'whenDifferent']),
  }),
  contactImage: z.enum(['table', 'path', 'none']),
  languages: z.array(z.string().min(1)).min(1),
  displayLanguage: z.string().min(1),
  defaultWire: z.object({ color: z.string(), crossSection: z.number().positive() }),
  /** Automatic wire numbers; placeholders {page}, {column}, {row}, {counter}. */
  wireNumbering: z.object({ format: z.string().min(1) }),
});

export const plcFamilySchema = z.enum(['siemens', 'codesys', 'mitsubishi']);

export const plcStationSchema = z.object({
  name: z.string().min(1).regex(/^[\p{L}\p{N}_.-]+$/u, 'PLC names may only contain letters, digits, "_", "." and "-"'),
  family: plcFamilySchema,
  /** Mitsubishi X/Y numbering: FX/iQ-F octal, Q/iQ-R hexadecimal. */
  mitsubishiSeries: z.enum(['fx', 'iqr']).optional(),
  /** Siemens mnemonics: international (I/Q) or German (E/A). */
  mnemonic: z.enum(['international', 'german']).optional(),
  description: localizedTextSchema.optional(),
  /** First address per kind for automatic numbering. */
  firstAddress: ioStartSchema.optional(),
});

export const projectSchema = z.object({
  format: z.literal('wirewright-project'),
  formatVersion: z.literal(1),
  name: z.string(),
  description: localizedTextSchema.optional(),
  properties: z.record(z.string(), z.string()),
  settings: settingsSchema,
  potentials: z.array(potentialSchema),
  /** Fluid media of pipes (pneumatics, hydraulics), like the potentials of wires. */
  media: z.array(mediumSchema).optional(),
  plcs: z.array(plcStationSchema).default([]),
  /**
   * Functions (=) and locations (+) of the project with descriptions; their order is the
   * sort order of the pages (by function, then location).
   */
  structures: z.object({ function: z.array(structureEntrySchema), location: z.array(structureEntrySchema) }).optional(),
  /** Released revisions, oldest first; each has a snapshot in `revisions/<name>.json`. */
  revisions: z.array(z.lazy(() => revisionSchema)).optional(),
  /** PLC cards of the project that are not drawn yet (card items with their full tag; see plcStore.ts). */
  plcCards: z.array(itemSchema).optional(),
  /** Issues the designer checked and accepted: shown greyed out, not counted. */
  acknowledged: z.array(z.lazy(() => acknowledgementSchema)).optional(),
  pages: z.array(idSchema),
});

/** An accepted issue: its key (`issueKey`), a reason and when. */
export const acknowledgementSchema = z.object({
  key: z.string().min(1),
  note: z.string().optional(),
  /** ISO date (YYYY-MM-DD). */
  date: z.string().optional(),
});
export type Acknowledgement = z.infer<typeof acknowledgementSchema>;

/** A released state of the project (`Revision`, `Änderungsstand`). */
export const revisionSchema = z.object({
  name: z.string().min(1).regex(/^[\p{L}\p{N}._-]+$/u, 'Revision names may only contain letters, digits, ".", "_" and "-"'),
  /** ISO date (YYYY-MM-DD). */
  date: z.string(),
  author: z.string().optional(),
  description: z.string().optional(),
});

export type Revision = z.infer<typeof revisionSchema>;

// ---------------------------------------------------------------------------
// Library definitions: symbols, frames, device templates

export const directionSchema = z.enum(['up', 'down', 'left', 'right']);

const point = z.tuple([z.number(), z.number()]);

export const graphicSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('line'), x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() }),
  z.object({ type: z.literal('polyline'), points: z.array(point).min(2), closed: z.boolean().optional(), fill: z.boolean().optional() }),
  z.object({ type: z.literal('rect'), x: z.number(), y: z.number(), width: z.number(), height: z.number(), fill: z.boolean().optional() }),
  z.object({ type: z.literal('circle'), cx: z.number(), cy: z.number(), r: z.number().positive(), fill: z.boolean().optional() }),
  // Angles in degrees, clockwise from the positive x axis (screen coordinates).
  z.object({ type: z.literal('arc'), cx: z.number(), cy: z.number(), r: z.number().positive(), start: z.number(), end: z.number() }),
  z.object({ type: z.literal('text'), x: z.number(), y: z.number(), text: z.string(), size: z.number().positive().optional(), align: z.enum(['left', 'center', 'right']).optional() }),
]);

export const connectionPointSchema = z.object({
  id: z.string().min(1),
  x: z.int(),
  y: z.int(),
  direction: directionSchema,
  designation: z.string().optional(),
  /** `fluid`: a pipe port (pneumatics, hydraulics); it only connects to other pipe ports. Default: electrical. */
  medium: z.literal('fluid').optional(),
});

export const textFieldSchema = z.object({
  field: z.string().min(1),
  x: z.number(),
  y: z.number(),
  align: z.enum(['left', 'center', 'right']).optional(),
  size: z.number().positive().optional(),
});

export const symbolDefinitionSchema = z.object({
  id: z.string().min(1),
  name: localizedTextSchema,
  category: z.string(),
  function: z.string().min(1),
  /** `none`: not a device function (connection symbols, structure boxes). */
  defaultRole: z.enum(['main', 'auxiliary', 'none']),
  letterCode: z.string().optional(),
  /** Boxes: the item stores width and height; graphics are drawn from them. */
  resizable: z.boolean().optional(),
  /** Graphics and connections computed from item data (`plcCard`: one row per channel; `cable`: a line of the item's length). */
  generator: z.enum(['plcCard', 'cable']).optional(),
  graphics: z.array(graphicSchema),
  connections: z.array(connectionPointSchema),
  /** Pins linked inside the device. Omitted: all pins linked. `[]`: none. */
  links: z.array(z.array(z.string())).optional(),
  texts: z.array(textFieldSchema),
  /**
   * Mini symbol of this function in a contact image (Kontaktspiegel) under its
   * main function: graphics in a 5 × 3 mm box, origin at the left end of the
   * row's middle line (x 0 … 5, y -1.5 … 1.5). Functions with a mini symbol are
   * listed in the contact image.
   */
  contactImage: z.array(graphicSchema).optional(),
  /** Main functions (coils …) that show a contact image of their contacts, with or without a contact template. */
  hasContactImage: z.boolean().optional(),
});

export const frameFieldSchema = z.object({
  source: z.string().min(1),
  x: z.number(),
  y: z.number(),
  size: z.number().positive().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  /**
   * Height available for the text (mm). Several lines are centered on `y` either way; when they
   * need more than this height, the text gets smaller.
   */
  height: z.number().positive().optional(),
});

export const frameDefinitionSchema = z.object({
  id: z.string().min(1),
  name: localizedTextSchema,
  size: z.object({ width: z.number().positive(), height: z.number().positive() }),
  drawingArea: z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() }),
  columns: z.object({ count: z.int().min(1), x: z.number(), width: z.number().positive() }),
  rows: z.object({ labels: z.array(z.string()).min(1), y: z.number(), height: z.number().positive() }),
  graphics: z.array(graphicSchema),
  fields: z.array(frameFieldSchema),
});

export const deviceTemplateSchema = z.object({
  id: z.string().min(1),
  name: localizedTextSchema,
  /** Main function symbol this template is meant for. */
  symbol: z.string().optional(),
  contacts: z.array(contactTemplateEntrySchema),
});

/** One symbol of a device definition, e.g. the coil or the NO contact 13/14 of a relay. */
export const deviceFunctionSchema = z.object({
  symbol: z.string().min(1),
  /** Shown while placing, e.g. "NO 13/14", "DI 2 (pin 5)". */
  label: localizedTextSchema.optional(),
  main: z.boolean().optional(),
  /** Connection designations by pin ID. */
  pins: z.record(z.string(), z.string()).optional(),
  /** PLC I/O point: the card channel. */
  channel: z.int().min(0).optional(),
});

/**
 * A device as it is bought: its symbols (functions), part data, contacts and
 * I/O channels. Placing a device steps through its functions with Tab.
 */
export const deviceDefinitionSchema = z.object({
  id: z.string().min(1),
  name: localizedTextSchema,
  category: z.string().optional(),
  manufacturer: z.string().optional(),
  partNumber: z.string().optional(),
  description: localizedTextSchema.optional(),
  functions: z.array(deviceFunctionSchema).min(1),
  /** Contact image template; default: the contact functions. */
  contacts: z.array(contactTemplateEntrySchema).optional(),
  /** I/O channels of a PLC card. */
  plc: z.object({ channels: z.array(ioChannelSchema) }).optional(),
  /** Cable data of a cable type. */
  cable: cableSchema.optional(),
});

/** A supplier of a part, with its own order number and price. */
export const partSupplierSchema = z.object({
  name: z.string().min(1),
  orderNumber: z.string().optional(),
  price: z.number().nonnegative().optional(),
  currency: z.string().optional(),
  /** Delivery time in working days. */
  deliveryDays: z.int().min(0).optional(),
});

/**
 * A part in the parts database (`Artikel`): what a device's `parts` entries refer to by
 * manufacturer and part number, with commercial (ERP) data for the bill of materials.
 */
export const partDefinitionSchema = z.object({
  /** Usually `<manufacturer>:<part number>`. */
  id: z.string().min(1),
  manufacturer: z.string(),
  partNumber: z.string().min(1),
  description: localizedTextSchema.optional(),
  /** Order number at the manufacturer, when it differs from the part number. */
  orderNumber: z.string().optional(),
  ean: z.string().optional(),
  /** Article number in the company's ERP system. */
  erpNumber: z.string().optional(),
  /** Unit of quantities, e.g. `pcs` (default) or `m`. */
  unit: z.string().optional(),
  /** List price for `priceUnit` units (default 1) in `currency`. */
  price: z.number().nonnegative().optional(),
  currency: z.string().optional(),
  priceUnit: z.number().positive().optional(),
  suppliers: z.array(partSupplierSchema).optional(),
  url: z.string().optional(),
  /** Product classes, e.g. `{ system: "ECLASS-13.0", id: "27371601" }` or an ETIM class (from catalogs). */
  classification: z.array(z.object({ system: z.string(), id: z.string() })).optional(),
  /** Rated (coil) voltage, e.g. "24 V DC", "230 V AC", "24 V UC" (engineering checks). */
  ratedVoltage: z.string().optional(),
  /** Rated current in A of a protective device (engineering checks). */
  ratedCurrent: z.number().positive().optional(),
  /** Outer dimensions (mm) for the cabinet layout: width and height on the mounting plate, depth. */
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  depth: z.number().positive().optional(),
  /** Further fields, e.g. from the ERP system. */
  properties: z.record(z.string(), z.string()).optional(),
});

export const formColumnSchema = z.object({
  key: z.string().min(1),
  title: localizedTextSchema,
  width: z.number().positive(),
  align: z.enum(['left', 'center', 'right']).optional(),
});

/** Table layout of a report page (`Formular`). */
export const formDefinitionSchema = z.object({
  id: z.string().min(1),
  name: localizedTextSchema,
  kind: reportKindSchema,
  frame: z.string(),
  title: localizedTextSchema,
  table: z.object({
    x: z.number(),
    y: z.number(),
    headerHeight: z.number().positive(),
    rowHeight: z.number().positive(),
    /** Rows per sheet. */
    rows: z.int().min(1),
    textSize: z.number().positive().optional(),
  }),
  columns: z.array(formColumnSchema).min(1),
});

export type Tag = z.infer<typeof tagSchema>;
export type Structure = z.infer<typeof structureSchema>;
export type LocalizedText = z.infer<typeof localizedTextSchema>;
export type Rotation = z.infer<typeof rotationSchema>;
export type GridSize = z.infer<typeof gridSchema>;
export type Part = z.infer<typeof partSchema>;
export type ContactTemplateEntry = z.infer<typeof contactTemplateEntrySchema>;
export type ItemProps = z.infer<typeof itemPropsSchema>;
export type BorderPin = z.infer<typeof borderPinSchema>;
export type Item = z.infer<typeof itemSchema>;
export type SchematicPage = z.infer<typeof schematicPageSchema>;
export type ReportKind = z.infer<typeof reportKindSchema>;
export type ReportPage = z.infer<typeof reportPageSchema>;
export type LayoutPage = z.infer<typeof layoutPageSchema>;
export type Page = z.infer<typeof pageSchema>;
export type PotentialType = z.infer<typeof potentialTypeSchema>;
export type Potential = z.infer<typeof potentialSchema>;
export type ProjectSettings = z.infer<typeof settingsSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Direction = z.infer<typeof directionSchema>;
export type Graphic = z.infer<typeof graphicSchema>;
export type ConnectionPoint = z.infer<typeof connectionPointSchema>;
export type TextField = z.infer<typeof textFieldSchema>;
export type SymbolDefinition = z.infer<typeof symbolDefinitionSchema>;
export type FrameDefinition = z.infer<typeof frameDefinitionSchema>;
export type FrameField = z.infer<typeof frameFieldSchema>;
export type DeviceTemplate = z.infer<typeof deviceTemplateSchema>;
export type FormColumn = z.infer<typeof formColumnSchema>;
export type IoKind = z.infer<typeof ioKindSchema>;
export type IoChannel = z.infer<typeof ioChannelSchema>;
export type IoStart = z.infer<typeof ioStartSchema>;
export type PlcCard = z.infer<typeof plcCardSchema>;
export type PlcFamily = z.infer<typeof plcFamilySchema>;
export type PlcStation = z.infer<typeof plcStationSchema>;
export type DeviceFunctionDefinition = z.infer<typeof deviceFunctionSchema>;
export type DeviceDefinition = z.infer<typeof deviceDefinitionSchema>;
export type PartDefinition = z.infer<typeof partDefinitionSchema>;
export type PartSupplier = z.infer<typeof partSupplierSchema>;
export type CableCore = z.infer<typeof cableCoreSchema>;
export type Cable = z.infer<typeof cableSchema>;
export type Wire = z.infer<typeof wireSchema>;
export type FormDefinition = z.infer<typeof formDefinitionSchema>;

/** A loaded project: the project file plus all pages by ID. */
export interface ProjectState {
  project: Project;
  pages: Record<string, Page>;
  /** Project-local library (`library.json`): devices, symbols … copied into the project. */
  library?: ProjectLibrary;
}

/**
 * A macro: a reusable piece of circuit (items with positions relative to the
 * macro's top-left item). Placed with the `placeItems` command, its devices
 * get new names; contacts follow their coil.
 */
export const macroDefinitionSchema = z.object({
  id: z.string().min(1),
  name: localizedTextSchema,
  description: localizedTextSchema.optional(),
  category: z.string().optional(),
  items: z.array(itemSchema).min(1),
});

export type MacroDefinition = z.infer<typeof macroDefinitionSchema>;

export const projectLibrarySchema = z.object({
  symbols: z.array(symbolDefinitionSchema).optional(),
  templates: z.array(deviceTemplateSchema).optional(),
  devices: z.array(deviceDefinitionSchema).optional(),
  macros: z.array(macroDefinitionSchema).optional(),
  parts: z.array(partDefinitionSchema).optional(),
  frames: z.array(frameDefinitionSchema).optional(),
});

export type ProjectLibrary = z.infer<typeof projectLibrarySchema>;
