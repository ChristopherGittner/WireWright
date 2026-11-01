# Data model

This document describes how a project is stored and what is computed from it.
It is the basis for `packages/core`. Decisions referenced: ADR-003 (autoconnect),
ADR-004 (folder of JSON files), ADR-007 (command API / MCP), ADR-008 (derived
devices, inherited tags, JSON symbols).

## Principles

1. **Store only what the user decided.** Placement, tags and properties are
   stored. Devices, connections, cross-references, contact images, addresses
   and report pages are derived and never saved.
2. **Devices are derived from symbols.** All symbol instances with the same
   effective tag form one device. There is no separate device list.
3. **Tags are inherited.** A symbol stores only the tag parts that differ from
   its page. Moving a page to another location moves its devices with it.
4. **Everything graphical is data.** Symbols, page frames, report forms and
   device templates are JSON definitions. Code never draws a specific symbol.
5. **Every change is a command** (ADR-007).

## Terms

| Term | Meaning |
|---|---|
| **Symbol definition** | A library entry: graphics, connection points, text fields. Example: `iec60617.relay.coil`. |
| **Item** | Anything placed on a page: a symbol instance, connection symbol, cable definition line, free text. |
| **Function** | What an item represents for its device: coil, NO contact, PLC input, … |
| **Main function** (master) | The one function per device that carries the device data (parts, technical data, contact template, PLC card data) and shows cross-references to all other functions. For a relay this is the coil. In the editor: the **Master** checkbox. |
| **Auxiliary function** (slave) | Any other function of the device (contacts, PLC I/O points). Carries its tag and connection designations and shows a cross-reference to the master only. |
| **Device** | Derived: all functions with the same effective tag. |
| **Effective tag** | The full tag after inheritance, e.g. `=A1+CAB1-K1`. |
| **Structure box** | Rectangle on a page that sets `=` / `+` for everything inside it (`Strukturkasten`). |
| **Device box** | Rectangle that is a device of its own, with pins on its border and components inside (`Black Box`). |
| **Frame** | Page border with column/row grid and title block (`Seitenrahmen` / `Schriftfeld`). |
| **Form** | Table layout for a report page (`Formular`). |
| **Device template** | List of functions a device type provides, e.g. a relay with 2 changeover contacts. Drives the contact image (`Kontaktspiegel`). |

## Coordinates and grid

- All page coordinates are **integer millimetres**. Item positions are
  integers, so autoconnect alignment checks are exact, with no rounding.
- The **snap grid is switchable: 1, 2, 4 or 8 mm.** It is an editor setting
  (with a project default), not a storage unit. Changing it never moves anything.
- Library symbols have their connection points on a **4 mm raster**. Symbols
  placed on the 4 or 8 mm grid always line up; 1 and 2 mm are for fine
  placement of texts and graphics. A symbol placed off the 4 mm raster simply
  does not autoconnect to on-raster symbols.
- Rotation is `0 | 90 | 180 | 270`; mirroring is a boolean (horizontal mirror,
  applied before rotation). Both keep integer coordinates integer.
- Page origin is the top-left corner; `x` grows to the right, `y` grows downwards.

## Project folder

```
MyMachine.wirewright/
├── project.json
├── pages/
│   ├── p_8kq2m4x7tz.json
│   └── …
├── library.json         # optional project library: device definitions, symbols … copied into the project
└── view.json            # optional: the page open last ({ "page": "p_…" }); not project data, can be ignored in git
```

The editor reopens the page in `view.json` (written shortly after the page
changes); if that page no longer exists it starts on the first schematic page.

### Project archive

`<name>.wirewright.zip` holds the project folder's files (`project.json`,
`pages/`, `library.json`) and `wirewright-archive.json` (format, version, name,
page count, time). Symbols, frames, devices and parts that the project uses
but that are neither in the standard library nor in its own library (e.g.
from the shared library folder) are added to the archived `library.json`, so
the archive opens complete on any computer. A zip with the project in one top
folder is read as well.

### Revisions

`project.revisions` lists the released revisions, oldest first:
`{ "name": "A", "date": "2026-11-01", "author": "CG", "description": "…" }`.
Each has a snapshot of the whole project in `revisions/<name>.json`
(`{ "format": "wirewright-revision", "revision", "project", "pages", "library" }`).
Releasing a revision writes its name and date into `properties.revision` and
`properties.date` (title block) of the pages added or changed since the
previous revision (all pages for the first), then the snapshot. Comparing
with a revision lists new, changed and deleted pages and, per page, added,
changed and removed items; changes of the revision marks themselves and key
order do not count. The report kind `revisions` lists the revisions with the
pages that carry each one.

### Machine settings

Not part of a project: the defaults of one installation, stored by the host
(desktop: `settings.json` in the user data folder under `machine`; browser:
local storage). A new project copies `newProject.settings` and
`newProject.potentials`; missing or invalid parts fall back to the built-in
defaults.

```json
{
  "uiLanguage": "de",
  "newProject": {
    "settings": { "languages": ["de", "en"], "displayLanguage": "de", "…": "all project settings" },
    "potentials": [{ "name": "L1", "type": "L", "voltage": "400 V AC 50 Hz" }]
  }
}
```

### `project.json`

```json
{
  "format": "wirewright-project",
  "formatVersion": 1,
  "name": "Packaging machine PM-200",
  "description": { "de": "", "en": "" },
  "properties": {
    "customer": "ACME GmbH",
    "drawingNumber": "PM-200-E",
    "createdBy": "C. Gittner"
  },
  "settings": {
    "defaultGridMm": 4,
    "defaultFrame": "iec.frame.a3",
    "deviceNaming": { "scheme": "pageColumn", "format": "{page}{letter}{column}", "duplicateSuffix": ".{n}" },
    "crossReferences": { "format": "/{page}.{column}", "structure": "whenDifferent" },
    "contactImage": "table",
    "languages": ["de", "en"],
    "displayLanguage": "de",
    "defaultWire": { "color": "BK", "crossSection": 1.5 }
  },
  "potentials": [ … ],
  "pages": ["p_1toc0000aa", "p_8kq2m4x7tz", "p_3nf9w2c1ad"]
}
```

**Structure** (`structures`, optional): the project's functions (=) and
locations (+) with descriptions, in sort order:

```json
"structures": {
  "function": [{ "code": "FB", "description": { "de": "Förderband", "en": "Conveyor" } }, { "code": "DOC" }],
  "location": [{ "code": "CAB1", "description": "Schaltschrank 1" }, { "code": "FIELD" }]
}
```

With structures defined, pages are kept sorted by function, then location,
then their own order (codes not listed come last) — in the page list, PDF and
print. The `setStructures` command sets them.

`pages` defines the page order. File names use stable IDs, so reordering or
renumbering pages only changes this list. `properties` is a free key–value
list; frames show any of it in the title block.

### `pages/<id>.json` — schematic page

