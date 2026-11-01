// One-line text fields that can hold line breaks: a break is shown as ¶ (pilcrow) and entered
// with Ctrl+Enter (or by typing ¶).
import type { InputHTMLAttributes, KeyboardEvent } from 'react';

export const PILCROW = '¶';

/** The text as shown in a one-line field. */
export function showBreaks(text: string): string {
  return text.replace(/\r?\n/g, PILCROW);
}

/** The text from a one-line field. */
export function readBreaks(shown: string): string {
  return shown.replaceAll(PILCROW, '\n');
}

/**
 * Ctrl+Enter in a one-line field: inserts a line break (¶) at the cursor. Returns true when it
 * did, so the caller does not treat the key as Enter.
 */
export function insertBreak(e: KeyboardEvent<HTMLInputElement>): boolean {
  if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return false;
  e.preventDefault();
  const el = e.currentTarget;
  el.setRangeText(PILCROW, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length, 'end');
  // Let React (controlled fields) see the new value.
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: string; onChange: (value: string) => void };

/** A controlled one-line text field with line breaks (¶, Ctrl+Enter). */
export function LineInput({ value, onChange, onKeyDown, title, ...rest }: Props) {
  return (
    <input
      {...rest}
      title={title ?? 'Ctrl+Enter: line break (¶)'}
      value={showBreaks(value)}
      onChange={(e) => onChange(readBreaks(e.target.value))}
      onKeyDown={(e) => {
        if (!insertBreak(e)) onKeyDown?.(e);
      }}
    />
  );
}
