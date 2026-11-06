// What to tell the user when the dataset description is missing or has no
// meaningful title or authors. Shared by the dev server and the compute
// script (plain-text log lines) and the page header (rich parts).
// Relative imports only: this module is also loaded by Node scripts.

/** Where the dataset title and authors were read from */
export type DescriptionSource = 'main' | 'physio' | 'derivatives' | 'none';

/** Fields of dataset_description.json checked for a meaningful value */
export type DescriptionField = 'Name' | 'Authors';

export interface DescriptionNotice {
  /** dataset_description.json the title and authors were read from; null when none was found */
  file: string | null;
  source: DescriptionSource;
  /** Fields with no meaningful value in that file (all of them when there is no file) */
  missingFields: DescriptionField[];
  /** Set when the main BIDS folder has no readable dataset_description.json */
  mainMissing: {
    /** Where the file was expected */
    path: string;
    /** Web link to the main dataset (DataLad .gitmodules or SourceDatasets), if one was found */
    url: string | null;
    /** Command that installs the main folder (DataLad subdataset), if known */
    command: string | null;
  } | null;
}

/** A piece of notice text: plain, a file name or command (code style), or a link */
export type NoticePart = string | { code: string } | { link: string };

const PLACEHOLDERS = new Set([
  'n/a',
  'na',
  'none',
  'unknown',
  'unspecified',
  'unnamed',
  'untitled',
  'todo',
  'tbd',
  'placeholder',
  'test',
]);

/**
 * True when a Name or Authors entry carries no real information: not a
 * string, no letters, a stock placeholder (n/a, unknown, TODO, …, ignoring
 * case and surrounding brackets or quotes), or "Author", "Author 1", ….
 */
export function isPlaceholder(value: unknown): boolean {
  if (typeof value !== 'string') return true;
  const s = value
    .trim()
    .replace(/^[[({<"'`\s]+|[\])}>"'`\s]+$/g, '')
    .toLowerCase();
  if (!/\p{L}/u.test(s)) return true;
  return PLACEHOLDERS.has(s) || /^author\s*\d*$/.test(s);
}

const FIELD_WORD: Record<DescriptionField, string> = { Name: 'title', Authors: 'authors' };

/** `"Name"` and `"Authors"` → ['"Name"', ' and ', '"Authors"'] as code parts */
function fieldList(fields: DescriptionField[]): NoticePart[] {
  const parts: NoticePart[] = [];
  fields.forEach((f, i) => {
    if (i > 0) parts.push(' and ');
    parts.push({ code: `"${f}"` });
  });
  return parts;
}

/**
 * Lines telling the user what is missing and how to fix it; empty when the
 * main description is there and has a title and authors.
 */
export function descriptionNoticeLines(n: DescriptionNotice | undefined | null): NoticePart[][] {
  if (!n) return [];
  const lines: NoticePart[][] = [];

  if (n.mainMissing) {
    const { path, url, command } = n.mainMissing;
    const line: NoticePart[] = ["The main BIDS folder's dataset description was not found at ", { code: path }, '. '];
    if (url) {
      line.push('Download it from ', { link: url });
      if (command) line.push(' (', { code: command }, ')');
      line.push(', or add one with ');
    } else if (command) {
      line.push('Install it with ', { code: command }, ', or add one with ');
    } else {
      line.push('Download the main BIDS dataset from its source repository, or add one with ');
    }
    line.push(...fieldList(['Name', 'Authors']), '.');
    lines.push(line);
    if (n.file && n.source !== 'main') {
      lines.push([`The name shown is from the ${n.source} folder's description (`, { code: n.file }, ').']);
    }
    return lines;
  }

  if (n.missingFields.length > 0 && n.file) {
    const words = n.missingFields.map((f) => FIELD_WORD[f]).join(' or ');
    lines.push([
      `No dataset ${words} found in `,
      { code: n.file },
      '. Add ',
      ...fieldList(n.missingFields),
      ' to it so the header, Stats tab and PDF report name the dataset.',
    ]);
  }
  return lines;
}

/** A notice line as plain text, for the terminal */
export function noticeText(line: NoticePart[]): string {
  return line.map((p) => (typeof p === 'string' ? p : 'code' in p ? p.code : p.link)).join('');
}
