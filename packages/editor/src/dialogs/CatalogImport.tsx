// BMEcat import (ECLASS / ETIM): shows the catalog's features with the part field each fills,
// lets the user assign unknown ones (remembered in the machine settings) and imports the products
// into the project's parts database, merged with existing parts.
import { catalogFeatures, catalogParts, FEATURE_TARGETS, mergePart, type Catalog, type FeatureMapping, type FeatureTarget } from '@wirewright/core';
import { useMemo, useState } from 'react';
import { tr } from '../i18n.js';
import { useEditor, useStore } from '../store.js';
import { Modal } from './common.js';

const TARGET_LABELS: Record<FeatureTarget, string> = {
  width: 'Width (mm)',
  height: 'Height (mm)',
  depth: 'Depth (mm)',
  ratedVoltage: 'Rated voltage',
  ratedCurrent: 'Rated current (A)',
  property: 'Keep as property',
  ignore: 'Ignore',
};

export function CatalogImportDialog({ catalog, fileName }: { catalog: Catalog; fileName: string }) {
  const store = useStore();
  const doc = useEditor((s) => s.doc)!;
  const machine = useEditor((s) => s.machine);
  const [mapping, setMapping] = useState<FeatureMapping>(() => ({ ...(machine.catalogFeatures ?? {}) }));
  const [filter, setFilter] = useState('');
  const features = useMemo(() => catalogFeatures(catalog, mapping), [catalog, mapping]);
  const shown = filter ? features.filter((f) => `${f.key} ${f.name ?? ''}`.toLowerCase().includes(filter.toLowerCase())) : features;
  const systems = [...new Set(catalog.products.flatMap((p) => p.classification.map((c) => c.system)))];
  const recognized = features.filter((f) => f.target && f.target !== 'property' && f.target !== 'ignore').length;

  const choose = (key: string, value: string) => {
    const next = { ...mapping };
    if (value === '') delete next[key];
    else next[key] = value as FeatureTarget;
    setMapping(next);
  };

  const ok = async () => {
    const imported = catalogParts(catalog, mapping);
    if (imported.length === 0) return store.notify(tr('No parts found in the file'), true);
    const parts = imported.map((p) => mergePart(doc.library.part(p.id), p));
    if (!store.apply({ type: 'addToProjectLibrary', content: { parts } }, 'import catalog')) return;
    // Remember the assignments for the next catalog.
    const machineNext = { ...store.state.machine, catalogFeatures: mapping };
    store.set({ machine: machineNext, dialog: { kind: 'parts' } });
    try {
      await store.host.saveMachineSettings(machineNext);
    } catch {
      // only kept for this session
    }
    store.notify(tr('{count} part(s) imported', { count: parts.length }));
  };

  return (
    <Modal title={tr('Import catalog (BMEcat)')} onOk={() => void ok()} okLabel={tr('Import {count} part(s)', { count: catalog.products.length })} wide onCancel={() => store.set({ dialog: { kind: 'parts' } })}>
      <p className="hint">
        {fileName}: {catalog.supplier || '?'}, BMEcat {catalog.version}, {tr('{count} product(s)', { count: catalog.products.length })}
        {systems.length > 0 && <> · {systems.join(', ')}</>}
      </p>
      <p className="hint">
        {tr('Features fill part fields: dimensions for the cabinet layout, rated voltage and current for the engineering checks. Recognized: {count}. Assign the others if needed (ECLASS codes differ between versions); your choice is remembered on this computer. Features without a field are kept as part properties.', { count: recognized })}
      </p>
      <input className="catalog-filter" placeholder={tr('Filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="catalog-features">
        <table>
          <thead>
            <tr>
              <th>{tr('Feature')}</th>
              <th>{tr('Example')}</th>
              <th>{tr('Products')}</th>
              <th>{tr('Part field')}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((f) => (
              <tr key={f.key} className={f.target && f.target !== 'property' && f.target !== 'ignore' ? 'mapped' : ''}>
                <td title={f.key}>
                  {f.name ?? f.key}
                  {f.name && <div className="feature-code">{f.key}</div>}
                </td>
                <td>
                  {f.example}
                  {f.unit ? ` ${f.unit}` : ''}
                </td>
                <td>{f.count}</td>
                <td>
                  <select value={mapping[f.key] ?? ''} onChange={(e) => choose(f.key, e.target.value)}>
                    <option value="">{f.target && !f.mapped ? tr('Automatic: {field}', { field: tr(TARGET_LABELS[f.target]) }) : tr('Automatic: {field}', { field: tr(TARGET_LABELS.property) })}</option>
                    {FEATURE_TARGETS.map((t) => (
                      <option key={t} value={t}>
                        {tr(TARGET_LABELS[t])}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={4} className="empty">
                  {tr('No features')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