```json
{
  "id": "p_8kq2m4x7tz",
  "type": "schematic",
  "name": "5",
  "description": { "de": "Steuerstromkreis Förderband", "en": "Control circuit conveyor" },
  "structure": { "function": "A1", "location": "CAB1" },
  "properties": { "revision": "A", "checkedBy": "" },
  "items": [
    {
      "id": "i_q71bz0k2rm",
      "symbol": "iec60617.relay.coil",
      "x": 80, "y": 120, "rotation": 0, "mirror": false,
      "tag": { "product": "5K3" },
      "main": true,
      "props": {
        "functionText": { "de": "Förderband ein", "en": "Conveyor on" },
        "technicalData": "24 V DC",
        "parts": [{ "manufacturer": "Finder", "partNumber": "40.52.9.024.0000", "quantity": 1 }],
        "contacts": [
          { "function": "contact.co", "pins": ["11", "12", "14"] },
          { "function": "contact.co", "pins": ["21", "22", "24"] }
        ]
      }
    },
    {
      "id": "i_c0w8s5n1ue",
      "symbol": "iec60617.contact.no",
      "x": 160, "y": 120, "rotation": 0, "mirror": false,
      "tag": { "product": "5K3" },
      "pins": { "1": "11", "2": "14" },
      "texts": { "xref": { "dx": 2, "dy": 0 }, "tag": { "dx": -4, "dy": 0, "angle": 90, "align": "right" } }
    }
  ]
}
```

- The page's full name is its structure plus name: `=A1+CAB1/5`.
- `frame` (optional) overrides the project's default frame for this page.
- `main` is optional; when absent, the symbol definition's default role applies.
- `pins` overrides the default connection designations of the definition.
- `texts` (optional) moves individual text fields (tag, cross-reference,
  pins, …) away from their default position in the symbol definition, and
  can turn them: `angle` 90 reads from bottom to top, 270 from top to
  bottom, always against the sheet (a turned symbol does not turn it
  further). `align` (left, center, right) runs along the reading direction.
  A text with its own angle or alignment is placed exactly as set; without
  them, texts stay upright and adapt to the symbol's rotation and mirroring.
  Several lines of a turned text continue sideways.
- `textArrangement` (optional, e.g. `{ "side": "left", "angle": 90 }`) puts
  the label texts (tag, name, function text, technical data, text,
  cross-references – those the symbol has and that are not empty) as one
  block next to the outline of the item's graphics: on `side` (left, right,
  above, below), centered along it, 1.5 mm away, turned by `angle`.
  `texts` offsets, angles and alignments still apply on top; setting an
  arrangement removes them for the arranged texts.
- Device data (`parts`, `technicalData`, `contacts`, `plc`) belongs on the main
  function only. Validation warns about device data on auxiliary functions.

### `pages/<id>.json` — report page

```json
{
  "id": "p_1toc0000aa",
  "type": "report",
  "name": "1",
  "description": { "de": "Inhaltsverzeichnis", "en": "Table of contents" },
  "structure": { "function": "DOC" },
  "report": { "kind": "pageIndex" }
}
```

A report page stores only its definition. Its content is generated from the
project and is **always up to date**; there is no "update reports" step. If
the content needs more than one sheet, the page expands to sheets `1.1`,
`1.2`, … in the page order. Report kinds:

| Kind | Content | Stage |
|---|---|---|
| `titlePage` | Title page: project name and description, below them the project properties (customer, drawing number, created by, then any other property) as label/value lines without a table grid. The form's table area places the property block; name and description are centered above it | 1 |
| `pageIndex` | Table of contents: all pages with name, description, structure | 1 |
| `structureOverview` | Functions (`=`) and locations (`+`) with description and page count, in the order of Project settings → Structure; codes used in the project but not listed there follow | 1 |
| `deviceIndex` | Device directory: tag, function text, part, where each function is placed | 1 |
| `bom` | Bill of materials, grouped by part number | 1 |
| `terminalList` | Terminals per strip: external and internal targets, bridge, page | 1 |
| `terminalDiagram` | The same drawn as a graphic: each strip as a column of terminals, field-side targets left, cabinet-side right, bridges as a line joining the bridged terminals (column widths from the form) | 3 |
| `plcIoList`, `plcOverview` | I/O per card and channel with address, symbol name, comment | 2 |
| `cableOverview`, `cableDiagram` | Cables with type and route; core-by-core connections | 2 |
| `revisions` | Released revisions with date, author, description | 3 |
| `mountingPlate` | Per cabinet layout: the plate, rail and duct lengths, devices with part and footprint (`*` = default size) | 3 |

The table layout comes from a **form** (`Formular`), a JSON definition in the
library. Without `report.form`, the form `iec.form.<kind>` is used:

```json
{
  "id": "iec.form.bom",
  "kind": "bom",
  "frame": "iec.frame.a3.report",
  "title": { "de": "Stückliste", "en": "Bill of materials" },
  "table": { "x": 24, "y": 28, "headerHeight": 8, "rowHeight": 6, "rows": 36, "textSize": 2.5 },
  "columns": [
    { "key": "quantity", "title": { "de": "Menge", "en": "Qty" }, "width": 30 },
    { "key": "manufacturer", "title": { "de": "Hersteller", "en": "Manufacturer" }, "width": 80 }
  ]
}
```

`rows` is the number of rows per sheet. The page index lists every sheet,
including its own, and the page count in the title block counts sheets.

### `pages/<id>.json` — cabinet layout page

```json
{
  "id": "p_plate0001",
  "type": "layout",
  "name": "10",
  "structure": { "function": "FB", "location": "CAB1" },
  "plate": { "width": 600, "height": 800 },
  "scale": 5,
  "items": [
    { "id": "i_duct1", "kind": "duct", "x": 20, "y": 20, "length": 560, "width": 60 },
    { "id": "i_rail1", "kind": "rail", "x": 20, "y": 140, "length": 560, "profile": "TS35" },
    { "id": "i_k1pos", "kind": "device", "itemId": "i_coilk1", "x": 33, "y": 118.5, "turned": false }
  ]
}
```

A 2D cabinet layout: the mounting plate drawn at 1:`scale`, centered in the
frame's drawing area. Item positions and sizes are **real millimetres** from
the plate's top-left corner (the top-left corner of the item). Rails (TS35:
35 mm high, TS15: 15 mm) and ducts (`width`) run along `length`, vertically
when `vertical` is set. A device item points to the **main function** of the
device (`itemId`), so it follows renames. Its footprint is the part's
`width` × `height` from the parts database, else the item's own `width` and
`height`, else 45 × 90 mm (drawn dashed); `turned` swaps them. The plate is
labelled with the device tags relative to the page structure.

