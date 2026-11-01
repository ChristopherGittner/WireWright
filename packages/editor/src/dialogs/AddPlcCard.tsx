// Appending I/O cards to a PLC from the PLC tab: pick a device definition (search by part number
// or name; the full name as tooltip, a preview of the card under the mouse); each pick adds the card
// to the PLC with the next slot and tag, not drawn yet (drag it from the PLC tab onto a page). The
// dialog stays open, so a whole I/O station is put together in a row.
import { channelPins, localize, type DeviceDefinition } from '@wirewright/core';
import { useMemo, useState } from 'react';
import { tr } from '../i18n.js';
import { useEditor, useStore } from '../store.js';
import { Modal } from './common.js';

const MAX_SHOWN = 80;

/** Device definitions that are PLC cards (main function is a card master). */
export function plcCardDefinitions(devices: readonly DeviceDefinition[]): DeviceDefinition[] {
  return devices.filter((d) => d.functions.find((f) => f.main)?.symbol === 'wirewright.plc.card' || d.functions[0]?.symbol === 'wirewright.plc.card');
}

export function AddPlcCardDialog({ station }: { station: string }) {
  const store = useStore();
  const doc = useEditor((s) => s.doc)!;
  useEditor((s) => s.version);
  const language = useEditor((s) => s.language);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const all = useMemo(() => plcCardDefinitions(store.library.devices()), [store.library]);
  const name = (d: DeviceDefinition) => localize(d.name, language, ['en']);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const found = all.filter((d) => words.every((w) => [d.id, d.partNumber ?? '', d.manufacturer ?? '', name(d)].some((v) => v.toLowerCase().includes(w))));
  const cards = doc.plc().cards.filter((c) => c.station?.name === station);
  const preview = all.find((d) => d.id === (hovered ?? selected)) ?? null;

  const add = (id: string) => {
    if (store.apply({ type: 'addPlcCard', station, device: id }, 'add PLC card')) {
      const def = store.library.device(id);
      store.notify(tr('{card} added to {plc}', { card: def?.partNumber ?? id, plc: station }));
    }
  };

  return (
    <Modal title={tr('Add cards to {plc}', { plc: station })} onOk={() => store.set({ dialog: null })} okLabel={tr('Done')} wide>
      <div className="add-card">
        <div className="add-card-search">
          <input
            autoFocus
            placeholder={tr('Search: part number or name, e.g. 750-430, EL1008, DI 8')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (selected ?? found[0]?.id)) add((selected ?? found[0]!.id));
            }}
          />
          <ul className="add-card-list" onMouseLeave={() => setHovered(null)}>
            {found.slice(0, MAX_SHOWN).map((d) => {
              const counts = channelCounts(d);
              return (
                <li
                  key={d.id}
                  className={selected === d.id ? 'active' : ''}
                  onClick={() => setSelected(d.id)}
                  onDoubleClick={() => add(d.id)}
                  onMouseEnter={() => setHovered(d.id)}
                  title={`${name(d)}\n${tr('Double-click (or Enter) adds the card')}`}
                >
                  <span className="part">{d.partNumber ?? d.id}</span>
                  <span className="desc">{name(d).replace(/^(WAGO|Beckhoff|Siemens)\s+\S+,\s*/, '')}</span>
                  <span className="kinds">
                    {KINDS.filter((k) => counts[k]).map((k) => (
                      <span key={k} className={`io-kind ${k.toLowerCase()}`}>
                        {counts[k]} {k}
                      </span>
                    ))}
                  </span>
                </li>
              );
            })}
            {found.length > MAX_SHOWN && <li className="empty">{tr('{count} more – narrow the search', { count: found.length - MAX_SHOWN })}</li>}
            {found.length === 0 && <li className="empty">{tr('Nothing found')}</li>}
          </ul>
          <button disabled={!selected} onClick={() => selected && add(selected)}>
            {tr('Add card')}
          </button>
        </div>
        <div className="add-card-side">
          <div className="add-card-preview">{preview ? <CardPreview def={preview} name={name(preview)} language={language} /> : <p className="hint">{tr('Point at a card to see its channels.')}</p>}</div>
          <div className="add-card-station">
          <div className="add-card-title">{tr('{plc}: {count} card(s)', { plc: station, count: cards.length })}</div>
          <ol>
            {[...cards]
              .sort((a, b) => (a.slot ?? 1e9) - (b.slot ?? 1e9))
              .map((c) => (
                <li key={c.itemId} className={c.stored ? 'not-drawn' : ''} title={c.stored ? tr('not drawn') : undefined}>
                  <span className="slot">{c.slot ?? '–'}</span> {c.device}
                  <span className="count">{c.channels.length}</span>
                </li>
              ))}
          </ol>
          </div>
        </div>
      </div>
      <p className="hint">{tr('Each card is added to the PLC with the next slot, not drawn yet: drag it from the PLC tab onto a page, or let "Generate overview pages" draw all cards not drawn yet. Undo removes the last card.')}</p>
    </Modal>
  );
}

const KINDS = ['DI', 'DO', 'AI', 'AO'] as const;

/** Channel counts per kind, e.g. { DI: 4, DO: 4 }. */
function channelCounts(def: DeviceDefinition): Partial<Record<(typeof KINDS)[number], number>> {
  const counts: Partial<Record<(typeof KINDS)[number], number>> = {};
  for (const c of def.plc?.channels ?? []) counts[c.kind] = (counts[c.kind] ?? 0) + 1;
  return counts;
}

/** Preview of a card definition: name, part, channels per kind and their terminals. */
function CardPreview({ def, name, language }: { def: DeviceDefinition; name: string; language: string }) {
  const counts = channelCounts(def);
  const channels = def.plc?.channels ?? [];
  const terminals = channels.reduce((n, c) => n + channelPins(c).length, 0);
  return (
    <div>
      <div className="add-card-title">{name}</div>
      <div className="hint">
        {[def.manufacturer, def.partNumber].filter(Boolean).join(' ')}
        {def.description && <> · {localize(def.description, language, ['en'])}</>}
      </div>
      <div className="add-card-kinds">
        {KINDS.map((k) => (
          <div key={k} className={`add-card-kind ${counts[k] ? '' : 'none'}`}>
            <span className={`io-kind ${k.toLowerCase()}`}>{k}</span>
            <strong>{counts[k] ?? 0}</strong>
          </div>
        ))}
      </div>
      <div className="hint">{tr('{channels} channels, {terminals} terminals', { channels: channels.length, terminals })}</div>
      <table className="add-card-channels">
        <tbody>
          {channels.slice(0, 32).map((c, i) => (
            <tr key={i}>
              <td>{c.label ?? `${c.kind} ${c.channel}`}</td>
              <td>{channelPins(c).join(', ')}</td>
              <td className="hint">{(c.extraPins ?? []).map((p) => p.label).filter(Boolean).join(', ')}</td>
            </tr>
          ))}
          {channels.length > 32 && (
            <tr>
              <td colSpan={3} className="hint">
                … {channels.length - 32}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
