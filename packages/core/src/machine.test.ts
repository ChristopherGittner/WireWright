import { describe, expect, it } from 'vitest';
import { projectDefaults, readMachineSettings } from './machine.js';
import { createProjectState, defaultPotentials, defaultSettings } from './project.js';

describe('machine settings', () => {
  it('new projects use the machine defaults for settings and potentials', () => {
    const settings = { ...defaultSettings(), languages: ['en', 'fr'], displayLanguage: 'fr' };
    const potentials = [{ name: 'L+', type: '+' as const, voltage: '24 V DC' }];
    const defaults = projectDefaults({ newProject: { settings, potentials } });
    const state = createProjectState({ name: 'P', ...defaults });
    expect(state.project.settings.languages).toEqual(['en', 'fr']);
    expect(state.project.settings.displayLanguage).toBe('fr');
    expect(state.project.potentials).toEqual(potentials);
    // a copy: changing the project does not change the defaults
    state.project.potentials[0]!.name = 'changed';
    expect(defaults.potentials[0]!.name).toBe('L+');
  });

  it('falls back to the built-in defaults', () => {
    expect(projectDefaults(undefined)).toEqual({ settings: defaultSettings(), potentials: defaultPotentials() });
    expect(projectDefaults({ newProject: { potentials: [{ name: '', type: 'L' }] } }).potentials).toEqual(defaultPotentials());
  });

  it('reading keeps the valid parts', () => {
    expect(readMachineSettings({ uiLanguage: 'de', newProject: { settings: { broken: true }, potentials: [{ name: 'PE', type: 'PE' }] } })).toEqual({
      uiLanguage: 'de',
      newProject: { potentials: [{ name: 'PE', type: 'PE' }] },
    });
    expect(readMachineSettings('nonsense')).toEqual({});
  });

  it('named languages still show the first one by default', () => {
    expect(createProjectState({ name: 'P', languages: ['en', 'de'] }).project.settings.displayLanguage).toBe('en');
  });
});