**Door** (`"surface": "door"`): the same page type for the front of the
enclosure door, seen from outside. Devices without part dimensions are drawn
round, Ø 30 mm, with the function text below them as the door legend; the
report lists them with the 22.5 mm mounting hole. `shape` (`round`, `rect`)
overrides the outline; round devices use `width` as diameter. **Cutouts**
(`{ "kind": "cutout", "x", "y", "width", "height", "label": "HMI" }`) mark
openings for HMIs, fans or windows.

Checks: a device placed twice, a placed device whose main function is gone,
and (as a hint) devices with a part that are on no plate. When every layout
page has a location (`+CAB1`), only devices of those locations are expected.
A layout page is one sheet.

## Multilingual texts

Texts written for people (function texts, page and project descriptions, free
texts) are translatable:

```json
"functionText": { "de": "Förderband ein", "en": "Conveyor on" }
```

- A plain string is also allowed and means "the same in every language". Use
  it for language-neutral texts such as technical data (`"24 V DC"`).
- `settings.languages` lists the project languages; `settings.displayLanguage`
  is what the editor, reports and PDF show. A missing translation falls back to
  the first project language and is listed by `check_project`.
- Tags, pin designations, PLC symbol names and part numbers are never translated.
- The `setTexts` command sets one language of texts addressed by key:
  `project:description`, `plc:<name>:description`, `page:<page>:description`,
  `item:<page>:<item>:functionText|technicalData`, `channel:<page>:<item>:<index>`.
  Setting a language of a plain string first copies the string to every
  project language.
- Translation files (CSV `;`-separated UTF-8, or ODS): one row per distinct
  text, one column per language code, then "Used at" for information. Import
  matches rows by the first project language and fills in the others; empty
  cells change nothing, and a row equal to a text's current translations
  changes nothing (a source text may have different translations in
  different places).

## Tags and device naming

A tag has three aspects (IEC 81346): function `=`, location `+`, product `-`.
Values are stored without their prefix.

Each aspect is taken from the first place that sets it:

```
1. the item's own tag
2. the innermost device box the item lies in        (all three aspects)
3. the innermost structure box the item lies in     (= and + only)
4. the page structure                               (= and + only)
```

The product aspect (`-K10`) is required for devices; it comes from the item
itself or from a device box.

Example: page `=A1+CAB1`, item tag `{ "product": "5K3" }`, effective tag
`=A1+CAB1-5K3`. An item in the field on the same page uses
`{ "location": "FIELD", "product": "S1" }`, effective tag `=A1+FIELD-S1`.

Tags are **displayed** relative to their context: a symbol shows only the
aspects that differ from the box or page around it, so a coil on page
`=A1+CAB1` shows `-5K3`, not `=A1+CAB1-5K3`.

**Automatic naming.** When a main function is placed, it gets a product name
from `settings.deviceNaming`:

| Scheme | Example (relay, page 5, column 3) |
|---|---|
| `pageColumn` with `{page}{letter}{column}` (**default**) | `-5K3` |
| `pageColumn` with `{letter}{page}{column:2}` | `-K503` |
| `counter` with `{letter}{counter}` | `-K1`, `-K2`, … |

- `{letter}` comes from the symbol definition (`K` for relays, `S` for
  switches, `Q` for contactors and breakers, …).
- If the name is taken, `duplicateSuffix` is added: the first relay in page 5,
  column 3 is `-5K3`, the next ones are `-5K3.1`, `-5K3.2`, …
- Names are assigned **once, on placement**. Moving a symbol later does not
  rename it. The `renumberDevices` command renames a selection or the whole
  project by the current positions, as one undo step.
- A main function never joins an existing device: if `-5K3` exists (even
  with only contacts so far), the next coil there gets `-5K3.1`. Coils in a
  row are always separate devices.
- **Contacts inherit from the left:** an auxiliary function placed without
  its own tag takes the device tag of the nearest device symbol to its left
  at the same height (same `y`), at any distance. Connection symbols and
  boxes are skipped. The tag is copied on placement and stored like a typed
  tag. Without such a neighbour (and outside a device box), the contact
  needs its tag.
- Otherwise auxiliary functions are placed against an existing device (the
  editor asks, with a list; the MCP tool takes the tag).

Renaming a device is one command (`renameDevice`) that updates every item with
that effective tag, applied as one undo step.

## Boxes

Boxes are rectangles on a page that change the tag of everything inside.
Box items store their size:

```json
{ "id": "i_box1", "symbol": "wirewright.box.structure", "x": 200, "y": 40,
  "width": 120, "height": 80, "tag": { "function": "AA", "location": "20" } }
```

An item belongs to a box when its insertion point lies inside the box. This is
derived from the geometry, not stored. Boxes can be nested; the innermost box
wins for each aspect.

### Structure box

- Sets `=` and/or `+` for everything inside. Aspects the box leaves empty
  come from the page.
- Example: page `=SG+10`, structure box `=AA+20`, coil `-K10` inside the box:
  effective tag `=AA+20-K10`.
- Drawn as a **turquoise dash-dotted** rectangle with its tag (`=AA+20`) in
  the top-left corner.
- It is not a device: it has no part, no cross-references and does not appear
  in the device directory.

### Device box

For drawing a device that has no symbol (an unknown or one-off device):

- A device box **is a device** (main function `device.box`), with tag
  (`-A5`, auto-named on placement), function text, parts and technical data
  like any other device. It appears in the navigator, device directory and BOM.
- **Pins** are placed on the box border, each with a designation. They connect
  by autoconnect on the outside **and** on the inside of the box:

  ```json
  "borderPins": [
    { "id": "p1", "side": "left",  "offset": 8,  "designation": "L" },
    { "id": "p2", "side": "left",  "offset": 16, "designation": "N" },
    { "id": "p3", "side": "right", "offset": 8,  "designation": "13" }
  ]
  ```

- **Components inside** (contacts, coils, terminals, …) without their own
  product tag become functions of the box's device. Draw a NO contact
  inside `-A5` and it is a contact of `-A5`. A component with its own
  product tag keeps it and only inherits `=` and `+` from the box.
- **Internal connections** are drawn inside the box between the pins and the
  components. They define how the potential passes through the device. With
  nothing drawn inside, the pins are **not** linked: an unknown device must
  not join L and N by default. Links can also be set directly in the
  properties dialog; they are stored on the box item as
  `"links": [["p1", "p2"]]`.
- Drawn in the **symbol color**, as a dashed rectangle with its tag in the
  top-left corner.
- Select a device box with its contents and "Save macro" to reuse it; turning it into a library symbol comes with the symbol editor.

### Moving items in and out of boxes

Moving an item into or out of a box changes its effective tag. The rules from
[editor.md](editor.md) apply: for a main function the whole device is renamed
(its auxiliary functions on other pages follow); an auxiliary function moves
to the device the new tag points to. The editor shows the change before the
move is applied.

## Cross-references

Cross-references are derived and shown on the devices:

