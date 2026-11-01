# Editor interaction

How the schematic editor is operated. Every action here runs a command from
the core (see [data-model.md](data-model.md)), so everything can be undone
and is also available through MCP.

## Toolbar

Icon buttons in sections (File, Edit, View, Project, Output, Help); the name
and shortcut of each button are its tooltip. Toggles (pin links, black and
white) are highlighted when on. Icons: Material Symbols (Apache License 2.0);
the terminal strip icon is Wirewright's own.

## Symbol and frame editor

Symbols tab → symbol editor button (a copy of the symbol chosen for placing,
or a new one), or Device library → Symbol editor… / Frame editor…. Tools:
select and move (Delete removes), line, rectangle, circle (from the centre),
polyline (click the points, double-click or Enter ends), fixed text; for
symbols connection points (on whole millimetres, the direction points away
from the middle) and text fields (tag, function text, technical data,
cross-reference, contact image, name, pins), for frames title block fields
(project and page properties). **Pin links** (which pins the potential passes
through) are drawn with the link tool: click one pin, then another; clicking
the same pair again unlinks them. Alternatively all pins or none are linked.
The panel on the right holds the definition (ID, name, category, function,
role, letter code; for frames size, drawing area, columns and row labels) and
exact values of the selected element. Wheel zooms. Saving validates the
definition and writes it to the project library (an ID of the standard
library is replaced for this project only), optionally also to the shared
library folder (`symbols/<id>.json`, `frames/<id>.json`). Project settings
choose the default frame.

### Device box → library symbol

Right-click a device box (or its properties, Pins and links) → "Turn into a
library symbol…": a symbol with the box outline (solid), the graphics of
everything inside it and the wires between them (without their texts), the
border pins as connection points pointing outwards, the box's pin links, and
tag and function text above it; origin in the middle of the box, letter code
from its tag. It opens in the symbol editor to check, name and save; the box
on the page stays as it is.

## Parts database

Toolbar → Project → Parts database: search the parts of all libraries, edit
one (manufacturer, part number, description, order and ERP number, EAN, price
per price unit and currency, unit, suppliers with order number, price and
delivery time, URL) and save it to the project (optionally also to the shared
library folder). Import a list from the ERP system (CSV or .xlsx), export the
database as CSV or .xlsx. "Used in the drawing, not in the database" lists the
part numbers of devices that have no entry yet. In a device's properties the
part number field suggests the database's parts, fills in the manufacturer
and shows description, price and supplier.

Import… also reads **BMEcat** catalogs (`.xml`, `.zip`) from manufacturers or
wholesalers: a dialog lists the catalog's ECLASS/ETIM features with an example
value and the part field each fills (width, height, depth, rated voltage, rated
current, property, ignore). Change the assignment where needed; it is remembered
on this computer.

## Revisions

Toolbar → Project → Revisions: release a revision (name suggested: A, B …;
date, author, description). Pages changed since the previous revision get its
name and date in their title block; the project is saved and its state kept
for comparing. "Show changes since" compares the drawing with a revision: the
Pages tab marks new and changed pages with Δ, the canvas frames new symbols
green and changed ones orange and marks deleted ones with a red × at their
old place, and the dialog lists the changed pages. The toolbar button stays
highlighted while comparing. A report page "Revisions" lists all revisions.

## Cabinet layout

Pages tab → "New cabinet layout": mounting plate or door, name, structure
(give the cabinet's location, e.g. `+CAB1`), size and scale (600 × 800 mm at
1:5 fits A3).
On a layout page the canvas shows the plate to scale with tools at the top
and the devices of the location on the right:

- **Rail** / **Duct**: drag along the plate; the longer side of the drag
  decides horizontal or vertical. Duct width is set next to the tool.
- **Devices**: click a device in the list, then click on the plate. Dropped
  near a rail, the device sits centred on it. Placed devices are ticked; a
  click on them selects them on the plate.
- Select, drag to move (5 mm steps, arrow keys 5 mm, Shift+arrow 1 mm),
  band selection, **R** turns devices by 90° and switches rails/ducts between
  horizontal and vertical, **Del** deletes, double-click edits position,
  length, profile or the footprint of devices without part dimensions.

