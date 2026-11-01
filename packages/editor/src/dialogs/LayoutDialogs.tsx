// Dialogs of the cabinet layout: a new layout page, the plate size and scale, and the properties
// of a rail, duct or device on the plate.
import { layoutFootprint, type Command, type LayoutItem, type LayoutPage } from '@wirewright/core';
import { useState } from 'react';
import { tr } from '../i18n.js';
import { useEditor, useStore } from '../store.js';
import { Field, Modal } from './common.js';

export interface PlateValue {
  width: string;
  height: string;
  scale: string;
}

/** Plate width × height (mm) and the drawing scale 1:n. */
export function PlateFields({ value, onChange }: { value: PlateValue; onChange: (value: PlateValue) => void }) {
  return (
    <div className="tag-fields">
      <Field label={tr('Width (mm)')}>
        <input type="number" min={1} value={value.width} onChange={(e) => onChange({ ...value, width: e.target.value })} />
      </Field>
      <Field label={tr('Height (mm)')}>
        <input type="number" min={1} value={value.height} onChange={(e) => onChange({ ...value, height: e.target.value })} />
      </Field>
      <Field label={tr('Scale 1:')}>
        <input type="number" min={1} value={value.scale} onChange={(e) => onChange({ ...value, scale: e.target.value })} />
      </Field>
    </div>
  );
}

export function NewLayoutDialog() {
  const store = useStore();
  const doc = useEditor((s) => s.doc)!;
  const current = useEditor((s) => s.sheet);
  const currentPage = current ? doc.state.pages[current.pageId] : undefined;
  const numbers = Object.values(doc.state.pages).map((p) => Number.parseInt(p.name, 10)).filter((n) => !Number.isNaN(n));
  const [name, setName] = useState(String(Math.max(0, ...numbers) + 1));
  const [fn, setFn] = useState(currentPage?.structure?.function ?? '');
  const [location, setLocation] = useState(currentPage?.structure?.location ?? '');
  const [plate, setPlate] = useState<PlateValue>({ width: '600', height: '800', scale: '5' });
  const [surface, setSurface] = useState<'plate' | 'door'>('plate');
  const ok = () => {
    const index = current ? doc.state.project.pages.indexOf(current.pageId) + 1 : undefined;
    const structure = { ...(fn.trim() ? { function: fn.trim() } : {}), ...(location.trim() ? { location: location.trim() } : {}) };
    const result = store.apply(
      {
        type: 'createLayoutPage',
        name,
        description: surface === 'door' ? { de: 'Tür', en: 'Door' } : { de: 'Montageplatte', en: 'Mounting plate' },
        ...(surface === 'door' ? { surface } : {}),
        ...(Object.keys(structure).length ? { structure } : {}),
        plate: { width: Number(plate.width) || 600, height: Number(plate.height) || 800 },
        scale: Number(plate.scale) || 5,
        ...(index !== undefined ? { index } : {}),
      },
      'new cabinet layout',
    );
    if (result) {
      store.set({ dialog: null });
      store.navigate(result.created[0]!);
    }
  };
  return (
    <Modal title={tr('New cabinet layout (mounting plate or door)')} onOk={ok} okLabel={tr('Create')}>
      <Field label={tr('Layout of')}>
        <select value={surface} onChange={(e) => setSurface(e.target.value as 'plate' | 'door')}>
          <option value="plate">{tr('Mounting plate')}</option>
          <option value="door">{tr('Door (outside view)')}</option>
        </select>
      </Field>
      <div className="tag-fields">
        <Field label={tr('Page name')}>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label={tr('= Function')}>
          <input list="sg-functions" value={fn} onChange={(e) => setFn(e.target.value)} />
        </Field>
        <Field label={tr('+ Location')}>
          <input list="sg-locations" value={location} onChange={(e) => setLocation(e.target.value)} />
        </Field>
      </div>
      <PlateFields value={plate} onChange={setPlate} />
      <p className="hint">{tr('The devices of the location (e.g. +CAB1) are listed next to the plate for placing. Their size comes from the parts database (width × height).')}</p>
    </Modal>
  );
}

