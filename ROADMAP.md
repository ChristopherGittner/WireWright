# Roadmap

Details of the data behind each feature: [docs/data-model.md](docs/data-model.md).
Editor operation (selection, F2 renaming, shortcuts): [docs/editor.md](docs/editor.md).

## Stage 1 — documented schematics ✅

Status: complete. Everything below is implemented and tested (unit tests,
browser tests of the editor, end-to-end test of the desktop app). Known
limitations are listed at the end of this stage.

**Goal:** draw a real control circuit (main circuit, control circuit with
relays and contactors, terminals) across several pages, with frames, automatic
device names, cross-references and contact images, a table of contents and a
device directory, and export it as a PDF. An AI can do the same through MCP.

### 1. Project and pages
- [x] Create, open and save projects (folder of JSON files, see ADR-004)
- [x] Page tree: add, delete, reorder and rename pages
- [x] Page properties: name, description, structure (`=` / `+`), free properties
- [x] Desktop app reloads when the project folder changes on disk
- [x] Multilingual texts (function texts, descriptions) with a display language switch

### 2. Page frames
- [x] Frame definitions as JSON: size, drawing area, columns and rows, title block fields
- [x] Title block filled from project and page properties
- [x] A3 landscape schematic frame and a matching report frame
- [x] Default frame per project, override per page

### 3. Editor basics
- [x] Zoom and pan
- [x] Switchable snap grid: 1, 2, 4, 8 mm
- [x] Select (click, box), move, rotate, mirror, delete
- [x] Copy and paste
- [x] Undo and redo
- [x] Select and move individual symbol texts (tag, cross-reference, pins)
- [x] F2 edits the selected text or tag in place; double-click opens properties
- [x] Find and replace across the project (Ctrl+H) with preview
- [x] Multi-select properties editing

### 4. Symbol library (IEC 60617)
- [x] Symbol definition format: graphics, connection points with direction, links, text fields
- [x] Basic set of about 30–40 symbols: NO/NC/changeover contacts, coil,
      contactor main contacts, MCB, motor protection switch, fuse, motor,
      lamp, push buttons, selector switch, terminal, PE, transformer, power supply
- [x] Device templates: relays (1–4 CO), contactors (3 main + aux), motor protection switch
- [x] Symbol picker in the editor

### 5. Autoconnect (see ADR-003)
- [x] Connect facing connection points on the same horizontal or vertical line automatically
- [x] Connection symbols: corner, T-junction (all directions), cross
- [x] Live connection preview while moving symbols
- [x] Highlight ambiguous or conflicting connections
- [x] Interruption points (`Unterbrechungsstellen`): cross-page connections
- [x] Break points (`Abbruchstellen`): end a connection on purpose, stop autoconnect
- [x] Potential points (L1, L2, L3, N, PE, 24V, 0V)

### 5a. Potentials
- [x] Potential definitions per project (name, type L/N/PE/+/−, voltage, line color and style, default wire)
- [x] Potential sources: potential points, potential definition points, device pins
- [x] Propagation along connections and through devices (symbol `links`; all pins linked when undefined)
- [x] Connection lines colored by potential (L black, N light blue, PE green dashed, 24V red, 0V dark blue, none red); black-and-white option for PDF
- [x] Pin links shown in the properties dialog and as a schematic overlay (L)
- [x] Conflict check (two potentials joined, e.g. L1 to N) with the path shown

### 6. Devices and tags (IEC 81346)
- [x] Device tag `=Function +Location -Device`, inherited from the page where not set
- [x] Automatic naming on placement: by page and column (`-5K3`, then `-5K3.1`, `-5K3.2`) or by counter (`-K1`), configurable
- [x] Renumber devices (selection or whole project) by current position
- [x] Structure boxes: turquoise dash-dotted rectangle setting `=` / `+` for its contents
- [x] Device boxes: device with pins on its border and components inside
- [x] Rename a device across all its functions (tag change on a main function); move a contact to another device (tag change on an auxiliary function)
- [x] Properties dialog: tag, function text, technical data, parts, connection designations

### 7. Cross-references and contact images
- [x] Contacts show where their coil is (`/3.4`); structure prefix only when it differs
- [x] Contact image (`Kontaktspiegel`) under coils, contactors and breakers: table or path style
- [x] Main functions without a template list their auxiliary functions
- [x] Interruption points show their partners
- [x] Contact overuse and pin mismatch warnings
- [x] Double-click a reference to jump to its target

