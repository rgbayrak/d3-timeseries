import { readdirSync } from 'fs';
import { join } from 'path';
import { availableRuleVersions, compareVersions, loadRules, parseVersion, RULES_DIR } from './bids-rules';
import type { BidsRules, FileRule } from './bids-rules';
import type { BidsStructure, StructureProblem } from '../src/data/bids-structure';

// Checks a BIDS dataset's file and folder names against the rules of the BIDS
// version it declares (server/schema-rules/). Only names are read, never file
// contents, so it works on DataLad datasets whose files are not downloaded.
// derivatives/, sourcedata/, code/ and other top-level folders are not checked.

const MAX_PROBLEMS = 50;
const LABEL_RE = /^[a-zA-Z0-9]+$/;

interface NameParts {
  entities: [string, string][];
  suffix: string;
  extension: string;
}

/** "sub-01_task-rest_physio.tsv.gz" → entities, suffix, extension; null when it is not entity_…_suffix.ext */
export function parseBidsName(name: string): NameParts | null {
  const dot = name.indexOf('.');
  if (dot <= 0) return null;
  const stem = name.slice(0, dot);
  const extension = name.slice(dot);
  const parts = stem.split('_');
  const suffix = parts.pop() ?? '';
  if (!suffix || suffix.includes('-')) return null;
  const entities: [string, string][] = [];
  for (const p of parts) {
    const i = p.indexOf('-');
    if (i <= 0 || i === p.length - 1) return null;
    entities.push([p.slice(0, i), p.slice(i + 1)]);
  }
  return { entities, suffix, extension };
}

/** What, if anything, is wrong with one file name in a datatype folder (or a subject/session folder when datatype is null) */
export function checkFileName(
  name: string,
  rules: BidsRules,
  where: { datatype: string | null; sub: string; ses: string | null },
): string | null {
  const parsed = parseBidsName(name);
  if (!parsed) return 'not a BIDS file name (entity-label_…_suffix.extension)';
  const { entities, suffix, extension } = parsed;

  const byKey = new Map(rules.entities.map((e, i) => [e.key, { name: e.name, index: i }]));
  for (const [key, value] of entities) {
    if (!byKey.has(key)) return `unknown entity "${key}-"`;
    if (!LABEL_RE.test(value)) return `"${key}-${value}" may only use letters and digits`;
  }
  const order = entities.map(([key]) => byKey.get(key)!.index);
  if (order.some((v, i) => i > 0 && v <= order[i - 1])) return 'entities are not in the BIDS order';

  const values = new Map(entities);
  if (values.get('sub') !== where.sub) return `"sub-${values.get('sub') ?? ''}" does not match the folder sub-${where.sub}`;
  if (where.ses !== null && values.has('ses') && values.get('ses') !== where.ses) {
    return `"ses-${values.get('ses')}" does not match the folder ses-${where.ses}`;
  }
  if (where.ses !== null && !values.has('ses') && where.datatype !== null) return `missing "ses-${where.ses}"`;
  if (where.ses === null && values.has('ses')) return `has "ses-${values.get('ses')}" but is not in a session folder`;

  const inFolder = (r: FileRule) => (where.datatype === null ? r.datatypes.length === 0 : r.datatypes.includes(where.datatype));
  // Subject and session folders also hold sidecars inherited by the files below them (BIDS inheritance)
  const inherited = where.datatype === null && (extension === '.json' || extension === '.tsv');
  const candidates = rules.files.filter((r) => (inFolder(r) || inherited) && r.suffixes.includes(suffix));
  const place = where.datatype ? `${where.datatype}/` : 'this folder';
  if (candidates.length === 0) return `suffix "_${suffix}" is not allowed in ${place}`;
  const withExt = candidates.filter((r) => r.extensions.includes(extension));
  if (withExt.length === 0) return `extension "${extension}" is not allowed for "_${suffix}"`;
  if (inherited && !candidates.some(inFolder)) return null; // sidecar: entities are checked on the files it applies to

  let firstError: string | null = null;
  for (const r of withExt) {
    const extra = entities.map(([k]) => byKey.get(k)!.name).find((n) => !(n in r.entities));
    const missing = Object.entries(r.entities).find(([n, level]) => level === 'required' && !entities.some(([k]) => byKey.get(k)!.name === n));
    if (!extra && !missing) return null;
    firstError ??= extra
      ? `entity "${rules.entities.find((e) => e.name === extra)!.key}-" is not allowed for "_${suffix}"`
      : `missing required entity "${rules.entities.find((e) => e.name === missing![0])?.key ?? missing![0]}-"`;
  }
  return firstError;
}