On a **door** the tools are Select and **Cutout** (drag a rectangle; double-click
to give it a label such as "HMI"). Pushbuttons, lamps, selector and emergency
stop switches come first in the device list; devices without part dimensions
are round (Ø 30 mm) with their function text below. Devices already on another
layout page are shown in italics with that page.

Footprints come from the parts database (Width / Height in the part); devices
without them are drawn dashed at 45 × 90 mm. Page properties change plate size
and scale. The report "Mounting plate" lists plates, rail and duct lengths and
devices.

## Moving pages between functions and locations

Drag a page in the Pages tab onto a **function** (`=`) node to give it that
function (the location stays), onto a **location** (`+`) node to give it both,
or onto another **page** to put it before that page with that page's structure.
Several pages selected with Ctrl/Shift+click move together. A page name that
already exists in the target is refused (renumber the pages first). One undo
step.

## Style brush

Like the format painter of office programs: select a symbol whose text layout
you like (positions of tag, function text, pins …, their angles and alignment,
the label arrangement), click the brush in the toolbar (or **Ctrl+Shift+C**, or
"Copy style" in the right-click menu), then click other symbols — each gets the
same layout. Drag a band to give it to all symbols inside. The brush stays
active, also when you change pages, until **Esc**. Each click is one undo step.

## Command palette

**Ctrl+K** opens one search field for everything: toolbar and panel actions
(only those available right now, with their shortcut), pages, devices (jumps to
the main function) and library symbols (starts placing). Type a few letters of
any word, choose with the arrow keys and Enter.

While moving or placing symbols, **alignment guides** connect their connection
points with the nearest pin of another symbol in the same column or row: green
when the two face each other (autoconnect will join them), magenta dashed when
they only line up.

## Machine settings

Defaults of this computer (toolbar → Project section, or the welcome screen):
the settings (languages, display language, device naming, cross-references,
grid, default wire …) and the potentials a **new project** starts with. Open
projects keep their own values (Project settings). "Take from the open
project" copies the current project's settings and potentials; "Built-in
defaults" returns to Wirewright's own. The desktop app stores them in
`settings.json` in its user data folder, the browser in local storage.

**Software language** (also in Machine settings): the language of the
editor's own texts – English or German; "Like the operating system" uses the
system language when it is available, English otherwise. It is separate from
the project languages, which are the languages of the texts in the drawing.
It covers menus, dialogs, tooltips, status messages, key names (Strg, Entf …),
undo/redo names, the Problems tab and command errors, and the desktop app's
own dialogs (unsaved changes, folders). Problems and command errors carry
their message as a template with values (`text` next to the English
`message`), so the editor translates them; MCP keeps the English message.
The texts are keyed by their English wording (`packages/editor/src/i18n.ts`);
a missing translation shows the English text. Another language is a further
dictionary in `packages/editor/src/i18n/` registered in `UI_LANGUAGES`.

## Suggestions while typing

Fields offer a drop-down of known values while typing (new values are still
allowed): tag fields the project's functions and locations (with
descriptions) and existing device names; potential, interruption and break
point names the project's potentials and names already used; wire colors the
IEC 60757 codes; cross-sections the common values; bridge labels the labels
already used; "rename device" the existing devices.

## Side panels

Pages, Devices, Symbols, PLC and Issues are tabs of the side panel. Each
tab can be closed (× on the tab) and opened again with its button in the
toolbar section "Panels" (highlighted while open); with all tabs closed the
drawing uses the full width. Which tabs are open is remembered. The window
button at the end of the tab bar opens the current tab in its own window
(e.g. on a second screen); it works on the same project, so selection, drag
and drop and undo are shared. Closing that window docks the tab again.

## Selection