| Item | Shows |
|---|---|
| Auxiliary function (contact) | Where its main function is: `/3.4` under or beside the contact |
| Main function with a contact template | Contact image (`Kontaktspiegel`), see below |
| Main function without a template | List of its auxiliary functions with references |
| Interruption point | Its partner(s) with the same name: `/6.1` |
| PLC I/O point | Its card's main function (stage 2) |
| Cable definition line | Other definition lines of the same cable (stage 2) |

- Format from `settings.crossReferences.format`: `/{page}.{column}` by default,
  `/{page}.{column}{row}` optional.
- The structure prefix (`=A1+CAB1`) is shown only when it differs from the
  current page's structure (`structure: "whenDifferent"`).
- Columns and rows come from the page's frame.
- References are clickable in the editor and in the PDF.

## Contact image (`Kontaktspiegel`)

The main function's `contacts` list (from a device template) says which
contacts the device has. The contact image is built from that list plus the
placed functions:

```
        -5K3
     ┌─────────┐
     │  A1  A2 │            coil
     └─────────┘
   11 ─┬─ 14   /5.4         used, with reference
       └─ 12   /7.2
   21 ─┬─ 24                unused
       └─ 22
```

- Each template entry is shown with its pins and the reference of the
  placed function, or empty when unused.
- **It grows with the drawing:** every contact drawn for the device is listed.
  Without a template, the rows are exactly the contacts drawn (sorted by
  pins); with a template, contacts beyond it are added as extra rows (and
  reported). Main functions whose symbol has `hasContactImage` (relay and
  contactor coils, motor protection, overload relays) always show it; other
  main functions show it once they have a template.
- **Mini symbols:** each row shows the `contactImage` graphics of the drawn
  contact's symbol (a 5 × 3 mm mini symbol), so any symbol with a mini
  symbol can appear in a contact image (time-delay contacts, contact blocks
  …). Free template rows use a library symbol with the row's function.
- Display variants (`settings.contactImage`, overridable per coil):
  `table`, a graphical table below the coil; `path`, text references beside
  the coil; `none`.
- Works for any main function with a template: relays, contactors (main and
  auxiliary contacts), motor protection switches, circuit breakers with
  auxiliary contacts.
- Validation: more placed contacts of a type than the template has, or pins
  that don't match the template.
- Main functions without `hasContactImage` and without a template just list
  their auxiliary functions.

**Device templates** are JSON files in the library (`relay.2co`,
`contactor.3p.1no1nc`, …). Choosing a template copies its `contacts` list onto
the main function, so the project does not depend on the library. In stage 2
a part from the parts database brings its template with it.

## Page frames

A frame is a JSON definition, like a symbol:

```json
{
  "id": "iec.frame.a3",
  "size": { "width": 420, "height": 297 },
  "drawingArea": { "x": 20, "y": 10, "width": 390, "height": 247 },
  "columns": { "count": 10, "x": 20, "width": 39 },
  "rows": { "labels": ["A", "B", "C", "D", "E", "F"], "y": 10, "height": 41 },
  "graphics": [ … ],
  "fields": [
    { "source": "project.properties.customer", "x": 300, "y": 270, "size": 3.5 },
    { "source": "page.fullName", "x": 395, "y": 285, "size": 5 },
    { "source": "page.description", "x": 200, "y": 285, "size": 3.5, "height": 13 },
    { "source": "page.index/project.pageCount", "x": 395, "y": 292, "size": 2.5 }
  ]
}
```

- `columns` and `rows` drive the grid labels on the border, cross-references
  and page-column device naming.
- `fields` bind title block texts to project and page properties, so the
  title block fills itself.
  A text with several lines (e.g. a two-line page description) is centered
  on the field's position; with `height` (mm) it gets smaller when its lines
  need more room than that.
- Stage 1 ships an A3 landscape frame and a matching report frame. A frame
  editor comes later; until then frames are edited as JSON.

## PLC

### Stations

`project.json` lists the PLCs of the project; a project can have several:

```json
"plcs": [
  { "name": "PLC1", "family": "siemens", "mnemonic": "german", "firstAddress": { "DI": 10, "DO": 10 } },
  { "name": "PLC2", "family": "mitsubishi", "mitsubishiSeries": "fx" },
  { "name": "PLC3", "family": "codesys" }
]
```

| Family | Digital | Analog |
|---|---|---|
| `siemens` | `I4.0`, `Q8.3` (German mnemonic: `E4.0`, `A8.3`) | `IW64`, `QW80` (byte address) |
| `codesys` | `%IX4.0`, `%QX8.3` | `%IW32`, `%QW40` (word index) |
| `mitsubishi` FX / iQ-F | `X40`, `Y17` (octal) | none (set an address per channel) |
| `mitsubishi` Q / iQ-R | `X4A`, `Y1F` (hex) | none (set an address per channel) |

Start addresses are stored as numbers: bytes for Siemens and Codesys (also
for analog: `%IW32` is byte 64), points for Mitsubishi. `firstAddress` is where
automatic numbering starts.

### I/O cards and I/O points

An **I/O card** (e.g. WAGO 750-430, Beckhoff EL1008, ET 200SP DI 8) is a device.
Its main function carries the card data:

```json
"props": {
  "plc": {
    "station": "PLC1",
    "slot": 1,
    "start": { "DI": 10 },
    "channels": [
      { "channel": 1, "kind": "DI", "pin": "1" },
      { "channel": 2, "kind": "DI", "pin": "5", "name": "B_EndPosition", "function": { "de": "Endlage" } }
    ]
  }
}
```

- `channel` is the number printed on the card (WAGO counts from 1, Siemens
  from 0); `pin` is the terminal point. They differ: on a WAGO 750-430
  input 2 is pin 5.
- `name` (PLC tag name), `dataType`, `function` and `address` (override) are
  optional per channel.
- `extraPins` lists further terminals that belong to the channel, drawn before
  its `pin`, e.g. the clock output of a safety input (WAGO 750-667:
  `{ "pin": "I1", "extraPins": [{ "pin": "T1", "label": "Takt" }] }`). The card
  master gives such a channel one row per terminal.