### 8. Navigation
- [x] Device navigator: all devices and where each function is placed
- [x] Page navigator

### 9. Reports (always up to date, multi-sheet)
- [x] Report forms as JSON
- [x] Table of contents (page index)
- [x] Device directory (device index)
- [x] Bill of materials
- [x] Terminal list
- [x] CSV export of every report

### 10. Output
- [x] PDF export with clickable cross-references and bookmarks, color or black and white
- [x] Print (desktop app)
- [x] SVG export of a page (browser)

### 11. AI access through MCP (see ADR-007)
- [x] Command API in the core: every change is a serialisable command, with batches
- [x] MCP server (stdio, project folder mode) with read, check and write tools
- [x] `render_page` so the AI can see the result (PNG or SVG)
- [x] `get_report`, `create_report_page`, `set_page`

### Known limitations of stage 1
- Device box pins are added and edited in the properties dialog, not by
  clicking on the box border.
- All derived data (connections, cross-references, reports) is recomputed
  for the whole project after each change. This is fast for projects of a
  few hundred pages; incremental updates come when needed.
- Printing goes through the operating system's print dialog of the desktop
  app and has not been tested against real printers yet.
- The browser version opens folders only in Chromium-based browsers (File
  System Access API) and has no PDF export; use the desktop app for that.

## Stage 2 — engineering data

### PLC ✅
- [x] Several PLC stations per project: Siemens (I/Q or E/A), Codesys, Mitsubishi FX/iQ-F (octal) and Q/iQ-R (hex)
- [x] I/O cards of any make (WAGO, Beckhoff, Siemens …) assigned to a PLC, with slot and start addresses
- [x] Channel number and terminal pin kept apart (WAGO 750-430: input 2 = pin 5)
- [x] Card master on a PLC overview page and/or single I/O points scattered over pages; both are the same terminal
- [x] Derived addresses and tag names; channel function inherited from the wired device
- [x] Address numbering for the whole PLC, selected cards or only missing addresses
- [x] I/O list report and CSV; exports: TIA Portal tag table (`.xlsx`), Codesys GVL, GX Works3 global labels
- [x] Validation: channels drawn twice, unknown channels, address overlaps, tag names
- [x] PLC overview pages generated automatically from the cards of a PLC (again later: adds only missing cards)
- [x] Import of tag names (and comments) back from the PLC project: TIA tag table, Codesys GVL, GX Works3 labels, I/O list CSV; matched by address, reviewed before applying

### Device library ✅
- [x] Device definitions with all symbols of a device (relay coil + contacts, card + I/O points), part and channels
- [x] Placing a device with Tab through its functions; Tab on a drawn device continues with its unplaced functions
- [x] Standard library, shared library folder (desktop), project copy in `library.json`
- [x] Save a drawn device as a definition
- [x] Master checkbox (main function) on every device symbol

### Cables ✅
- [x] Cable definition lines; cables as devices with type, cross-section (mm²), outer diameter
- [x] Cores with numbers and/or IEC 60757 colors; cores generated from the type (`5G1.5`, `7x0.75`)
- [x] Automatic core assignment (PE to GNYE); explicit cores via wire markers
- [x] Cable overview and cable diagram reports
- [x] Validation: core count, duplicate cores, PE core

### More
- [x] Wire properties: color and cross-section from connection definition point, cable core, potential or project default
- [x] Wire numbering per conductor ({page}.{column}.{counter}), shown and fixed on wire markers; wire list
- [x] Parts database with ERP fields (description, order/ERP number, EAN, price per unit, suppliers, delivery time): project and shared library, CSV/.xlsx import and export, prices in the bill of materials
- [x] Terminal strips: bridges (shared potential, drawn), internal/external targets, renumbering, checks, editor dialog
- [x] Macros: save a selection, place with new device names (contacts follow their coil), standard/shared/project macros; paste works the same way
- [x] Symbol and frame editor UI (graphics, connection points, text fields, pin links drawn and edited graphically; frames with title block fields, drawing area, columns and rows)
- [x] Save a device box as a macro (select box and contents)
- [x] Turn a device box into a library symbol (outline, inner graphics and wires, border pins, pin links; reviewed in the symbol editor)
- [x] MCP: high-level circuit tools: `draw_current_path` (a current path laid out in a column between two potentials), `connect_pins` (L/Z routes with corners)
- [x] MCP: live mode inside the desktop app (Streamable HTTP on 127.0.0.1 with access token, shared undo)