const entries = (dir: string) => {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith('.'));
  } catch {
    return [];
  }
};

/** Required top-level files and folders that are missing */
function missingTopLevel(root: string, rules: BidsRules): string[] {
  const present = new Set(entries(root).map((e) => e.name));
  return rules.topLevel
    .filter((t) => t.required && !t.extensions.some((ext) => present.has(t.name + ext)))
    .map((t) => t.name + (t.extensions.length === 1 ? t.extensions[0] : ''));
}

/** Check every sub-<label>/[ses-<label>/]<datatype>/ name in root against one version's rules */
export function checkWithRules(root: string, rules: BidsRules): Extract<BidsStructure, { state: 'checked' }> {
  const problems: StructureProblem[] = [];
  let problemCount = 0;
  let filesChecked = 0;
  const datatypes = new Set(rules.files.flatMap((r) => r.datatypes));
  const report = (path: string, message: string | null) => {
    if (!message) return;
    problemCount++;
    if (problems.length < MAX_PROBLEMS) problems.push({ path, message });
  };

  /** A subject or session folder: tables and sidecars, then datatype (and session) folders */
  const walk = (dir: string, rel: string, sub: string, ses: string | null) => {
    for (const e of entries(dir)) {
      const path = `${rel}/${e.name}`;
      if (!e.isDirectory()) {
        filesChecked++;
        report(path, checkFileName(e.name, rules, { datatype: null, sub, ses }));
      } else if (ses === null && e.name.startsWith('ses-')) {
        const label = e.name.slice(4);
        if (!LABEL_RE.test(label)) report(path, 'session label may only use letters and digits');
        walk(join(dir, e.name), path, sub, label);
      } else if (datatypes.has(e.name)) {
        for (const f of entries(join(dir, e.name))) {
          if (f.isDirectory()) continue; // e.g. MEG .ds folders: not checked
          filesChecked++;
          report(`${path}/${f.name}`, checkFileName(f.name, rules, { datatype: e.name, sub, ses }));
        }
      } else {
        report(path, `"${e.name}" is not a ${ses === null ? 'session or datatype' : 'datatype'} folder`);
      }
    }
  };

  for (const e of entries(root)) {
    if (!e.isDirectory() || !e.name.startsWith('sub-')) continue;
    const sub = e.name.slice(4);
    if (!LABEL_RE.test(sub)) report(e.name, 'subject label may only use letters and digits');
    walk(join(root, e.name), e.name, sub, null);
  }
  return {
    state: 'checked',
    version: rules.bidsVersion,
    filesChecked,
    missing: missingTopLevel(root, rules),
    problemCount,
    problems,
  };
}

/** Check root against the rules of its declared BIDSVersion, or say why it can't be */
export function checkStructure(root: string, declared: string | null, rulesDir = RULES_DIR): BidsStructure {
  if (!declared || declared.trim() === '') return { state: 'no-version' };
  const available = availableRuleVersions(rulesDir);
  const v = parseVersion(declared);
  const rules = v ? loadRules(`${v[0]}.${v[1]}.${v[2]}`, rulesDir) : null;
  if (rules) return checkWithRules(root, rules);

  const oldest = parseVersion(available[0]);
  const newest = parseVersion(available[available.length - 1]);
  const reason =
    v && oldest && compareVersions(v, oldest) < 0 ? 'older' : v && newest && compareVersions(v, newest) > 0 ? 'newer' : 'unknown';
  return { state: 'no-rules', declared: declared.trim(), reason, available };
}
