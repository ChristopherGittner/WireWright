import type { Connectivity } from './connectivity.js';
import { schematicPages, type DeviceIndex } from './devices.js';
import { issueMessage, type Issue } from './issues.js';
import type { Library } from './library.js';
import type { LocalizedText, ProjectState } from './schema.js';
import { missingLanguages } from './text.js';

export interface DerivedData {
  devices: DeviceIndex;
  connectivity: Connectivity;
  /** Issues from further derived data (cross-references, contact images …). */
  extraIssues?: readonly Issue[];
}

/** All problems in a project: devices, connections, potentials, frames and translations. */
export function checkProject(state: ProjectState, library: Library, derived: DerivedData): Issue[] {
  const issues: Issue[] = [...derived.devices.issues, ...derived.connectivity.issues, ...(derived.extraIssues ?? [])];
  const { settings } = state.project;
  const itemIds = new Map<string, string>();

  for (const pageId of state.project.pages) {
    const page = state.pages[pageId];
    if (!page) {
      issues.push({ severity: 'error', code: 'page.missing', ...issueMessage('Page "{page}" is listed but missing', { page: pageId }), pageId });
      continue;
    }
    const frameId = page.frame ?? settings.defaultFrame;
    if (!library.frame(frameId)) {
      issues.push({ severity: 'warning', code: 'frame.unknown', ...issueMessage('Unknown frame "{frame}"', { frame: frameId }), pageId });
    }
    checkTranslation(issues, page.description, settings.languages, 'Description of page {page} has no translation for: {languages}', { page: page.name }, { pageId });
  }

  for (const page of schematicPages(state)) {
    for (const item of page.items) {
      const other = itemIds.get(item.id);
      if (other !== undefined) {
        issues.push({ severity: 'error', code: 'item.duplicateId', ...issueMessage('Item ID "{id}" is used twice', { id: item.id }), pageId: page.id, itemId: item.id });
      }
      itemIds.set(item.id, page.id);
      checkTranslation(issues, item.props?.functionText, settings.languages, 'Function text has no translation for: {languages}', {}, { pageId: page.id, itemId: item.id });
    }
  }
  return issues;
}

function checkTranslation(
  issues: Issue[],
  text: LocalizedText | undefined,
  languages: readonly string[],
  template: string,
  values: Record<string, string>,
  where: Pick<Issue, 'pageId' | 'itemId'>,
): void {
  const missing = missingLanguages(text, languages);
  if (missing.length > 0) {
    issues.push({ severity: 'info', code: 'text.missingTranslation', ...issueMessage(template, { ...values, languages: missing.join(', ') }), ...where });
  }
}