/** Properties of a rail, duct or device on the plate (double-click). */
export function LayoutItemDialog({ pageId, itemId }: { pageId: string; itemId: string }) {
  const store = useStore();
  const doc = useEditor((s) => s.doc)!;
  const page = doc.state.pages[pageId] as LayoutPage | undefined;
  const item = page?.items.find((i) => i.id === itemId);
  const [draft, setDraft] = useState<Record<string, string | boolean>>(() => (item ? toDraft(item) : {}));
  if (!page || !item) return null;
  const num = (key: string) => Number(draft[key]);
  const set = (key: string, value: string | boolean) => setDraft({ ...draft, [key]: value });
  const footprint = item.kind === 'device' ? layoutFootprint(doc.state, store.library, doc.devices(), item, page.surface) : undefined;

  const ok = () => {
    const base = { id: item.id, x: num('x'), y: num('y') };
    let next: LayoutItem;
    if (item.kind === 'rail') next = { ...base, kind: 'rail', length: num('length'), ...(draft.vertical ? { vertical: true } : {}), ...(draft.profile === 'TS15' ? { profile: 'TS15' } : {}) };
    else if (item.kind === 'duct') next = { ...base, kind: 'duct', length: num('length'), width: num('width'), ...(draft.vertical ? { vertical: true } : {}) };
    else if (item.kind === 'cutout') next = { ...base, kind: 'cutout', width: num('width'), height: num('height'), ...(String(draft.label).trim() ? { label: String(draft.label).trim() } : {}) };
    else
      next = {
        ...base,
        kind: 'device',
        itemId: item.itemId,
        ...(draft.turned ? { turned: true } : {}),
        ...(num('width') > 0 ? { width: num('width') } : {}),
        ...(num('height') > 0 && draft.shape !== 'round' ? { height: num('height') } : {}),
        ...(draft.shape === 'round' || draft.shape === 'rect' ? { shape: draft.shape } : {}),
      };
    const command: Command = { type: 'setLayoutItem', pageId, item: next };
    if (store.apply(command, 'layout item')) store.set({ dialog: null });
  };
  const title = item.kind === 'rail' ? tr('DIN rail') : item.kind === 'duct' ? tr('Wire duct') : item.kind === 'cutout' ? tr('Cutout') : (footprint?.device ?? tr('Device'));
  const input = (key: string, label: string, extra: { placeholder?: string } = {}) => (
    <Field label={label}>
      <input type="number" value={String(draft[key] ?? '')} onChange={(e) => set(key, e.target.value)} {...extra} />
    </Field>
  );
  return (
    <Modal title={title} onOk={ok}>
      <div className="tag-fields">
        {input('x', tr('X (mm)'))}
        {input('y', tr('Y (mm)'))}
        {(item.kind === 'rail' || item.kind === 'duct') && input('length', tr('Length (mm)'))}
        {(item.kind === 'duct' || item.kind === 'cutout') && input('width', tr('Width (mm)'))}
        {item.kind === 'cutout' && input('height', tr('Height (mm)'))}
      </div>
      {item.kind === 'cutout' && (
        <Field label={tr('Label')}>
          <input value={String(draft.label ?? '')} onChange={(e) => set('label', e.target.value)} placeholder="HMI" />
        </Field>
      )}
      {item.kind === 'rail' && (
        <Field label={tr('Profile')}>
          <select value={String(draft.profile)} onChange={(e) => set('profile', e.target.value)}>
            <option value="TS35">TS35 (35 mm)</option>
            <option value="TS15">TS15 (15 mm)</option>
          </select>
        </Field>
      )}
      {(item.kind === 'rail' || item.kind === 'duct') && (
        <label className="check">
          <input type="checkbox" checked={draft.vertical === true} onChange={(e) => set('vertical', e.target.checked)} /> {tr('Vertical')}
        </label>
      )}
      {item.kind === 'device' && footprint && (
        <>
          {footprint.part && <p className="hint">{footprint.part}</p>}
          <Field label={tr('Outline')}>
            <select value={String(draft.shape)} onChange={(e) => set('shape', e.target.value)}>
              <option value="">{tr('Automatic ({shape})', { shape: footprint.shape === 'round' ? tr('round') : tr('rectangular') })}</option>
              <option value="rect">{tr('rectangular')}</option>
              <option value="round">{tr('round (diameter = width)')}</option>
            </select>
          </Field>
          {footprint.fromPart ? (
            <p className="hint">{tr('Size from the parts database: {width} × {height} mm', { width: item.turned ? footprint.height : footprint.width, height: item.turned ? footprint.width : footprint.height })}</p>
          ) : (
            <div className="tag-fields">
              {input('width', draft.shape === 'round' || (draft.shape === '' && footprint.shape === 'round') ? tr('Diameter (mm)') : tr('Width (mm)'), { placeholder: String(footprint.width) })}
              {!(draft.shape === 'round' || (draft.shape === '' && footprint.shape === 'round')) && input('height', tr('Height (mm)'), { placeholder: String(footprint.height) })}
            </div>
          )}
          <label className="check">
            <input type="checkbox" checked={draft.turned === true} onChange={(e) => set('turned', e.target.checked)} /> {tr('Turned by 90°')}
          </label>
        </>
      )}
    </Modal>
  );
}

function toDraft(item: LayoutItem): Record<string, string | boolean> {
  const draft: Record<string, string | boolean> = { x: String(item.x), y: String(item.y) };
  if (item.kind === 'rail') Object.assign(draft, { length: String(item.length), vertical: item.vertical === true, profile: item.profile ?? 'TS35' });
  if (item.kind === 'duct') Object.assign(draft, { length: String(item.length), width: String(item.width), vertical: item.vertical === true });
  if (item.kind === 'cutout') Object.assign(draft, { width: String(item.width), height: String(item.height), label: item.label ?? '' });
  if (item.kind === 'device') Object.assign(draft, { turned: item.turned === true, width: item.width !== undefined ? String(item.width) : '', height: item.height !== undefined ? String(item.height) : '', shape: item.shape ?? '' });
  return draft;
}
