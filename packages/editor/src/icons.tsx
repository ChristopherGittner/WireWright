// Toolbar icons: Material Symbols (outlined, Apache License 2.0, © Google) bundled as SVG,
// plus own icons in the same style where Material Symbols has none (terminal strip).
import newProjectSvg from '@material-symbols/svg-400/outlined/note_add.svg?raw';
import openSvg from '@material-symbols/svg-400/outlined/folder_open.svg?raw';
import saveSvg from '@material-symbols/svg-400/outlined/save.svg?raw';
import undoSvg from '@material-symbols/svg-400/outlined/undo.svg?raw';
import redoSvg from '@material-symbols/svg-400/outlined/redo.svg?raw';
import findSvg from '@material-symbols/svg-400/outlined/find_replace.svg?raw';
import renumberSvg from '@material-symbols/svg-400/outlined/format_list_numbered.svg?raw';
import gridSvg from '@material-symbols/svg-400/outlined/grid_4x4.svg?raw';
import linksSvg from '@material-symbols/svg-400/outlined/link.svg?raw';
import languageSvg from '@material-symbols/svg-400/outlined/language.svg?raw';
import wiresSvg from '@material-symbols/svg-400/outlined/cable.svg?raw';
import plcSvg from '@material-symbols/svg-400/outlined/memory.svg?raw';
import librarySvg from '@material-symbols/svg-400/outlined/library_books.svg?raw';
import saveMacroSvg from '@material-symbols/svg-400/outlined/bookmark_add.svg?raw';
import translationsSvg from '@material-symbols/svg-400/outlined/translate.svg?raw';
import settingsSvg from '@material-symbols/svg-400/outlined/settings.svg?raw';
import computerSvg from '@material-symbols/svg-400/outlined/computer.svg?raw';
import overviewSvg from '@material-symbols/svg-400/outlined/view_module.svg?raw';
import partsSvg from '@material-symbols/svg-400/outlined/inventory_2.svg?raw';
import historySvg from '@material-symbols/svg-400/outlined/history.svg?raw';
import archiveSvg from '@material-symbols/svg-400/outlined/folder_zip.svg?raw';
import unarchiveSvg from '@material-symbols/svg-400/outlined/unarchive.svg?raw';
import symbolEditorSvg from '@material-symbols/svg-400/outlined/design_services.svg?raw';
import frameEditorSvg from '@material-symbols/svg-400/outlined/web_asset.svg?raw';
import toolSelectSvg from '@material-symbols/svg-400/outlined/arrow_selector_tool.svg?raw';
import toolLineSvg from '@material-symbols/svg-400/outlined/pen_size_2.svg?raw';
import toolRectSvg from '@material-symbols/svg-400/outlined/rectangle.svg?raw';
import toolCircleSvg from '@material-symbols/svg-400/outlined/circle.svg?raw';
import toolPolylineSvg from '@material-symbols/svg-400/outlined/polyline.svg?raw';
import toolTextSvg from '@material-symbols/svg-400/outlined/title.svg?raw';
import toolConnectionSvg from '@material-symbols/svg-400/outlined/radio_button_checked.svg?raw';
import toolFieldSvg from '@material-symbols/svg-400/outlined/text_fields.svg?raw';
import toolLinksSvg from '@material-symbols/svg-400/outlined/add_link.svg?raw';
import pdfSvg from '@material-symbols/svg-400/outlined/picture_as_pdf.svg?raw';
import svgSvg from '@material-symbols/svg-400/outlined/image.svg?raw';
import csvSvg from '@material-symbols/svg-400/outlined/csv.svg?raw';
import printSvg from '@material-symbols/svg-400/outlined/print.svg?raw';
import monochromeSvg from '@material-symbols/svg-400/outlined/contrast.svg?raw';
import shortcutsSvg from '@material-symbols/svg-400/outlined/keyboard.svg?raw';
import tabPagesSvg from '@material-symbols/svg-400/outlined/description.svg?raw';
import tabDevicesSvg from '@material-symbols/svg-400/outlined/list_alt.svg?raw';
import tabSymbolsSvg from '@material-symbols/svg-400/outlined/category.svg?raw';
import tabPlcSvg from '@material-symbols/svg-400/outlined/lan.svg?raw';
import tabIssuesSvg from '@material-symbols/svg-400/outlined/report.svg?raw';
import closeSvg from '@material-symbols/svg-400/outlined/close.svg?raw';
import popOutSvg from '@material-symbols/svg-400/outlined/open_in_new.svg?raw';
import dockBackSvg from '@material-symbols/svg-400/outlined/dock_to_left.svg?raw';
import addPageSvg from '@material-symbols/svg-400/outlined/post_add.svg?raw';
import addReportSvg from '@material-symbols/svg-400/outlined/summarize.svg?raw';
import addCardSvg from '@material-symbols/svg-400/outlined/add_box.svg?raw';
import addLayoutSvg from '@material-symbols/svg-400/outlined/space_dashboard.svg?raw';
import brushSvg from '@material-symbols/svg-400/outlined/format_paint.svg?raw';
import pagePropertiesSvg from '@material-symbols/svg-400/outlined/tune.svg?raw';
import upSvg from '@material-symbols/svg-400/outlined/arrow_upward.svg?raw';
import downSvg from '@material-symbols/svg-400/outlined/arrow_downward.svg?raw';
import deleteSvg from '@material-symbols/svg-400/outlined/delete.svg?raw';
import uploadSvg from '@material-symbols/svg-400/outlined/upload.svg?raw';
import downloadSvg from '@material-symbols/svg-400/outlined/download.svg?raw';

