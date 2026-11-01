# Wirewright

**Wirewright** — free electrical plans. An open-source electrical CAD tool for
drawing the electrical plans of machines and control cabinets: schematics,
PLC I/O, cables and wiring, and the lists that are made from them.

The schematic is a view onto a device database. Devices carry IEC 81346
reference designations, coils and contacts cross-reference each other, and
reports such as BOMs, terminal lists, wire lists and PLC I/O lists are
generated from the project data.

> Status: stage 1 is complete; stage 2 has PLC I/O, the device library, cables and wire numbering.
> See [ROADMAP.md](ROADMAP.md) for what comes next.

## Features

- **Schematics to IEC 60617** with 40 symbols, A3 frames with a self-filling
  title block, switchable grid (1/2/4/8 mm)
- **Autoconnect**: symbols that face each other on a line are connected
  automatically; corners, T-junctions, crossings, interruption points
  (`Unterbrechungsstellen`), break points (`Abbruchstellen`), potential points
- **Potentials**: L, N, PE, 24V, 0V … spread along wires and through devices
  and color the lines (L black, N light blue, PE green dashed, 24V/0V dark
  blue, no potential red); short circuits between potentials are reported
- **IEC 81346 tags** inherited from pages, structure boxes and device boxes;
  automatic names by page and column (`-5K3`, `-5K3.1`)
- **Cross-references and contact images** (`Kontaktspiegel`) with jump
  links, overuse warnings
- **Reports that are always up to date**: table of contents, device
  directory, bill of materials, terminal list; multi-sheet; CSV export
- **PLC I/O** for Siemens, Codesys and Mitsubishi: I/O cards of any make
  (WAGO, Beckhoff …) assigned to PLCs, card overview and single I/O points
  as master/slaves, derived addresses, functions inherited from the wired
  sensor, address numbering, exports (I/O list, TIA Portal tag table,
  Codesys GVL, GX Works3 labels)
- **Device library**: devices with all their symbols; place them with Tab
  through coil, contacts, card channels; shared library folder
- **Cables and wires**: cable lines across the conductors, cores from the
  type (`5G1.5`, numbered or colored), automatic core assignment (PE to
  green-yellow); wire numbers per conductor (`5.3.1`) on wire markers; wire
  list, cable overview and cable diagram
- **PDF export** with clickable cross-references and bookmarks
- **Multilingual** texts (e.g. German and English)
- **AI drawing through MCP**: an AI assistant can create pages, place symbols,
  check the project and look at rendered pages
- Projects are **folders of JSON files** that diff and merge in git

## Getting started

Requires Node.js 22.12 or later and pnpm 10.

```sh
pnpm install
pnpm build
```

**Desktop app** (Electron):

```sh
pnpm start                          # build and launch; open or create a project from the app
pnpm start ../projects/MyMachine    # build and open a project folder (relative to where you are)
```

**Browser** (with a demo project; opening folders needs Chrome or Edge):

```sh
pnpm --filter @wirewright/editor dev
```

**AI assistant through MCP:** see [docs/mcp.md](docs/mcp.md).

Keyboard shortcuts and editor operation: [docs/editor.md](docs/editor.md)
(or press `?` in the editor).

## Packages

| Package | Content |
|---|---|
| [`@wirewright/core`](packages/core) | Project model, commands with undo/redo, tags, devices, autoconnect, potentials, cross-references, reports, load/save. No UI. |
| [`@wirewright/library`](packages/library) | Standard library: IEC 60617 symbols, frames, report forms, device templates (JSON), demo project |
| [`@wirewright/render`](packages/render) | Renders pages to drawing primitives and SVG |
| [`@wirewright/pdf`](packages/pdf) | PDF export |
| [`@wirewright/editor`](packages/editor) | Schematic editor (React), for the browser and the desktop app |
| [`@wirewright/desktop`](apps/desktop) | Desktop app (Electron) |
| [`@wirewright/mcp-server`](packages/mcp-server) | MCP server for AI assistants |

## Development

```sh
pnpm test        # unit and integration tests (Vitest)
pnpm typecheck   # TypeScript, including tests and the editor
pnpm lint        # ESLint
pnpm build       # compile all packages and the editor
```

End-to-end tests drive the real desktop app with Playwright (each test gets a
fresh copy of the demo project). Build first; on Linux without a display use
`xvfb-run`:

```sh
pnpm build && pnpm --filter @wirewright/desktop build
pnpm --filter @wirewright/desktop e2e            # xvfb-run -a … on a headless Linux
```

`node packages/library/scripts/benchmark.mjs [copies]` (after `pnpm build`)
measures what one edit costs on a large project (the demo's pages copied, about
250 pages and 3,500 items by default).

GitHub Actions (`.github/workflows/ci.yml`) runs both on every push and pull
request; failed end-to-end runs upload traces and screenshots.

## Documentation

- [ROADMAP.md](ROADMAP.md): stages and features
- [docs/decisions.md](docs/decisions.md): architecture decisions
- [docs/data-model.md](docs/data-model.md): project files, tags, devices, potentials, boxes, reports
- [docs/editor.md](docs/editor.md): editor operation
- [docs/mcp.md](docs/mcp.md): AI access through MCP

## License

Wirewright is licensed under the [GNU General Public License v3.0 or later](LICENSE).

The toolbar icons are [Material Symbols](https://github.com/google/material-design-icons) by Google,
licensed under the Apache License 2.0 (bundled from the `@material-symbols/svg-400` package).
