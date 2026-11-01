// Building blocks of the dialogs: modal frame, labelled fields, multilingual fields.
import type { LocalizedText } from '@wirewright/core';
import { useEffect, type ReactNode } from 'react';
import { tr } from '../i18n.js';
import { LineInput, showBreaks } from '../lineInput.js';
import { useEditor, useStore } from '../store.js';

/** A copy of `set` with `value` added (on) or removed. */
export function toggle<T>(set: ReadonlySet<T>, value: T, on: boolean): Set<T> {
  const next = new Set(set);
  if (on) next.add(value);
  else next.delete(value);
  return next;
}

/** Shown for a value that differs between the selected items; left alone, it stays as it is. */
export const MIXED = '<-->';

export function Modal({
  title,
  children,
  onOk,
  okLabel = 'OK',
  wide,
  full,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  onOk?: () => void;
  okLabel?: string;
  wide?: boolean;
  /** Nearly the whole window (editors). */
  full?: boolean;
  /** Called instead of just closing (Cancel, Esc, click outside). */
  onCancel?: () => void;
}) {
  const store = useStore();
  const close = () => (onCancel ? onCancel() : store.set({ dialog: null }));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && store.set({ dialog: null });
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      {/* noValidate: number steps are only for the arrow keys; a value like 1.5 mm² must not block OK. */}
      <form
        noValidate
        className={full ? 'modal full' : wide ? 'modal wide' : 'modal'}
        onSubmit={(e) => {
          e.preventDefault();
          onOk?.();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') close();
        }}
      >
        <h3>{title}</h3>
        <div className="modal-body">{children}</div>
        <div className="modal-buttons">
          <button type="button" onClick={close}>
            {onOk ? tr('Cancel') : tr('Close')}
          </button>
          {onOk && (
            <button type="submit" className="primary">
              {okLabel}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function texts(text: LocalizedText | undefined, languages: string[]): Record<string, string> {
  return Object.fromEntries(languages.map((l) => [l, typeof text === 'string' ? text : (text?.[l] ?? '')]));
}

export function toLocalized(values: Record<string, string>): LocalizedText | null {
  const entries = Object.entries(values).filter(([, v]) => v !== '');
  return entries.length === 0 ? null : Object.fromEntries(entries);
}

/**
 * One multilingual text: a single field for the language selected in the toolbar. The other
 * languages are kept and shown below; they are edited in the Translations window.
 */
export function LanguageFields({
  label,
  values,
  onChange,
  mixed,
}: {
  label: string;
  values: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  /** Languages whose value differs between the edited items (shown as <-->). */
  mixed?: ReadonlySet<string>;
}) {
  const selected = useEditor((s) => s.language);
  const language = selected in values ? selected : (Object.keys(values)[0] ?? selected);
  const others = Object.entries(values).filter(([l, v]) => l !== language && v !== '');
  return (
    <Field label={`${label} (${language})`}>
      <LineInput value={values[language] ?? ''} placeholder={mixed?.has(language) ? MIXED : undefined} onChange={(v) => onChange({ ...values, [language]: v })} />
      {others.length > 0 && <span className="translations-hint">{others.map(([l, v]) => `${l}: ${showBreaks(v)}`).join(' · ')}</span>}
    </Field>
  );
}