interface IconData {
  viewBox: string;
  paths: string[];
}

/** Path data of a Material Symbols SVG file (one or more `<path d="…">`). */
function material(svg: string): IconData {
  return {
    viewBox: /viewBox="([^"]+)"/.exec(svg)?.[1] ?? '0 -960 960 960',
    paths: [...svg.matchAll(/<path[^>]* d="([^"]+)"/g)].map((m) => m[1]!),
  };
}

const ICONS = {
  newProject: material(newProjectSvg),
  open: material(openSvg),
  save: material(saveSvg),
  undo: material(undoSvg),
  redo: material(redoSvg),
  find: material(findSvg),
  renumber: material(renumberSvg),
  grid: material(gridSvg),
  links: material(linksSvg),
  language: material(languageSvg),
  wires: material(wiresSvg),
  plc: material(plcSvg),
  library: material(librarySvg),
  saveMacro: material(saveMacroSvg),
  translations: material(translationsSvg),
  settings: material(settingsSvg),
  machine: material(computerSvg),
  plcOverview: material(overviewSvg),
  parts: material(partsSvg),
  revisions: material(historySvg),
  archive: material(archiveSvg),
  unarchive: material(unarchiveSvg),
  symbolEditor: material(symbolEditorSvg),
  frameEditor: material(frameEditorSvg),
  toolSelect: material(toolSelectSvg),
  toolLine: material(toolLineSvg),
  toolRect: material(toolRectSvg),
  toolCircle: material(toolCircleSvg),
  toolPolyline: material(toolPolylineSvg),
  toolText: material(toolTextSvg),
  toolConnection: material(toolConnectionSvg),
  toolField: material(toolFieldSvg),
  toolLinks: material(toolLinksSvg),
  pdf: material(pdfSvg),
  svg: material(svgSvg),
  csv: material(csvSvg),
  print: material(printSvg),
  monochrome: material(monochromeSvg),
  shortcuts: material(shortcutsSvg),
  tabPages: material(tabPagesSvg),
  tabDevices: material(tabDevicesSvg),
  tabSymbols: material(tabSymbolsSvg),
  tabPlc: material(tabPlcSvg),
  tabIssues: material(tabIssuesSvg),
  close: material(closeSvg),
  popOut: material(popOutSvg),
  dockBack: material(dockBackSvg),
  addPage: material(addPageSvg),
  addReport: material(addReportSvg),
  addCard: material(addCardSvg),
  addLayout: material(addLayoutSvg),
  brush: material(brushSvg),
  pageProperties: material(pagePropertiesSvg),
  up: material(upSvg),
  down: material(downSvg),
  delete: material(deleteSvg),
  upload: material(uploadSvg),
  download: material(downloadSvg),
} satisfies Record<string, IconData>;

export type IconName = keyof typeof ICONS | 'terminals';

/** An icon in the current text color, 20 px. */
export function Icon({ name }: { name: IconName }) {
  if (name === 'terminals') return <TerminalsIcon />;
  const icon = ICONS[name];
  return (
    <svg className="icon" viewBox={icon.viewBox} aria-hidden="true" focusable="false">
      {icon.paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

/** Own icon: three terminals of a strip joined by a bridge. */
function TerminalsIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
      {[5, 12, 19].map((x) => (
        <g key={x}>
          <line x1={x} y1={3} x2={x} y2={8} />
          <circle cx={x} cy={11} r={2.6} />
          <line x1={x} y1={13.6} x2={x} y2={21} />
        </g>
      ))}
      <line x1={5} y1={17.5} x2={19} y2={17.5} />
      {[5, 12, 19].map((x) => (
        <circle key={x} cx={x} cy={17.5} r={1.1} fill="currentColor" stroke="none" />
      ))}
    </svg>
  );
}
