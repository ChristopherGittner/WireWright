import {
  effectiveTag,
  formatTag,
  itemRole,
  linkGroups,
  localize,
  macroFromItems,
  pageFullName,
  planPageNames,
  usedStructureCodes,
  nextRevisionName,
  findPart,
  parseAmount,
  partId,
  partsTable,
  readPartsTable,
  xlsx,
  tableToCsv,
  type PartDefinition,
  type PartSupplier,
  planPlcTagImport,
  plcTagImportCommands,
  readPlcTags,
  type PlcTagImport,
  ARRANGED_TEXT_FIELDS,
  machineSettingsSchema,
  isBmecat,
  readBmecat,
  projectDefaults,
  type MachineSettings,
  suggestionLists,
  WIRE_COLORS,
  type StructureEntry,
  type Page,
  planRenumbering,
  collectTexts,
  exportTranslations,
  groupTexts,
  planTranslationImport,
  readTranslationTable,
  textFieldLabel,
  type TextGroup,
  type TranslationFormat,
  naturalCompare,
  parseTag,
  channelLabel,
  coresFromType,
  definitionFromDevice,
  exportFormats,
  exportPlc,
  formatStart,
  IO_KINDS,
  isPlcPoint,
  parseStart,
  plcPointKind,
  potentialTypeSchema,
  tagContext,
  type BorderPin,
  type Cable,
  type Wire,
  type IoKind,
  type PlcCard,
  type Command,
  type Item,
  type Part,
  type PlcStation,
  type PlcExportFormat,
  type Potential,
  type Medium,
  type ProjectSettings,
  type SchematicPage,
  type SymbolDefinition,
} from '@wirewright/core';
import { PIPE_COLOR, renderContext, symbolFromDeviceBox, TYPE_COLORS } from '@wirewright/render';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { exportPdf, exportSvg, fileBase, print, type ExportOptions } from '../exports.js';
import { Icon } from '../icons.js';
import { insertBreak, LineInput, readBreaks, showBreaks } from '../lineInput.js';
import { useEditor, useStore, type Dialog } from '../store.js';
import { setUiLanguage, tr, trKeys, UI_LANGUAGES } from '../i18n.js';
import { Field, LanguageFields, MIXED, Modal, texts, toggle, toLocalized } from './common.js';
import { SymbolEditorDialog } from './SymbolEditor.js';
import { LayoutItemDialog, NewLayoutDialog, PlateFields } from './LayoutDialogs.js';
import { CommandPalette } from './CommandPalette.js';
import { AddPlcCardDialog } from './AddPlcCard.js';
import { CatalogImportDialog } from './CatalogImport.js';

/** Suggestion lists for input fields (`<input list="sg-…">`), rendered once with the dialogs. */
function Suggestions() {
  const store = useStore();
  const doc = useEditor((s) => s.doc);
  const language = useEditor((s) => s.language);
  useEditor((s) => s.version);
  if (!doc) {
    // Machine settings without an open project: the standard wire colors.
    return (
      <datalist id="sg-wire-colors">
        {WIRE_COLORS.map((c) => (
          <option key={c.value} value={c.value} {...(c.label ? { label: c.label } : {})} />
        ))}
      </datalist>
    );
  }
  const lists = suggestionLists(doc.state, store.library, language);
  const media = doc.state.project.media ?? [];
  const ids: Record<keyof typeof lists, string> = {
    functions: 'sg-functions',
    locations: 'sg-locations',
    products: 'sg-products',
    devices: 'sg-devices',
    potentials: 'sg-potentials',
    names: 'sg-names',
    bridges: 'sg-bridges',
    wireColors: 'sg-wire-colors',
    crossSections: 'sg-cross-sections',
  };
  return (
    <>
      {Object.entries(lists).map(([key, values]) => (
        <datalist key={key} id={ids[key as keyof typeof lists]}>
          {values.map((v) => (
            <option key={v.value} value={v.value} {...(v.label ? { label: v.label } : {})} />
          ))}
        </datalist>
      ))}
      <datalist id="sg-media">
        {media.map((m) => (
          <option key={m.name} value={m.name} label={[m.pressure, m.type].filter(Boolean).join(' ')} />
        ))}
      </datalist>
    </>
  );
}

export function Dialogs() {
  const dialog = useEditor((s) => s.dialog);
  return dialog ? (
    <>
      <Suggestions />
      <DialogSwitch />
    </>
  ) : null;
}

function DialogSwitch() {
  const store = useStore();
  const dialog = useEditor((s) => s.dialog);
  // The document is mutable: re-render open dialogs when it changes (lists of wires, terminals, PLC cards …).
  useEditor((s) => s.version);
  if (!dialog) return null;
  switch (dialog.kind) {
    case 'item':
      return isFreeText(store, dialog) ? <FreeTextDialog key={dialog.itemIds[0]} dialog={dialog} /> : <ItemDialog key={dialog.itemIds.join()} dialog={dialog} />;
    case 'page':
      return <PageDialog key={dialog.pageId} pageId={dialog.pageId} />;
    case 'project':
      return <ProjectDialog />;
    case 'find':
      return <FindDialog />;
    case 'placeAuxiliary':
      return <PlaceAuxiliaryDialog command={dialog.command} />;
    case 'structureBox':
      return <StructureBoxDialog command={dialog.command} />;
    case 'newReport':
      return <NewReportDialog />;
    case 'newLayout':
      return <NewLayoutDialog />;
    case 'palette':
      return <CommandPalette />;
    case 'addPlcCard':
      return <AddPlcCardDialog station={dialog.station} />;
    case 'acknowledge':
      return <AcknowledgeDialog keys={dialog.keys} text={dialog.text} />;
    case 'catalogImport':
      return <CatalogImportDialog catalog={dialog.catalog} fileName={dialog.fileName} />;
    case 'layoutItem':
      return <LayoutItemDialog key={dialog.itemId} pageId={dialog.pageId} itemId={dialog.itemId} />;
    case 'renameDevice':
      return <RenameDeviceDialog device={dialog.device} />;
    case 'externalChange':
      return <ExternalChangeDialog />;
    case 'shortcuts':
      return <ShortcutsDialog />;
    case 'plc':
      return <PlcDialog station={dialog.station} />;
    case 'library':
      return <LibraryDialog />;
    case 'saveDevice':
      return <SaveDeviceDialog device={dialog.device} />;
    case 'wires':
      return <WiresDialog />;
    case 'terminals':
      return <TerminalsDialog />;
    case 'saveMacro':
      return <SaveMacroDialog />;
    case 'translations':
      return <TranslationsDialog />;
    case 'renumber':
      return <RenumberDialog />;
    case 'renumberPages':
      return <RenumberPagesDialog />;
    case 'export':
      return <ExportDialog mode={dialog.mode} />;
    case 'machine':
      return <MachineDialog />;
    case 'symbolEditor':
      return <SymbolEditorDialog key={`${dialog.mode}:${dialog.id ?? ''}:${dialog.initial?.id ?? ''}`} mode={dialog.mode} id={dialog.id} initial={dialog.initial} />;
    case 'revisions':
      return <RevisionsDialog />;
    case 'parts':
      return <PartsDialog select={dialog.select} />;
    case 'plcImport':
      return <PlcImportDialog station={dialog.station} plan={dialog.plan} comments={dialog.comments} />;
  }
}

// ---------------------------------------------------------------------------
// Free text

function isFreeText(store: ReturnType<typeof useStore>, dialog: Extract<Dialog, { kind: 'item' }>): boolean {
  const page = store.state.doc?.state.pages[dialog.pageId];
  const item = dialog.itemIds.length === 1 && page?.type === 'schematic' ? page.items.find((i) => i.id === dialog.itemIds[0]) : undefined;
  return item !== undefined && store.library.symbol(item.symbol)?.function === 'text';
}