| Action | Result |
|---|---|
| Click or drag on a symbol (graphics or any of its texts) | Selects and moves the whole symbol |
| **Ctrl+click** on a symbol text (tag, function text, pin, cross-reference) | Selects only that text: drag to move it, F2 edits it, F follows a cross-reference, **R** turns it 0° → 90° → 270° (against the sheet) |
| Shift+click (Ctrl+click on graphics) | Adds to or removes from the selection |
| Drag on empty space | Box selection |
| Esc | Clears the selection, cancels the current action |
| **F** (follow) on a cross-reference selected with Ctrl+click | Jumps to where it points and selects that symbol |
| **F** on a selected slave | Jumps to its master: from a contact to its coil, from an I/O point to the PLC card, from an interruption point to its partner. On a master, select one of its cross-references and press F. |
| Double-click a cross-reference | Jumps to where it points |

## Editing texts and renaming

| Key / action | Result |
|---|---|
| **F2** on a selected text | Edits the text in place on the canvas. Enter applies, Esc cancels, Tab moves to the next text of the same symbol. |
| **F2** on a selected symbol | Edits its tag in place |
| **Double-click** a symbol | Opens the properties dialog: all fields, all languages, parts, contact template, PLC and cable data |
| **Right-click** a symbol | Menu: Edit… (the selection, or this symbol), Rotate, Mirror, Delete. A right-click on a symbol outside the selection selects it first; while placing, a right-click ends the tool |
| Edit several symbols | Select them, then right-click → "Edit n items…" (or double-click one of them). Values the symbols share are shown; where they differ the field shows `<-->`. Fields left alone change nothing; a field you fill in is written to every symbol. Available for several: tag (=, +, -), master, show device name, function text and technical data (only the edited language), name of interruption and potential points, terminal bridge, and the text layout |
| Text layout (properties) | **Label texts**: a side (left, right, above, below) and an angle (0°, 90° ↑, 270° ↓) for the label block – tag or name, function text, technical data, cross-references – placed next to the symbol's graphics and centered on them (e.g. interruption points "above, 90°", coils in a row "left, 90°"); choosing a side resets the own positions of those texts. Below that, angle (default, 0°, 90°, 270°) and alignment of each single text, on top of the arrangement. Works for several selected symbols at once |
| **F2** in the device navigator | Renames the device (all its functions) |
| **F2** in the page navigator | Renames the page |
| **Ctrl+H** | Find and replace across the project |

Inline editing edits the current display language. Other languages are
edited in the properties dialog.

### What happens when a tag is changed

Changing a tag can mean "rename this device" or "move this contact to another
device". The editor decides by function:

- **Main function** (coil, contactor, breaker): the whole device is renamed.
  The coil and all its contacts change together. The properties dialog says
  which of the two cases applies.
- **Auxiliary function** (contact, PLC I/O point): only this function changes,
  so it moves to the other device. Autocomplete lists the existing devices,
  and the contact images of both devices update.

### Bulk renaming

- **Find and replace (Ctrl+H)** in tags, function texts, page descriptions
  and free texts. Filters: whole project, current page or selection; text
  type; language. Shows a preview of all changes and applies them as one undo step.
- **Renumber devices** renames devices by the current page and column
  (`-5K3`, `-5K3.1`, …). First choose the pages (all by default), then review
  the list of changes (before → after); unchecked devices keep their names
  and the others are numbered around them. Applied as one undo step.
- **Pages tab** is a tree: function (=, with description) → location (+) →
  pages, shown by their short name (the full name is the tooltip). Click a
  function or location to fold it (remembered).
- **Structure** (Project settings → Structure): functions (=) and locations
  (+) with description and order; "Add codes used in the project" fills the
  lists. The order sorts the pages. The move arrows then move a page
  only within its function/location (disabled at the border); to move it to
  another group, change its structure in the page properties.
- **Renumber pages** (Pages tab, "1‥n"): pages are named prefix + start,
  start + step, … in their order (1, 2, 3 · 1.1, 1.2 · 10, 20, 30). Pages
  selected in the Pages tab (Ctrl+click, Shift+click for a range) are
  preselected; otherwise all. A preview shows old and new names. The page
  selection in this dialog, in Renumber devices and in the export dialog is a
  tree: ticking a function or location selects all its pages.
- **Multi-select + properties dialog**: fields with the same value are shown,
  differing fields are marked; changing a field sets it on all selected items.

## Line breaks in texts

