# AI access through MCP

Wirewright includes an MCP server (`@wirewright/mcp-server`) so AI assistants such as
Claude can read and edit a project. Design: [ADR-007](decisions.md).

The server works in **project folder mode**: it is started for one project
folder, loads the project from disk on every tool call, and writes back only
the files that changed. It cannot read or write outside that folder.

## Setup

Build once:

```sh
pnpm install
pnpm build
```

**Claude Code:**

```sh
claude mcp add wirewright -- node /path/to/wirewright/packages/mcp-server/dist/main.js --project /path/to/MyMachine.wirewright
```

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "wirewright": {
      "command": "node",
      "args": ["/path/to/wirewright/packages/mcp-server/dist/main.js", "--project", "/path/to/MyMachine.wirewright"]
    }
  }
}
```

If the folder is empty, ask the assistant to create a project; it uses the
`create_project` tool.

## Live mode (desktop app)

Instead of a project folder, the MCP server can work on the project open in
the desktop app: Machine settings → AI assistants (MCP) → "Let AI assistants
work on the open project". The app then serves MCP over Streamable HTTP at
`http://127.0.0.1:3920/mcp` (port adjustable), on this computer only, and
every request needs the access token shown there:

```sh
claude mcp add --transport http wirewright http://127.0.0.1:3920/mcp --header "Authorization: Bearer <token>"
```

All tools work the same. Each tool call reads the state open in the editor
window, runs on a copy and hands its changes back as **one undo step** ("AI
(MCP)"): the drawing updates at once, Ctrl+Z undoes what the assistant did,
and the project is saved as usual (the changes count as unsaved until then).
`create_project` is refused while a project is open.

## Tools

| Tool | What it does |
|---|---|
| `create_project` | Creates a new project in the empty folder |
| `get_project` | Name, settings, potentials, pages, frame geometry (columns, drawing area), device and issue counts |
| `list_pages` | All pages in order |
| `get_page` | All items of a page with position (`/5.3`), effective tag, properties and connection points in absolute page coordinates |
| `search_symbols` | Library symbols by ID, name (any language), function or letter code |
| `list_templates` | Device templates (e.g. `relay.2co`) |
| `list_devices` | Devices with their functions and where they are placed |
| `acknowledge_issues` | Marks problems (by `key` from check_project) as intended, with a reason; `undo` takes it back |
| `check_project` | Problems: devices without or with several main functions, open or ambiguous connections, potential conflicts (short circuits), contact overuse, missing translations |
| `render_page` | Picture of a page (PNG, or SVG) with connection lines colored by potential, optionally with pin links |
| `get_report` | Rows of a report page (table of contents, device directory, BOM, terminal list) |
| `create_page` | New schematic page with name, description and structure (`=` / `+`) |
| `create_report_page` | New report page that is always up to date |
| `set_page` | Page name, description, structure, properties (revision, date) |
| `place_symbol` | Places a symbol; main functions are named automatically (`-5K3`); contacts take the given tag, or that of the nearest device to their left at the same height; `props` sets further properties (e.g. terminal designation and bridge) |
| `draw_current_path` | Lays out a vertical current path in a column: potential at the top, symbols top to bottom on one line, potential at the bottom; autoconnect wires it |
| `connect_pins` | Joins two pins that are not on one line with corner symbols (L or Z route) |
| `create_revision` | Releases a revision: marks changed pages in the title block, keeps a snapshot for comparing |
| `get_changes` | New, changed and deleted pages and items since a revision |
| `move_items` | Moves items; boxes move with their contents |
| `delete_items` | Deletes items |
| `set_tag` | Changes a tag: on a main function the device is renamed, on a contact the contact moves to another device |
| `set_properties` | Function text, properties, connection designations |
| `rename_device` | Renames a device by its full tag |
| `renumber_devices` | Renames devices by page and column; returns the changes (before → after); `dryRun` only lists them, `exclude` keeps names |
| `apply_commands` | Any core commands as one atomic step |
| `list_device_definitions` | Device library: relays, contactors, PLC cards (WAGO, Beckhoff, Siemens …) with their functions and channels |
| `place_device_function` | Places one function of a device definition (card overview, DI 2, coil, contact …); copies the definition into the project |
| `set_plc` | Creates, changes or removes a PLC station (Siemens, Codesys, Mitsubishi FX/iQ-R) |
| `add_plc_card` | Adds an I/O card, CPU or coupler from the device library to a PLC (next slot, next tag) without drawing it |
| `place_plc_card` | Draws a card of the project on a page (a second drawing is reported) |
| `set_card` | Assigns an I/O card to a PLC, with slot and start addresses |
| `number_plc_addresses` | Numbers start addresses per PLC (all, given cards, or only missing) |
| `search_parts` | Searches the parts database (prices, suppliers, ERP numbers) |
| `set_part` | Adds or replaces a part in the project's parts database |
| `import_parts` | Imports a BMEcat catalog (ECLASS/ETIM features → dimensions, rated voltage/current; `mapping` for unknown features, `dryRun` to look first) or an ERP table |
| `import_plc_tags` | Tag names (and comments) from a TIA tag table, Codesys GVL, GX Works3 labels or I/O list CSV back into the channels, matched by address; preview unless `apply` |
| `generate_plc_overview` | Overview pages of a PLC with a view of each card; again later adds only missing cards |
| `get_io_list` | All I/O channels with address, tag name, function and where drawn |
| `export_plc` | I/O list CSV, TIA tag table (.xlsx), Codesys GVL, GX Works3 labels |
| `set_cable` | Cable data of a cable line (`wirewright.cable` placed with width/height); cores generated from the type (`5G1.5`) |
| `get_cables` | Cables with each core's wire and connected pins, spare cores |
| `get_wires` | All wires: number, connected pins, color, cross-section, potential, cable core |
| `number_wires` | Writes wire numbers into the wire markers |
| `list_macros` | Macros of the library (reusable circuits) with their size |
| `place_macro` | Places a macro at a position; devices get new names, contacts follow their coil |
| `save_macro` | Saves items of a page as a macro in the project library |
| `get_terminal_strips` | Terminal strips: terminals in order with bridge, external and internal targets, page |
| `renumber_terminals` | Numbers the terminals of a strip in drawing order (PE, N … stay) |
| `create_layout_page` | New cabinet layout page: mounting plate or door, size (real mm) and scale |
| `place_layout_items` | Adds or replaces DIN rails, wire ducts, cutouts and devices (by tag) on a cabinet layout page |
| `move_layout_items` | Moves layout items by real mm |
| `delete_layout_items` | Removes layout items (the devices stay in the schematic) |

Interruption points, break points, potential points, connection symbols and
boxes are ordinary symbols: find them with `search_symbols` (category
`connections` or `boxes`) and place them with `place_symbol`.

The desktop app watches the project folder: changes made through MCP appear
in the open editor automatically.

## Example prompt

> Create page 3 "Conveyor control" in =SG+10. Draw a start button, a stop
> button and a relay that holds itself in, with an indicator lamp. Use a relay
> with 2 changeover contacts.
