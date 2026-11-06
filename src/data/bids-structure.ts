// Result of checking the served dataset's file and folder names against the
// rules of the BIDS version it declares, and the line that describes it.
// Shared by the dev server (plain-text log line) and the viewer's dataset summary.
// Relative imports only: this module is also loaded by Node scripts.

export const ISSUES_URL = 'https://github.com/rgbayrak/physai-qa-interactive/issues';

/** One file or folder that breaks the rules */
export interface StructureProblem {
  /** Relative to the BIDS root, with '/' */
  path: string;
  message: string;
}

export type BidsStructure =
  /** dataset_description.json has no BIDSVersion */
  | { state: 'no-version' }
  /** No rules file for the declared version; available is oldest first */
  | { state: 'no-rules'; declared: string; reason: 'older' | 'newer' | 'unknown'; available: string[] }
  | {
      state: 'checked';
      version: string;
      /** Files inside sub-* folders that were checked */
      filesChecked: number;
      /** Required top-level files that are missing */
      missing: string[];
      problemCount: number;
      /** The first problems found (capped) */
      problems: StructureProblem[];
    };

/** A piece of the line: plain text, a file name (code style) or a link */
export type StructurePart = string | { code: string } | { link: string };

const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
const ISSUE_INVITE: StructurePart[] = [' If you come across any issues, please open an issue at ', { link: ISSUES_URL }, '.'];

/** What the structure check found, for the dataset summary and the server log */
export function structureLine(s: BidsStructure | undefined | null): StructurePart[] | null {
  if (!s) return null;
  if (s.state === 'no-version') {
    return [
      'File names were not checked against BIDS: ',
      { code: 'dataset_description.json' },
      ' has no ',
      { code: '"BIDSVersion"' },
      '.',
    ];
  }
  if (s.state === 'no-rules') {
    const oldest = s.available[0];
    const newest = s.available[s.available.length - 1];
    if (s.reason === 'older') {
      return [
        `BIDS version ${s.declared} is older than ${oldest}, the oldest version with a published BIDS schema, so the schema is not matched and file names were not checked.`,
        ...ISSUE_INVITE,
      ];
    }
    if (s.reason === 'newer') {
      return [
        `BIDS version ${s.declared} is newer than ${newest}, the newest rules this viewer has, so file names were not checked. Update the rules with `,
        { code: 'npx vite-node scripts/update-bids-rules.ts' },
        '.',
      ];
    }
    return [
      `BIDS version ${s.declared} is not a BIDS release (rules exist for ${oldest} to ${newest}), so file names were not checked.`,
      ...ISSUE_INVITE,
    ];
  }

  const ok = s.problemCount === 0 && s.missing.length === 0;
  if (ok) return [`File and folder names follow BIDS ${s.version} (${plural(s.filesChecked, 'file')} checked).`];

  const line: StructurePart[] = [];
  if (s.problemCount > 0) {
    line.push(`${plural(s.problemCount, 'name')} ${s.problemCount === 1 ? 'does' : 'do'} not follow BIDS ${s.version} (${plural(s.filesChecked, 'file')} checked), for example `);
    s.problems.slice(0, 3).forEach((p, i) => {
      if (i > 0) line.push('; ');
      line.push({ code: p.path }, `: ${p.message}`);
    });
    line.push('.');
  }
  if (s.missing.length > 0) {
    line.push(`${line.length > 0 ? ' ' : ''}Missing required by BIDS ${s.version}: `);
    s.missing.forEach((m, i) => {
      if (i > 0) line.push(', ');
      line.push({ code: m });
    });
    line.push('.');
  }
  return line;
}

/** The line as plain text, for the terminal */
export function structureText(line: StructurePart[]): string {
  return line.map((p) => (typeof p === 'string' ? p : 'code' in p ? p.code : p.link)).join('');
}
