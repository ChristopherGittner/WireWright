/**
 * `message` as a template with `{name}` placeholders; values named in `translate` are themselves
 * translatable words (e.g. "Function text"), the others are names and tags.
 */
export interface IssueText {
  template: string;
  values?: Record<string, string | number>;
  translate?: string[];
}

/** `message` and `text` of an issue from a template. */
export function issueMessage(template: string, given: Record<string, string | number | undefined> = {}, translate?: string[]): { message: string; text: IssueText } {
  const values = Object.fromEntries(Object.entries(given).map(([k, v]) => [k, v ?? ''])) as Record<string, string | number>;
  const message = template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
  return { message, text: { template, ...(Object.keys(values).length > 0 ? { values } : {}), ...(translate ? { translate } : {}) } };
}

export type IssueSeverity = 'error' | 'warning' | 'info';

/** A problem found in a project, shown in the editor and returned by `check_project`. */
export interface Issue {
  severity: IssueSeverity;
  /** Stable machine-readable code, e.g. `device.multipleMainFunctions`. */
  code: string;
  /** English text (MCP, logs). */
  message: string;
  /** Template of `message` with its values, so a user interface can translate it. */
  text?: IssueText;
  pageId?: string;
  itemId?: string;
  /** Full device tag, e.g. `=A1+CAB1-5K3`. */
  device?: string;
  /** Accepted by the designer (project.acknowledged): shown greyed out, not counted. */
  acknowledged?: { note?: string; date?: string };
}

/**
 * A stable key of an issue for acknowledging it: code and where (item, else page and device),
 * plus the message values that tell several issues of one item apart (e.g. the PLC channel).
 */
export function issueKey(issue: Issue): string {
  const values = issue.text?.values;
  const detail = values ? ['channel', 'pin', 'wire', 'name', 'names'].map((k) => values[k]).filter((v) => v !== undefined).join(',') : '';
  return [issue.code, issue.itemId ?? issue.pageId ?? '', issue.itemId ? '' : (issue.device ?? ''), detail].join('|');
}

/** Issues that are not acknowledged (those that count). */
export function openIssues(issues: readonly Issue[]): Issue[] {
  return issues.filter((i) => !i.acknowledged);
}
