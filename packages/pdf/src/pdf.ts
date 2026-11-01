// PDF export: every sheet becomes one vector PDF page. Cross-references are
// clickable links to the target page, and every page gets a bookmark.
import { localize } from '@wirewright/core';
import { arcPath, renderSheet, type RenderContext, type RenderOptions, type Scene, type SceneElement, type Stroke } from '@wirewright/render';
import PDFDocument from 'pdfkit';

const POINTS_PER_MM = 72 / 25.4;

export interface PdfPage {
  scene: Scene;
  /** Named destination of this page, used as link target. */
  destination: string;
  /** Bookmark title. */
  title: string;
}

export interface PdfOptions {
  title?: string;
  author?: string;
  /** Destination name for a cross-reference target page, if it is part of the PDF. */
  resolve?: (target: { pageId: string; itemId: string }) => string | undefined;
}

/** Destination name of a sheet. */
export function sheetDestination(pageId: string, sheet: number): string {
  return `wirewright-${pageId}-${sheet}`;
}

/** The whole project as PDF. */
export function exportProjectPdf(ctx: RenderContext, options: RenderOptions = {}): Promise<Uint8Array> {
  const { project } = ctx.state;
  const language = options.language ?? project.settings.displayLanguage;
  const pages = ctx.sheets.map((sheet) => {
    const page = ctx.state.pages[sheet.pageId]!;
    const description = localize(page.description, language, project.settings.languages);
    return {
      scene: renderSheet(ctx, sheet, options),
      destination: sheetDestination(sheet.pageId, sheet.sheet),
      title: description ? `${sheet.fullName}  ${description}` : sheet.fullName,
    };
  });
  return scenesToPdf(pages, {
    title: project.name,
    ...(project.properties.createdBy ? { author: project.properties.createdBy } : {}),
    resolve: (target) => sheetDestination(target.pageId, 0),
  });
}

export function scenesToPdf(pages: readonly PdfPage[], options: PdfOptions = {}): Promise<Uint8Array> {
  const doc = new PDFDocument({
    autoFirstPage: false,
    margin: 0,
    info: { Title: options.title ?? 'Wirewright', Author: options.author ?? '', Creator: 'Wirewright' },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Uint8Array>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    doc.on('error', reject);
  });
  const destinations = new Set(pages.map((p) => p.destination));

  for (const page of pages) {
    doc.addPage({ size: [page.scene.width * POINTS_PER_MM, page.scene.height * POINTS_PER_MM], margin: 0 });
    doc.addNamedDestination(page.destination);
    doc.outline.addItem(page.title);
    doc.save();
    doc.scale(POINTS_PER_MM);
    for (const element of page.scene.elements) {
      drawElement(doc, element);
      const target = element.meta?.target && options.resolve?.(element.meta.target);
      if (target && destinations.has(target) && element.kind === 'text') link(doc, element, target);
    }
    doc.restore();
  }
  doc.end();
  return done;
}

type Doc = PDFKit.PDFDocument;

function drawElement(doc: Doc, e: SceneElement): void {
  switch (e.kind) {
    case 'line':
      doc.moveTo(e.x1, e.y1).lineTo(e.x2, e.y2);
      return paint(doc, e.stroke, undefined);
    case 'polyline': {
      const [first, ...rest] = e.points;
      if (!first) return;
      doc.moveTo(first[0], first[1]);
      for (const [x, y] of rest) doc.lineTo(x, y);
      if (e.closed) doc.closePath();
      return paint(doc, e.stroke, e.fill);
    }
    case 'rect':
      doc.rect(e.x, e.y, e.width, e.height);
      return paint(doc, e.stroke, e.fill);
    case 'circle':
      doc.circle(e.cx, e.cy, e.r);
      return paint(doc, e.stroke, e.fill);
    case 'arc':
      doc.path(arcPath(e.cx, e.cy, e.r, e.start, e.end));
      return paint(doc, e.stroke, undefined);
    case 'text': {
      doc.font(e.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(e.size).fillColor(e.color);
      if (e.angle) doc.save().rotate(-e.angle, { origin: [e.x, e.y] });
      doc.text(e.text, textLeft(doc, e), e.y, { lineBreak: false, baseline: 'alphabetic' });
      if (e.angle) doc.restore();
      return;
    }
  }
}

function textLeft(doc: Doc, e: Extract<SceneElement, { kind: 'text' }>): number {
  if (e.align === 'left') return e.x;
  const width = doc.widthOfString(e.text);
  return e.align === 'center' ? e.x - width / 2 : e.x - width;
}

function paint(doc: Doc, stroke: Stroke | undefined, fill: string | undefined): void {
  if (stroke) {
    doc.lineWidth(stroke.width).strokeColor(stroke.color).lineCap('round');
    if (stroke.dash && stroke.dash.length > 0) doc.dash(stroke.dash[0]!, { space: stroke.dash[1] ?? stroke.dash[0]! });
    else doc.undash();
  }
  if (stroke && fill) doc.fillColor(fill).fillAndStroke();
  else if (fill) doc.fillColor(fill).fill();
  else doc.stroke();
}

function link(doc: Doc, e: Extract<SceneElement, { kind: 'text' }>, destination: string): void {
  doc.font(e.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(e.size);
  const width = doc.widthOfString(e.text);
  doc.goTo(textLeft(doc, e), e.y - e.size * 0.8, width, e.size, destination);
}