- The card can be drawn in two ways, or both:
  - **Card master** (`wirewright.plc.card`, generated from the channel list): one
    row and one connection per channel, usually on a PLC overview page. Each
    row shows pin, channel, address, function and where the channel is drawn.
  - **I/O points** (`wirewright.plc.di/do/ai/ao`, slaves): one channel each, placed
    on the page where the sensor or actuator is (`"channel": 2` in its props,
    the card's tag). A box of rows, from the connections away: cross-reference
    to the card master, channel (`DI 2`), PLC address and a large row for the
    function text (several lines). Inputs are connected at the top, outputs at
    the bottom; a channel with further terminals uses `….di.2` / `….di.3` with
    one connection per terminal (pins named like the card's terminals).
- **Cards belong to the project**, drawn or not. A card that is not drawn is
  kept in `project.json` (`plcCards`: the card item with its full tag) and is
  a device with its channels like a drawn one; drawing it moves the item onto
  a page, deleting its drawing moves it back. A card drawn more than once is
  reported (`plc.cardDrawnTwice`); one not drawn is a hint (`plc.cardNotDrawn`).
  Commands: `addPlcCard` (from a device definition), `placePlcCard`,
  `removePlcCards`.
- A card pin and the I/O point of the same channel are **one terminal**:
  wiring either one connects both (each connection of a multi-terminal point
  joins the card terminal of the same designation).

### Derived per channel

| | Rule |
|---|---|
| Address | card start + position among the card's channels of the same kind |
| Tag name | `name`, or `DI2_4A1` (kind, channel, card) |
| Function | channel `function`; else the I/O point's own function text; else **inherited** from the device wired to the channel: the wire is followed (through terminals and interruption points) to the nearest device with a function text. Inherited functions are drawn in grey. |

`assignPlcAddresses` numbers start addresses per PLC: cards in slot order
(then by tag) get consecutive ranges from the PLC's first address. It can
renumber all cards, selected cards or only cards without an address; cards
that keep their addresses are skipped.

Checks: card without PLC or with an unknown PLC, I/O point without card or
with a channel the card does not have, channel drawn twice, overlapping
address ranges, duplicate or invalid tag names, missing start address.

Exports per PLC: I/O list (CSV), TIA Portal PLC tag table (`.xlsx`),
Codesys GVL with `AT %IX…` declarations, GX Works3 global labels.

## Device library

A **device definition** describes a device as it is bought, with all its
symbols:

```json
{
  "id": "wago.750-430",
  "name": "WAGO 750-430, 8 DI 24 V DC",
  "manufacturer": "WAGO",
  "partNumber": "750-430",
  "functions": [
    { "symbol": "wirewright.plc.card", "main": true },
    { "symbol": "wirewright.plc.di", "channel": 1, "pins": { "1": "1" } },
    { "symbol": "wirewright.plc.di", "channel": 2, "pins": { "1": "5" } }
  ],
  "plc": { "channels": [ … ] }
}
```

- `functions` are the symbols the device can be drawn with: coil and
  contacts of a relay (with their pins), card master and I/O points of a
  card. Placing a device steps through them with **Tab**; every placed
  function gets the device's tag. The main function receives the part,
  the contact template (from `contacts`, or derived from the contact
  functions) and the channel list.
- Definitions come from three layers: the **standard library**, the shared
  **library folder** (desktop app; JSON files, e.g. on a network drive) and
  the project's own **`library.json`**. A device placed from the standard or
  shared library is copied into `library.json`, so the project stays complete
  without the library folder.
- "Save to library" turns a drawn device back into a definition.

The standard library contains the common PLC I/O systems (`devices/plc-*.json`,
generated from tables):

| Family | Content |
|---|---|
| WAGO 750/753 | every product of the series listed on wago.com (469, accessories left out), with English and German names. For 262 I/O modules the terminal assignment is read from the product manual's table (Kanal / Benennung / Anschluss / Funktion), including further terminals per channel: clock outputs of safety inputs, sensor supply of 3-conductor inputs, 0 V of 2-conductor modules, − of differential and RTD inputs. 25 modules whose table could not be read use the family pattern (marked "check"); couplers, controllers and special modules have no channel list |
| Beckhoff EtherCAT terminals | EL1xxx, EL2xxx (incl. relays), EL3xxx (voltage, current, RTD, thermocouple), EL4xxx, TwinSAFE EL1904/EL1918/EL2904, EK1100/EK9300 couplers, CX embedded PCs |
| Siemens ET 200SP | DI/DQ/RQ ST, HF, BA; F-DI with sensor supplies, F-DQ; AI/AQ; IM 155-6 interface modules |
| Siemens S7-1500 / ET 200MP | DI/DQ 16/32, AC and relay modules, F-DI/F-DQ, AI/AQ (channels `CH0` …), IM 155-5; CPUs 1511 … 1518 incl. F and compact C, ET 200SP CPUs 1510SP/1512SP |

For Beckhoff and Siemens, channel counts follow the product and pin assignments
follow each family's usual terminal pattern (Beckhoff 1/5/4/8 …, ET 200MP 2–9/12–19 …).
Such definitions say so in their description: check pin assignment and order
number against the manufacturer's documentation before use, and correct a
definition by saving it to the project or the library folder. CPUs, couplers and
controllers have no channels; they are drawn as a card master.

## Parts database

Devices name their parts by manufacturer and part number (`props.parts`). The
parts database holds the commercial data for them; the bill of materials takes
description, unit price (price / price unit), total, first supplier and ERP
number from it and adds a sum line per currency.

```json
{
  "id": "Finder:40.52.9.024.0000",
  "manufacturer": "Finder",
  "partNumber": "40.52.9.024.0000",
  "description": { "de": "Relais 2 W 24 V DC", "en": "Relay 2 CO 24 V DC" },
  "orderNumber": "405290240000",
  "ean": "8012823000000",
  "erpNumber": "100234",
  "unit": "pcs",
  "price": 125.0,
  "priceUnit": 10,
  "currency": "EUR",
  "suppliers": [{ "name": "Elektro AG", "orderNumber": "EA-4052", "price": 9.8, "deliveryDays": 3 }],
  "url": "https://…",
  "width": 15.5,
  "height": 78,
  "depth": 72,
  "properties": { "Lagerort": "R3" }
}
```

`width` and `height` (mm, as mounted) are the device's footprint in the
cabinet layout.

Parts live in the project's `library.json` (`parts`), in the shared library
folder (`parts/<id>.json`) or in library content files. A part is found by its
ID `<manufacturer>:<part number>`, else by the part number (with the same
manufacturer, if one is given). Tables from ERP systems (CSV with `;`, `,` or
tabs, or .xlsx) are read by their column titles in English or German
(Hersteller, Bestellnummer, Bezeichnung, Materialnummer, Preis, Währung,
Preiseinheit, Lieferant …); other columns become `properties`.

### Manufacturer catalogs (BMEcat, ECLASS, ETIM)

Parts can also come from **BMEcat** catalogs (versions 1.2 and 2005, `.xml` or
zipped), as manufacturers and wholesalers publish them. Per product: manufacturer
and part number (`MANUFACTURER_PID`, else the supplier's number), descriptions
in all languages of the file, EAN/GTIN, order unit, the net list price (lowest
quantity) with price quantity as price unit, a data sheet link, and the
**classification** (`ECLASS-13.0 27371601`, `ETIM-9.0 EC001437`).

The product **features** (ECLASS or ETIM properties) fill part fields:

| Field | Recognized by |
|---|---|
| `width`, `height`, `depth` (mm, converted from cm, m …) | name (Breite/Width, Höhe/Height, Tiefe/Depth …) or ETIM EF000008, EF000040, EF000049 |
| `ratedVoltage` | name (Bemessungssteuerspeisespannung, rated control supply voltage, coil voltage, rated voltage …); AC/DC from the name or a voltage-type feature; equal AC and DC values give `UC`; ranges stay ranges |
| `ratedCurrent` (A) | name (Bemessungsstrom, rated current, setting range → the highest value) |

ECLASS identifies properties by IRDI codes (`0173-1#02-…`) that differ between
ECLASS versions; they are recognized when the file names them (feature templates
or `FDESCR`). Others are assigned once in the import dialog — the assignment is
kept in the machine settings (`catalogFeatures`) for the next catalog. All other
features are kept as part properties. A wholesaler's catalog (supplier differs
from the manufacturer) puts its article number and price into the part's
supplier list. Imports merge with existing parts: imported fields win, ERP
numbers, other suppliers and properties stay.

## Macros

A **macro** is a reusable piece of circuit: a start/stop circuit with
self-holding contact, a motor feeder, a device box with its contents.

```json
{
  "id": "wirewright.macro.selfholding",
  "name": { "de": "Ein/Aus mit Selbsthaltung", "en": "Start/stop with self-holding contact" },
  "category": "control",
  "items": [ { "id": "i_m1", "symbol": "iec60617.contactor.coil", "x": 0, "y": 112, "tag": { "product": "3Q2" }, … } ]
}
```

- `items` are ordinary page items; positions are relative to the macro's
  top-left item. Tags hold only what the items had themselves, so a placed
  macro takes the structure (`=FB+CAB1`) of the target page.
- Placing (`placeItems`): a device whose main function is in the macro gets
  a new name by page and column; the macro's contacts of that device follow
  it. Contacts of devices outside the macro (e.g. an auxiliary contact of a
  contactor drawn elsewhere) keep their tag. Wire numbers and PLC start
  addresses are not taken over. Copy and paste works the same way.
- Like device definitions, macros come from the standard library, the shared
  library folder (`macros/<id>.json`) and the project's `library.json`; a
  placed macro is copied into `library.json`.

## Cables

- A **cable** is a device (`-W1`, letter W). It is drawn as a **definition
  line** (`wirewright.cable`) across the conductors that run in the cable: a
  horizontal (`width`) or vertical (`height`) line of any length. The first
  line is the cable's main function and carries the cable data; further lines
  (on other pages) are auxiliary functions with the same tag.

  ```json
  "cable": {
    "type": "ÖLFLEX CLASSIC 110 5G1.5",
    "crossSection": 1.5,
    "outerDiameterMm": 9.4,
    "coreIdentification": "numbers",
    "cores": [
      { "id": "1", "number": "1", "color": "BK" },
      { "id": "2", "number": "2", "color": "BK" },
      { "id": "PE", "color": "GNYE" }
    ],
    "shield": false,
    "lengthM": 12
  }
  ```

- Core `crossSection` overrides the cable's (e.g. `4G2.5 + 2×0.75`).
- **Cores from the type designation:** `5G1.5` → 5 cores, one green-yellow,
  1.5 mm²; `7x0.75` → no green-yellow core. Numbered (1…n, black) or colored
  per HD 308 (`5G`: BN, BK, GY, BU, GNYE; `3G`: BN, BU, GNYE; up to 5 cores).
- **Core assignment is derived:** the conductors the lines cross get the
  cores in order along the lines (lines in page order); PE conductors get the
  green-yellow core; a wire marker on a conductor can choose its core
  (`"wire": { "core": "3" }`). Unassigned cores are spare.
- Cable types are device definitions (`cable.5g1.5.colors` …) with the cable
  data, placed like other devices.
- Checks: more conductors than cores, no green-yellow core for PE,
  green-yellow core not on PE, core used twice, unknown core.
- Reports: cable overview (type, used/total cores, route by location,
  length) and cable diagram (core by core: color, cross-section, from, to,
  wire number).

## Wires and wire numbers

A **wire** is one conductor: everything joined by connection lines,
connection symbols, interruption points and potential points with the same
name. A device (or terminal) ends a wire.

- **Number** (one per conductor):
  1. the number on a **wire marker** (`wirewright.connection.definition`) placed on
     the conductor, or
  2. derived from where the conductor is first drawn: page, column and a
     counter, format `settings.wireNumbering.format` (default
     `{page}.{column}.{counter}`, e.g. `5.3.1`); the counter skips numbers
     that markers already use.
- Numbers are **shown only on wire markers** (derived ones in grey). The
  **numberWires** command writes the numbers into the markers (all, or only
  missing; whole project or some pages), so they stay fixed when the drawing
  changes. Wires without a marker are numbered in the wire list only.
- **Color and cross-section**, in this order: wire marker, cable core,
  the potential's `wire` defaults, `settings.defaultWire`.
- Wire ends are named `-K1:A1`; terminals by their terminal designation
  (`-X1:3`).
- Checks: one conductor with several numbers, one number on several
  conductors.
- Report: wire list (number, from, to, color, cross-section, potential, cable
  core).

## Terminal strips

A strip `-X1` is a device whose functions are terminal symbols, each with its
own designation (`props.terminal`: `1`, `2`, `PE`). The terminals of a strip
may be drawn on any number of pages.

- **Bridges:** terminals of the same strip with the same `props.bridge`
  label are bridged. They carry the same potential (like a device's linked
  pins, the nets themselves stay apart). Terminals bridged side by side at
  the same height on a page are drawn with a bridge line.
- **Targets:** for each terminal the conductors are followed through
  connection symbols (corners, tees, wire markers, interruption points) to
  the next device pins; a potential point ends the search, so a terminal on a
  rail does not list every device of the rail. Targets in the strip's
  location (`+CAB1`) are **internal** (cabinet side), others **external**
  (field side).
- **Renumbering** (`renumberTerminals`): numeric designations are replaced
  by `start`, `start+1`, … in drawing order (page order, then left to right,
  top to bottom). Names like `PE` or `N` stay.
- **Placing terminals** (macros, paste) onto a strip that already has
  terminals continues its numbering after the highest number and gives the
  placed bridges labels the strip does not use yet.
- **Checks:** duplicate designations (warning), terminals without
  designation (info), a bridge label used by only one terminal (warning).

## Connection symbols

Autoconnect (ADR-003) links facing connection points on the same line. These
symbols control where connections go and where they stop:

| Symbol | German | Function | Connectivity |
|---|---|---|---|
| Corner | Ecke | `connection.corner` | Turns a connection by 90°; one symbol per direction: `wirewright.connection.corner.up-right`, `.right-down`, `.down-left`, `.left-up` |
| T-junction | T-Anschluss | `connection.tee` | Branches a connection; one symbol per direction, named by its pins: `wirewright.connection.tee.up-right-down` (up ← right → down), `.right-down-left`, `.down-left-up`, `.left-up-right` |
| Cross | Kreuzung | `connection.cross` | Two connections cross without touching (or connect, as a variant) |
| **Interruption point** | Unterbrechungsstelle | `connection.interruption` | Connection continues at all interruption points with the same name, usually on another page. Shows the partner's cross-reference. |
| **Break point** | Abbruchstelle | `connection.break` | Connection deliberately ends here. It does not continue anywhere and is not reported as an open connection. |
| Potential point | Potenzialanschlusspunkt | `connection.potential` | Feeds a named potential (L1, 24V, PE, …) into the connection, usually at the edge of the page. All potential points with the same name are connected. |
| Potential definition point | Potenzialdefinitionspunkt | `connection.potentialDefinition` | Placed on a connection; sets its potential without connecting it to other points of that potential (e.g. after a transformer or power supply) |

Break points (`Abbruchstellen`) are needed because autoconnect connects
everything that faces each other:

- **Ending a line on purpose**, e.g. a connection that leads to equipment that
  is not drawn in this project, or a spare wire. Without a break point the
  check would report an open connection point.
- **Stopping autoconnect** between two aligned connection points that must not
  connect: a break point in between ends the line on both sides.
- A break point has one connection point; its rotation sets the side the line
  arrives from. It can carry an optional text (e.g. `to machine frame`).
- A break point has no tag, no partner and no cross-reference. That is the
  difference from an interruption point.

## Potentials

A potential names what a conductor carries: `L1`, `N`, `PE`, `24V`, `0V`, ….
Potentials are defined once per project, spread automatically through wires
and devices, and color the connection lines.

### Definitions in `project.json`

```json
"potentials": [
  { "name": "L1",  "type": "L",  "voltage": "400 V AC 50 Hz", "wire": { "color": "BK", "crossSection": 2.5 } },
  { "name": "L2",  "type": "L",  "voltage": "400 V AC 50 Hz", "wire": { "color": "BK", "crossSection": 2.5 } },
  { "name": "L3",  "type": "L",  "voltage": "400 V AC 50 Hz", "wire": { "color": "BK", "crossSection": 2.5 } },
  { "name": "N",   "type": "N",  "wire": { "color": "BU" } },
  { "name": "PE",  "type": "PE", "wire": { "color": "GNYE" } },
  { "name": "24V", "type": "+",  "voltage": "24 V DC", "wire": { "color": "BU", "crossSection": 0.75 } },
  { "name": "0V",  "type": "-",  "voltage": "0 V DC",  "wire": { "color": "WHBU", "crossSection": 0.75 } }
]
```

- `type` is one of `L`, `N`, `PE`, `PEN`, `+`, `-`, `signal`, `other`. Each
  type has a default line color and style, so `line` is optional and only
  needed to override it (e.g. `"line": { "color": "#FF8800" }`):

  | Type | Default line |
  |---|---|
  | `L` | black |
  | `N` | light blue |
  | `PE`, `PEN` | green, dashed |
  | `+` (24V) | red |
  | `-` (0V) | dark blue |
  | `signal`, `other` | black |
  | **no potential** | **red** |

  Unspecified connections in red make missing potential definitions visible
  at a glance.
- `line` is how connections of this potential are **drawn** (screen and PDF;
  the PDF export can switch to black and white).
- `wire` is the **physical** wire (color, cross-section) used by default for
  connections of this potential in wire lists (see Wire properties).
- A new project starts with L1, L2, L3, N, PE, 24V and 0V defined.

### Where a potential starts

- **Potential point** (`Potenzialanschlusspunkt`): feeds the potential into a
  connection, typically at the page edge.
- **Potential definition point** (`Potenzialdefinitionspunkt`): placed on a
  connection, sets its potential.
- **Device pin as source:** a pin can set a new potential, e.g. the output of
  a power supply or the secondary of a transformer:

  ```json
  "pinPotentials": { "+": "24V", "-": "0V" }
  ```

### How a potential spreads

1. **Along connections:** everything connected by autoconnect lines,
   interruption points (same name) and potential points (same name) has the
   same potential.
2. **Through devices**, following the symbol's internal links (`links` in
   the symbol definition):
   - **No `links` defined:** all pins of the symbol are linked, so the
     potential passes between all of them.
   - **`links` defined:** only linked pins pass the potential on. A NO contact
     links `1–2`; a three-pole main contact links `1–2`, `3–4`, `5–6`.
   - **`links: []`:** nothing passes through. Used for consumers such as coils,
     lamps and motors: the potential arriving at `A1` stops there and does not
     reach `A2`.
   - **A pin with a source potential** (`pinPotentials`) starts the new
     potential and is not linked to the rest of the device.
3. **Conflicts:** if two different potentials meet (e.g. `L1` and `N` joined
   through a wrongly linked device), `check_project` reports the conflict with
   the path between the two sources. These lines are highlighted with a
   magenta halo (red is taken by "no potential").
4. **Undefined:** connections without a potential are drawn in red.

Note the difference between a **net** and a **potential**: a net is what is
joined by wires only (a contact separates two nets); a potential continues
through devices. Terminal lists and wire lists use nets; colors and potential
checks use potentials.

## Pneumatics and hydraulics

Fluid power symbols (ISO 1219: 3/2, 5/2, 5/3-way valves, cylinders, flow
control and check valves, service unit, pressure gauge, pump, tank, relief
valve, exhaust, silencer) sit on the same pages as the electrical symbols.
Their connection points are **pipe ports** (`"medium": "fluid"` in the symbol
definition). Autoconnect joins pipe ports only to pipe ports; pins and pipe
ports on one line neither connect nor block each other, so pipes never touch
wires. Pipe connection symbols (`wirewright.pipe.corner.*`, `wirewright.pipe.tee.*`,
crossings, interruption points, plug) work like the wire ones.

**Media** (`project.media`) are to pipes what potentials are to wires:

```json
"media": [
  { "name": "P", "type": "pressure", "pressure": "6 bar", "line": { "color": "#2b7bd6" } },
  { "name": "R", "type": "exhaust" }
]
```

Types: pressure, exhaust, pilot, vacuum, hydraulicPressure, hydraulicReturn,
other. A pressure source (`wirewright.pipe.source`, `props.name` = medium) feeds
its pipes; components pass a medium on only along their links (valves and
cylinders do not, flow control and check valves and the service unit do).
Pipes are gray unless their medium has its own color; pilot lines are dashed
by default. Two media meeting in one pipe are reported like a potential
conflict. Pipes have no wire numbers and no cable cores. A solenoid valve is an
auxiliary function of its valve coil (same tag), so coil and valve show
cross-references to each other; manual and double-solenoid valves are main
functions.

## Engineering checks

Besides the drawing checks (open connections, potential conflicts, contact
overuse …) the project check looks for typical design mistakes. They are hints
for the designer, not a replacement for the standards.

| Code | Check |
|---|---|
| `voltage.mismatch` | Coils (relay, contactor, valve) and lamps: the rated voltage — from the item's technical data (`24 V DC`), else the part's `ratedVoltage`, else a single voltage in the part description — against the voltage between the potentials at its two pins. L–N of a 400 V supply counts as 230 V; L–L as the line voltage; + / − as the difference. AC/DC must match (UC fits both), the value within ±10 %. |
| `wire.crossSection` | Breakers, motor protection and fuses: the rating — technical data (`C16`, `B10`, `6,3 A`, `4–6,3 A` → the highest), else the part's `ratedCurrent` — against the cross-section of every wire at its pins. Current-carrying capacity per EN 60204-1 Table 6, PVC, 40 °C, method B1 (single conductors in ducts), without derating for grouping. |
| `pe.notConnected`, `pe.wrongPotential` | Pins designated PE that are not wired, or that carry a potential other than PE/PEN. |
| `plc.channelType` | PLC inputs (DI, AI) wired only to coils, lamps or motors; outputs (DO, AO) wired only to switches, contacts or sensors. Follows the wire through terminals to the nearest devices; when a device of the right kind is wired there too (an input on the A1 of a coil that a pushbutton switches), it is fine. |

Any problem can be **acknowledged** (checked and intended): `project.acknowledged`
holds `{ key, note, date }` per problem, the key being code, item (or page and
device) and the values that tell several problems of one item apart. Acknowledged
problems are still reported, marked `acknowledged`, and do not count.

Parts can carry `ratedVoltage` (text, e.g. `"24 V DC"`) and `ratedCurrent`
(A) for these checks.

## Symbol definitions

```json
{
  "id": "iec60617.contact.no",
  "name": { "en": "Normally open contact", "de": "Schließer" },
  "category": "contacts",
  "function": "contact.no",
  "defaultRole": "auxiliary",
  "letterCode": "K",
  "graphics": [
    { "type": "line", "x1": 0, "y1": -8, "x2": 0, "y2": -3 },
    { "type": "line", "x1": 0, "y1": -3, "x2": 3, "y2": 3 },
    { "type": "line", "x1": 0, "y1": 3, "x2": 0, "y2": 8 }
  ],
  "connections": [
    { "id": "1", "x": 0, "y": -8, "direction": "up", "designation": "13" },
    { "id": "2", "x": 0, "y": 8, "direction": "down", "designation": "14" }
  ],
  "links": [["1", "2"]],
  "texts": [
    { "field": "tag", "x": -4, "y": -2, "align": "right" },
    { "field": "xref", "x": -4, "y": 2, "align": "right" },
    { "field": "pin:1", "x": 1.5, "y": -6 },
    { "field": "pin:2", "x": 1.5, "y": 6 }
  ]
}
```

- All positions are millimetres relative to the origin. Connection points
  are on the 4 mm raster.
- `direction` is the side the connection leaves the symbol. Autoconnect only
  links two points that face each other.
- `function` drives cross-references and contact images.
- `links` lists which pins are connected inside the device, for potential
  propagation (see Potentials). Omitted means all pins are linked; `[]` means
  none are. The symbol editor and the properties dialog draw the links as
  lines between the pins (see [editor.md](editor.md)).
- Graphic primitives: `line`, `polyline`, `rect`, `circle`, `arc`, `text`.
- Connection symbols (`wirewright.connection.corner.*`, `…tee.*`, `…cross`),
  interruption points, potential points, PLC I/O points and cable definition
  lines are ordinary definitions with a special `function`.

## Derived data (computed, never saved)

| Index | Content | Used by |
|---|---|---|
| Devices | effective tag → functions (page, item) | navigator, cross-references, reports, MCP `list_devices` |
| Connectivity | autoconnect lines per page, then nets joined across pages via interruption and potential points | display, terminal list, cables, `check_project` |
| Cross-references | per function: where the related functions are | display, contact images, PDF links |
| Nets and potentials | nets (joined by wires) and potentials (joined through device links) per connection; conflicts | line colors, wire properties, short-circuit check |
| Report sheets | expanded content of report pages | display, PDF |
| PLC addresses | per I/O point | display, I/O list, exports |
| Issues | duplicate or missing main functions, open connection points, ambiguous autoconnect, contact overuse, PLC and cable errors | `check_project`, editor markers |

Stage 1 recomputes the derived data for the whole project after each change
and caches it until the next change; this takes milliseconds for projects of
a few hundred pages. Incremental updates (only the changed page and the
affected devices) can be added without changing the file format.

## Item properties of special symbols

| Symbol | Property |
|---|---|
| Interruption point, potential point, potential definition point | `props.name`: `X1`, `L1`, `24V` … |
| Break point | `props.text`: optional label |
| Terminal | `props.terminal`: terminal designation (`1`, `PE`); `props.bridge`: bridge label |
| PLC card view | `props.plcView`: `{ of: <item ID of the card master>, channels: [...] }`; a further overview of a card (not the master), its channels kept in sync with the master's. Pages generated by `generatePlcOverview` carry `properties.plcOverview: <PLC name>` |
| Free text (`wirewright.text`) | `props.text`: multilingual text, lines separated by `\n`; `props.textStyle`: `{ align: left/center/right, color: "#rrggbb", size: mm }` (defaults left, black, 3 mm) |
| Any slave function | `props.showTag`: show the device name even right of a symbol of the same device (default: not repeated) |
| Connection definition point | `props.wire`: `{ color, crossSection, number }` |

## Commands

A command is a plain JSON object. Applying it changes the project and records
the inverse for undo. A batch of commands is one undo step.

```json
{ "type": "placeSymbol", "page": "p_8kq2m4x7tz", "symbol": "iec60617.relay.coil",
  "x": 80, "y": 120, "template": "relay.2co" }
```

First command set:

| Area | Commands |
|---|---|
| Project | `setProjectProperties`, `setProjectSettings`, `setPotentials`, `setPlcs`, `addToProjectLibrary` |
| PLC | `assignPlcAddresses` (all cards, selected cards or only missing addresses) |
| Wires | `numberWires` (all or only missing, project or pages) |
| Pages | `renumberPages` (prefix, start, step; in page order; names stay unique per structure) |
| Terminals | `renumberTerminals` (one strip, numbered in drawing order from `start`) |
| Macros, paste | `placeItems` (items or a library macro at a position, with new device names) |
| Pages | `createPage`, `createReportPage`, `deletePage`, `movePage`, `setPageProperties` |
| Items | `placeSymbol`, `moveItems`, `rotateItems`, `mirrorItems`, `deleteItems`, `setItemProperties`, `setItemTag`, `moveItemText` |
| Devices | `renameDevice`, `renumberDevices`, `applyDeviceTemplate` |
| Texts | `replaceTexts` (find and replace across tags and texts, with filters) |

Implementation note: the project state is immutable and commands are applied
with Immer, which generates the patches for undo/redo and tells the storage
layer which page files changed.

## Open points
