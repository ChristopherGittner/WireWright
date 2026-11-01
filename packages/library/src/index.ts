// The Wirewright standard library. All definitions are JSON files (ADR-008) and are
// validated when the library is created.
import { MapLibrary, parseLibraryContent, type LibraryContent } from '@wirewright/core';
import boxes from './symbols/boxes.json' with { type: 'json' };
import connections from './symbols/connections.json' with { type: 'json' };
import consumers from './symbols/consumers.json' with { type: 'json' };
import contacts from './symbols/contacts.json' with { type: 'json' };
import plc from './symbols/plc.json' with { type: 'json' };
import cables from './symbols/cables.json' with { type: 'json' };
import devices from './devices/devices.json' with { type: 'json' };
import plcWago from './devices/plc-wago.json' with { type: 'json' };
import plcBeckhoff from './devices/plc-beckhoff.json' with { type: 'json' };
import plcSiemens from './devices/plc-siemens.json' with { type: 'json' };
import protection from './symbols/protection.json' with { type: 'json' };
import relays from './symbols/relays.json' with { type: 'json' };
import fluid from './symbols/fluid.json' with { type: 'json' };
import pipes from './symbols/pipes.json' with { type: 'json' };
import forms from './forms/forms.json' with { type: 'json' };
import frames from './frames/frames.json' with { type: 'json' };
import templates from './templates/templates.json' with { type: 'json' };
import macros from './macros/macros.json' with { type: 'json' };
import terminalMacros from './macros/terminals.json' with { type: 'json' };

let content: LibraryContent | undefined;

/** The validated standard library content. */
export function standardLibraryContent(): LibraryContent {
  content ??= parseLibraryContent({
    symbols: [...relays, ...contacts, ...protection, ...consumers, ...plc, ...cables, ...connections, ...fluid, ...pipes, ...boxes],
    frames,
    templates,
    forms,
    devices: [...plcWago, ...plcBeckhoff, ...plcSiemens, ...devices],
    macros: [...macros, ...terminalMacros],
  });
  return content;
}

/** The standard library, optionally overridden by project-local content. */
export function createStandardLibrary(...overrides: LibraryContent[]): MapLibrary {
  return new MapLibrary(standardLibraryContent(), ...overrides);
}

export { createDemoProject } from './demo.js';