Texts (function text, technical data, descriptions, translations, the
inline editor) can have several lines: **Ctrl+Enter** inserts a line break,
shown as **¶** in the one-line field. On the drawing and in the PDF the text
continues on the next line; in report tables the lines are joined.

## Languages and translations

- Dialogs show one field per text, for the language chosen in the toolbar;
  the other translations are listed below the field and kept.
- **Languages** (top of the Translations window): add any language code
  (fr, it, pl, de-CH …), remove one (its texts stay in the files) or change
  the order; the first language is the source language.
- **Translations** (toolbar): every text of the project with one column per
  language, identical texts as one row (edited once for all places). Search,
  "Only missing", and a link to where the text is used. **Export CSV/ODS**
  gives a table for a translator; **Import…** reads it back (CSV or ODS),
  matching rows by the first language.

## Placing

- Symbols and macros: click one and then click on the page, or drag it onto
  the page (a ghost shows where it lands).
- Symbol picker (Insert key or toolbar): a tree of Symbols, Devices and Macros,
  each split into categories (Connections, Contacts, Relays …); click a group to
  open or close it (remembered). Searching by name, ID or letter code opens all
  groups with matches.
- **Devices** (top of the Symbols tab): click a device such as "WAGO 750-430"
  or "Relay 2 CO" and place its functions one after another. **Tab** switches
  to the next function (Shift+Tab: previous), e.g. coil → CO 11/12/14 →
  NO 11/14 …, or card overview → DI 1 (pin 1) → DI 2 (pin 5) …; the status bar
  shows which one. After the main function, every function gets the device's
  tag. Select a drawn device and press **Tab** to continue with its functions
  that are not placed yet.
- Corners and T-junctions are one symbol per direction (e.g. "Corner up →
  right", "T-junction left ← down → right"); R and M switch to the symbol for
  the new direction. A placed junction is selected by clicking its point.
  In the editor, corners, T-junctions and crosses show short red lines in
  their directions (2.5 mm, like the blue ones in the symbol icons); wires cover the
  connected ones, so the red ones show open directions. PDF, print and
  exports do not contain them.
- While placing: R rotates, M mirrors, Esc cancels. Autoconnect lines are
  previewed live.
- **Macros** (top of the Symbols tab): click a macro and click on the page;
  the ghost shows it at the cursor. Its devices get new names, contacts follow
  their coil. **Save macro** (toolbar) saves the selected items as a macro in
  the project and, in the desktop app, in the shared library folder.
- **Text** (Symbols → Texts): click on the page and type; Enter starts a new
  line, Ctrl+Enter applies. Alignment (left, centered, right, to the clicked
  point), color (default black) and size; the text is multilingual (one field
  for the toolbar language, all languages in the Translations window).
  Double-click or F2 edits it; Cancel on a new, empty text removes it.
- **Copy/paste** (Ctrl+C/V): the copy follows the mouse until a click places
  it (Esc cancels). **X** keeps it at the original's x position (it moves only
  up and down), **Y** at the original's y position; press again to release.
  Copied devices get new names and the copied contacts move with them.
- A main function gets its name automatically (`-5K3`). An auxiliary function
  joins the device of the nearest device symbol to its left at the same
  height; if there is none, the editor asks for its device, with
  autocomplete of existing devices.
- The same holds later: unchecking **Master** of a symbol (e.g. the second
  contact block of an e-stop drawn right of the first) or clearing the device
  name of a contact makes it join the device to its left, with
  cross-references both ways. A former master keeps its name if other
  symbols still belong to it.
- A slave drawn right of a symbol of the same device (same height) does not
  repeat the device name; it shows only its own texts and cross-reference.
  "Show device name next to its device" in the symbol's properties shows it
  anyway (off by default).

## Master and slaves

The **Master** checkbox in the properties dialog marks the main function of a
device (coil, card master …). The master carries the device data and shows
cross-references to all slaves; slaves (contacts, I/O points) show only the
cross-reference to the master. The **Function** field (per language) says
what a symbol is used for, e.g. "Motor 1 rechts".

## PLC

