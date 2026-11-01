import type { Medium, Potential, ProjectSettings, ProjectState } from './schema.js';

export function defaultSettings(): ProjectSettings {
  return {
    defaultGridMm: 4,
    defaultFrame: 'iec.frame.a3',
    deviceNaming: { scheme: 'pageColumn', format: '{page}{letter}{column}', duplicateSuffix: '.{n}' },
    crossReferences: { format: '/{page}.{column}', structure: 'whenDifferent' },
    contactImage: 'table',
    languages: ['de', 'en'],
    displayLanguage: 'de',
    defaultWire: { color: 'BK', crossSection: 1.5 },
    wireNumbering: { format: '{page}.{column}.{counter}' },
  };
}

export function defaultPotentials(): Potential[] {
  return [
    { name: 'L1', type: 'L', voltage: '400 V AC 50 Hz' },
    { name: 'L2', type: 'L', voltage: '400 V AC 50 Hz' },
    { name: 'L3', type: 'L', voltage: '400 V AC 50 Hz' },
    { name: 'N', type: 'N', wire: { color: 'BU' } },
    { name: 'PE', type: 'PE', wire: { color: 'GNYE' } },
    { name: '24V', type: '+', voltage: '24 V DC', wire: { color: 'BU', crossSection: 0.75 } },
    { name: '0V', type: '-', voltage: '0 V DC', wire: { color: 'WHBU', crossSection: 0.75 } },
  ];
}

/** Media of new projects: compressed air and exhaust. Pipes are gray unless a medium sets a color. */
export function defaultMedia(): Medium[] {
  return [
    { name: 'P', type: 'pressure', pressure: '6 bar' },
    { name: 'R', type: 'exhaust' },
  ];
}

export interface NewProjectOptions {
  name: string;
  languages?: string[];
  displayLanguage?: string;
  /** Settings to start with (e.g. the machine settings' defaults); built-in defaults otherwise. */
  settings?: ProjectSettings;
  potentials?: Potential[];
}

/** A new, empty project with default settings and the default potentials. */
export function createProjectState(options: NewProjectOptions): ProjectState {
  const settings = structuredClone(options.settings ?? defaultSettings());
  if (options.languages) settings.languages = options.languages;
  // Given languages: the first is shown unless another is named.
  const keep = !options.languages && settings.languages.includes(settings.displayLanguage);
  settings.displayLanguage = options.displayLanguage ?? (keep ? settings.displayLanguage : settings.languages[0]!);
  return {
    project: {
      format: 'wirewright-project',
      formatVersion: 1,
      name: options.name,
      properties: {},
      settings,
      potentials: structuredClone(options.potentials ?? defaultPotentials()),
      media: defaultMedia(),
      plcs: [],
      pages: [],
    },
    pages: {},
  };
}