function FreeTextDialog({ dialog }: { dialog: Extract<Dialog, { kind: 'item' }> }) {
  const store = useStore();
  const doc = useEditor((s) => s.doc)!;
  const selected = useEditor((s) => s.language);
  const { languages } = doc.state.project.settings;
  const item = (doc.state.pages[dialog.pageId] as SchematicPage).items.find((i) => i.id === dialog.itemIds[0])!;
  const [values, setValues] = useState(() => texts(item.props?.text, languages));
  const [align, setAlign] = useState<'left' | 'center' | 'right'>(item.props?.textStyle?.align ?? 'left');
  const [color, setColor] = useState(item.props?.textStyle?.color ?? '#000000');
  const [size, setSize] = useState(String(item.props?.textStyle?.size ?? 3));
  const language = selected in values ? selected : (languages[0] ?? selected);
  const others = Object.entries(values).filter(([l, v]) => l !== language && v !== '');
  const ok = () => {
    const sizeMm = Number(size.replace(',', '.'));
    const style = {
      ...(align !== 'left' ? { align } : {}),
      ...(color.toLowerCase() !== '#000000' ? { color } : {}),
      ...(sizeMm > 0 && sizeMm !== 3 ? { size: Math.min(sizeMm, 50) } : {}),
    };
    const text = toLocalized(Object.fromEntries(Object.entries(values).map(([l, v]) => [l, v.replace(/\s+$/, '')])));
    if (store.apply({ type: 'setItemProperties', pageId: dialog.pageId, itemId: item.id, props: { text, textStyle: Object.keys(style).length > 0 ? style : null } }, 'text')) {
      store.set({ dialog: null });
    }
  };
  // Cancelling a text that was just placed and never filled in removes it again.
  const cancel = () => {
    if (dialog.isNew && !item.props?.text) store.undo();
    store.set({ dialog: null });
  };
  return (
    <Modal title={tr('Text')} onOk={ok} onCancel={cancel}>
      <Field label={`${tr('Text')} (${language})`}>
        <textarea
          rows={4}
          autoFocus
          value={values[language] ?? ''}
          onChange={(e) => setValues({ ...values, [language]: e.target.value })}
          onKeyDown={(e) => {
            // Ctrl+Enter applies; Enter alone starts a new line.
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              ok();
            }
          }}
        />
        {others.length > 0 && <span className="translations-hint">{others.map(([l, v]) => `${l}: ${v.split('\n')[0]}${v.includes('\n') ? ' …' : ''}`).join(' · ')}</span>}
      </Field>
      <div className="tag-fields">
        <Field label={tr('Alignment')}>
          <select value={align} onChange={(e) => setAlign(e.target.value as 'left' | 'center' | 'right')}>
            <option value="left">{tr('Left')}</option>
            <option value="center">{tr('Centered')}</option>
            <option value="right">{tr('Right')}</option>
          </select>
        </Field>
        <Field label={tr('Color')}>
          <span className="color-field">
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label={tr('Color')} />
            <input value={color} onChange={(e) => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && setColor(e.target.value)} aria-label={tr('Color code')} />
          </span>
        </Field>
        <Field label={tr('Size (mm)')}>
          <input value={size} onChange={(e) => setSize(e.target.value)} inputMode="decimal" />
        </Field>
      </div>
      <p className="hint">{tr('Enter starts a new line, Ctrl+Enter applies. Other languages: Translations window or switch the language in the toolbar.')}</p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Item properties

/** The value all items share, or `mixed` when they differ. */
function shared<T>(items: readonly Item[], read: (item: Item) => T): { value: T | undefined; mixed: boolean } {
  const values = items.map(read);
  const first = JSON.stringify(values[0] ?? null);
  return values.every((v) => JSON.stringify(v ?? null) === first) ? { value: values[0], mixed: false } : { value: undefined, mixed: true };
}

/** Checkbox that shows a mixed state (some items on, some off) until it is clicked. */
function TriCheck({ value, onChange }: { value: boolean | undefined; onChange: (v: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = value === undefined;
  }, [value]);
  return <input ref={ref} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
}

/** Readable names of symbol text fields. */
const TEXT_FIELD_NAMES: Record<string, string> = {
  tag: 'Device tag',
  functionText: 'Function text',
  technicalData: 'Technical data',
  xref: 'Cross-reference',
  name: 'Name',
  wire: 'Wire number',
  terminal: 'Terminal',
  text: 'Text',
  address: 'Address',
  channel: 'Channel',
};

/** Contact template choice that removes the contacts of a main function. */
const NO_TEMPLATE = '\u0000none';

function ItemDialog({ dialog }: { dialog: Extract<Dialog, { kind: 'item' }> }) {
  const store = useStore();
  const doc = useEditor((s) => s.doc)!;
  const page = doc.state.pages[dialog.pageId] as SchematicPage;
  const items = dialog.itemIds.flatMap((id) => page.items.filter((i) => i.id === id));
  const { languages } = doc.state.project.settings;
  const single = items.length === 1 ? items[0]! : undefined;
  const def = single ? store.library.symbol(single.symbol) : undefined;

  const mixed = items.length > 1;
  const defs = items.map((i) => store.library.symbol(i.symbol));
  const roles = items.map((i, n) => (defs[n] ? itemRole(i, defs[n]) : undefined));

  // Values that several items can share: each shows the common value, or <--> when they differ.
  // Only what is changed in the dialog is written (to every item); everything else stays.
  const multilingual = (key: 'functionText' | 'technicalData') => {
    const values: Record<string, string> = {};
    const differ = new Set<string>();
    for (const language of languages) {
      const one = shared(items, (i) => texts(i.props?.[key], languages)[language] ?? '');
      values[language] = one.value ?? '';
      if (one.mixed) differ.add(language);
    }
    return { values, differ };
  };
  const [initialTexts] = useState(() => ({ functionText: multilingual('functionText'), technicalData: multilingual('technicalData') }));
  const [functionText, setFunctionText] = useState(initialTexts.functionText.values);
  const [technicalData, setTechnicalData] = useState(initialTexts.technicalData.values);
  const [initialTag] = useState(() => ({
    function: shared(items, (i) => i.tag?.function ?? ''),
    location: shared(items, (i) => i.tag?.location ?? ''),
    product: shared(items, (i) => i.tag?.product ?? ''),
  }));
  const [tagEdits, setTagEdits] = useState<Partial<Record<'function' | 'location' | 'product', string>>>({});
  const tag = {
    function: tagEdits.function ?? initialTag.function.value ?? '',
    location: tagEdits.location ?? initialTag.location.value ?? '',
    product: tagEdits.product ?? initialTag.product.value ?? '',
  };
  const setTag = (next: typeof tag) =>
    setTagEdits({
      ...tagEdits,
      ...Object.fromEntries((['function', 'location', 'product'] as const).filter((k) => next[k] !== tag[k]).map((k) => [k, next[k]])),
    });
  const [initialFlags] = useState(() => ({
    master: shared(items, (i) => roles[items.indexOf(i)] === 'main'),
    showTag: shared(items, (i) => i.props?.showTag === true),
    name: shared(items, (i) => (typeof i.props?.name === 'string' ? i.props.name : '')),
    bridge: shared(items, (i) => (typeof i.props?.bridge === 'string' ? i.props.bridge : '')),
  }));
  const [masterEdit, setMaster] = useState<boolean | undefined>();
  const [showTagEdit, setShowTag] = useState<boolean | undefined>();
  const [nameEdit, setName] = useState<string | undefined>();
  const [bridgeEdit, setBridge] = useState<string | undefined>();
  const master = masterEdit ?? initialFlags.master.value;
  const showTag = showTagEdit ?? initialFlags.showTag.value;
  const name = nameEdit ?? initialFlags.name.value ?? '';
  const bridge = bridgeEdit ?? initialFlags.bridge.value ?? '';
  // Text angle and alignment per text field (fields all edited symbols have).
  const textFields = (defs[0]?.texts ?? [])
    .map((t) => t.field)
    .filter((f, n, all) => f !== 'contactImage' && all.indexOf(f) === n && defs.every((d) => d?.texts.some((t) => t.field === f)));
  const [initialStyles] = useState(() =>
    Object.fromEntries(
      textFields.map((f) => [f, { angle: shared(items, (i) => i.texts?.[f]?.angle ?? ''), align: shared(items, (i) => i.texts?.[f]?.align ?? '') }]),
    ),
  );
  const [styleEdits, setStyleEdits] = useState<Record<string, { angle?: '' | 0 | 90 | 270; align?: '' | 'left' | 'center' | 'right' }>>({});
  // Text arrangement: side ('' = as in the symbol definition) and angle of the label block.
  const [initialArrangement] = useState(() => ({
    side: shared(items, (i) => i.textArrangement?.side ?? ''),
    angle: shared(items, (i) => i.textArrangement?.angle ?? 0),
  }));
  const [arrangementEdit, setArrangementEdit] = useState<{ side?: '' | 'left' | 'right' | 'above' | 'below'; angle?: 0 | 90 | 270 }>({});
  const arrangementSide = arrangementEdit.side ?? (initialArrangement.side.mixed ? undefined : initialArrangement.side.value);
  const arrangementAngle = arrangementEdit.angle ?? (initialArrangement.angle.mixed ? undefined : initialArrangement.angle.value);
  const [plc, setPlc] = useState<PlcCard | undefined>(() => (single?.props?.plc ? structuredClone(single.props.plc) : undefined));
  const [channel, setChannel] = useState<number | undefined>(single?.props?.channel);
  const [cable, setCable] = useState<Cable | undefined>(() => (single?.props?.cable ? structuredClone(single.props.cable) : undefined));
  const [wire, setWire] = useState<Wire>(() => ({ ...single?.props?.wire }));
  const [parts, setParts] = useState<Part[]>(() => single?.props?.parts ?? []);
  const [template, setTemplate] = useState('');
  const [pins, setPins] = useState<Record<string, string>>(() => ({ ...single?.pins }));
  const [pinPotentials, setPinPotentials] = useState<Record<string, string>>(() => ({ ...single?.pinPotentials }));
  const [extraText, setExtraText] = useState(() => (typeof single?.props?.text === 'string' ? single.props.text : ''));
  const [terminal, setTerminal] = useState(() => (typeof single?.props?.terminal === 'string' ? single.props.terminal : ''));
  const [borderPins, setBorderPins] = useState<BorderPin[]>(() => single?.borderPins ?? []);
  const [links, setLinks] = useState(() => (single?.links ?? []).map((g) => g.join(',')).join('; '));
  const [size, setSize] = useState(() => ({ width: single?.width ?? 40, height: single?.height ?? 24 }));

  if (items.length === 0) return null;
  const role = single && def ? itemRole(single, def) : undefined;
  const isDevice = role !== undefined && role !== 'none';
  const isDeviceBox = def?.function === 'box.device';
  // What every edited item has (for several items, only those fields are shown).
  const allDevices = roles.every((r) => r !== undefined && r !== 'none');
  const allTagged = items.every((_, n) => (roles[n] !== undefined && roles[n] !== 'none') || defs[n]?.function === 'box.structure');
  const anyStructureBox = defs.some((d) => d?.function === 'box.structure');
  const hasName = defs.every((d) => d && ['connection.interruption', 'connection.potential', 'connection.potentialDefinition', 'connection.medium'].includes(d.function));
  // A pipe source names a medium (Project settings → Media), the others a potential or partner.
  const namesMedium = defs.every((d) => d?.function === 'connection.medium');
  const allTerminals = defs.every((d) => d?.function === 'terminal');

  const ok = () => {
    const commands: Command[] = [];
    const pageId = page.id;
    // Languages changed in the dialog; the others keep each item's own text.
    const changedLanguages = (key: 'functionText' | 'technicalData', values: Record<string, string>) =>
      languages.filter((l) => values[l] !== initialTexts[key].values[l]);
    for (const item of items) {
      const props: Record<string, unknown> = {};
      for (const [key, values] of [['functionText', functionText], ['technicalData', technicalData]] as const) {
        const changed = changedLanguages(key, values);
        if (changed.length === 0) continue;
        const own = texts(item.props?.[key], languages);
        for (const l of changed) own[l] = values[l] ?? '';
        props[key] = toLocalized(own);
      }
      if (nameEdit !== undefined && hasName) props.name = nameEdit || null;
      if (bridgeEdit !== undefined && allTerminals) props.bridge = bridgeEdit || null;
      const isMain = masterEdit ?? roles[items.indexOf(item)] === 'main';
      if (showTagEdit !== undefined && allDevices) props.showTag = showTagEdit && !isMain ? true : null;
      if (masterEdit !== undefined && allDevices) {
        const itemDef = defs[items.indexOf(item)]!;
        commands.push({ type: 'setItemProperties', pageId, itemId: item.id, main: masterEdit === (itemDef.defaultRole === 'main') ? null : masterEdit });
        if (masterEdit) props.showTag = null;
      }
      const tagChanged = (Object.keys(tagEdits) as ('function' | 'location' | 'product')[]).filter((k) => allTagged && tagEdits[k] !== undefined);
      if (tagChanged.length > 0) {
        const clean = (v: string | undefined) => (v === undefined || v.trim() === '' ? null : v.trim());
        const next = { function: clean(item.tag?.function), location: clean(item.tag?.location), product: clean(item.tag?.product) };
        for (const k of tagChanged) next[k] = clean(tagEdits[k]);
        if (JSON.stringify(next) !== JSON.stringify({ function: clean(item.tag?.function), location: clean(item.tag?.location), product: clean(item.tag?.product) })) {
          commands.push({ type: 'setItemTag', pageId, itemId: item.id, tag: next });
        }
      }
      if (arrangementEdit.side !== undefined || arrangementEdit.angle !== undefined) {
        // A side left at <--> keeps each item's own; an angle alone needs a side to apply to.
        const side = arrangementEdit.side ?? item.textArrangement?.side ?? '';
        const angle = arrangementEdit.angle ?? item.textArrangement?.angle ?? 0;
        if (side === '') {
          if (item.textArrangement) commands.push({ type: 'setTextArrangement', pageId, itemId: item.id, arrangement: null });
        } else if (side !== item.textArrangement?.side || angle !== item.textArrangement.angle) {
          commands.push({ type: 'setTextArrangement', pageId, itemId: item.id, arrangement: { side, angle } });
        }
      }
      for (const [field, edit] of Object.entries(styleEdits)) {
        if (edit.angle === undefined && edit.align === undefined) continue;
        commands.push({
          type: 'setItemTextStyle',
          pageId,
          itemId: item.id,
          field,
          ...(edit.angle !== undefined ? { angle: edit.angle === '' ? null : edit.angle } : {}),
          ...(edit.align !== undefined ? { align: edit.align || null } : {}),
        });
      }
      if (single) {
        if (isDevice) props.parts = parts.length > 0 ? parts : null;
        if (def?.function === 'connection.break') props.text = extraText || null;
        if (def?.function === 'terminal') props.terminal = terminal || null;
        if (plc) props.plc = plc;
        if (isPlcPoint(def)) props.channel = channel ?? null;
        if (def?.generator === 'cable') props.cable = cable ?? null;
        if (def?.function === 'connection.definition') {
          const clean = Object.fromEntries(Object.entries(wire).filter(([, v]) => v !== undefined && v !== ''));
          props.wire = Object.keys(clean).length > 0 ? clean : null;
        }
      }
      if (Object.keys(props).length > 0) commands.push({ type: 'setItemProperties', pageId, itemId: item.id, props });
    }
    if (single && def) {
      commands.push({
        type: 'setItemProperties',
        pageId,
        itemId: single.id,
        pins: Object.fromEntries(def.connections.map((c) => [c.id, pins[c.id] && pins[c.id] !== c.designation ? pins[c.id]! : null])),
        pinPotentials: Object.fromEntries(def.connections.map((c) => [c.id, pinPotentials[c.id] || null])),
        ...(def.resizable ? { width: Math.max(4, Math.round(size.width)), height: Math.max(4, Math.round(size.height)) } : {}),
        ...(isDeviceBox
          ? {
              borderPins,
              links: links.trim() === '' ? null : links.split(';').map((g) => g.split(',').map((p) => p.trim()).filter(Boolean)).filter((g) => g.length > 1),
            }
          : {}),
      });
      if (template === NO_TEMPLATE) commands.push({ type: 'setItemProperties', pageId, itemId: single.id, props: { contacts: null } });
      else if (template) commands.push({ type: 'applyDeviceTemplate', pageId, itemId: single.id, template });
    }
    if (commands.length === 0 || store.apply(commands, 'properties')) store.set({ dialog: null });
  };

  const effective = single ? formatTag(effectiveTag(page, single, store.library)) : '';
  const context = single ? formatTag(tagContext(page, single, store.library, single.id)) : '';
  /** Placeholder of a tag field: <--> where the items differ, otherwise the inherited value. */
  const tagHint = (part: 'function' | 'location' | 'product', pattern: RegExp) =>
    initialTag[part].mixed && tagEdits[part] === undefined ? MIXED : (context.match(pattern)?.[1] ?? '');

  return (
    <Modal title={single ? `${tr('Properties')} ${def ? localize(def.name, store.state.language, ['en']) : single.symbol}` : tr('Properties of {count} items', { count: items.length })} onOk={ok} wide>
      <div className="columns">
        <div>
          {allTagged && (
            <fieldset>
              <legend>{tr('Tag')} {effective && <code>{effective}</code>}</legend>
              <div className="tag-fields">
                <Field label="=">
                  <input list="sg-functions" value={tag.function} placeholder={tagHint('function', /=([^+-]*)/)} onChange={(e) => setTag({ ...tag, function: e.target.value })} />
                </Field>
                <Field label="+">
                  <input list="sg-locations" value={tag.location} placeholder={tagHint('location', /\+([^=-]*)/)} onChange={(e) => setTag({ ...tag, location: e.target.value })} />
                </Field>
                {!anyStructureBox && (
                  <Field label="-">
                    <input list="sg-products" value={tag.product} placeholder={tagHint('product', /-([^=+]*)/)} onChange={(e) => setTag({ ...tag, product: e.target.value })} />
                  </Field>
                )}
              </div>
              <p className="hint">
                {tr('Empty fields are inherited from the page and boxes.')}{' '}
                {mixed
                  ? tr('A changed field is written to all items; fields left alone keep each item\'s own value.')
                  : role === 'main'
                    ? tr('Changing the tag renames the device; its contacts follow.')
                    : role === 'auxiliary'
                      ? tr('Changing the tag moves this function to another device.')
                      : ''}
              </p>
              {allDevices && (
                <label className="check">
                  <TriCheck value={master} onChange={setMaster} /> {tr('Master')}
                  <span className="hint"> {tr('— shows cross-references to all its slaves and carries the device data; slaves show only the master')}</span>
                </label>
              )}
              {allDevices && master !== true && (
                <label className="check">
                  <TriCheck value={showTag} onChange={setShowTag} /> {tr('Show device name next to its device')}
                  <span className="hint"> {tr('— by default a slave right of a symbol of the same device (same height) does not repeat the name')}</span>
                </label>
              )}
            </fieldset>
          )}
          {single && def?.resizable && (
            <div className="tag-fields">
              <Field label={tr('Width (mm)')}>
                <input type="number" step={4} min={4} value={size.width} onChange={(e) => setSize({ ...size, width: Number(e.target.value) })} />
              </Field>
              <Field label={tr('Height (mm)')}>
                <input type="number" step={4} min={4} value={size.height} onChange={(e) => setSize({ ...size, height: Number(e.target.value) })} />
              </Field>
            </div>
          )}
          {allDevices && (
            <fieldset>
              <legend>{tr('Texts')}</legend>
              <LanguageFields label={tr('Function')} values={functionText} onChange={setFunctionText} mixed={initialTexts.functionText.differ} />
              <LanguageFields label={tr('Technical data')} values={technicalData} onChange={setTechnicalData} mixed={initialTexts.technicalData.differ} />
            </fieldset>
          )}
          {hasName && (
            <Field label={tr('Name')}>
              <input list={namesMedium ? 'sg-media' : 'sg-names'} value={name} placeholder={initialFlags.name.mixed && nameEdit === undefined ? MIXED : undefined} onChange={(e) => setName(e.target.value)} autoFocus />
            </Field>
          )}
          {single && def?.function === 'connection.break' && (
            <Field label={tr('Text')}>
              <input value={extraText} onChange={(e) => setExtraText(e.target.value)} />
            </Field>
          )}
          {allTerminals && (
            <div className="tag-fields">
              {single && (
                <Field label={tr('Terminal')}>
                  <input value={terminal} onChange={(e) => setTerminal(e.target.value)} />
                </Field>
              )}
              <Field label={tr('Bridge (same label = bridged)')}>
                <input list="sg-bridges" value={bridge} placeholder={initialFlags.bridge.mixed && bridgeEdit === undefined ? MIXED : undefined} onChange={(e) => setBridge(e.target.value)} />
              </Field>
            </div>
          )}
          {single && isDevice && (
            <fieldset>
              <legend>{tr('Parts')}</legend>
              <datalist id="sg-parts">
                {store.library.parts().map((p) => (
                  <option key={p.id} value={p.partNumber} label={[p.manufacturer, localize(p.description, store.state.language, languages)].filter(Boolean).join(' – ')} />
                ))}
              </datalist>
              {parts.map((p, i) => {
                const known = p.partNumber ? findPart(store.library, p.manufacturer, p.partNumber) : undefined;
                const setPart = (patch: Partial<Part>) => setParts(parts.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                return (
                  <Fragment key={i}>
                    <div className="part-row">
                      <input placeholder={tr('Manufacturer')} value={p.manufacturer} onChange={(e) => setPart({ manufacturer: e.target.value })} />
                      <input
                        placeholder={tr('Part number')}
                        list="sg-parts"
                        value={p.partNumber}
                        onChange={(e) => {
                          // A part number from the database brings its manufacturer along.
                          const match = store.library.parts().find((x) => x.partNumber === e.target.value);
                          setPart({ partNumber: e.target.value, ...(match && !p.manufacturer ? { manufacturer: match.manufacturer } : {}) });
                        }}
                      />
                      <input type="number" min={1} value={p.quantity} onChange={(e) => setPart({ quantity: Number(e.target.value) || 1 })} />
                      <button type="button" onClick={() => setParts(parts.filter((_, j) => j !== i))}>×</button>
                    </div>
                    {known && (
                      <p className="hint part-info">
                        {[
                          localize(known.description, store.state.language, languages),
                          known.price !== undefined ? `${known.price} ${known.currency ?? ''}${known.priceUnit && known.priceUnit !== 1 ? ` / ${known.priceUnit}` : ''}`.trim() : '',
                          known.suppliers?.[0]?.name ?? '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}{' '}
                        <button type="button" className="link" onClick={() => store.set({ dialog: { kind: 'parts', select: known.id } })}>
                          {tr('Parts database')}
                        </button>
                      </p>
                    )}
                  </Fragment>
                );
              })}
              <button type="button" onClick={() => setParts([...parts, { manufacturer: '', partNumber: '', quantity: 1 }])}>
                {tr('+ Part')}
              </button>
              {role === 'main' && !def?.generator && (
                <Field label={tr('Contact template')}>
                  <select value={template} onChange={(e) => setTemplate(e.target.value)}>
                    <option value="">{single.props?.contacts ? `${single.props.contacts.length} contacts (keep)` : 'none'}</option>
                    {single.props?.contacts && <option value={NO_TEMPLATE}>{tr('none (remove the contact list)')}</option>}
                    {store.library.templates().map((t) => (
                      <option key={t.id} value={t.id}>
                        {localize(t.name, store.state.language, ['en'])}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </fieldset>
          )}
        </div>
        <div>
          {textFields.length > 0 && (
            <fieldset>
              <legend>{tr('Text layout')}</legend>
              {textFields.some((f) => (ARRANGED_TEXT_FIELDS as readonly string[]).includes(f)) && (
                <div className="tag-fields">
                  <Field label={tr('Label texts')}>
                    <select
                      value={arrangementSide === undefined ? MIXED : arrangementSide}
                      onChange={(e) => setArrangementEdit({ ...arrangementEdit, side: e.target.value as '' | 'left' | 'right' | 'above' | 'below' })}
                    >
                      {arrangementSide === undefined && <option value={MIXED}>{MIXED}</option>}
                      <option value="">{tr('As in the symbol')}</option>
                      <option value="left">{tr('Left')}</option>
                      <option value="right">{tr('Right')}</option>
                      <option value="above">{tr('Above')}</option>
                      <option value="below">{tr('Below')}</option>
                    </select>
                  </Field>
                  <Field label={tr('Angle')}>
                    <select
                      value={arrangementAngle === undefined ? MIXED : String(arrangementAngle)}
                      disabled={arrangementSide === ''}
                      onChange={(e) => setArrangementEdit({ ...arrangementEdit, angle: Number(e.target.value) as 0 | 90 | 270 })}
                    >
                      {arrangementAngle === undefined && <option value={MIXED}>{MIXED}</option>}
                      <option value="0">0°</option>
                      <option value="90">90° ↑</option>
                      <option value="270">270° ↓</option>
                    </select>
                  </Field>
                </div>
              )}
              <table className="text-layout">
                <thead>
                  <tr>
                    <th>{tr('Text')}</th>
                    <th>{tr('Angle')}</th>
                    <th>{tr('Alignment')}</th>
                  </tr>
                </thead>
                <tbody>
                  {textFields.map((field) => {
                    const initial = initialStyles[field]!;
                    const edit = styleEdits[field] ?? {};
                    const set = (patch: (typeof styleEdits)[string]) => setStyleEdits({ ...styleEdits, [field]: { ...edit, ...patch } });
                    const angle = edit.angle ?? (initial.angle.mixed ? undefined : initial.angle.value);
                    const align = edit.align ?? (initial.align.mixed ? undefined : initial.align.value);
                    return (
                      <tr key={field}>
                        <td>{field.startsWith('pin:') ? `${tr('Pin')} ${field.slice(4)}` : tr(TEXT_FIELD_NAMES[field] ?? field)}</td>
                        <td>
                          <select value={angle === undefined ? MIXED : String(angle)} onChange={(e) => set({ angle: e.target.value === '' ? '' : (Number(e.target.value) as 0 | 90 | 270) })}>
                            {angle === undefined && <option value={MIXED}>{MIXED}</option>}
                            <option value="">{tr('default')}</option>
                            <option value="0">0°</option>
                            <option value="90">90° ↑</option>
                            <option value="270">270° ↓</option>
                          </select>
                        </td>
                        <td>
                          <select value={align === undefined ? MIXED : align} onChange={(e) => set({ align: e.target.value as '' | 'left' | 'center' | 'right' })}>
                            {align === undefined && <option value={MIXED}>{MIXED}</option>}
                            <option value="">{tr('default')}</option>
                            <option value="left">{tr('Left')}</option>
                            <option value="center">{tr('Centered')}</option>
                            <option value="right">{tr('Right')}</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="hint">
                {tr('Label texts (tag, name, function text, technical data, cross-references) go together as a block next to the symbol, centered on it; choosing a side resets their own positions.')}{' '}
                {tr('Angles are against the sheet: 90° reads from bottom to top, 270° from top to bottom. A text selected with Ctrl+click turns with R.')}
              </p>
            </fieldset>
          )}
          {single && def?.function === 'connection.definition' && <WireFields item={single} wire={wire} onChange={setWire} />}
          {single && isPlcPoint(def) && <IoPointFields item={single} kind={plcPointKind(def!)} channel={channel} onChange={setChannel} />}
          {single && def && (def.connections.length > 0 || isDeviceBox) && !plc && (
            <fieldset>
              <legend>{tr('Pins and links')}</legend>
              <PinDiagram item={single} def={def} borderPins={borderPins} links={links} />
              {!isDeviceBox && (
                <table className="pins">
                  <thead>
                    <tr>
                      <th>{tr('Pin')}</th>
                      <th>{tr('Designation')}</th>
                      {isDevice && <th>{tr('Starts potential')}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {def.connections.map((c) => (
                      <tr key={c.id}>
                        <td>{c.id}</td>
                        <td>
                          <input value={pins[c.id] ?? c.designation ?? ''} onChange={(e) => setPins({ ...pins, [c.id]: e.target.value })} />
                        </td>
                        {isDevice && (
                          <td>
                            <select value={pinPotentials[c.id] ?? ''} onChange={(e) => setPinPotentials({ ...pinPotentials, [c.id]: e.target.value })}>
                              <option value="">–</option>
                              {doc.state.project.potentials.map((p) => (
                                <option key={p.name}>{p.name}</option>
                              ))}
                            </select>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {isDeviceBox && (
                <>
                  <table className="pins">
                    <thead>
                      <tr>
                        <th>{tr('ID')}</th>
                        <th>{tr('Side')}</th>
                        <th>{tr('Offset')}</th>
                        <th>{tr('Designation')}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {borderPins.map((p, i) => (
                        <tr key={i}>
                          <td>{p.id}</td>
                          <td>
                            <select value={p.side} onChange={(e) => setBorderPins(borderPins.map((x, j) => (j === i ? { ...x, side: e.target.value as BorderPin['side'] } : x)))}>
                              {['left', 'right', 'top', 'bottom'].map((s) => (
                                <option key={s}>{s}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input type="number" step={4} value={p.offset} onChange={(e) => setBorderPins(borderPins.map((x, j) => (j === i ? { ...x, offset: Math.round(Number(e.target.value)) } : x)))} />
                          </td>
                          <td>
                            <input value={p.designation} onChange={(e) => setBorderPins(borderPins.map((x, j) => (j === i ? { ...x, designation: e.target.value } : x)))} />
                          </td>
                          <td>
                            <button type="button" onClick={() => setBorderPins(borderPins.filter((_, j) => j !== i))}>×</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button
                    type="button"
                    onClick={() => {
                      const n = borderPins.length + 1;
                      let id = `p${n}`;
                      for (let k = n; borderPins.some((p) => p.id === id); k++) id = `p${k + 1}`;
                      setBorderPins([...borderPins, { id, side: 'left', offset: 4 * Math.min(n, Math.floor((single.height ?? 24) / 4) - 1), designation: String(n) }]);
                    }}
                  >
                    {tr('+ Pin')}
                  </button>
                  <Field label={tr('Links (e.g. p1,p2; p3,p4)')}>
                    <input value={links} onChange={(e) => setLinks(e.target.value)} />
                  </Field>
                  <button
                    type="button"
                    className="with-icon"
                    title={tr('A symbol with the box outline, the graphics inside it, its border pins and pin links – opened in the symbol editor to check and save')}
                    onClick={() => openBoxAsSymbol(store, page.id, single.id)}
                  >
                    <Icon name="symbolEditor" /> {tr('Turn into a library symbol…')}
                  </button>
                </>
              )}
            </fieldset>
          )}
        </div>
      </div>
      {single && plc && <PlcCardFields plc={plc} onChange={setPlc} cardItemId={single.id} />}
      {single && def?.generator === 'cable' && <CableFields item={single} cable={cable} onChange={setCable} />}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Cables and wires

function CableFields({ item, cable, onChange }: { item: Item; cable: Cable | undefined; onChange: (c: Cable | undefined) => void }) {
  const store = useStore();
  const doc = useEditor((s) => s.doc)!;
  const key = doc.devices().byItem.get(item.id);
  const device = key ? doc.devices().devices.get(key) : undefined;
  const isMain = device?.main?.itemId === item.id;
  const info = doc.cables().cables.find((c) => c.device === key);
  const [identification, setIdentification] = useState<'numbers' | 'colors' | 'both'>(cable?.coreIdentification ?? 'numbers');
  const others = doc.cables().cables.filter((c) => c.device !== key);
  const pageId = store.state.sheet?.pageId ?? '';

  if (!isMain) {
    return (
      <fieldset>
        <legend>{tr('Cable')}</legend>
        <p>
          {tr("Further definition line of {cable}. Its cores are numbered after the conductors of the cable's other lines.", { cable: key ?? '' })}
        </p>
        {info === undefined && others.length > 0 && <p className="hint">{tr('To make this line part of another cable, use the button below.')}</p>}
        {others.length > 0 && (
          <Field label={tr('Move to cable')}>
            <select
              value=""
              onChange={(e) => {
                const target = others.find((c) => c.device === e.target.value);
                if (!target) return;
                const product = target.device.split('-').at(-1)!;
                if (store.apply([{ type: 'setItemProperties', pageId, itemId: item.id, main: false }, { type: 'setItemTag', pageId, itemId: item.id, tag: { product } }], 'cable line')) store.set({ dialog: null });
              }}
            >
              <option value="">–</option>
              {others.map((c) => (
                <option key={c.device}>{c.device}</option>
              ))}
            </select>
          </Field>
        )}
      </fieldset>
    );
  }

  const data: Cable = cable ?? { cores: [] };
  const set = (patch: Partial<Cable>) => onChange({ ...data, ...patch });
  const generate = () => {
    const result = coresFromType(data.type ?? '', identification);
    if (!result) return store.notify('Type designation like "5G1.5" or "7x0.75" expected', true);
    onChange({ ...data, coreIdentification: identification, crossSection: result.crossSection, cores: result.cores });
  };
  const setCore = (i: number, patch: Partial<Cable['cores'][number]>) => set({ cores: data.cores.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const num = (v: string) => (v === '' ? undefined : Number(v.replace(',', '.')) || undefined);

  return (
    <fieldset>
      <legend>{tr('Cable')}</legend>
      <div className="tag-fields">
        <Field label={tr('Type')}>
          <input value={data.type ?? ''} placeholder={tr('ÖLFLEX CLASSIC 110 5G1.5')} onChange={(e) => set({ type: e.target.value || undefined })} />
        </Field>
        <Field label={tr('Cores')}>
          <select value={identification} onChange={(e) => setIdentification(e.target.value as typeof identification)}>
            <option value="numbers">{tr('numbered')}</option>
            <option value="colors">{tr('colored (HD 308)')}</option>
            <option value="both">{tr('numbers and colors')}</option>
          </select>
        </Field>
      </div>
      <button type="button" onClick={generate}>
        {tr('Generate cores from type')}
      </button>
      <div className="tag-fields">
        <Field label={tr('Cross-section (mm²)')}>
          <input list="sg-cross-sections" value={data.crossSection ?? ''} onChange={(e) => set({ crossSection: num(e.target.value) })} />
        </Field>
        <Field label={tr('Outer Ø (mm)')}>
          <input value={data.outerDiameterMm ?? ''} onChange={(e) => set({ outerDiameterMm: num(e.target.value) })} />
        </Field>
        <Field label={tr('Length (m)')}>
          <input value={data.lengthM ?? ''} onChange={(e) => set({ lengthM: num(e.target.value) })} />
        </Field>
      </div>
      <label className="check">
        <input type="checkbox" checked={data.shield ?? false} onChange={(e) => set({ shield: e.target.checked || undefined })} /> {tr('Shielded')}
      </label>
      <table className="channels">
        <thead>
          <tr>
            <th>{tr('Core')}</th>
            <th>{tr('Number')}</th>
            <th>{tr('Color')}</th>
            <th>{tr('mm²')}</th>
            <th>{tr('Wire')}</th>
            <th>{tr('Connects')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.cores.map((core, i) => {
            const assignment = info?.assignments.find((a) => a.core.id === core.id);
            const wire = assignment ? doc.wires().byNet.get(assignment.net) : undefined;
            return (
              <tr key={i}>
                <td>
                  <input value={core.id} onChange={(e) => setCore(i, { id: e.target.value })} />
                </td>
                <td>
                  <input value={core.number ?? ''} onChange={(e) => setCore(i, { number: e.target.value || undefined })} />
                </td>
                <td>
                  <input value={core.color ?? ''} onChange={(e) => setCore(i, { color: e.target.value.toUpperCase() || undefined })} />
                </td>
                <td>
                  <input list="sg-cross-sections" value={core.crossSection ?? ''} placeholder={String(data.crossSection ?? '')} onChange={(e) => setCore(i, { crossSection: num(e.target.value) })} />
                </td>
                <td className="derived">{wire?.number ?? (assignment ? '' : 'spare')}</td>
                <td className="derived">{wire?.ends.join(' – ') ?? ''}</td>
                <td>
                  <button type="button" onClick={() => set({ cores: data.cores.filter((_, j) => j !== i) })}>×</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button type="button" onClick={() => set({ cores: [...data.cores, { id: String(data.cores.length + 1), number: String(data.cores.length + 1) }] })}>
        {tr('+ Core')}
      </button>
      <p className="hint">{tr('Conductors crossed by the cable lines get the cores in order (PE gets the green-yellow core). A wire marker on a conductor can choose its core.')}</p>
    </fieldset>
  );
}

function WireFields({ item, wire, onChange }: { item: Item; wire: Wire; onChange: (w: Wire) => void }) {
  const doc = useEditor((s) => s.doc)!;
  const library = useStore().library;
  const pin = library.symbol(item.symbol)?.connections[0];
  const net = pin ? doc.connectivity().netOf.get(`${item.id}:${pin.id}`) : undefined;
  const info = net !== undefined ? doc.wires().byNet.get(net) : undefined;
  const set = (patch: Partial<Wire>) => onChange({ ...wire, ...patch });
  return (
    <fieldset>
      <legend>{tr('Wire')}</legend>
      <div className="tag-fields">
        <Field label={tr('Wire number')}>
          <input value={wire.number ?? ''} placeholder={info?.numberSource === 'derived' ? info.number : ''} onChange={(e) => set({ number: e.target.value || undefined })} />
        </Field>
        <Field label={tr('Color')}>
          <input list="sg-wire-colors" value={wire.color ?? ''} placeholder={info?.color} onChange={(e) => set({ color: e.target.value.toUpperCase() || undefined })} />
        </Field>
        <Field label={tr('Cross-section (mm²)')}>
          <input list="sg-cross-sections" value={wire.crossSection ?? ''} placeholder={info ? String(info.crossSection) : ''} onChange={(e) => set({ crossSection: e.target.value === '' ? undefined : Number(e.target.value.replace(',', '.')) || undefined })} />
        </Field>
        <Field label={tr('Cable core')}>
          <input value={wire.core ?? ''} placeholder={info?.cable?.core ?? ''} onChange={(e) => set({ core: e.target.value || undefined })} />
        </Field>
      </div>
      {info && (
        <p className="hint">
          {tr('Conductor')} {info.ends.join(' – ') || tr('(no device pins)')}
          {info.potential ? `, ${tr('potential {name}', { name: info.potential })}` : ''}
          {info.cable ? `, ${tr('in {cable} core {core}', { cable: info.cable.device, core: info.cable.core })}` : ''}
          {tr('. Empty number: taken from the drawing (page.column.counter); "Number wires" writes it here.')}
        </p>
      )}
    </fieldset>
  );
}

function WiresDialog() {
  const store = useStore();
  const doc = useEditor((s) => s.doc)!;
  const current = useEditor((s) => s.sheet);
  const [format, setFormat] = useState(doc.state.project.settings.wireNumbering.format);
  const [scope, setScope] = useState<'project' | 'page'>('project');
  const [onlyMissing, setOnlyMissing] = useState(true);
  const number = () => {
    const commands: Command[] = [];
    if (format !== doc.state.project.settings.wireNumbering.format) commands.push({ type: 'setProjectSettings', settings: { wireNumbering: { format } } });
    commands.push({ type: 'numberWires', onlyMissing, ...(scope === 'page' && current ? { pageIds: [current.pageId] } : {}) });
    if (store.apply(commands, 'number wires')) store.notify('Wire numbers written to the wire markers');
  };
  const wires = doc.wires().wires;
  return (
    <Modal title={tr('Wires')} wide>
      <div className="tag-fields">
        <Field label={tr('Number format')}>
          <input value={format} onChange={(e) => setFormat(e.target.value)} />
        </Field>
        <Field label={tr('Scope')}>
          <select value={scope} onChange={(e) => setScope(e.target.value as 'project' | 'page')}>
            <option value="project">{tr('Whole project')}</option>
            <option value="page">{tr('Current page')}</option>
          </select>
        </Field>
      </div>
      <p className="hint">
        {tr('Placeholders {placeholders}. One number per conductor. Numbers are shown where a wire marker sits on the conductor; "Number wires" writes them into the markers so they no longer change with the drawing.', { placeholders: '{page} {column} {row} {counter}' })}
      </p>
      <label className="check">
        <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> {tr('Keep existing numbers (only fill in missing ones)')}
      </label>
      <button type="button" className="primary" onClick={number}>
        {tr('Number wires')}
      </button>
      <table className="channels" style={{ marginTop: 10 }}>
        <thead>
          <tr>
            <th>{tr('Wire')}</th>
            <th>{tr('Connects')}</th>
            <th>{tr('Color')}</th>
            <th>{tr('mm²')}</th>
            <th>{tr('Potential')}</th>
            <th>{tr('Cable')}</th>
          </tr>
        </thead>
        <tbody>
          {wires.slice(0, 300).map((w) => (
            <tr key={w.net} onClick={() => w.markers[0] && store.navigate(w.markers[0].pageId, 0, w.markers[0].itemId)}>
              <td className={w.numberSource === 'derived' ? 'derived' : undefined}>{w.number}</td>
              <td>{w.ends.join(' – ')}</td>
              <td>{w.color}</td>
              <td>{w.crossSection}</td>
              <td>{w.potential ?? ''}</td>
              <td>{w.cable ? `${w.cable.device}:${w.cable.core}` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {wires.length > 300 && <p className="hint">{tr('{count} more – see the wire list report.', { count: wires.length - 300 })}</p>}
    </Modal>
  );
}

function TerminalsDialog() {
  const store = useStore();
  const doc = useEditor((s) => s.doc)!;
  const strips = doc.terminals().strips;
  const [selected, setSelected] = useState(() => strips[0]?.device ?? '');
  const [start, setStart] = useState('1');
  const [step, setStep] = useState('1');
  const strip = strips.find((s) => s.device === selected) ?? strips[0];
  const setTerminal = (pageId: string, itemId: string, props: { terminal?: string | null; bridge?: string | null }) =>
    store.apply([{ type: 'setItemProperties', pageId, itemId, props }], 'edit terminal');
  const renumber = () => {
    if (strip && store.apply([{ type: 'renumberTerminals', strip: strip.device, start: Number(start) || 0, step: Math.max(1, Math.trunc(Number(step)) || 1) }], 'renumber terminals')) {
      store.notify(tr('{name} renumbered', { name: strip.device }));
    }
  };
  if (!strip) {
    return (
      <Modal title={tr('Terminal strips')}>
        <p className="hint">{tr('The project has no terminals. Place terminal symbols with a tag like -X1 to create a strip.')}</p>
      </Modal>
    );
  }
  return (
    <Modal title={tr('Terminal strips')} wide>
      <div className="tag-fields">
        <Field label={tr('Terminal strip')}>
          <select value={strip.device} onChange={(e) => setSelected(e.target.value)}>
            {strips.map((s) => (
              <option key={s.device} value={s.device}>
                {s.device} ({s.terminals.length})
              </option>
            ))}
          </select>
        </Field>
        <Field label={tr('Renumber from')}>
          <input value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label={tr('Step')}>
          <input value={step} inputMode="numeric" onChange={(e) => setStep(e.target.value)} />
        </Field>
      </div>
      <button type="button" onClick={renumber} title={tr('Numbers the terminals in drawing order; PE, N and other names stay')}>
        {tr('Renumber strip')}
      </button>
      <p className="hint">
        {tr("Terminals with the same bridge label are bridged and share their potential. Internal targets are in the strip's location ({location}), external targets elsewhere.", { location: strip.location ? `+${strip.location}` : tr('none') })}
      </p>
      <table className="channels">
        <thead>
          <tr>
            <th>{tr('Terminal')}</th>
            <th>{tr('Bridge')}</th>
            <th>{tr('External')}</th>
            <th>{tr('Internal')}</th>
            <th>{tr('Page')}</th>
          </tr>
        </thead>
        <tbody>
          {strip.terminals.map((t) => (
            <tr key={t.itemId}>
              <td>
                <input defaultValue={t.designation} key={t.designation} onBlur={(e) => e.target.value !== t.designation && setTerminal(t.pageId, t.itemId, { terminal: e.target.value || null })} />
              </td>
              <td>
                <input defaultValue={t.bridge ?? ''} key={t.bridge ?? ''} size={4} onBlur={(e) => e.target.value !== (t.bridge ?? '') && setTerminal(t.pageId, t.itemId, { bridge: e.target.value || null })} />
              </td>
              <td>{t.external.join(', ')}</td>
              <td>{t.internal.join(', ')}</td>
              <td>
                <a href="#" onClick={(e) => (e.preventDefault(), store.navigate(t.pageId, 0, t.itemId))}>
                  {t.reference}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// PLC card and I/O point

function PlcCardFields({ plc, onChange, cardItemId }: { plc: PlcCard; onChange: (plc: PlcCard) => void; cardItemId: string }) {
  const doc = useEditor((s) => s.doc)!;
  const language = useEditor((s) => s.language);
  const stations = doc.state.project.plcs;
  const station = stations.find((s) => s.name === plc.station);
  const kinds = IO_KINDS.filter((k) => plc.channels.some((c) => c.kind === k));
  const derived = doc.plc().byCard.get(cardItemId);
  const [starts, setStarts] = useState<Record<string, string>>(() =>
    Object.fromEntries(kinds.map((k) => [k, station && plc.start?.[k] !== undefined ? formatStart(station, k, plc.start[k]!) : String(plc.start?.[k] ?? '')])),
  );
  const setStart = (kind: IoKind, text: string) => {
    setStarts({ ...starts, [kind]: text });
    const value = station ? parseStart(station, kind, text) : Number.isNaN(Number(text)) ? undefined : Number(text);
    const start = { ...plc.start };
    if (value === undefined) delete start[kind];
    else start[kind] = value;
    onChange({ ...plc, start });
  };
  const setChannel = (i: number, patch: Partial<PlcCard['channels'][number]>) =>
    onChange({ ...plc, channels: plc.channels.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  return (
    <fieldset>
      <legend>{tr('PLC I/O card')}</legend>
      <div className="tag-fields">
        <Field label={tr('PLC')}>
          <select value={plc.station ?? ''} onChange={(e) => onChange({ ...plc, station: e.target.value || undefined })}>
            <option value="">{tr('– not assigned –')}</option>
            {stations.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name} ({s.family}{s.mitsubishiSeries ? ` ${s.mitsubishiSeries.toUpperCase()}` : ''})
              </option>
            ))}
          </select>
        </Field>
        <Field label={tr('Slot')}>
          <input type="number" value={plc.slot ?? ''} onChange={(e) => onChange({ ...plc, slot: e.target.value === '' ? undefined : Number(e.target.value) })} />
        </Field>
        {kinds.map((k) => (
          <Field key={k} label={`${tr('Start')} ${k}`}>
            <input value={starts[k] ?? ''} placeholder={station?.family === 'mitsubishi' ? 'X40' : station?.family === 'codesys' ? '%IX4.0' : 'I4.0'} onChange={(e) => setStart(k, e.target.value)} />
          </Field>
        ))}
      </div>
      {stations.length === 0 && <p className="hint">{tr('Define PLCs in Settings → PLCs first.')}</p>}
      <table className="channels">
        <thead>
          <tr>
            <th>{tr('Channel')}</th>
            <th>{tr('Pin')}</th>
            <th title={tr('Further terminals of the channel, drawn before its pin, e.g. the clock of a safety input: T1=Takt, …')}>{tr('Further terminals')}</th>
            <th>{tr('Address')}</th>
            <th>{tr('Tag name')}</th>
            <th>{tr('Function ({language})', { language })}</th>
            <th>{tr('Address override')}</th>
          </tr>
        </thead>
        <tbody>
          {plc.channels.map((c, i) => {
            const info = derived?.channels[i];
            const fn = typeof c.function === 'string' ? c.function : (c.function?.[language] ?? '');
            return (
              <tr key={i}>
                <td>{channelLabel(c)}</td>
                <td>{c.pin}</td>
                <td>
                  <input
                    className="extra-pins"
                    defaultValue={(c.extraPins ?? []).map((p) => (p.label ? `${p.pin}=${p.label}` : p.pin)).join(', ')}
                    placeholder="T1=Takt"
                    onBlur={(e) => {
                      const extraPins = e.target.value
                        .split(',')
                        .map((part) => part.trim())
                        .filter(Boolean)
                        .map((part) => {
                          const [pin, label] = part.split('=').map((x) => x.trim());
                          return { pin: pin!, ...(label ? { label } : {}) };
                        })
                        .filter((p) => p.pin && p.pin !== c.pin);
                      setChannel(i, { extraPins: extraPins.length > 0 ? extraPins : undefined });
                    }}
                  />
                </td>
                <td className="derived">{info?.address ?? '–'}</td>
                <td>
                  <input value={c.name ?? ''} placeholder={info?.name} onChange={(e) => setChannel(i, { name: e.target.value || undefined })} />
                </td>
                <td>
                  <input
                    value={fn}
                    placeholder={info?.functionSource === 'wiring' || info?.functionSource === 'slave' ? localize(info.function, language, ['en']) : ''}
                    onChange={(e) =>
                      setChannel(i, {
                        function: e.target.value === '' ? undefined : typeof c.function === 'object' ? { ...c.function, [language]: e.target.value } : { [language]: e.target.value },
                      })
                    }
                  />
                </td>
                <td>
                  <input value={c.address ?? ''} onChange={(e) => setChannel(i, { address: e.target.value || undefined })} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="hint">{tr('Grey placeholders are derived: tag names from the channel, functions from the I/O point or from the device wired to the channel.')}</p>
    </fieldset>
  );
}

function IoPointFields({ item, kind, channel, onChange }: { item: Item; kind: IoKind; channel: number | undefined; onChange: (c: number | undefined) => void }) {
  const doc = useEditor((s) => s.doc)!;
  const key = doc.devices().byItem.get(item.id);
  const main = key ? doc.devices().devices.get(key)?.main : undefined;
  const card = main ? doc.plc().byCard.get(main.itemId) : undefined;
  return (
    <fieldset>
      <legend>{tr('PLC I/O point')}</legend>
      {card ? (
        <Field label={tr('Channel of {device}', { device: card.device })}>
          <select value={channel ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}>
            <option value="">–</option>
            {card.channels
              .filter((c) => c.channel.kind === kind)
              .map((c) => (
                <option key={c.channel.channel} value={c.channel.channel}>
                  {channelLabel(c.channel)} · {tr('pin')} {c.channel.pin}
                  {c.address ? ` · ${c.address}` : ''}
                  {c.slaves.length > 0 && !c.slaves.some((s) => s.itemId === item.id) ? ` ${tr('(drawn elsewhere)')}` : ''}
                </option>
              ))}
          </select>
        </Field>
      ) : (
        <p className="hint">{tr('This I/O point\'s tag does not belong to an I/O card. Give it the tag of the card (e.g. -4A1).')}</p>
      )}
    </fieldset>
  );
}

const LINK_COLORS = ['#FF8C00', '#8A2BE2', '#008B8B', '#C71585', '#2E8B57'];

/** Pins of a symbol with its links drawn as colored lines; unlinked pins are end points. */
function PinDiagram({ item, def, borderPins, links }: { item: Item; def: SymbolDefinition; borderPins: BorderPin[]; links: string }) {
  let points: { id: string; x: number; y: number; label: string }[];
  let groups: string[][];
  let outline: ReactNode;
  if (def.function === 'box.device') {
    const w = item.width ?? 40;
    const h = item.height ?? 24;
    points = borderPins.map((p) => ({
      id: p.id,
      label: p.designation,
      ...{ left: { x: 0, y: p.offset }, right: { x: w, y: p.offset }, top: { x: p.offset, y: 0 }, bottom: { x: p.offset, y: h } }[p.side],
    }));
    groups = links.trim() === '' ? [] : links.split(';').map((g) => g.split(',').map((s) => s.trim()).filter(Boolean));
    outline = <rect x={0} y={0} width={w} height={h} fill="none" stroke="#999" strokeDasharray="2 1.2" strokeWidth={0.4} />;
  } else {
    points = def.connections.map((c) => ({ id: c.id, x: c.x, y: c.y, label: c.designation ?? c.id }));
    groups = linkGroups(def, item);
    outline = def.graphics.map((g, i) => (g.type === 'line' ? <line key={i} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} stroke="#bbb" strokeWidth={0.4} /> : null));
  }
  if (points.length === 0) return <p className="hint">{tr('No pins yet.')}</p>;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs) - 6;
  const minY = Math.min(...ys) - 6;
  const w = Math.max(...xs) + 6 - minX;
  const h = Math.max(...ys) + 6 - minY;
  const linked = new Set(groups.filter((g) => g.length > 1).flat());
  return (
    <svg className="pin-diagram" viewBox={`${minX} ${minY} ${w} ${h}`} width="100%" height={Math.min(160, Math.max(80, h * 4))}>
      {outline}
      {groups.map((g, i) => {
        const pts = g.flatMap((id) => points.filter((p) => p.id === id));
        return pts.length > 1 ? <polyline key={i} points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={LINK_COLORS[i % LINK_COLORS.length]} strokeWidth={0.8} /> : null;
      })}
      {points.map((p) => (
        <g key={p.id}>
          <circle cx={p.x} cy={p.y} r={1.2} fill={linked.has(p.id) ? '#333' : '#fff'} stroke="#333" strokeWidth={0.4} />
          <text x={p.x + 1.8} y={p.y - 1.2} fontSize={2.6} fill="#333">
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Page properties

function PageDialog({ pageId }: { pageId: string }) {
  const store = useStore();
  const doc = useEditor((s) => s.doc)!;
  const page = doc.state.pages[pageId]!;
  const { languages } = doc.state.project.settings;
  const [name, setName] = useState(page.name);
  const [description, setDescription] = useState(() => texts(page.description, languages));
  const [fn, setFn] = useState(page.structure?.function ?? '');
  const [location, setLocation] = useState(page.structure?.location ?? '');
  const [frame, setFrame] = useState(page.frame ?? '');
  const [revision, setRevision] = useState(page.properties?.revision ?? '');
  const [date, setDate] = useState(page.properties?.date ?? '');
  const [plate, setPlate] = useState(() => (page.type === 'layout' ? { width: String(page.plate.width), height: String(page.plate.height), scale: String(page.scale) } : null));

  const ok = () => {
    const layout: Command[] =
      page.type === 'layout' && plate
        ? [{ type: 'setLayoutPage', pageId, plate: { width: Number(plate.width) || page.plate.width, height: Number(plate.height) || page.plate.height }, scale: Number(plate.scale) || page.scale }]
        : [];
    const result = store.apply([
      {
        type: 'setPageProperties',
        pageId,
        name,
        description: toLocalized(description),
        structure: { function: fn.trim() || null, location: location.trim() || null },
        frame: frame || null,
        properties: { revision: revision || null, date: date || null },
      },
      ...layout,
    ], 'page properties');
    if (result) store.set({ dialog: null });
  };

  return (
    <Modal title={`${tr('Page')} ${page.name}`} onOk={ok}>
      <Field label={tr('Name')}>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <LanguageFields label={tr('Description')} values={description} onChange={setDescription} />
      <div className="tag-fields">
        <Field label={tr('= Function')}>
          <input list="sg-functions" value={fn} onChange={(e) => setFn(e.target.value)} />
        </Field>
        <Field label={tr('+ Location')}>
          <input list="sg-locations" value={location} onChange={(e) => setLocation(e.target.value)} />
        </Field>
      </div>
      <Field label={tr('Frame')}>
        <select value={frame} onChange={(e) => setFrame(e.target.value)}>
          <option value="">{tr('Project default ({frame})', { frame: doc.state.project.settings.defaultFrame })}</option>
          {store.library.frames().map((f) => (
            <option key={f.id} value={f.id}>
              {localize(f.name, store.state.language, ['en'])}
            </option>
          ))}
        </select>
      </Field>
      <div className="tag-fields">
        <Field label={tr('Revision')}>
          <input value={revision} onChange={(e) => setRevision(e.target.value)} />
        </Field>
        <Field label={tr('Date')}>
          <input value={date} onChange={(e) => setDate(e.target.value)} placeholder="2026-10-31" />
        </Field>
      </div>
      {plate && <PlateFields value={plate} onChange={setPlate} />}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Project structure: functions and locations with descriptions and order

function StructureEditor({ title, entries, languages, onChange }: { title: string; entries: StructureEntry[]; languages: string[]; onChange: (entries: StructureEntry[]) => void }) {
  const selected = useEditor((s) => s.language);
  const language = languages.includes(selected) ? selected : languages[0]!;
  const set = (i: number, patch: Partial<StructureEntry>) => onChange(entries.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const move = (i: number, delta: number) => {
    const next = [...entries];
    const [e] = next.splice(i, 1);
    next.splice(i + delta, 0, e!);
    onChange(next);
  };
  return (
    <fieldset>
      <legend>{title}</legend>
      <table className="channels structure-table">
        <thead>
          <tr>
            <th>#</th>
            <th>{tr('Code')}</th>
            <th>{tr('Description ({language})', { language })}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={i}>
              <td className="order">{i + 1}</td>
              <td>
                <input value={e.code} onChange={(ev) => set(i, { code: ev.target.value })} aria-label={tr('Code')} />
              </td>
              <td>
                <LineInput
                  value={typeof e.description === 'string' ? e.description : (e.description?.[language] ?? '')}
                  aria-label={tr('Description')}
                  onChange={(v) => {
                    const description = toLocalized({ ...texts(e.description, languages), [language]: v });
                    const next = { ...e };
                    if (description === null) delete next.description;
                    else next.description = description;
                    onChange(entries.map((x, j) => (j === i ? next : x)));
                  }}
                />
              </td>
              <td className="row-buttons">
                <button type="button" className="panel-icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label={tr('Move up')} title={tr('Move up')}>
                  <Icon name="up" />
                </button>
                <button type="button" className="panel-icon" disabled={i === entries.length - 1} onClick={() => move(i, 1)} aria-label={tr('Move down')} title={tr('Move down')}>
                  <Icon name="down" />
                </button>
                <button type="button" className="panel-icon" onClick={() => onChange(entries.filter((_, j) => j !== i))} aria-label={tr('Remove')} title={tr('Remove')}>
                  <Icon name="delete" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={() => onChange([...entries, { code: '' }])}>
        {tr('+ Add')}
      </button>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Project settings and potentials

function ProjectDialog() {
  const store = useStore();
  const doc = useEditor((s) => s.doc)!;
  const { project } = doc.state;
  const [tab, setTab] = useState<'general' | 'settings' | 'structure' | 'potentials' | 'media' | 'plcs'>('general');
  const [media, setMedia] = useState<Medium[]>(project.media ?? []);
  const [plcs, setPlcs] = useState<PlcStation[]>(project.plcs);
  const [structures, setStructures] = useState(() => structuredClone(project.structures ?? { function: [], location: [] }));
  const [name, setName] = useState(project.name);
  const [properties, setProperties] = useState({ customer: '', drawingNumber: '', createdBy: '', ...project.properties });
  const [settings, setSettings] = useState<ProjectSettings>(project.settings);
  const [languages, setLanguages] = useState(project.settings.languages.join(', '));
  const [description, setDescription] = useState(() => texts(project.description, project.settings.languages));
  const [potentials, setPotentials] = useState<Potential[]>(project.potentials);

  const ok = () => {
    const result = store.apply(
      [
        { type: 'setProjectProperties', name, description: toLocalized(description), properties: Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, v || null])) },
        { type: 'setProjectSettings', settings: withLanguages(settings, languages) },
        { type: 'setPotentials', potentials: potentials.filter((p) => p.name.trim() !== '') },
        { type: 'setMedia', media: media.filter((m) => m.name.trim() !== '') },
        { type: 'setPlcs', plcs: plcs.filter((p) => p.name.trim() !== '') },
        {
          type: 'setStructures',
          structures: {
            function: structures.function.filter((e) => e.code.trim() !== '').map((e) => ({ ...e, code: e.code.trim() })),
            location: structures.location.filter((e) => e.code.trim() !== '').map((e) => ({ ...e, code: e.code.trim() })),
          },
        },
      ],
      'project settings',
    );
    if (result) store.set({ dialog: null, language: store.state.doc!.state.project.settings.displayLanguage });
  };
  return (
    <Modal title={tr('Project settings')} onOk={ok} wide>
      <div className="tabs">
        {(['general', 'settings', 'structure', 'potentials', 'media', 'plcs'] as const).map((t) => (
          <button type="button" key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {tr({ general: 'General', settings: 'Settings', structure: 'Structure', potentials: 'Potentials', media: 'Media', plcs: 'PLCs' }[t])}
          </button>
        ))}
      </div>
      {tab === 'general' && (
        <>
          <Field label={tr('Project name')}>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <LanguageFields label={tr('Description')} values={description} onChange={setDescription} />
          {Object.entries(properties).map(([key, value]) => (
            <Field key={key} label={tr({ customer: 'Customer', drawingNumber: 'Drawing number', createdBy: 'Created by' }[key] ?? key)}>
              <input value={value} onChange={(e) => setProperties({ ...properties, [key]: e.target.value })} />
            </Field>
          ))}
        </>
      )}
      {tab === 'settings' && <SettingsFields settings={settings} onChange={setSettings} languages={languages} onLanguages={setLanguages} />}
      {tab === 'plcs' && <PlcStationsEditor plcs={plcs} onChange={setPlcs} />}
      {tab === 'structure' && (
        <>
          <p className="hint">
            {tr('Functions (=) and locations (+) with a description. Their order sorts the pages (by function, then location) in the page list, PDF and print; codes that are not listed come last.')}
          </p>
          <div className="translations-tools">
            <button
              type="button"
              onClick={() => {
                const used = usedStructureCodes(doc.state);
                setStructures({
                  function: [...structures.function, ...used.function.filter((c) => !structures.function.some((e) => e.code === c)).map((code) => ({ code }))],
                  location: [...structures.location, ...used.location.filter((c) => !structures.location.some((e) => e.code === c)).map((code) => ({ code }))],
                });
              }}
            >
              {tr('Add codes used in the project')}
            </button>
          </div>
          <div className="columns">
            {(['function', 'location'] as const).map((aspect) => (
              <StructureEditor
                key={aspect}
                title={aspect === 'function' ? tr('Functions (=)') : tr('Locations (+)')}
                entries={structures[aspect]}
                languages={project.settings.languages}
                onChange={(entries) => setStructures({ ...structures, [aspect]: entries })}
              />
            ))}
          </div>
        </>
      )}
      {tab === 'media' && <MediaEditor media={media} onChange={setMedia} />}
      {tab === 'potentials' && <PotentialsEditor potentials={potentials} onChange={setPotentials} />}
    </Modal>
  );
}

/** Settings of a project (Project settings) or of new projects (Machine settings). */
function SettingsFields({
  settings,
  onChange: setSettings,
  languages,
  onLanguages: setLanguages,
}: {
  settings: ProjectSettings;
  onChange: (s: ProjectSettings) => void;
  /** Comma separated, as typed. */
  languages: string;
  onLanguages: (l: string) => void;
}) {
  const store = useStore();
  const language = useEditor((s) => s.language);
  return (
    <>
      <Field label={tr('Default frame')}>
        <select value={settings.defaultFrame} onChange={(e) => setSettings({ ...settings, defaultFrame: e.target.value })}>
          {store.library.frames().map((f) => (
            <option key={f.id} value={f.id}>
              {localize(f.name, language, ['en'])} ({f.id})
            </option>
          ))}
        </select>
      </Field>
      <Field label={tr('Languages (comma separated)')}>
        <input value={languages} onChange={(e) => setLanguages(e.target.value)} />
      </Field>
      <Field label={tr('Display language')}>
        <input value={settings.displayLanguage} onChange={(e) => setSettings({ ...settings, displayLanguage: e.target.value })} />
      </Field>
      <Field label={tr('Device naming')}>
        <select value={settings.deviceNaming.scheme} onChange={(e) => setSettings({ ...settings, deviceNaming: { ...settings.deviceNaming, scheme: e.target.value as 'pageColumn' | 'counter', format: e.target.value === 'counter' ? '{letter}{counter}' : '{page}{letter}{column}' } })}>
          <option value="pageColumn">{tr('By page and column (-5K3)')}</option>
          <option value="counter">{tr('Counter (-K1, -K2 …)')}</option>
        </select>
      </Field>
      <div className="tag-fields">
        <Field label={tr('Name format')}>
          <input value={settings.deviceNaming.format} onChange={(e) => setSettings({ ...settings, deviceNaming: { ...settings.deviceNaming, format: e.target.value } })} />
        </Field>
        <Field label={tr('Duplicate suffix')}>
          <input value={settings.deviceNaming.duplicateSuffix} onChange={(e) => setSettings({ ...settings, deviceNaming: { ...settings.deviceNaming, duplicateSuffix: e.target.value } })} />
        </Field>
      </div>
      <p className="hint">{tr('Placeholders: {placeholders}; the suffix needs {suffix}.', { placeholders: '{page} {letter} {column} {column:2} {row} {counter}', suffix: '{n}' })}</p>
      <div className="tag-fields">
        <Field label={tr('Cross-reference format')}>
          <input value={settings.crossReferences.format} onChange={(e) => setSettings({ ...settings, crossReferences: { ...settings.crossReferences, format: e.target.value } })} />
        </Field>
        <Field label={tr('Show structure')}>
          <select value={settings.crossReferences.structure} onChange={(e) => setSettings({ ...settings, crossReferences: { ...settings.crossReferences, structure: e.target.value as 'always' | 'whenDifferent' } })}>
            <option value="whenDifferent">{tr('When different')}</option>
            <option value="always">{tr('Always')}</option>
          </select>
        </Field>
      </div>
      <div className="tag-fields">
        <Field label={tr('Contact image')}>
          <select value={settings.contactImage} onChange={(e) => setSettings({ ...settings, contactImage: e.target.value as ProjectSettings['contactImage'] })}>
            <option value="table">{tr('Graphical table')}</option>
            <option value="path">{tr('Text in path')}</option>
            <option value="none">{tr('None')}</option>
          </select>
        </Field>
        <Field label={tr('Default grid')}>
          <select value={settings.defaultGridMm} onChange={(e) => setSettings({ ...settings, defaultGridMm: Number(e.target.value) as ProjectSettings['defaultGridMm'] })}>
            {[1, 2, 4, 8].map((g) => (
              <option key={g} value={g}>
                {g} {tr('mm')}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="tag-fields">
        <Field label={tr('Default wire color')}>
          <input value={settings.defaultWire.color} onChange={(e) => setSettings({ ...settings, defaultWire: { ...settings.defaultWire, color: e.target.value } })} />
        </Field>
        <Field label={tr('Default cross-section (mm²)')}>
          <input type="number" step={0.25} min={0.1} value={settings.defaultWire.crossSection} onChange={(e) => setSettings({ ...settings, defaultWire: { ...settings.defaultWire, crossSection: Number(e.target.value) || 1.5 } })} />
        </Field>
      </div>
    </>
  );
}

/** Potentials with type, voltage, line and wire defaults (Project and Machine settings). */
function PotentialsEditor({ potentials, onChange: setPotentials }: { potentials: Potential[]; onChange: (p: Potential[]) => void }) {
  const setPotential = (i: number, patch: Partial<Potential>) => setPotentials(potentials.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <>
      <table className="potentials">
        <thead>
          <tr>
            <th>{tr('Name')}</th>
            <th>{tr('Type')}</th>
            <th>{tr('Voltage')}</th>
            <th>{tr('Line color')}</th>
            <th>{tr('Line style')}</th>
            <th>{tr('Wire color')}</th>
            <th>{tr('mm²')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {potentials.map((p, i) => (
            <tr key={i}>
              <td>
                <input value={p.name} onChange={(e) => setPotential(i, { name: e.target.value })} />
              </td>
              <td>
                <select value={p.type} onChange={(e) => setPotential(i, { type: e.target.value as Potential['type'] })}>
                  {potentialTypeSchema.options.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </td>
              <td>
                <input value={p.voltage ?? ''} onChange={(e) => setPotential(i, { voltage: e.target.value || undefined })} />
              </td>
              <td>
                {/* Without an own color the type's default is shown (and used). */}
                <input
                  type="color"
                  value={p.line?.color ?? TYPE_COLORS[p.type]}
                  title={p.line?.color ? tr('Own color') : tr('Default color of type {type}', { type: p.type })}
                  onChange={(e) => setPotential(i, { line: { ...p.line, color: e.target.value } })}
                />
                {p.line?.color && (
                  <button type="button" title={tr('Use the default color of the type')} onClick={() => setPotential(i, { line: { ...p.line, color: undefined } })}>
                    ↺
                  </button>
                )}
              </td>
              <td>
                <select value={p.line?.style ?? ''} onChange={(e) => setPotential(i, { line: { ...p.line, style: (e.target.value || undefined) as never } })}>
                  <option value="">{tr('default')}</option>
                  <option value="solid">{tr('solid')}</option>
                  <option value="dash">{tr('dashed')}</option>
                  <option value="dashdot">{tr('dash-dot')}</option>
                </select>
              </td>
              <td>
                <input list="sg-wire-colors" value={p.wire?.color ?? ''} onChange={(e) => setPotential(i, { wire: { ...p.wire, color: e.target.value || undefined } })} />
              </td>
              <td>
                <input type="number" step={0.25} min={0} value={p.wire?.crossSection ?? ''} onChange={(e) => setPotential(i, { wire: { ...p.wire, crossSection: Number(e.target.value) || undefined } })} />
              </td>
              <td>
                <button type="button" onClick={() => setPotentials(potentials.filter((_, j) => j !== i))}>×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={() => setPotentials([...potentials, { name: '', type: 'other' }])}>
        {tr('+ Potential')}
      </button>
      <p className="hint">{tr('Default line colors by type: L black, N light blue, PE green dashed, + (24V) red, − (0V) dark blue. ↺ returns to the default. Connections without a potential are red.')}</p>
    </>
  );
}

const MEDIUM_TYPES: Medium['type'][] = ['pressure', 'exhaust', 'pilot', 'vacuum', 'hydraulicPressure', 'hydraulicReturn', 'other'];
const MEDIUM_TYPE_NAMES: Record<Medium['type'], string> = {
  pressure: 'Compressed air',
  exhaust: 'Exhaust',
  pilot: 'Pilot line',
  vacuum: 'Vacuum',
  hydraulicPressure: 'Hydraulic pressure',
  hydraulicReturn: 'Hydraulic return',
  other: 'Other',
};

/** Media of pipes (pneumatics, hydraulics): name, type, pressure, line color and style. */
function MediaEditor({ media, onChange }: { media: Medium[]; onChange: (m: Medium[]) => void }) {
  const set = (i: number, patch: Partial<Medium>) => onChange(media.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  return (
    <>
      <table className="potentials">
        <thead>
          <tr>
            <th>{tr('Name')}</th>
            <th>{tr('Type')}</th>
            <th>{tr('Pressure')}</th>
            <th>{tr('Line color')}</th>
            <th>{tr('Line style')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {media.map((m, i) => (
            <tr key={i}>
              <td>
                <input value={m.name} onChange={(e) => set(i, { name: e.target.value })} />
              </td>
              <td>
                <select value={m.type} onChange={(e) => set(i, { type: e.target.value as Medium['type'] })}>
                  {MEDIUM_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {tr(MEDIUM_TYPE_NAMES[t])}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input placeholder="6 bar" value={m.pressure ?? ''} onChange={(e) => set(i, { pressure: e.target.value || undefined })} />
              </td>
              <td>
                <input
                  type="color"
                  value={m.line?.color ?? PIPE_COLOR}
                  title={m.line?.color ? tr('Own color') : tr('Default: gray')}
                  onChange={(e) => set(i, { line: { ...m.line, color: e.target.value } })}
                />
                {m.line?.color && (
                  <button type="button" title={tr('Back to gray')} onClick={() => set(i, { line: { ...m.line, color: undefined } })}>
                    ↺
                  </button>
                )}
              </td>
              <td>
                <select value={m.line?.style ?? ''} onChange={(e) => set(i, { line: { ...m.line, style: (e.target.value || undefined) as never } })}>
                  <option value="">{tr('default')}</option>
                  <option value="solid">{tr('solid')}</option>
                  <option value="dash">{tr('dashed')}</option>
                  <option value="dashdot">{tr('dash-dot')}</option>
                </select>
              </td>
              <td>
                <button type="button" onClick={() => onChange(media.filter((_, j) => j !== i))}>×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={() => onChange([...media, { name: '', type: 'pressure' }])}>
        {tr('+ Medium')}
      </button>
      <p className="hint">{tr('Pipes (pneumatics, hydraulics) carry a medium from a pressure source with its name, like wires carry a potential. They are gray unless the medium has its own color; pilot lines are dashed. Pipes never connect to wires.')}</p>
    </>
  );
}

/** Settings from the languages field: the display language must be one of the languages. */
function withLanguages(settings: ProjectSettings, languages: string): ProjectSettings {
  const langs = languages.split(',').map((l) => l.trim()).filter(Boolean);
  if (langs.length === 0) return settings;
  return { ...settings, languages: langs, displayLanguage: langs.includes(settings.displayLanguage) ? settings.displayLanguage : langs[0]! };
}

// ---------------------------------------------------------------------------
// Machine settings: defaults of this installation

function MachineDialog() {
  const store = useStore();
  const machine = useEditor((s) => s.machine);
  const doc = useEditor((s) => s.doc);
  const [tab, setTab] = useState<'settings' | 'potentials' | 'ai'>('settings');
  const [initial] = useState(() => projectDefaults(machine));
  const [mcpEnabled, setMcpEnabled] = useState(machine.mcp?.enabled ?? false);
  const [mcpPort, setMcpPort] = useState(String(machine.mcp?.port ?? ''));
  const [live, setLive] = useState<Awaited<ReturnType<NonNullable<typeof store.host.liveStatus>>> | null>(null);
  useEffect(() => {
    void store.host.liveStatus?.().then(setLive);
  }, [store]);
  const [settings, setSettings] = useState<ProjectSettings>(initial.settings);
  const [languages, setLanguages] = useState(initial.settings.languages.join(', '));
  const [potentials, setPotentials] = useState<Potential[]>(initial.potentials);
  const [error, setError] = useState<string | null>(null);
  const [ui, setUi] = useState(machine.uiLanguage ?? '');
  const use = (defaults: { settings: ProjectSettings; potentials: Potential[] }) => {
    setSettings(structuredClone(defaults.settings));
    setLanguages(defaults.settings.languages.join(', '));
    setPotentials(structuredClone(defaults.potentials));
  };
  const ok = async () => {
    const rest: MachineSettings = { ...machine };
    delete rest.uiLanguage;
    const port = Number(mcpPort);
    const next: MachineSettings = {
      ...rest,
      ...(ui ? { uiLanguage: ui } : {}),
      newProject: { settings: withLanguages(settings, languages), potentials: potentials.filter((p) => p.name.trim() !== '') },
      ...(store.host.liveStatus ? { mcp: { enabled: mcpEnabled, ...(mcpPort.trim() && Number.isInteger(port) ? { port } : {}) } } : {}),
    };
    const valid = machineSettingsSchema.safeParse(next);
    if (!valid.success) {
      setError(valid.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      return;
    }
    try {
      await store.host.saveMachineSettings(valid.data);
      setUiLanguage(valid.data.uiLanguage);
      store.set({ machine: valid.data, dialog: null });
      store.notify('Machine settings saved');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal title={tr('Machine settings')} onOk={() => void ok()} wide>
      <Field label={tr('Software language')}>
        <select value={ui} onChange={(e) => setUi(e.target.value)}>
          <option value="">{tr('Like the operating system')}</option>
          {UI_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </Field>
      <p className="hint">{tr('Defaults of this computer. New projects start with these settings and potentials; open projects keep their own (Project settings).')}</p>
      <div className="tabs">
        {(store.host.liveStatus ? (['settings', 'potentials', 'ai'] as const) : (['settings', 'potentials'] as const)).map((t) => (
          <button type="button" key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {tr({ settings: 'New projects', potentials: 'Potentials', ai: 'AI assistants (MCP)' }[t])}
          </button>
        ))}
      </div>
      <div className="translations-tools">
        {doc && (
          <button type="button" title={tr('Use the settings and potentials of the open project as defaults')} onClick={() => use({ settings: doc.state.project.settings, potentials: doc.state.project.potentials })}>
            {tr('Take from the open project')}
          </button>
        )}
        <button type="button" title={tr('Back to Wirewright\'s built-in defaults')} onClick={() => use(projectDefaults({}))}>
          {tr('Built-in defaults')}
        </button>
      </div>
      {tab === 'settings' && <SettingsFields settings={settings} onChange={setSettings} languages={languages} onLanguages={setLanguages} />}
      {tab === 'potentials' && <PotentialsEditor potentials={potentials} onChange={setPotentials} />}
      {tab === 'ai' && live && (
        <>
          <label className="check">
            <input type="checkbox" checked={mcpEnabled} onChange={(e) => setMcpEnabled(e.target.checked)} /> {tr('Let AI assistants work on the open project (MCP live mode)')}
          </label>
          <Field label={tr('Port')}>
            <input inputMode="numeric" placeholder={String(live.defaultPort)} value={mcpPort} onChange={(e) => setMcpPort(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <p className="hint">
            {tr('The assistant then reads the drawing open in this window and changes it directly; each change is one step that Ctrl+Z undoes. Save as usual. The server listens on this computer only (127.0.0.1) and needs the access token.')}
          </p>
          <p className="hint">
            {live.running ? tr('Running at {url}', { url: live.url }) : live.error ? tr('Not running: {error}', { error: live.error }) : tr('Not running')}
          </p>
          <Field label={tr('Claude Code')}>
            <textarea
              readOnly
              rows={3}
              value={`claude mcp add --transport http wirewright http://127.0.0.1:${mcpPort || live.defaultPort}/mcp --header "Authorization: Bearer ${live.token}"`}
              onFocus={(e) => e.target.select()}
            />
          </Field>
          <p className="hint">{tr('Other MCP clients: URL http://127.0.0.1:{port}/mcp (Streamable HTTP), header "Authorization: Bearer <token>". Keep the token private.', { port: mcpPort || live.defaultPort })}</p>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}

function PlcStationsEditor({ plcs, onChange }: { plcs: PlcStation[]; onChange: (p: PlcStation[]) => void }) {
  const set = (i: number, patch: Partial<PlcStation>) => onChange(plcs.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const first = (p: PlcStation, k: IoKind) => (p.firstAddress?.[k] !== undefined ? formatStart(p, k, p.firstAddress[k]!) : '');
  return (
    <>
      <table className="potentials">
        <thead>
          <tr>
            <th>{tr('Name')}</th>
            <th>{tr('Family')}</th>
            <th>{tr('Variant')}</th>
            <th>{tr('First DI')}</th>
            <th>{tr('First DO')}</th>
            <th>{tr('First AI')}</th>
            <th>{tr('First AO')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {plcs.map((p, i) => (
            <tr key={i}>
              <td>
                <input value={p.name} onChange={(e) => set(i, { name: e.target.value })} />
              </td>
              <td>
                <select value={p.family} onChange={(e) => set(i, { family: e.target.value as PlcStation['family'] })}>
                  <option value="siemens">{tr('Siemens')}</option>
                  <option value="codesys">{tr('Codesys')}</option>
                  <option value="mitsubishi">{tr('Mitsubishi')}</option>
                </select>
              </td>
              <td>
                {p.family === 'siemens' && (
                  <select value={p.mnemonic ?? 'international'} onChange={(e) => set(i, { mnemonic: e.target.value as 'international' | 'german' })}>
                    <option value="international">I/Q</option>
                    <option value="german">E/A</option>
                  </select>
                )}
                {p.family === 'mitsubishi' && (
                  <select value={p.mitsubishiSeries ?? 'iqr'} onChange={(e) => set(i, { mitsubishiSeries: e.target.value as 'fx' | 'iqr' })}>
                    <option value="iqr">{tr('Q / iQ-R (hex)')}</option>
                    <option value="fx">{tr('FX / iQ-F (octal)')}</option>
                  </select>
                )}
              </td>
              {IO_KINDS.map((k) => (
                <td key={k}>
                  <input
                    defaultValue={first(p, k)}
                    disabled={p.family === 'mitsubishi' && (k === 'AI' || k === 'AO')}
                    onBlur={(e) => {
                      const value = parseStart(p, k, e.target.value);
                      const firstAddress = { ...p.firstAddress };
                      if (value === undefined) delete firstAddress[k];
                      else firstAddress[k] = value;
                      set(i, { firstAddress });
                    }}
                  />
                </td>
              ))}
              <td>
                <button type="button" onClick={() => onChange(plcs.filter((_, j) => j !== i))}>×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={() => onChange([...plcs, { name: `PLC${plcs.length + 1}`, family: 'siemens' }])}>
        {tr('+ PLC')}
      </button>
      <p className="hint">
        {tr('Addresses are written in the PLC\'s notation: Siemens I4.0 / E4.0, Codesys %IX4.0 / %IW32, Mitsubishi X40. The first addresses are used by the numbering in the PLC dialog.')}
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// PLC: address numbering and exports

function PlcDialog({ station: initialStation }: { station?: string | undefined }) {
  const store = useStore();
  const doc = useEditor((s) => s.doc)!;
  const selection = useEditor((s) => s.selection);
  const language = useEditor((s) => s.language);
  const plcs = doc.state.project.plcs;
  const [station, setStation] = useState(initialStation ?? plcs[0]?.name ?? '');
  const [scope, setScope] = useState<'all' | 'selected' | 'missing'>('missing');
  const [step, setStep] = useState('');
  const current = plcs.find((p) => p.name === station);
  const [format, setFormat] = useState<PlcExportFormat>('csv');
  const selectedCards = selection.items.flatMap((id) => {
    const card = doc.plc().byCard.get(id);
    return card ? [card.device] : [];
  });
  const cards = doc.plc().cards.filter((c) => c.station?.name === station);

  const number = () => {
    const result = store.apply(
      {
        type: 'assignPlcAddresses',
        station,
        ...(scope === 'selected' ? { devices: selectedCards } : {}),
        ...(scope === 'missing' ? { onlyMissing: true } : {}),
        ...(Number(step) >= 1 ? { step: Math.trunc(Number(step)) } : {}),
      },
      'number PLC addresses',
    );
    if (result) store.notify('Addresses numbered');
  };
  const [importComments, setImportComments] = useState(false);
  const importTags = async (file: File) => {
    try {
      const rows = readPlcTags(new Uint8Array(await file.arrayBuffer()));
      const plan = planPlcTagImport(doc.state, doc.plc(), station, rows, { comments: importComments, language });
      store.set({ dialog: { kind: 'plcImport', station, plan, comments: importComments } });
    } catch (error) {
      store.notify(tr('Import failed: {error}', { error: (error as Error).message }), true);
    }
  };
  const exportFile = () => {
    try {
      const file = exportPlc(doc.reportContext(), station, format, language);
      void store.host.saveFile(file.fileName, file.content, file.mimeType);
    } catch (error) {
      store.notify((error as Error).message, true);
    }
  };

  if (plcs.length === 0) {
    return (
      <Modal title={tr('PLC')}>
        <p>{tr('There are no PLCs in this project yet. Add them in Settings → PLCs, then assign I/O cards to them in the card\'s properties.')}</p>
      </Modal>
    );
  }
  return (
    <Modal title={tr('PLC addresses and export')} wide>
      <Field label={tr('PLC')}>
        <select value={station} onChange={(e) => setStation(e.target.value)}>
          {plcs.map((p) => (
            <option key={p.name}>{p.name}</option>
          ))}
        </select>
      </Field>
      <fieldset>
        <legend>{tr('Number start addresses')}</legend>
        <div className="checks">
          <label>
            <input type="radio" checked={scope === 'missing'} onChange={() => setScope('missing')} /> {tr('Only cards without address')}
          </label>
          <label>
            <input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} /> {tr('All cards of {plc}', { plc: station ?? '' })}
          </label>
          <label>
            <input type="radio" checked={scope === 'selected'} disabled={selectedCards.length === 0} onChange={() => setScope('selected')} /> {tr('Selected cards ({count})', { count: selectedCards.length })}
          </label>
        </div>
        <Field label={current?.family === 'mitsubishi' ? tr('Step (points between card starts; empty: packed)') : tr('Step (bytes between card starts; empty: packed)')}>
          <input value={step} inputMode="numeric" placeholder={tr('packed')} onChange={(e) => setStep(e.target.value)} />
        </Field>
        <p className="hint">
          {tr('Cards are numbered in slot order (then by tag), from the PLC\'s first addresses; cards that keep their addresses are skipped. Step 10: I0.0–I0.7, I10.0–I10.7, I20.0 …')}
        </p>
        <button type="button" className="primary" onClick={number} disabled={scope === 'selected' && selectedCards.length === 0}>
          {tr('Number addresses')}
        </button>
      </fieldset>
      <fieldset>
        <legend>{tr('Cards of {plc}', { plc: station ?? '' })}</legend>
        <table className="channels">
          <thead>
            <tr>
              <th>{tr('Slot')}</th>
              <th>{tr('Card')}</th>
              <th>{tr('Channels')}</th>
              <th>{tr('Addresses')}</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((c) => (
              <tr key={c.device}>
                <td>{c.slot ?? ''}</td>
                <td>{c.device}</td>
                <td>{c.channels.length}</td>
                <td className="derived">{[c.channels[0]?.address, c.channels.at(-1)?.address].filter(Boolean).join(' … ') || '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </fieldset>
      <fieldset>
        <legend>{tr('Export')}</legend>
        <div className="tag-fields">
          <Field label={tr('Format')}>
            <select value={format} onChange={(e) => setFormat(e.target.value as PlcExportFormat)}>
              {(current ? exportFormats(current) : (['csv'] as PlcExportFormat[])).map((f) => (
                <option key={f} value={f}>
                  {tr({ csv: 'I/O list (CSV)', tia: 'TIA Portal PLC tag table (.xlsx)', codesys: 'Codesys GVL', gxworks3: 'GX Works3 global labels' }[f])}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <button type="button" onClick={exportFile}>
          {tr('Export…')}
        </button>
      </fieldset>
      <fieldset>
        <legend>{tr('Import tag names')}</legend>
        <p className="hint">
          {tr('Takes the tag names (and comments) from the PLC project back into the channels, matched by address: TIA Portal tag table (.xlsx), Codesys GVL, GX Works3 global labels or the I/O list (CSV). You review the changes before they are applied.')}
        </p>
        <label className="check">
          <input type="checkbox" checked={importComments} onChange={(e) => setImportComments(e.target.checked)} /> {tr('Also take comments as channel functions ({language})', { language })}
        </label>
        <label className="button with-icon">
          <Icon name="upload" /> {tr('Import…')}
          <input
            type="file"
            accept=".xlsx,.csv,.txt,.gvl,.st,.exp"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void importTags(file);
            }}
          />
        </label>
      </fieldset>
    </Modal>
  );
}

/** Opens the symbol editor with a symbol made from a device box (saved only from there). */
export function openBoxAsSymbol(store: ReturnType<typeof useStore>, pageId: string, itemId: string): void {
  const doc = store.state.doc;
  if (!doc) return;
  try {
    const initial = symbolFromDeviceBox(renderContext(doc), pageId, itemId);
    store.set({ dialog: { kind: 'symbolEditor', mode: 'symbol', initial } });
  } catch (error) {
    store.notify((error as Error).message, true);
  }
}

/** Revisions: release a new one, see the list, compare the drawing with one. */
function RevisionsDialog() {
  const store = useStore();
  const doc = useEditor((s) => s.doc)!;
  const compare = useEditor((s) => s.compare);
  useEditor((s) => s.version);
  const revisions = doc.state.project.revisions ?? [];
  const [name, setName] = useState(() => nextRevisionName(revisions));
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [author, setAuthor] = useState(() => doc.state.project.properties.createdBy ?? '');
  const [description, setDescription] = useState('');
  const changes = compare ? store.changes() : null;
  const pageName = (id: string) => (doc.state.pages[id] ? pageFullName(doc.state.pages[id]) : id);
  const release = async () => {
    if (!name.trim()) return store.notify('Give the revision a name', true);
    const ok = await store.createRevision({ name: name.trim(), date, ...(author.trim() ? { author: author.trim() } : {}), ...(description.trim() ? { description: description.trim() } : {}) });
    if (ok) {
      store.notify(tr('Revision {name} released', { name: name.trim() }));
      setName(nextRevisionName(store.state.doc!.state.project.revisions ?? []));
      setDescription('');
    }
  };
  return (
    <Modal title={tr('Revisions')} wide>
      {revisions.length > 0 ? (
        <table className="channels">
          <thead>
            <tr>
              <th>{tr('Revision')}</th>
              <th>{tr('Date')}</th>
              <th>{tr('Author')}</th>
              <th>{tr('Description')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {[...revisions].reverse().map((r) => (
              <tr key={r.name}>
                <td>
                  <b>{r.name}</b>
                </td>
                <td>{r.date}</td>
                <td>{r.author ?? ''}</td>
                <td>{r.description ?? ''}</td>
                <td>
                  <button type="button" className={compare?.name === r.name ? 'pressed' : undefined} onClick={() => void store.compareWith(compare?.name === r.name ? null : r.name)}>
                    {compare?.name === r.name ? tr('Stop comparing') : tr('Show changes since')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="hint">{tr('No revision released yet.')}</p>
      )}
      {changes && compare && (
        <fieldset>
          <legend>{tr('Changes since revision {name}', { name: compare.name })}</legend>
          <ul className="revision-summary">
            {changes.addedPages.length > 0 && <li>{tr('New pages: {pages}', { pages: changes.addedPages.map(pageName).join(', ') })}</li>}
            {changes.changedPages.length > 0 && <li>{tr('Changed pages: {pages}', { pages: changes.changedPages.map(pageName).join(', ') })}</li>}
            {changes.removedPages.length > 0 && <li>{tr('Deleted pages: {pages}', { pages: changes.removedPages.map((p) => pageFullName(p)).join(', ') })}</li>}
            {changes.project && <li>{tr('Project data (settings, potentials, PLCs, library) changed')}</li>}
            {changes.addedPages.length + changes.changedPages.length + changes.removedPages.length === 0 && !changes.project && <li>{tr('No changes.')}</li>}
          </ul>
          <p className="hint">{tr('On the pages: new symbols are framed green, changed ones orange; deleted ones are marked with a red × at their old place. Changed pages carry Δ in the Pages tab.')}</p>
        </fieldset>
      )}
      <fieldset>
        <legend>{tr('Release a revision')}</legend>
        <div className="tag-fields">
          <Field label={tr('Revision')}>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={tr('Date')}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={tr('Author')}>
            <input value={author} onChange={(e) => setAuthor(e.target.value)} />
          </Field>
        </div>
        <Field label={tr('Description')}>
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <button type="button" className="primary" onClick={() => void release()}>
          {tr('Release revision')}
        </button>
        <p className="hint">
          {tr('Pages changed since the previous revision (all pages for the first) get its name and date in their title block. The project is saved, and its state is kept in revisions/<name>.json for comparing later. A report page "Revisions" lists them.')}
        </p>
      </fieldset>
    </Modal>
  );
}

/** Review of a tag name import: every change can be left out before applying. */
function PlcImportDialog({ station, plan, comments }: { station: string; plan: PlcTagImport; comments: boolean }) {
  const store = useStore();
  const doc = useEditor((s) => s.doc)!;
  const language = useEditor((s) => s.language);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const chosen = plan.changes.filter((_, i) => !excluded.has(i));
  const ok = () => {
    if (chosen.length > 0 && !store.apply(plcTagImportCommands(doc.state, chosen, language), 'import PLC tag names')) return;
    store.set({ dialog: null });
    store.notify(tr('{count} channel(s) updated', { count: chosen.length }));
  };
  return (
    <Modal title={tr('Import tag names – {plc}', { plc: station })} onOk={ok} okLabel={tr('Apply ({count})', { count: chosen.length })} wide>
      <p className="hint">
        {tr('{changes} change(s), {unchanged} channel(s) already as in the file, {unmatched} row(s) without a matching address.', {
          changes: plan.changes.length,
          unchanged: plan.unchanged,
          unmatched: plan.unmatched.length,
        })}
      </p>
      {plan.changes.length > 0 && (
        <table className="channels renumber">
          <thead>
            <tr>
              <th />
              <th>{tr('Card')}</th>
              <th>{tr('Channel')}</th>
              <th>{tr('Address')}</th>
              <th>{tr('Tag name')}</th>
              {comments && <th>{tr('Function')}</th>}
            </tr>
          </thead>
          <tbody>
            {plan.changes.map((c, i) => (
              <tr key={i} className={excluded.has(i) ? 'kept' : undefined}>
                <td>
                  <input type="checkbox" aria-label={c.address} checked={!excluded.has(i)} onChange={(e) => setExcluded(toggle(excluded, i, !e.target.checked))} />
                </td>
                <td>{c.card}</td>
                <td>{c.channel}</td>
                <td>{c.address}</td>
                <td>{c.name ? `${c.name.from} → ${c.name.to}` : ''}</td>
                {comments && <td>{c.comment ? `${c.comment.from || '–'} → ${c.comment.to}` : ''}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {plan.unmatched.length > 0 && (
        <details>
          <summary>{tr('Rows without a matching address ({count})', { count: plan.unmatched.length })}</summary>
          <ul className="unmatched">
            {plan.unmatched.slice(0, 200).map((r, i) => (
              <li key={i}>
                <code>{r.address}</code> {r.name}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Parts database

const EMPTY_PART: PartDefinition = { id: '', manufacturer: '', partNumber: '' };

function PartsDialog({ select }: { select?: string | undefined }) {
  const store = useStore();
  const doc = useEditor((s) => s.doc)!;
  const language = useEditor((s) => s.language);
  useEditor((s) => s.version);
  const { languages } = doc.state.project.settings;
  const own = new Set((doc.state.library?.parts ?? []).map((p) => p.id));
  const parts = [...doc.library.parts()].sort((a, b) => naturalCompare(`${a.manufacturer} ${a.partNumber}`, `${b.manufacturer} ${b.partNumber}`));
  // Parts used in the drawing but not in the database yet.
  const used = new Map<string, { manufacturer: string; partNumber: string }>();
  for (const page of Object.values(doc.state.pages)) {
    if (page.type !== 'schematic') continue;
    for (const item of page.items) for (const p of item.props?.parts ?? []) used.set(partId(p.manufacturer, p.partNumber), p);
  }
  const missing = [...used].filter(([id, p]) => !doc.library.part(id) && !findPart(doc.library, p.manufacturer, p.partNumber));
  const [query, setQuery] = useState('');
  const [edit, setEdit] = useState<PartDefinition>(() => structuredClone(doc.library.part(select ?? '') ?? parts[0] ?? EMPTY_PART));
  const [shared, setShared] = useState(false);
  const shown = parts.filter((p) =>
    `${p.manufacturer} ${p.partNumber} ${localize(p.description, language, languages)} ${p.erpNumber ?? ''} ${p.orderNumber ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const set = (patch: Partial<PartDefinition>) => setEdit({ ...edit, ...patch });
  const num = (v: string) => (v.trim() === '' ? undefined : parseAmount(v));
  const save = async () => {
    if (!edit.partNumber.trim()) return store.notify('Give the part a part number', true);
    const part: PartDefinition = Object.fromEntries(
      Object.entries({ ...edit, manufacturer: edit.manufacturer.trim(), partNumber: edit.partNumber.trim(), id: partId(edit.manufacturer, edit.partNumber) }).filter(
        ([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0),
      ),
    ) as PartDefinition;
    if (part.suppliers) part.suppliers = part.suppliers.filter((s) => s.name.trim() !== '');
    // Renamed (other manufacturer or number): the old entry of the project is replaced.
    const commands: Command[] = [];
    if (edit.id && edit.id !== part.id && own.has(edit.id)) commands.push({ type: 'removeFromProjectLibrary', kind: 'parts', ids: [edit.id] });
    commands.push({ type: 'addToProjectLibrary', content: { parts: [part] } });
    if (!store.apply(commands, 'save part')) return;
    if (shared && store.host.saveToSharedLibrary) {
      try {
        await store.host.saveToSharedLibrary(part);
      } catch (error) {
        return store.notify(tr('Could not save to the library folder: {error}', { error: (error as Error).message }), true);
      }
    }
    setEdit(part);
    store.notify(tr('Saved {name} to the library', { name: `${part.manufacturer} ${part.partNumber}`.trim() }));
  };
  const remove = () => {
    if (store.apply({ type: 'removeFromProjectLibrary', kind: 'parts', ids: [edit.id] }, 'delete part')) setEdit(structuredClone(doc.library.part(edit.id) ?? EMPTY_PART));
  };
  const importFile = async (file: File) => {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (isBmecat(bytes)) return store.set({ dialog: { kind: 'catalogImport', catalog: readBmecat(bytes), fileName: file.name } });
      const imported = readPartsTable(bytes, language);
      if (imported.length === 0) return store.notify('No parts found in the file', true);
      if (store.apply({ type: 'addToProjectLibrary', content: { parts: imported } }, 'import parts')) store.notify(tr('{count} part(s) imported', { count: imported.length }));
    } catch (error) {
      store.notify(tr('Import failed: {error}', { error: (error as Error).message }), true);
    }
  };
  const exportFile = (format: 'csv' | 'xlsx') => {
    const table = partsTable(parts, language, languages);
    const base = `${doc.state.project.name || 'project'}-parts`.replace(/[^\p{L}\p{N}._-]+/gu, '_');
    if (format === 'csv') void store.host.saveFile(`${base}.csv`, tableToCsv(table), 'text/csv');
    else void store.host.saveFile(`${base}.xlsx`, xlsx('Parts', table), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };
  const description = texts(edit.description, languages);
  const suppliers = edit.suppliers ?? [];
  const setSupplier = (i: number, patch: Partial<PartSupplier>) => set({ suppliers: suppliers.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  return (
    <Modal title={tr('Parts database')} wide>
      <div className="parts-dialog">
        <div className="parts-list">
          <div className="translations-tools">
            <input placeholder={tr('Search parts…')} value={query} onChange={(e) => setQuery(e.target.value)} />
            <button type="button" onClick={() => setEdit(structuredClone(EMPTY_PART))}>
              {tr('+ Part')}
            </button>
          </div>
          <ul>
            {shown.map((p) => (
              <li key={p.id} className={p.id === edit.id ? 'active' : undefined}>
                <button type="button" onClick={() => setEdit(structuredClone(p))}>
                  <span className="name">
                    {p.manufacturer} <b>{p.partNumber}</b>
                  </span>
                  <span className="description">{localize(p.description, language, languages)}</span>
                  <span className="source">{own.has(p.id) ? tr('project') : tr('library')}</span>
                </button>
              </li>
            ))}
            {shown.length === 0 && <li className="empty">{tr('No parts yet. Add one, import a list from your ERP system (CSV or .xlsx) or a manufacturer catalog (BMEcat with ECLASS or ETIM, .xml or .zip).')}</li>}
          </ul>
          {missing.length > 0 && (
            <details>
              <summary>{tr('Used in the drawing, not in the database ({count})', { count: missing.length })}</summary>
              <ul>
                {missing.map(([id, p]) => (
                  <li key={id}>
                    <button type="button" onClick={() => setEdit({ id: '', manufacturer: p.manufacturer, partNumber: p.partNumber })}>
                      {p.manufacturer} <b>{p.partNumber}</b>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="translations-tools">
            <label className="button with-icon">
              <Icon name="upload" /> {tr('Import…')}
              <input
                type="file"
                accept=".csv,.xlsx,.xml,.zip,text/csv"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void importFile(file);
                }}
              />
            </label>
            <button type="button" className="with-icon" onClick={() => exportFile('csv')}>
              <Icon name="download" /> {tr('Export CSV')}
            </button>
            <button type="button" className="with-icon" onClick={() => exportFile('xlsx')}>
              <Icon name="download" /> {tr('Export .xlsx')}
            </button>
          </div>
        </div>
        <div className="parts-form">
          <div className="tag-fields">
            <Field label={tr('Manufacturer')}>
              <input value={edit.manufacturer} onChange={(e) => set({ manufacturer: e.target.value })} />
            </Field>
            <Field label={tr('Part number')}>
              <input value={edit.partNumber} onChange={(e) => set({ partNumber: e.target.value })} />
            </Field>
          </div>
          <LanguageFields label={tr('Description')} values={description} onChange={(v) => set({ description: toLocalized(v) ?? undefined })} />
          <div className="tag-fields">
            <Field label={tr('Order number')}>
              <input value={edit.orderNumber ?? ''} onChange={(e) => set({ orderNumber: e.target.value })} />
            </Field>
            <Field label={tr('ERP number')}>
              <input value={edit.erpNumber ?? ''} onChange={(e) => set({ erpNumber: e.target.value })} />
            </Field>
            <Field label="EAN">
              <input value={edit.ean ?? ''} onChange={(e) => set({ ean: e.target.value })} />
            </Field>
          </div>
          <div className="tag-fields">
            <Field label={tr('Price')}>
              <input inputMode="decimal" defaultValue={edit.price ?? ''} key={`price:${edit.id}`} onChange={(e) => set({ price: num(e.target.value) })} />
            </Field>
            <Field label={tr('Currency')}>
              <input list="sg-currencies" value={edit.currency ?? ''} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} />
            </Field>
            <Field label={tr('Price unit')}>
              <input inputMode="decimal" placeholder="1" defaultValue={edit.priceUnit ?? ''} key={`unit:${edit.id}`} onChange={(e) => set({ priceUnit: num(e.target.value) })} />
            </Field>
            <Field label={tr('Unit')}>
              <input placeholder="pcs" value={edit.unit ?? ''} onChange={(e) => set({ unit: e.target.value })} />
            </Field>
          </div>
          <div className="tag-fields">
            {edit.classification && edit.classification.length > 0 && (
              <p className="hint">{edit.classification.map((c) => `${c.system}: ${c.id}`).join(' · ')}</p>
            )}
            <Field label={tr('Rated voltage')}>
              <input placeholder="24 V DC" value={edit.ratedVoltage ?? ''} onChange={(e) => set({ ratedVoltage: e.target.value })} />
            </Field>
            <Field label={tr('Rated current (A)')}>
              <input inputMode="decimal" defaultValue={edit.ratedCurrent ?? ''} key={`current:${edit.id}`} onChange={(e) => set({ ratedCurrent: num(e.target.value) })} />
            </Field>
          </div>
          <div className="tag-fields">
            <Field label={tr('Width (mm)')}>
              <input inputMode="decimal" defaultValue={edit.width ?? ''} key={`width:${edit.id}`} onChange={(e) => set({ width: num(e.target.value) })} />
            </Field>
            <Field label={tr('Height (mm)')}>
              <input inputMode="decimal" defaultValue={edit.height ?? ''} key={`height:${edit.id}`} onChange={(e) => set({ height: num(e.target.value) })} />
            </Field>
            <Field label={tr('Depth (mm)')}>
              <input inputMode="decimal" defaultValue={edit.depth ?? ''} key={`depth:${edit.id}`} onChange={(e) => set({ depth: num(e.target.value) })} />
            </Field>
          </div>
          <datalist id="sg-currencies">
            {['EUR', 'USD', 'CHF', 'GBP'].map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <fieldset>
            <legend>{tr('Suppliers')}</legend>
            {suppliers.map((s, i) => (
              <div className="part-row supplier-row" key={i}>
                <input placeholder={tr('Supplier')} value={s.name} onChange={(e) => setSupplier(i, { name: e.target.value })} />
                <input placeholder={tr('Order number')} value={s.orderNumber ?? ''} onChange={(e) => setSupplier(i, { orderNumber: e.target.value || undefined })} />
                <input placeholder={tr('Price')} inputMode="decimal" defaultValue={s.price ?? ''} onChange={(e) => setSupplier(i, { price: num(e.target.value) })} />
                <input placeholder={tr('Days')} title={tr('Delivery time in working days')} inputMode="numeric" defaultValue={s.deliveryDays ?? ''} onChange={(e) => setSupplier(i, { deliveryDays: num(e.target.value) === undefined ? undefined : Math.round(num(e.target.value)!) })} />
                <button type="button" onClick={() => set({ suppliers: suppliers.filter((_, j) => j !== i) })}>×</button>
              </div>
            ))}
            <button type="button" onClick={() => set({ suppliers: [...suppliers, { name: '' }] })}>
              {tr('+ Supplier')}
            </button>
          </fieldset>
          <Field label="URL">
            <input value={edit.url ?? ''} onChange={(e) => set({ url: e.target.value })} />
          </Field>
          {edit.properties && Object.keys(edit.properties).length > 0 && (
            <p className="hint">{Object.entries(edit.properties).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>
          )}
          <div className="translations-tools">
            <button type="button" className="primary" onClick={() => void save()}>
              {tr('Save part')}
            </button>
            {store.host.saveToSharedLibrary && (
              <label className="check">
                <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> {tr('Also save to the shared library folder')}
              </label>
            )}
            {own.has(edit.id) && (
              <button type="button" onClick={remove}>
                {tr('Delete from project')}
              </button>
            )}
          </div>
          <p className="hint">{tr('Parts are matched to the devices by manufacturer and part number. The bill of materials takes description, prices, supplier and ERP number from here.')}</p>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Library

function LibraryDialog() {
  const store = useStore();
  const [folder, setFolder] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    void store.host.libraryFolder?.().then(setFolder);
  }, [store]);
  const lib = store.library;
  const project = store.state.doc?.state.library;
  return (
    <Modal title={tr('Device library')}>
      <p>
        {tr(
          "{devices} device definitions, {symbols} symbols available. The project's own library (library.json) holds {own} device definitions: every device placed from the library is copied there, so the project stays complete without the library folder.",
          { devices: lib.devices().length, symbols: lib.symbols().length, own: project?.devices?.length ?? 0 },
        )}
      </p>
      {store.host.chooseLibraryFolder ? (
        <>
          <Field label={tr('Shared library folder')}>
            <input readOnly value={folder ?? '(none)'} />
          </Field>
          <button
            type="button"
            onClick={() =>
              void store.host.chooseLibraryFolder!().then(async (f) => {
                if (!f) return;
                setFolder(f);
                await store.reload();
                store.notify('Library folder loaded');
              })
            }
          >
            {tr('Choose folder…')}
          </button>
          <p className="hint">{tr('The folder can be shared by all projects (e.g. on a network drive). Device definitions are JSON files in it, saved via "⇢ Library" in the Devices tab.')}</p>
        </>
      ) : (
        <p className="hint">{tr('A shared library folder is available in the desktop app.')}</p>
      )}
      <div className="translations-tools">
        <button type="button" className="with-icon" onClick={() => store.set({ dialog: { kind: 'symbolEditor', mode: 'symbol' } })}>
          <Icon name="symbolEditor" /> {tr('Symbol editor…')}
        </button>
        <button type="button" className="with-icon" onClick={() => store.set({ dialog: { kind: 'symbolEditor', mode: 'frame' } })}>
          <Icon name="frameEditor" /> {tr('Frame editor…')}
        </button>
        <button type="button" className="with-icon" onClick={() => store.set({ dialog: { kind: 'parts' } })}>
          <Icon name="parts" /> {tr('Parts database')}
        </button>
      </div>
    </Modal>
  );
}

function SaveDeviceDialog({ device }: { device: string }) {
  const store = useStore();
  const doc = useEditor((s) => s.doc)!;
  const d = doc.devices().devices.get(device);
  const mainItem = d?.main ? (doc.state.pages[d.main.pageId] as SchematicPage).items.find((i) => i.id === d.main!.itemId) : undefined;
  const part = mainItem?.props?.parts?.[0];
  const [id, setId] = useState(() => (part ? `${part.manufacturer}.${part.partNumber}` : (d?.tag.product ?? 'device')).toLowerCase().replace(/[^a-z0-9._-]+/g, '-'));
  const [name, setName] = useState(() => (part ? `${part.manufacturer} ${part.partNumber}` : localize(mainItem?.props?.functionText, store.state.language, ['en']) || device));
  const [shared, setShared] = useState(Boolean(store.host.saveToSharedLibrary));
  if (!d) return null;
  const ok = async () => {
    const def = definitionFromDevice(d, doc.state, id, name);
    if (!store.apply({ type: 'addToProjectLibrary', content: { devices: [def] } }, 'save device to library')) return;
    if (shared && store.host.saveToSharedLibrary) {
      try {
        await store.host.saveToSharedLibrary(def);
      } catch (error) {
        store.notify(tr('Could not save to the library folder: {error}', { error: (error as Error).message }), true);
        return;
      }
    }
    store.notify(tr('Saved {name} to the library', { name }));
    store.set({ dialog: null });
  };
  return (
    <Modal title={`Save ${device} as a device definition`} onOk={() => void ok()} okLabel={tr('Save')}>
      <Field label={tr('ID')}>
        <input value={id} onChange={(e) => setId(e.target.value)} />
      </Field>
      <Field label={tr('Name')}>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <p className="hint">
        {tr("The definition contains the device's {count} functions (symbols with pins and channels), its part and contact/channel lists. Place it again from Symbols → Devices; Tab steps through the functions.", { count: d.functions.length })}
      </p>
      {store.host.saveToSharedLibrary && (
        <label>
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> {tr('Also save to the shared library folder')}
        </label>
      )}
    </Modal>
  );
}

function SaveMacroDialog() {
  const store = useStore();
  const doc = useEditor((s) => s.doc)!;
  const sheet = useEditor((s) => s.sheet);
  const selection = useEditor((s) => s.selection.items);
  const language = useEditor((s) => s.language);
  const page = sheet ? doc.state.pages[sheet.pageId] : undefined;
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [shared, setShared] = useState(Boolean(store.host.saveToSharedLibrary));
  if (page?.type !== 'schematic') return null;
  const macroId =
    id ||
    name
      .toLowerCase()
      .replace(/ß/g, 'ss')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  const ok = async () => {
    if (!macroId) return store.notify('Give the macro a name', true);
    const macro = macroFromItems(page, selection, {
      id: macroId,
      name: { [language]: name || macroId },
      ...(description ? { description: { [language]: description } } : {}),
      ...(category ? { category } : {}),
    });
    if (!store.apply({ type: 'addToProjectLibrary', content: { macros: [macro] } }, 'save macro')) return;
    if (shared && store.host.saveToSharedLibrary) {
      try {
        await store.host.saveToSharedLibrary(macro);
      } catch (error) {
        store.notify(tr('Could not save to the library folder: {error}', { error: (error as Error).message }), true);
        return;
      }
    }
    store.notify(tr('Saved macro {name}', { name: name || macroId }));
    store.set({ dialog: null });
  };
  return (
    <Modal title={`Save ${selection.length} items as a macro`} onOk={() => void ok()} okLabel={tr('Save')}>
      <Field label={tr('Name')}>
        <input value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="tag-fields">
        <Field label={tr('ID')}>
          <input value={id} placeholder={macroId} onChange={(e) => setId(e.target.value)} />
        </Field>
        <Field label={tr('Category')}>
          <input value={category} onChange={(e) => setCategory(e.target.value)} />
        </Field>
      </div>
      <Field label={tr('Description')}>
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <p className="hint">
        {tr('Place it from Symbols → Macros. Placed macros take the structure of the target page; their devices get new names (contacts follow their coil), contacts of devices outside the macro keep their tag. Wire numbers and PLC addresses are not stored.')}
      </p>
      {store.host.saveToSharedLibrary && (
        <label>
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> {tr('Also save to the shared library folder')}
        </label>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Renumber devices: choose pages, then review the changes

function RenumberDialog() {
  const store = useStore();
  const doc = useEditor((s) => s.doc)!;
  const pages = doc.state.project.pages.map((id) => doc.state.pages[id]!).filter((p) => p.type === 'schematic');
  const [step, setStep] = useState<'pages' | 'review'>('pages');
  const [pageIds, setPageIds] = useState<Set<string>>(() => new Set(pages.map((p) => p.id)));
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const scope = { pageIds: [...pageIds] };
  // All candidates (to list them) and the plan with the exclusions (what really happens).
  const candidates = planRenumbering(doc.state, doc.library, scope);
  const plan = new Map(planRenumbering(doc.state, doc.library, { ...scope, exclude: [...excluded] }).map((c) => [c.from, c]));
  const apply = () => {
    if (plan.size === 0) return store.set({ dialog: null });
    const result = store.apply({ type: 'renumberDevices', pageIds: [...pageIds], ...(excluded.size > 0 ? { exclude: [...excluded] } : {}) }, 'renumber devices');
    if (result) {
      store.notify(tr('{count} device(s) renumbered', { count: plan.size }));
      store.set({ dialog: null });
    }
  };

  if (step === 'pages') {
    return (
      <Modal title={tr('Renumber devices – pages')} onOk={() => setStep('review')} okLabel={tr('Next')}>
        <p className="hint">{tr('Devices whose main function is on the selected pages get names by page and column (e.g. -5K3).')}</p>
        <PageTreeChecklist pages={pages} selected={pageIds} onChange={setPageIds} />
      </Modal>
    );
  }
  return (
    <Modal title={tr('Renumber devices – changes')} onOk={apply} okLabel={plan.size > 0 ? `Renumber ${plan.size} ${plan.size === 1 ? 'device' : 'devices'}` : 'Close'} wide>
      <div className="translations-tools">
        <button type="button" onClick={() => setStep('pages')}>{tr('← Pages')}</button>
        <span className="hint">
          {candidates.length === 0 ? tr('All devices on these pages already have their names.') : tr('Uncheck devices that keep their names; the others are numbered around them.')}
        </span>
      </div>
      {candidates.length > 0 && (
        <table className="channels renumber">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label={tr('All')}
                  checked={excluded.size === 0}
                  onChange={(e) => setExcluded(e.target.checked ? new Set() : new Set(candidates.map((c) => c.from)))}
                />
              </th>
              <th>{tr('Before')}</th>
              <th />
              <th>{tr('After')}</th>
              <th>{tr('Page')}</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => {
              const change = plan.get(c.from);
              const page = doc.state.pages[c.pageId]!;
              return (
                <tr key={c.from} className={change ? undefined : 'kept'}>
                  <td>
                    <input type="checkbox" aria-label={`Renumber ${c.from}`} checked={!excluded.has(c.from)} onChange={(e) => setExcluded(toggle(excluded, c.from, !e.target.checked))} />
                  </td>
                  <td>{c.from}</td>
                  <td>→</td>
                  <td>{change ? change.to : excluded.has(c.from) ? '(keeps its name)' : '(unchanged)'}</td>
                  <td>
                    <a href="#" onClick={(e) => (e.preventDefault(), store.navigate(c.pageId, 0, c.itemId))}>
                      {pageFullName(page)}
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Export (PDF, print, SVG): pages, black and white, location

function ExportDialog({ mode }: { mode: 'pdf' | 'print' | 'svg' }) {
  const store = useStore();
  const doc = useEditor((s) => s.doc)!;
  const preselected = useEditor((s) => s.pageSelection);
  const opened = useEditor((s) => s.project);
  const pages = doc.state.project.pages.map((id) => doc.state.pages[id]!);
  const [pageIds, setPageIds] = useState<Set<string>>(() => new Set(preselected.length > 1 ? preselected : pages.map((p) => p.id)));
  const [monochrome, setMonochrome] = useState(store.state.monochrome);
  // Default location: the project folder's "doc" subfolder.
  const [path, setPath] = useState(() => (opened?.folder ? `${opened.folder}/doc/${fileBase(store)}.pdf` : ''));
  const choose = async () => {
    const chosen = await store.host.chooseSavePath?.(path || `${fileBase(store)}.pdf`, 'pdf');
    if (chosen) setPath(chosen);
  };
  const ok = () => {
    if (pageIds.size === 0) return store.notify('Select at least one page', true);
    const options: ExportOptions = { pageIds: doc.state.project.pages.filter((id) => pageIds.has(id)), monochrome, ...(mode === 'pdf' && path.trim() ? { path: path.trim() } : {}) };
    store.set({ dialog: null, monochrome });
    if (mode === 'pdf') void exportPdf(store, options);
    else if (mode === 'print') void print(store, options);
    else exportSvg(store, options);
  };
  const title = tr({ pdf: 'Export PDF', print: 'Print', svg: 'Export SVG' }[mode]);
  return (
    <Modal title={title} onOk={ok} okLabel={`${title} (${pageIds.size} ${pageIds.size === 1 ? tr('page') : tr('pages')})`} wide>
      {mode === 'pdf' && store.host.chooseSavePath && (
        <Field label={tr('Save to')}>
          <span className="color-field">
            <input value={path} onChange={(e) => setPath(e.target.value)} placeholder={tr('Ask when exporting')} />
            <button type="button" className="with-icon" onClick={() => void choose()}>
              <Icon name="open" /> {tr('Choose…')}
            </button>
          </span>
        </Field>
      )}
      <label className="check">
        <input type="checkbox" checked={monochrome} onChange={(e) => setMonochrome(e.target.checked)} /> {tr('Black and white (no potential colors)')}
      </label>
      <div className="translations-tools">
        <span className="hint">{preselected.length > 1 ? tr('Preselected: the pages selected in the Pages tab.') : tr('All pages; select pages in the Pages tab (Ctrl/Shift+click) to preselect them.')}</span>
      </div>
      <PageTreeChecklist pages={pages} selected={pageIds} onChange={setPageIds} />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Page selection as a tree: function → location → pages; a function or location
// checkbox selects or deselects all its pages.

function PageTreeChecklist({ pages, selected, onChange, extra }: { pages: Page[]; selected: Set<string>; onChange: (next: Set<string>) => void; extra?: (page: Page) => ReactNode }) {
  const store = useStore();
  const doc = useEditor((s) => s.doc)!;
  const language = useEditor((s) => s.language);
  const { structures, settings } = doc.state.project;
  const groups: { fn?: string; locations: { loc?: string; pages: Page[] }[] }[] = [];
  for (const page of pages) {
    let g = groups.find((x) => x.fn === page.structure?.function);
    if (!g) groups.push((g = { ...(page.structure?.function !== undefined ? { fn: page.structure.function } : {}), locations: [] }));
    let l = g.locations.find((x) => x.loc === page.structure?.location);
    if (!l) g.locations.push((l = { ...(page.structure?.location !== undefined ? { loc: page.structure.location } : {}), pages: [] }));
    l.pages.push(page);
  }
  const describe = (list: readonly StructureEntry[] | undefined, code: string) => localize(list?.find((e) => e.code === code)?.description, language, settings.languages);
  const setAll = (ids: string[], on: boolean) => {
    const next = new Set(selected);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    onChange(next);
  };
  /** Checkbox of a group: checked when all its pages are, half when some are. */
  const groupBox = (ids: string[], label: string) => {
    const count = ids.filter((id) => selected.has(id)).length;
    return (
      <input
        type="checkbox"
        aria-label={`Select ${label}`}
        checked={count === ids.length}
        ref={(el) => {
          if (el) el.indeterminate = count > 0 && count < ids.length;
        }}
        onChange={(e) => setAll(ids, e.target.checked)}
      />
    );
  };
  const pageItem = (p: Page, depth: number) => (
    <li key={p.id} className={`depth-${depth}${selected.has(p.id) ? '' : ' off'}`}>
      <label className="check">
        <input type="checkbox" aria-label={`Select ${pageFullName(p)}`} checked={selected.has(p.id)} onChange={(e) => setAll([p.id], e.target.checked)} />
        <span className="name">{p.name}</span> <span className="description">{localize(p.description, store.state.language, settings.languages)}</span>
        {extra?.(p)}
      </label>
    </li>
  );
  return (
    <>
      <div className="translations-tools">
        <button type="button" onClick={() => onChange(new Set(pages.map((p) => p.id)))}>{tr('All')}</button>
        <button type="button" onClick={() => onChange(new Set())}>{tr('None')}</button>
        <span className="hint">{tr('{selected} of {count} pages', { selected: selected.size, count: pages.length })}</span>
      </div>
      <ul className="page-checklist page-tree-checklist">
        {groups.map((g) => (
          <Fragment key={`f:${g.fn ?? ''}`}>
            {g.fn !== undefined && (
              <li className="group depth-0">
                <label className="check">
                  {groupBox(g.locations.flatMap((l) => l.pages.map((p) => p.id)), `=${g.fn}`)}
                  <span className="name">={g.fn}</span> <span className="description">{describe(structures?.function, g.fn)}</span>
                </label>
              </li>
            )}
            {g.locations.map((l) => {
              const base = g.fn !== undefined ? 1 : 0;
              return (
                <Fragment key={`l:${l.loc ?? ''}`}>
                  {l.loc !== undefined && (
                    <li className={`group depth-${base}`}>
                      <label className="check">
                        {groupBox(l.pages.map((p) => p.id), `+${l.loc}`)}
                        <span className="name">+{l.loc}</span> <span className="description">{describe(structures?.location, l.loc)}</span>
                      </label>
                    </li>
                  )}
                  {l.pages.map((p) => pageItem(p, base + (l.loc !== undefined ? 1 : 0)))}
                </Fragment>
              );
            })}
          </Fragment>
        ))}
      </ul>
    </>
  );
}

// ---------------------------------------------------------------------------
// Renumber pages

function RenumberPagesDialog() {
  const store = useStore();
  const doc = useEditor((s) => s.doc)!;
  const preselected = useEditor((s) => s.pageSelection);
  const pages = doc.state.project.pages.map((id) => doc.state.pages[id]!);
  const [pageIds, setPageIds] = useState<Set<string>>(() => new Set(preselected.length > 1 ? preselected : pages.map((p) => p.id)));
  const [prefix, setPrefix] = useState('');
  const [start, setStart] = useState('1');
  const [step, setStep] = useState('1');
  const options = { pageIds: [...pageIds], prefix, start: Math.max(0, Math.trunc(Number(start)) || 0), step: Math.max(1, Math.trunc(Number(step)) || 1) };
  const plan = new Map(planPageNames(doc.state, options).map((c) => [c.pageId, c.to]));
  const apply = () => {
    if (pageIds.size === 0) return store.notify('Select at least one page', true);
    if (store.apply({ type: 'renumberPages', ...options }, 'renumber pages')) {
      store.notify(tr('{count} page(s) renumbered', { count: pageIds.size }));
      store.set({ dialog: null, pageSelection: [] });
    }
  };
  return (
    <Modal title={tr('Renumber pages')} onOk={apply} okLabel={`Renumber ${pageIds.size} ${pageIds.size === 1 ? 'page' : 'pages'}`}>
      <div className="tag-fields">
        <Field label={tr('Prefix')}>
          <input value={prefix} placeholder="e.g. 1." onChange={(e) => setPrefix(e.target.value)} />
        </Field>
        <Field label={tr('Start')}>
          <input value={start} inputMode="numeric" onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label={tr('Step')}>
          <input value={step} inputMode="numeric" onChange={(e) => setStep(e.target.value)} />
        </Field>
      </div>
      <p className="hint">{tr('Examples: start 1, step 1 → 1, 2, 3 · prefix "1." → 1.1, 1.2, 1.3 · start 10, step 10 → 10, 20, 30. Pages are numbered in their order.')}</p>
      <PageTreeChecklist pages={pages} selected={pageIds} onChange={setPageIds} extra={(p) => (plan.has(p.id) ? <span className="new-name">→ {plan.get(p.id)}</span> : null)} />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Translations

/**
 * The project languages: add any language code, remove one, change the order. The first language
 * is the source language (translation import matches on it).
 */
function LanguageBar() {
  const store = useStore();
  const doc = useEditor((s) => s.doc)!;
  const { languages, displayLanguage } = doc.state.project.settings;
  const [code, setCode] = useState('');
  const save = (next: string[]) =>
    store.apply(
      { type: 'setProjectSettings', settings: { languages: next, displayLanguage: next.includes(displayLanguage) ? displayLanguage : next[0]! } },
      'languages',
    );
  const add = () => {
    const value = code.trim();
    if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(value)) return store.notify('Enter a language code such as fr, it, pl or de-CH', true);
    if (languages.some((l) => l.toLowerCase() === value.toLowerCase())) return store.notify(tr('{language} is already a project language', { language: value }), true);
    if (save([...languages, value])) setCode('');
  };
  const remove = (language: string) => {
    if (languages.length === 1) return store.notify('A project needs at least one language', true);
    if (!confirm(`Remove ${language} from the project languages? Texts already translated to ${language} stay in the files but are no longer shown.`)) return;
    const next = languages.filter((l) => l !== language);
    if (save(next) && store.state.language === language) store.set({ language: next[0]! });
  };
  const move = (index: number, delta: number) => {
    const next = [...languages];
    const [l] = next.splice(index, 1);
    next.splice(index + delta, 0, l!);
    save(next);
  };
  return (
    <div className="language-bar">
      <span className="label">{tr('Languages')}</span>
      {languages.map((l, i) => (
        <span key={l} className={i === 0 ? 'language-chip source' : 'language-chip'} title={i === 0 ? tr('Source language: imports match on it') : undefined}>
          <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${l} left`}>
            ‹
          </button>
          {l}
          {i === 0 && <small> {tr('source')}</small>}
          <button type="button" disabled={i === languages.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${l} right`}>
            ›
          </button>
          <button type="button" onClick={() => remove(l)} aria-label={`Remove ${l}`}>
            ×
          </button>
        </span>
      ))}
      <input
        value={code}
        placeholder={tr('e.g. fr')}
        size={6}
        aria-label={tr('New language code')}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
      />
      <button type="button" onClick={add}>
        {tr('+ Language')}
      </button>
    </div>
  );
}

function TranslationsDialog() {
  const store = useStore();
  const doc = useEditor((s) => s.doc)!;
  const { languages } = doc.state.project.settings;
  const [query, setQuery] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);
  const entries = collectTexts(doc.state, doc.library);
  const needle = query.trim().toLowerCase();
  const groups = groupTexts(entries, languages).filter(
    (g) =>
      (!missingOnly || languages.some((l) => !g.values[l])) &&
      (!needle || Object.values(g.values).some((v) => v.toLowerCase().includes(needle)) || g.entries.some((e) => e.where.toLowerCase().includes(needle))),
  );
  const missing = groupTexts(entries, languages).filter((g) => languages.some((l) => !g.values[l])).length;
  const set = (group: TextGroup, language: string, value: string) => {
    if ((group.values[language] ?? '') === value.trim()) return;
    store.apply({ type: 'setTexts', texts: group.entries.map((e) => ({ key: e.key, language, value: value.trim() })) }, 'translate');
  };
  const exportFile = (format: TranslationFormat) => {
    const base = `${doc.state.project.name || 'project'}-translations`.replace(/[^\p{L}\p{N}._-]+/gu, '_');
    const file = exportTranslations(groupTexts(entries, languages), languages, format, base);
    void store.host.saveFile(file.fileName, file.content, file.mimeType);
  };
  const importFile = async (file: File) => {
    try {
      const format: TranslationFormat = file.name.toLowerCase().endsWith('.ods') ? 'ods' : 'csv';
      const content = format === 'ods' ? new Uint8Array(await file.arrayBuffer()) : await file.text();
      const plan = planTranslationImport(readTranslationTable(content, format), entries, languages);
      if (plan.texts.length > 0) store.apply({ type: 'setTexts', texts: plan.texts }, 'import translations');
      store.notify(
        `${file.name}: ${plan.matched} ${plan.matched === 1 ? 'row' : 'rows'} matched, ${plan.texts.length} ${plan.texts.length === 1 ? 'text' : 'texts'} changed` +
          (plan.unmatched.length > 0 ? `, ${plan.unmatched.length} ${plan.unmatched.length === 1 ? 'row' : 'rows'} not found in the project` : ''),
        plan.matched === 0,
      );
    } catch (error) {
      store.notify(tr('Import failed: {error}', { error: (error as Error).message }), true);
    }
  };
  return (
    <Modal title={tr('Translations')} wide>
      <LanguageBar />
      <div className="translations-tools">
        <input className="search" placeholder={tr('Search texts…')} value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} /> {tr('Only missing ({count})', { count: missing })}
        </label>
        <span className="spacer" />
        <button type="button" className="with-icon" onClick={() => exportFile('csv')}>
          <Icon name="download" /> {tr('Export CSV')}
        </button>
        <button type="button" className="with-icon" onClick={() => exportFile('ods')}>
          <Icon name="download" /> {tr('Export ODS')}
        </button>
        <label className="button with-icon">
          <Icon name="upload" /> {tr('Import…')}
          <input
            type="file"
            accept=".csv,.ods,text/csv,application/vnd.oasis.opendocument.spreadsheet"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void importFile(file);
            }}
          />
        </label>
      </div>
      <p className="hint">
        {tr('Identical texts are one row. Import matches rows by the {language} column and fills in the other languages; empty cells change nothing.', { language: languages[0] ?? '' })}
      </p>
      <table className="channels translations">
        <thead>
          <tr>
            {languages.map((l) => (
              <th key={l}>{l}</th>
            ))}
            <th>{tr('Used at')}</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.entries[0]!.key}>
              {languages.map((l) => (
                <td key={l}>
                  <input
                    key={`${l}:${g.values[l] ?? ''}`}
                    defaultValue={showBreaks(g.values[l] ?? '')}
                    className={g.values[l] ? undefined : 'missing'}
                    title={tr('Enter applies, Ctrl+Enter: line break (¶)')}
                    onBlur={(e) => set(g, l, readBreaks(e.target.value))}
                    onKeyDown={(e) => {
                      if (insertBreak(e)) return;
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                    }}
                  />
                </td>
              ))}
              <td className="used-at" title={g.entries.map((e) => `${e.where} – ${textFieldLabel(e.field)}`).join('\n')}>
                {g.entries[0]!.pageId ? (
                  <a href="#" onClick={(e) => (e.preventDefault(), store.navigate(g.entries[0]!.pageId!, 0, g.entries[0]!.itemId))}>
                    {g.entries[0]!.where}
                  </a>
                ) : (
                  g.entries[0]!.where
                )}
                {g.entries.length > 1 && <span className="more"> +{g.entries.length - 1}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {groups.length === 0 && <p className="hint">{entries.length === 0 ? tr('The project has no multilingual texts yet.') : tr('No texts match.')}</p>}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Find and replace

function FindDialog() {
  const store = useStore();
  const doc = useEditor((s) => s.doc)!;
  const current = useEditor((s) => s.sheet);
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [fields, setFields] = useState<Record<string, boolean>>({ product: false, functionText: true, technicalData: false, pageDescription: false });
  const [scope, setScope] = useState<'project' | 'page'>('project');
  const [matchCase, setMatchCase] = useState(false);
  const [language, setLanguage] = useState('');

  const selectedFields = Object.entries(fields).filter(([, v]) => v).map(([k]) => k) as ('product' | 'functionText' | 'technicalData' | 'pageDescription')[];
  const command: Command | null =
    find && selectedFields.length > 0
      ? {
          type: 'replaceTexts',
          find,
          replace,
          fields: selectedFields,
          matchCase,
          ...(scope === 'page' && current ? { pageIds: [current.pageId] } : {}),
          ...(language ? { language } : {}),
        }
      : null;
  let count = 0;
  if (command) {
    try {
      count = doc.preview(command).result.replaced;
    } catch {
      count = -1;
    }
  }

  const ok = () => {
    if (!command) return;
    const result = store.apply(command, 'replace');
    if (result) {
      store.notify(tr('{count} text(s) replaced', { count: result.replaced }));
      store.set({ dialog: null });
    }
  };

  return (
    <Modal title={tr('Find and replace')} onOk={ok} okLabel={`Replace${count > 0 ? ` (${count})` : ''}`}>
      <Field label={tr('Find')}>
        <input value={find} onChange={(e) => setFind(e.target.value)} autoFocus />
      </Field>
      <Field label={tr('Replace with')}>
        <input value={replace} onChange={(e) => setReplace(e.target.value)} />
      </Field>
      <div className="checks">
        {Object.entries({ product: 'Device tags (-K…)', functionText: 'Function texts', technicalData: 'Technical data', pageDescription: 'Page descriptions' }).map(([key, label]) => (
          <label key={key}>
            <input type="checkbox" checked={fields[key] ?? false} onChange={(e) => setFields({ ...fields, [key]: e.target.checked })} /> {tr(label)}
          </label>
        ))}
      </div>
      <div className="tag-fields">
        <Field label={tr('Scope')}>
          <select value={scope} onChange={(e) => setScope(e.target.value as 'project' | 'page')}>
            <option value="project">{tr('Whole project')}</option>
            <option value="page">{tr('Current page')}</option>
          </select>
        </Field>
        <Field label={tr('Language')}>
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="">{tr('All languages')}</option>
            {doc.state.project.settings.languages.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </Field>
      </div>
      <label>
        <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> {tr('Match case')}
      </label>
      <p className="hint">{count === -1 ? tr('The replacement would create an invalid device tag.') : tr('{count} text(s) will change.', { count })}</p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Small prompts

function PlaceAuxiliaryDialog({ command }: { command: Extract<Command, { type: 'placeSymbol' }> }) {
  const store = useStore();
  const doc = useEditor((s) => s.doc)!;
  const [tag, setTag] = useState('');
  const page = doc.state.pages[command.pageId] as SchematicPage;
  const context = tagContext(page, command, store.library);
  const options = [...doc.devices().devices.values()]
    .filter((d) => d.main)
    .map((d) => (d.tag.function === context.function && d.tag.location === context.location ? `-${d.tag.product}` : d.key))
    .sort(naturalCompare);
  const ok = () => {
    try {
      const parsed = parseTag(tag.startsWith('-') || tag.startsWith('=') || tag.startsWith('+') ? tag : `-${tag}`);
      const result = store.apply({ ...command, tag: parsed }, 'place');
      if (result) store.set({ dialog: null, selection: { items: result.created } });
    } catch (error) {
      store.notify((error as Error).message, true);
    }
  };
  return (
    <Modal title={tr('Which device does this function belong to?')} onOk={ok} okLabel={tr('Place')}>
      <Field label={tr('Device tag')}>
        <input value={tag} onChange={(e) => setTag(e.target.value)} list="devices" autoFocus placeholder="-3K7" />
      </Field>
      <datalist id="devices">
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <p className="hint">{tr('Contacts belong to the device of their coil. Type the tag or pick one of the existing devices.')}</p>
    </Modal>
  );
}

function StructureBoxDialog({ command }: { command: Extract<Command, { type: 'placeSymbol' }> }) {
  const store = useStore();
  const [fn, setFn] = useState('');
  const [location, setLocation] = useState('');
  const ok = () => {
    const tag = { ...(fn.trim() ? { function: fn.trim() } : {}), ...(location.trim() ? { location: location.trim() } : {}) };
    const result = store.apply({ ...command, tag }, 'structure box');
    if (result) store.set({ dialog: null, selection: { items: result.created } });
  };
  return (
    <Modal title={tr('Structure box')} onOk={ok} okLabel={tr('Create')}>
      <div className="tag-fields">
        <Field label={tr('= Function')}>
          <input list="sg-functions" value={fn} onChange={(e) => setFn(e.target.value)} autoFocus />
        </Field>
        <Field label={tr('+ Location')}>
          <input list="sg-locations" value={location} onChange={(e) => setLocation(e.target.value)} />
        </Field>
      </div>
      <p className="hint">{tr('Everything inside the box takes this structure. Empty fields are inherited from the page.')}</p>
    </Modal>
  );
}

function NewReportDialog() {
  const store = useStore();
  const doc = useEditor((s) => s.doc)!;
  const current = useEditor((s) => s.sheet);
  const [kind, setKind] = useState<'titlePage' | 'pageIndex' | 'structureOverview' | 'revisions' | 'deviceIndex' | 'bom' | 'terminalList' | 'wireList' | 'cableOverview' | 'cableDiagram' | 'plcIoList' | 'mountingPlate' | 'terminalDiagram'>('pageIndex');
  const numbers = Object.values(doc.state.pages).map((p) => Number.parseInt(p.name, 10)).filter((n) => !Number.isNaN(n));
  const [name, setName] = useState(String(Math.max(0, ...numbers) + 1));
  const [fn, setFn] = useState('DOC');
  const labels = {
    titlePage: 'Title page',
    pageIndex: 'Table of contents',
    structureOverview: 'Structure overview',
    revisions: 'Revisions',
    deviceIndex: 'Device directory',
    bom: 'Bill of materials',
    terminalList: 'Terminal list',
    terminalDiagram: 'Terminal diagram',
    wireList: 'Wire list',
    cableOverview: 'Cable overview',
    cableDiagram: 'Cable diagram',
    plcIoList: 'PLC I/O list',
    mountingPlate: 'Mounting plate',
  };
  const ok = () => {
    const index = current ? doc.state.project.pages.indexOf(current.pageId) + 1 : undefined;
    const form = store.library.form(`iec.form.${kind}`);
    const result = store.apply(
      {
        type: 'createReportPage',
        name,
        kind,
        ...(form ? { description: form.title } : {}),
        ...(fn ? { structure: { function: fn } } : {}),
        ...(index !== undefined ? { index } : {}),
      },
      'new report',
    );
    if (result) {
      store.set({ dialog: null });
      store.navigate(result.created[0]!);
    }
  };
  return (
    <Modal title={tr('New report page')} onOk={ok} okLabel={tr('Create')}>
      <Field label={tr('Report')}>
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          {Object.entries(labels).map(([k, l]) => (
            <option key={k} value={k}>
              {tr(l)}
            </option>
          ))}
        </select>
      </Field>
      <div className="tag-fields">
        <Field label={tr('Page name')}>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={tr('= Function')}>
          <input list="sg-functions" value={fn} onChange={(e) => setFn(e.target.value)} />
        </Field>
      </div>
      <p className="hint">{tr('Report pages are always up to date and grow to several sheets when needed.')}</p>
    </Modal>
  );
}

function RenameDeviceDialog({ device }: { device: string }) {
  const store = useStore();
  const [to, setTo] = useState(device);
  const ok = () => {
    if (store.apply({ type: 'renameDevice', device, to }, 'rename device')) store.set({ dialog: null });
  };
  return (
    <Modal title={`Rename ${device}`} onOk={ok} okLabel={tr('Rename')}>
      <Field label={tr('New full tag')}>
        <input list="sg-devices" value={to} onChange={(e) => setTo(e.target.value)} autoFocus />
      </Field>
      <p className="hint">{tr('All functions of the device (coil, contacts …) get the new tag.')}</p>
    </Modal>
  );
}

function ExternalChangeDialog() {
  const store = useStore();
  return (
    <Modal title={tr('Project changed on disk')} onOk={() => void store.reload()} okLabel={tr('Reload (discard my changes)')}>
      <p>{tr('The project files were changed outside the editor (e.g. by an AI assistant through MCP), and you have unsaved changes.')}</p>
      <p>{tr('Reload to see the external changes, or cancel to keep your version; saving will then overwrite the changed files.')}</p>
    </Modal>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Click / drag on a symbol', 'Select / move the whole symbol (also when clicking its texts)'],
  ['Shift+click / drag on empty space', 'Add to or remove from the selection / box select'],
  ['Ctrl+click on a text', 'Select only that text (tag, function text, pin, cross-reference): move it by dragging, F2 edits it, F follows a cross-reference'],
  ['F2', 'Edit the selected text or tag in place (Tab: next text)'],
  ['F', 'Follow: jump to the selected cross-reference, or from a contact / I/O point to its master'],
  ['Double-click', 'Properties; on a cross-reference: jump to it'],
  ['R / M', 'Rotate / mirror (also while placing)'],
  ['Delete', 'Delete selection'],
  ['Ctrl+C / Ctrl+X / Ctrl+V', 'Copy / cut / paste: the copy follows the mouse, a click places it'],
  ['X / Y while pasting', 'Keep the copy at the original x / y position'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
  ['Ctrl+S', 'Save'],
  ['Ctrl+K', 'Command palette: search actions, pages, devices and symbols'],
  ['F5', 'Place a corner (90° junction); press again to turn it'],
  ['F6', 'Place a T-junction; press again to turn it'],
  ['F7', 'Place an interruption point'],
  ['Ctrl+Shift+C', 'Style brush: copy the text layout of the selected symbol to the symbols clicked next'],
  ['Ctrl+H', 'Find and replace'],
  ['Insert', 'Search symbols'],
  ['G', 'Cycle grid 1 → 2 → 4 → 8 mm'],
  ['L', 'Show pin links'],
  ['Page Up / Page Down', 'Previous / next page'],
  ['Home', 'Fit page'],
  ['Wheel / middle drag / Space+drag', 'Zoom / pan'],
  ['Esc', 'Cancel tool, clear selection'],
  ['? / F1', 'This list'],
];

/** Accepting a problem as intended, with a reason (kept in the project). */
function AcknowledgeDialog({ keys, text }: { keys: string[]; text: string }) {
  const store = useStore();
  const [note, setNote] = useState('');
  const ok = () => {
    const date = new Date().toISOString().slice(0, 10);
    if (store.apply({ type: 'acknowledgeIssues', keys, date, ...(note.trim() ? { note: note.trim() } : {}) }, 'acknowledge problem')) store.set({ dialog: null });
  };
  return (
    <Modal title={tr('Acknowledge problem')} onOk={ok} okLabel={tr('Acknowledge')}>
      <p>{text}</p>
      <Field label={tr('Reason (optional)')}>
        <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr('e.g. input reads the pushbutton in parallel to the coil')} onKeyDown={(e) => e.key === 'Enter' && ok()} />
      </Field>
      <p className="hint">{tr('The problem stays in the list, greyed out, and is no longer counted or marked on the drawing. ↺ in the Issues tab takes it back.')}</p>
    </Modal>
  );
}

function ShortcutsDialog() {
  return (
    <Modal title={tr('Keyboard shortcuts')}>
      <table className="shortcuts">
        <tbody>
          {SHORTCUTS.map(([key, what]) => (
            <tr key={key}>
              <td>
                <kbd>{trKeys(key)}</kbd>
              </td>
              <td>{tr(what)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
