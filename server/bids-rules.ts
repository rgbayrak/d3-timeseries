import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// The file and folder naming rules of one BIDS version, cut down from the
// official BIDS schema (github.com/bids-standard/bids-schema) to what the
// structure check needs. One file per version in server/schema-rules/, written by
// scripts/update-bids-rules.ts (1.8.0 and later) or converted once from the
// schema's YAML sources (1.6.0, 1.7.0).

export interface EntityRule {
  /** Name the file rules use, e.g. "subject" */
  name: string;
  /** Key in file names, e.g. "sub" */
  key: string;
}

export interface TopLevelRule {
  /** File or folder name without extension, e.g. "README", "dataset_description" */
  name: string;
  required: boolean;
  /** Allowed extensions; "" = none */
  extensions: string[];
}

export interface FileRule {
  /** Datatype folders the files sit in (func, anat, …); empty = subject or session folder (scans, sessions) */
  datatypes: string[];
  suffixes: string[];
  extensions: string[];
  entities: Record<string, 'required' | 'optional'>;
}

export interface BidsRules {
  bidsVersion: string;
  /** Where the rules were converted from */
  source: string;
  /** In the order they must appear in file names */
  entities: EntityRule[];
  topLevel: TopLevelRule[];
  files: FileRule[];
}

export const RULES_DIR = join(process.cwd(), 'server', 'schema-rules');

/** "1.9.0" → [1, 9, 0]; null when it is not x.y.z */
export function parseVersion(v: string | null | undefined): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec((v ?? '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareVersions(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** Versions with a rules file, oldest first */
export function availableRuleVersions(dir = RULES_DIR): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .map((f) => /^v(\d+\.\d+\.\d+)\.json$/.exec(f)?.[1])
    .filter((v): v is string => !!v)
    .sort((a, b) => compareVersions(parseVersion(a)!, parseVersion(b)!));
}

export function loadRules(version: string, dir = RULES_DIR): BidsRules | null {
  try {
    return JSON.parse(readFileSync(join(dir, `v${version}.json`), 'utf-8'));
  } catch {
    return null;
  }
}

// ── Conversion from a compiled schema.json (BIDS 1.8.0 and later) ──

type Level = string | { level?: string };
type RawRule = {
  datatypes?: string[];
  suffixes?: string[];
  extensions?: string[];
  entities?: Record<string, Level>;
  stem?: string;
  path?: string;
  level?: string;
};

const levelOf = (v: Level | undefined): string | undefined => (typeof v === 'string' ? v : v?.level);

/** Every rule object in a nested group ({ func: { events: {...}, ... }, ... }) */
function ruleObjects(group: unknown): RawRule[] {
  if (!group || typeof group !== 'object') return [];
  const out: RawRule[] = [];
  for (const v of Object.values(group as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const r = v as RawRule;
    if (r.suffixes || r.stem || r.path || r.extensions) out.push(r);
    else out.push(...ruleObjects(v));
  }
  return out;
}

const fileRule = (r: RawRule): FileRule => ({
  datatypes: r.datatypes ?? [],
  suffixes: r.suffixes ?? [],
  extensions: r.extensions ?? [],
  entities: Object.fromEntries(
    Object.entries(r.entities ?? {}).map(([k, v]) => [k, levelOf(v) === 'required' ? 'required' : 'optional']),
  ),
});

/**
 * Compact rules from a compiled schema.json: entity order and keys, the raw
 * file rules (derivatives are not checked), and the top-level files and the
 * subject and session tables from rules.files.common.
 */
export function compactRules(schema: Record<string, any>, source: string): BidsRules {
  const order: string[] = schema.rules?.entities ?? [];
  const objects: Record<string, { name?: string; entity?: string }> = schema.objects?.entities ?? {};
  const entities = order.map((name) => ({ name, key: objects[name]?.entity ?? objects[name]?.name ?? name }));

  const files: FileRule[] = [];
  const topLevel: TopLevelRule[] = [];
  for (const r of ruleObjects(schema.rules?.files?.raw)) if (r.suffixes) files.push(fileRule(r));
  for (const r of ruleObjects(schema.rules?.files?.common)) {
    if (r.suffixes) files.push(fileRule(r)); // scans, sessions: in subject and session folders
    else if (r.path) topLevel.push({ name: r.path, required: r.level === 'required', extensions: [''] });
    else if (r.stem) topLevel.push({ name: r.stem, required: r.level === 'required', extensions: r.extensions ?? [''] });
  }
  return { bidsVersion: String(schema.bids_version), source, entities, topLevel, files };
}
