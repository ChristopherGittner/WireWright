// Detached tabs: a sidebar panel shown in its own browser window (e.g. on a second screen).
// The window belongs to the same page (same-origin child window), so the panel uses the same
// store: the open project, undo history and selection are shared, and drag and drop works
// between the windows. A separate React root renders into the child window, so its events work.
import { StrictMode, useEffect, useRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { StoreContext, type EditorStore } from './store.js';

/** Copies the editor's stylesheets into the child window (absolute URLs: its base is about:blank). */
function copyStyles(target: Document): void {
  for (const node of document.querySelectorAll('style, link[rel="stylesheet"]')) {
    if (node instanceof HTMLLinkElement) {
      const link = target.createElement('link');
      link.rel = 'stylesheet';
      link.href = new URL(node.getAttribute('href') ?? '', document.baseURI).href;
      target.head.append(link);
    } else {
      const style = target.createElement('style');
      style.textContent = node.textContent;
      target.head.append(style);
    }
  }
}

interface Props {
  store: EditorStore;
  /** Window name (one window per tab). */
  name: string;
  title: string;
  /** Called when the window is closed (by the user or because it could not be opened). */
  onClose: () => void;
  children: ReactNode;
}

/** Renders `children` into a separate window while mounted; closing the window calls onClose. */
export function PanelWindow({ store, name, title, onClose, children }: Props) {
  const root = useRef<Root | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const child = window.open('', `wirewright-panel-${name}`, 'width=380,height=760');
    if (!child) {
      store.notify('The window could not be opened (blocked by the browser?)', true);
      close.current();
      return;
    }
    child.document.title = `${title} – Wirewright`;
    copyStyles(child.document);
    child.document.body.className = 'panel-window';
    const container = child.document.createElement('div');
    container.className = 'panel-window-root';
    child.document.body.append(container);
    root.current = createRoot(container);
    const closed = () => close.current();
    child.addEventListener('pagehide', closed);
    // Closing the main window closes the panel windows too.
    const closeChild = () => child.close();
    window.addEventListener('pagehide', closeChild);
    return () => {
      child.removeEventListener('pagehide', closed);
      window.removeEventListener('pagehide', closeChild);
      const r = root.current;
      root.current = null;
      // Unmount after React finished the current render.
      setTimeout(() => r?.unmount(), 0);
      child.close();
    };
  }, [name, title, store]);

  useEffect(() => {
    root.current?.render(
      <StrictMode>
        <StoreContext.Provider value={store}>
          <div className="panel-window-content">{children}</div>
        </StoreContext.Provider>
      </StrictMode>,
    );
  });
  return null;
}