### Editor and project comfort ✅
- [x] Title page and structure overview report pages
- [x] Functions and locations with descriptions and sort order (Project settings → Structure); page tree by structure
- [x] Translations window (all texts, CSV/ODS export and import), own project languages
- [x] Line breaks in texts (Ctrl+Enter, shown as ¶)
- [x] Free texts (multi-line, alignment, color, multilingual)
- [x] Renumber pages (prefix, step) and devices (choose pages, review changes); step for terminal and PLC address numbering
- [x] PLC tab: cards and channels, drawn channels marked with their cross-reference, drag channels and cards onto pages
- [x] Drag and drop from the Symbols tab; detachable and closable side tabs
- [x] Paste follows the mouse (X/Y keep the original position); right-click menu on symbols
- [x] Edit several symbols at once (`<-->` for differing values, only changed fields are written)
- [x] Text layout: angle (90°/270°) and alignment per text; label texts as a block beside the symbol (side + angle)
- [x] Export dialog (pages as a tree, black and white, location); last open page reopened
- [x] Recent projects on the welcome screen; Machine settings (defaults for new projects)
- [x] Editor in English and German (software language in Machine settings)

## Stage 3 — fluid power, cabinet layout, revisions

- [x] Pneumatics and hydraulics (ISO 1219): valves, cylinders, service units, … on the same pages; pipes as their own medium (they never connect to wires), media with color and line style like potentials (default gray)
- [x] Project archive: the whole project in one file (`.wirewright.zip`, with the definitions it uses from the shared library), and opening it again
- [x] 2D cabinet layout: mounting plate pages to scale with DIN rails, wire ducts and device footprints from the parts database (placed from the device list, snapped onto rails), checks for unplaced devices, mounting plate report, MCP tools
- [x] Engineering checks: coil/lamp voltage against the potentials, wire cross-section against breaker/fuse rating (EN 60204-1), PE not connected or on another potential, PLC inputs/outputs wired to the wrong kind of device
- [x] Command palette (Ctrl+K: actions, pages, devices, symbols); alignment guides while moving and placing; graphic terminal diagram report
- [x] End-to-end tests of the desktop app in CI; faster recomputation on large projects (per-page caches)
- [x] Acknowledge problems (greyed out with a reason, not counted); PLC channel check accepts inputs on a coil that a switch also drives
- [x] PLC cards belong to the project: added from the device library in the PLC tab (picker stays open, next slot and tag, full name as tooltip, preview of DI/DO/AI/AO and terminals), marked until drawn, drawn by dragging, cross-references to their drawings, several drawings reported; MCP add_plc_card, place_plc_card
- [x] F5/F6/F7 place corners, T-junctions and interruption points
- [x] WAGO 750/753 from wago.com: all 469 products, terminal assignments of 262 I/O modules read from the product manuals (clock, sensor supply, 0 V terminals per channel)
- [x] Device library: WAGO 750, Beckhoff EtherCAT terminals, Siemens ET 200SP and S7-1500/ET 200MP I/O modules, CPUs, couplers and controllers (pin assignments to be checked per project)
- [x] PLC I/O points as a box with rows (cross-reference, channel, address, multi-line function); channels with several terminals (clock + input of safety inputs)
- [x] Drag and drop pages onto another function/location or page in the Pages tab
- [x] Style brush: copy the text layout of a symbol to others by clicking them
- [x] Catalog import: BMEcat 1.2/2005 with ECLASS and ETIM features (dimensions, rated voltage/current, classification), feature assignment remembered per machine, merge with existing parts
- [x] Door layout: door front with round command devices, function-text legend, cutouts (HMI, fan), drilling in the report
- [x] Revisions and change tracking: release revisions (snapshot, title block marks on changed pages), compare with a revision (Δ pages, new/changed/deleted symbols highlighted), revision list report, MCP create_revision / get_changes
