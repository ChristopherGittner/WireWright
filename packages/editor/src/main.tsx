import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import type { ProjectHost } from './host.js';
import { createBrowserHost } from './hosts/browser.js';
import { setUiLanguage } from './i18n.js';
import { EditorStore, StoreContext } from './store.js';
import './styles.css';

declare global {
  interface Window {
    /** Provided by the desktop app's preload script. */
    wirewrightHost?: ProjectHost;
  }
}

const host = window.wirewrightHost ?? createBrowserHost();
const store = new EditorStore(host);
// Exposed for debugging and end-to-end tests.
(window as unknown as { wirewrightStore: EditorStore }).wirewrightStore = store;

setUiLanguage(undefined);
void host.machineSettings().then((machine) => {
  setUiLanguage(machine.uiLanguage);
  store.set({ machine });
});
void host.initial().then((initial) => initial && store.open(initial.project));

// Unsaved changes: the browser asks before leaving; the desktop app shows its own question
// (Save / Discard changes / Cancel) and calls back here for "Save".
window.addEventListener('beforeunload', (e) => {
  if (store.state.dirty) e.preventDefault();
});
// MCP live mode (desktop app): AI assistants read the open project and change it in one undo step.
host.onLiveRequest?.(async (kind, payload) => {
  const { doc, project } = store.state;
  if (kind === 'state') return doc ? { state: doc.state, ...(project?.folder ? { folder: project.folder } : {}) } : null;
  if (kind === 'apply') {
    const { label, patches, inverse } = payload as { label: string; patches: never[]; inverse: never[] };
    store.applyStep(label, patches, inverse);
    return true;
  }
  throw new Error(`Unknown request ${kind}`);
});
host.onSaveAndClose?.(async () => {
  await store.save();
  return !store.state.dirty;
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreContext.Provider value={store}>
      <App />
    </StoreContext.Provider>
  </StrictMode>,
);
