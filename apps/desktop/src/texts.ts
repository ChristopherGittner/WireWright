// Texts of the desktop app's own dialogs (main process), in the software language from
// Machine settings (like the editor's i18n, keyed by the English wording).
const de: Record<string, string> = {
  Save: 'Speichern',
  'Discard changes': 'Änderungen verwerfen',
  Cancel: 'Abbrechen',
  Create: 'Erstellen',
  'Unsaved changes': 'Ungespeicherte Änderungen',
  'The project has unsaved changes.': 'Das Projekt hat ungespeicherte Änderungen.',
  'Save them before closing? Discarded changes are lost.': 'Vor dem Schließen speichern? Verworfene Änderungen gehen verloren.',
  'Open Wirewright project folder': 'Wirewright-Projektordner öffnen',
  'Choose an empty folder for the new project': 'Einen leeren Ordner für das neue Projekt wählen',
  'Choose the shared library folder': 'Gemeinsamen Bibliotheksordner wählen',
  'Create it?': 'Anlegen?',
  'The folder "{path}" does not exist.': 'Der Ordner „{path}“ existiert nicht.',
  '"{path}" is a file, not a folder.': '„{path}“ ist eine Datei, kein Ordner.',
  '"{path}" does not contain a Wirewright project (project.json is missing).': '„{path}“ enthält kein Wirewright-Projekt (project.json fehlt).',
  '"{path}" already contains a project.': '„{path}“ enthält bereits ein Projekt.',
  '"{path}" is not empty. Choose an empty folder for a new project.': '„{path}“ ist nicht leer. Für ein neues Projekt einen leeren Ordner wählen.',
  'No library folder chosen (Library → Choose folder…)': 'Kein Bibliotheksordner gewählt (Bibliothek → Ordner wählen…)',
  'Open a project archive': 'Projektarchiv öffnen',
  'Choose an empty folder to unpack the project into': 'Einen leeren Ordner wählen, in den das Projekt entpackt wird',
};

let language = 'en';

/** `uiLanguage` from Machine settings; without one, the system language (`locale`, e.g. "de-DE"). */
export function setTextLanguage(uiLanguage: string | undefined, locale: string): void {
  const wanted = uiLanguage ?? locale.slice(0, 2).toLowerCase();
  language = wanted === 'de' ? 'de' : 'en';
}

export function t(text: string, values?: Record<string, string>): string {
  const translated = (language === 'de' ? de[text] : undefined) ?? text;
  return values ? translated.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match) : translated;
}
