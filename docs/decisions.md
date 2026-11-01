# Architecture decisions

Each entry records a decision, the alternatives considered, and why.

## ADR-001: TypeScript as the implementation language

**Decision:** TypeScript for the whole application.

**Alternatives:** C++/Qt, C#/.NET (Avalonia), Rust.

**Reasons:**
- Fastest UI development; large contributor pool.
- Performance is not a constraint at the target size. A 100-page project has
  roughly 5,000–15,000 symbols and 30,000 connection points. Full connectivity
  analysis and cross-reference rebuilds take milliseconds, and only one page
  is rendered at a time.
- Performance depends on design: incremental updates, indexed lookups,
  rendering only the visible page, virtualised lists.
- If a hot spot appears later (e.g. wire routing), that function can move to
  WebAssembly (C++/Rust) without rewriting the app.

**Trade-offs accepted:** higher baseline RAM and slower startup than a native Qt app.

## ADR-002: Electron as the desktop shell

**Decision:** Electron.

**Alternatives:** Tauri, browser-only.

**Reasons:** bundled Chromium gives identical rendering (and identical PDF/print
output) on every OS, and the backend stays in TypeScript, so there is no Rust to maintain.

**Trade-offs accepted:** installer of about 100 MB and 150–300 MB RAM baseline.

**Note:** the editor must not depend on Electron APIs directly. File access goes
through a small storage interface so a browser build stays possible.

## ADR-003: Autoconnect wiring

**Decision:** connections are derived automatically from symbol placement
rather than drawn as free wires.

**Alternatives:** explicit drawn wires (KiCad style), both.

**How it works:**
- Two open connection points on the same page connect automatically when they
  face each other on the same horizontal or vertical line with nothing in between.
- The connection lines are computed, not stored. Moving a symbol re-routes them.
- Branching and corners are expressed with **connection symbols** (corner,
  T-junction, cross) placed on the grid. A T-junction defines which way the
  branch goes, so the connection is unambiguous.
- Connections leave the page through **interruption points** (same name = same
  connection) and **potential points** (L1, L2, L3, N, PE, 24V, 0V).
- **Break points** (`Abbruchstellen`) end a connection on purpose and stop
  autoconnect between aligned points that must not connect.

**Consequences:**
- Connectivity is a derived index computed per page, then joined across pages
  by interruption and potential points.
- The editor must show the computed connections live while symbols are moved.
- Ambiguous or crossing situations must be detected and highlighted rather than guessed.

## ADR-004: Project stored as a folder of JSON files

**Decision:** a project is a folder, one file per page plus project-level files.

**Alternatives:** single JSON file, SQLite.

**Proposed layout** (details are settled when the data model is designed):

```
MyMachine.wirewright/
├── project.json        # metadata, settings, page order
├── pages/
│   ├── 6f1c…a2.json    # one file per page, named by a stable page ID
│   └── …
└── symbols/            # project-local symbol definitions (optional)
```

**Rules:**
- File names use stable IDs, not page numbers, so renumbering pages does not
  rename files and the git diffs stay small.
- Derived data (cross-references, connections, reports) is never saved. It is
  recomputed on load.
- JSON is written with stable key order and indentation for clean diffs.

## ADR-005: GPL-3.0-or-later license

**Decision:** GNU GPL v3.0 or later.

**Reasons:** keeps Wirewright and any distributed modifications open source.

## ADR-006: Standards

**Decision:** IEC/EN only for stage 1: IEC 60617 symbols, IEC 81346 reference
designations (`=Function +Location -Device`), IEC 61082 drawing conventions.

**Note:** all symbols are drawn from scratch to the IEC standard. No symbol
libraries, file formats or branding are copied from commercial ECAD products.

## ADR-007: AI drawing through an MCP server

**Decision:** Wirewright provides a Model Context Protocol (MCP) server so AI
assistants can read and edit projects.

**Architecture consequences (apply from the first line of code):**
- **Headless core.** The data model, autoconnect, cross-references and
  validation live in `packages/core` with no UI or Electron dependency.
- **Command API.** Every change to a project is a serialisable command
  (`placeSymbol`, `moveSymbol`, `setDeviceTag`, …). The editor UI, the MCP
  server, undo/redo and later macros/scripting all use the same commands.
  Anything the UI can do, the API can do.
- **Batches.** A list of commands is applied atomically and becomes one undo
  step, so one AI request can be undone as a whole.
- **Headless rendering.** Page rendering to SVG lives in a shared package, so
  the MCP server can return a picture of a page and the AI can check its own work.

**Tool design principles:**
- AI models are good at circuit topology and poor at coordinates. Tools work in
  grid units and page columns, not millimetres. Autoconnect helps: symbols placed
  on the same line connect without wires being drawn.
- Read tools return structured data (symbols, tags, computed connections), not
  just images.
- A validation tool reports problems (open connection points, duplicate tags,
  ambiguous connections) so the AI can fix its own mistakes.
- Later: high-level tools that take a circuit description (a current path such as
  `L1 → -F1 → -S1 → -K1:A1/A2 → N`) and lay it out automatically.

**Planned tool set (first version):**

| Kind | Tools |
|---|---|
| Read | `get_project`, `list_pages`, `get_page`, `list_devices`, `search_symbols`, `list_templates` |
| Check | `check_project`; `render_page` (PNG/SVG) once rendering exists |
| Write | `create_project`, `create_page`, `place_symbol`, `move_items`, `delete_items`, `set_tag`, `set_properties`, `rename_device`, `renumber_devices` |
| Batch | `apply_commands` (several commands as one undo step) |

Connection symbols, interruption points, break points, potential points and
boxes are ordinary symbols placed with `place_symbol`. The current tool list
is in [mcp.md](mcp.md).

**Modes:**
1. **Project folder mode** (first): standalone stdio server that edits a
   project folder on disk. The desktop app watches the folder and reloads on
   external changes.
2. **Live mode** (later): the server runs inside the desktop app (Streamable
   HTTP), so AI edits appear immediately and land in the app's undo history.

**Security:** the server only reads and writes inside the project folder it
was started for.

## ADR-008: Devices derived from symbols, inherited tags, JSON symbols

**Decisions:**
1. **Devices are derived.** All symbol instances with the same effective tag
   form one device. Device data (parts, technical data) is stored on the
   device's main function. There is no `devices.json`.
2. **Tags are inherited.** A symbol stores only the tag aspects (`=`, `+`, `-`)
   that differ from its page.
3. **Symbols are JSON definitions** from the start, so a symbol editor later
   only edits JSON.

**Reasons:** one source of truth (nothing to keep in sync), moving a page to a
new location re-tags its devices automatically, and an AI only has to place
symbols with tags, with no separate device list to manage.

Details: [data-model.md](data-model.md).

## ADR-009: One renderer for screen, PDF and AI; editor hosts

**Decision:** `@wirewright/render` turns a page into a *scene*, a flat list of
drawing primitives in millimetres with metadata (item, text field, link
target). The editor draws the scene as SVG elements, `@wirewright/pdf` as PDF
graphics with link annotations, and the MCP server as SVG or PNG.

The editor talks to its environment through a small host interface (open
folders, save files, PDF export, print). The desktop app implements it over
Electron IPC; the browser host uses a demo project, the File System Access
API and downloads.

**Reasons:** what the user sees, what is printed and what the AI checks are
always the same drawing; the editor stays a plain web app.