- **Settings → PLCs:** the PLCs of the project with family (Siemens,
  Codesys, Mitsubishi), variant (I/Q or E/A; FX octal or iQ-R hex) and
  first addresses for numbering.
- **Card properties:** PLC, slot, start addresses (typed in the PLC's
  notation, e.g. `E10.0`, `%IX4.0`, `X40`) and the channel table with derived
  addresses, tag names and functions (grey: inherited).
- **I/O point properties:** the card channel it shows.
- **PLC button:** number start addresses (only missing / all / selected
  cards; optional step between card starts, e.g. 10 for I0.0, I10.0, I20.0) and export the I/O list (CSV), TIA Portal tag table, Codesys GVL or
  GX Works3 labels.
- **PLC tab:** the PLCs with their cards (by slot) and each card's channels
  with address, function and where they are drawn. Cards belong to the
  project, drawn or not (cards are added with ⊞, see below). A card not drawn yet is marked ● orange ("not drawn"); drag it onto a
  page to draw it there. A drawn card shows the cross-reference of its
  drawing (click to jump there); dragging it again draws it once more, which
  is reported as a warning. × removes a card from the project with all its
  drawings; deleting a card's drawing on a page only puts it back into the
  tab. Drag a channel onto a page to place its I/O point. Instead of dragging,
  click an entry and then click on the page. Channels already drawn are
  marked ✓ with their cross-reference and cannot be placed a second time.
  Double-click jumps to the card or the drawn channel; the numbering button
  of a PLC opens address numbering for it.
- **Import tag names** (PLC dialog, "Import…"): reads the tag names of a
  PLC back from its project – TIA Portal tag table (.xlsx), Codesys GVL,
  GX Works3 global labels (tab separated) or Wirewright's I/O list (CSV) –
  and matches the rows to the PLC's channels by address (`%E8.1` matches
  `I8.1`; `%` and leading zeros do not matter). Optionally the comments
  become the channels' functions in the display language. A review lists
  each change (old → new) to leave out single ones, and the rows whose
  address is not a channel. The names are stored on the card master; its
  views follow.
- **Overview pages of a PLC** (button next to the PLC in the PLC tab): new
  pages drawing all of its cards that are not drawn yet, in slot order,
  stacked in columns (as many as fit the frame), named after the last page of
  the cards' structure. The pages are marked as the PLC's overview
  (`properties.plcOverview`); running it again draws only cards added since,
  on a further page, so cards already drawn and wired stay as they are.
- **F5 / F6 / F7:** place a corner (90° junction), a T-junction or an
  interruption point; pressing F5 or F6 again turns the junction.


