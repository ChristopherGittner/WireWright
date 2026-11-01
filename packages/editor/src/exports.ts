// Exports: PDF (desktop), SVG (browser), print and report CSV, for chosen pages.
import { localize, reportForm, reportToCsv, type ReportPage } from '@wirewright/core';
import { renderContext, renderSheet, sceneToSvg } from '@wirewright/render';
import type { EditorStore } from './store.js';
import { tr } from './i18n.js';

export function fileBase(store: EditorStore): string {
  return (store.state.doc?.state.project.name ?? 'project').replace(/[^\p{L}\p{N}._-]+/gu, '_');
}

export interface ExportOptions {
  /** Pages to export (all their sheets), in page order. */
  pageIds: string[];
  monochrome: boolean;
  /** PDF in the desktop app: where to write it (otherwise a save dialog asks). */
  path?: string;
}

function selectedSheets(store: EditorStore, pageIds: readonly string[]) {
  const ctx = renderContext(store.state.doc!);
  const wanted = new Set(pageIds);
  return { ctx, sheets: ctx.sheets.filter((s) => wanted.has(s.pageId)) };
}

export async function exportPdf(store: EditorStore, options: ExportOptions) {
  const doc = store.state.doc!;
  const { project } = doc.state;
  const { ctx, sheets } = selectedSheets(store, options.pageIds);
  const pdfSheets = sheets.map((sheet) => ({
    scene: renderSheet(ctx, sheet, { language: store.state.language, monochrome: options.monochrome }),
    pageId: sheet.pageId,
    sheet: sheet.sheet,
    title: `${sheet.fullName}  ${localize(doc.state.pages[sheet.pageId]?.description, store.state.language, project.settings.languages)}`.trim(),
  }));
  try {
    await store.host.exportPdf!(`${fileBase(store)}.pdf`, project.name, pdfSheets, options.path);
    if (options.path) store.notify(tr('PDF written to {path}', { path: options.path }));
  } catch (error) {
    store.notify(tr('PDF export failed: {error}', { error: (error as Error).message }), true);
  }
}

/** Browser: one SVG download per sheet. */
export function exportSvg(store: EditorStore, options: ExportOptions) {
  const { ctx, sheets } = selectedSheets(store, options.pageIds);
  for (const sheet of sheets) {
    const svg = sceneToSvg(renderSheet(ctx, sheet, { language: store.state.language, monochrome: options.monochrome }), { metadata: false });
    void store.host.saveFile(`${fileBase(store)}-${sheet.name}.svg`, svg, 'image/svg+xml');
  }
}

export function exportCsv(store: EditorStore, page: ReportPage) {
  const doc = store.state.doc!;
  const form = reportForm(page, store.library);
  if (!form) return;
  const rows = doc.sheets().sheets.filter((s) => s.pageId === page.id).flatMap((s) => s.rows ?? []);
  void store.host.saveFile(`${fileBase(store)}-${page.report.kind}.csv`, reportToCsv(form, rows, store.state.language), 'text/csv');
}

export async function print(store: EditorStore, options: ExportOptions) {
  const { ctx, sheets } = selectedSheets(store, options.pageIds);
  const pages = sheets.map((sheet) => sceneToSvg(renderSheet(ctx, sheet, { language: store.state.language, monochrome: options.monochrome }), { metadata: false }));
  await store.host.print!(pages);
}