**Adding cards:** the ⊞ button next to a PLC in the PLC tab opens a picker with
all PLC cards of the device library (WAGO, Beckhoff, Siemens, and your own).
Search by part number or name; the full name shows as tooltip, and the card
under the mouse is previewed with its DI/DO/AI/AO counts and terminals. Add
with double-click or Enter; the dialog stays open, so a whole I/O station is put
together in a row. Each card gets the PLC, the next slot and the next free tag
(-A<n> beside the PLC's other cards) and is not drawn yet. Undo removes the last
card.

## Cables and wires

- **Cable:** choose "Cable" in the Symbols tab and drag a line across the
  conductors (horizontal or vertical). The properties dialog opens: type
  (e.g. `5G1.5`), "Generate cores from type" (numbered or colored), cross-
  section, outer diameter, length, shield, the core table with the wire each
  core carries. Cable types are also in the device library (Devices).
  A further line for the same cable on another page: properties → "Move to
  cable".
- **Wire marker:** place "Verbindungsdefinitionspunkt" (wire marker) on a
  connection line: it shows the wire number and holds number, color,
  cross-section or cable core of that conductor.
- **Wires button:** number format, "Number wires" (keep existing or
  renumber; project or current page), and the list of all wires.

## Terminal strips

- **Terminals button:** choose a strip; the table lists its terminals in
  order with external and internal targets and the page. Designation and
  bridge label are edited in place; the page link jumps to the terminal.
  "Renumber strip" numbers the terminals from the given start with the given
  step (1, 2, 3 or 10, 20, 30) in drawing order (PE, N … stay).
- The properties dialog of a terminal also has designation and bridge.
- **Macros → Terminals, bridged** (1 … 20 terminals) and **Terminals with 3
  connections, bridged** (one feed above, two outgoing below): numbered
  terminals side by side with one bridge, e.g. a 24V distribution. Placed on
  a strip that already has terminals, the numbering continues and the bridge
  gets a free label (also when pasting terminals).

## Device library

- **Library button:** shows the library; in the desktop app choose the shared
  library folder (e.g. on a network drive).
- **Devices tab → ⇢ Library** on a device: save it as a device definition in
  the project (and the shared folder).

## Boxes

- **Structure box:** drag a rectangle, enter `=` and/or `+`. Turquoise,
  dash-dotted. Everything inside takes its structure.
- **Device box:** drag a rectangle; it gets a device name (`-A5`). Add pins
  (side, offset, designation) and links in the properties dialog
  (double-click the box border); F2 on a pin text edits its designation.
  Symbols placed inside become functions of the box device. Drawn in the
  symbol color, dashed.
- Boxes are selected by clicking their border. Width and height are set in
  the properties dialog. Moving a box moves everything inside it.

## Pin links

Pin links (which pins pass a potential through a device) are shown, not just
listed:

- **Symbol editor and properties dialog:** linked pins are joined by colored
  lines, one color per link group. Pins that start a new potential show it as
  a label (`→ 24V`). Pins with no link are marked as end points.
- In the properties dialog, links of a device box are entered as pin groups
  (`p1,p2; p3,p4`); the diagram updates as you type.
- **Schematic view (toggle, L):** shows the links of all symbols on the page
  as thin overlay lines, to trace why a potential reaches where it does.

## Problems

- Errors and warnings are marked on the canvas with a red or orange dot next
  to the item; the **Issues** tab lists all problems (hints such as open
  connection points on request). Click an entry to jump to it.
- While dragging, connections and potentials update live: a magenta line
  means two potentials would be connected (short circuit).


A problem that is intended — e.g. a PLC input wired to a coil's A1 that a
pushbutton switches — can be **acknowledged**: hover the problem in the Issues
tab, click ✓ and give a reason. It stays in the list, greyed out with the
reason, and no longer counts in the tab or shows a marker on the drawing. ↺
takes it back. Acknowledgements are saved in the project (`acknowledged` in
`project.json`).

## Files and export

| Action | Result |
|---|---|
| Ctrl+S | Save (only changed files are written) |
| Closing with unsaved changes | The desktop app asks: **Save** (then closes), **Discard changes** (closes without saving) or **Cancel** (stays open). The browser shows its own "leave page?" question. |
| Ctrl+O | Open a project folder |
| Save as archive (File) | The whole project in one file `<name>.wirewright.zip`: project.json, pages, library.json – with the symbols, frames, devices and parts it uses from the shared library folder – and a manifest. For sending, e-mail, backup |
| Open archive (File, welcome screen) | The desktop app unpacks it into an empty folder you choose and opens it there; the browser keeps it in memory |
| Welcome screen (desktop) | The 10 most recently opened projects: click to open, × removes one from the list (the folder stays). Moved or deleted folders are shown as "not found". |
| PDF (desktop) | Opens the export dialog: pages (preselected from the Pages tab, otherwise all), black and white, location (default: the project folder's `doc` subfolder, created if needed; "Choose…" picks another). PDF with clickable cross-references and bookmarks |
| Print (desktop) | The same dialog without location; A3 landscape |
| SVG (browser) | The same dialog; one SVG download per sheet |
| CSV | Current report page as CSV (`;` separated, UTF-8) |

When the project files change on disk (another program, git, or an AI
through MCP), the editor reloads them. If you have unsaved changes, it asks
first.

## View

| Key | Result |
|---|---|
| Mouse wheel | Zoom at cursor |
| Middle mouse drag / Space + drag | Pan |
| Home | Fit page |
| G | Cycle snap grid 1 → 2 → 4 → 8 mm |
| Page Up / Page Down | Previous / next page |
