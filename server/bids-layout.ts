import { readdirSync, readFileSync, existsSync, accessSync, constants, mkdirSync, writeFileSync } from 'fs';
import { gunzipSync } from 'zlib';
import { join, dirname } from 'path';

/** Matches physio .tsv.gz files (both _physio.tsv.gz and _desc-preproc_physio.tsv.gz) */
const PHYSIO_GZ_RE = /_physio\.tsv\.gz$/;

/** Matches confounds TSV files from fmriprep */
const CONFOUNDS_RE = /_desc-confounds_timeseries\.tsv$/;

export interface SubjectInfo {
  id: string;
  sessions: string[];
}

interface PhysioSidecar {
  SamplingFrequency: number;
  StartTime: number;
  Columns: string[];
}

export interface ScanEntry {
  sub: string;
  ses: string;
  task: string;
  run: string;
}

/** Check if a path is actually readable (resolves symlinks, not a broken annex pointer) */
export function isReadable(filePath: string): boolean {
  try {
    accessSync(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * List physio .tsv.gz filenames in a func dir that are actually readable.
 * Filters out broken symlinks (e.g. unlocked DataLad/git-annex files).
 */
export function listReadablePhysio(funcDir: string): string[] {
  if (!existsSync(funcDir)) return [];
  return readdirSync(funcDir).filter(
    (f) => PHYSIO_GZ_RE.test(f) && isReadable(join(funcDir, f)),
  );
}

/** Resolve the func directory for a subject, optionally within a session */
function funcDir(bidsRoot: string, sub: string, ses: string): string {
  return ses
    ? join(bidsRoot, `sub-${sub}`, `ses-${ses}`, 'func')
    : join(bidsRoot, `sub-${sub}`, 'func');
}

export function getSubjects(bidsRoot: string): SubjectInfo[] {
  const entries = readdirSync(bidsRoot, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && e.name.startsWith('sub-'))
    .map((e) => {
      const subId = e.name.replace('sub-', '');
      const subDir = join(bidsRoot, e.name);
      const sesDirs = readdirSync(subDir, { withFileTypes: true })
        .filter((s) => s.isDirectory() && s.name.startsWith('ses-'))
        .map((s) => s.name.replace('ses-', ''));

      if (sesDirs.length > 0) {
        // Has session directories — filter to those with readable physio
        const sessions = sesDirs
          .filter((ses) => listReadablePhysio(funcDir(bidsRoot, subId, ses)).length > 0)
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        return { id: subId, sessions };
      }

      // No session directories — check for func/ directly under subject
      if (listReadablePhysio(funcDir(bidsRoot, subId, '')).length > 0) {
        return { id: subId, sessions: [''] };
      }
      return { id: subId, sessions: [] };
    })
    .filter((s) => s.sessions.length > 0)
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

export function getTasks(bidsRoot: string, sub: string, ses: string): string[] {
  const fd = funcDir(bidsRoot, sub, ses);
  const readable = listReadablePhysio(fd);
  const taskSet = new Set<string>();
  for (const f of readable) {
    const m = f.match(/task-([^_]+)/);
    if (m) taskSet.add(m[1]);
  }
  return [...taskSet].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function getRuns(bidsRoot: string, sub: string, ses: string, task: string): string[] {
  const fd = funcDir(bidsRoot, sub, ses);
  const readable = listReadablePhysio(fd);
  const runSet = new Set<string>();
  for (const f of readable) {
    // Only consider files matching this task
    if (!f.includes(`task-${task}`)) continue;
    const m = f.match(/run-([^_]+)/);
    if (m) runSet.add(m[1]);
  }
  return [...runSet].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function findPhysioFiles(bidsRoot: string, sub: string, ses: string, task: string, run: string) {
  const fd = funcDir(bidsRoot, sub, ses);
  const readable = listReadablePhysio(fd);

  // Build prefix: sub-XX[_ses-XX]_task-XX[_run-XX]
  const basePrefix = ses ? `sub-${sub}_ses-${ses}_task-${task}` : `sub-${sub}_task-${task}`;
  const prefix = run ? `${basePrefix}_run-${run}` : basePrefix;

  const tsvGzName = readable.find((f) => f.startsWith(prefix));
  if (!tsvGzName) return null;
  const tsvGzPath = join(fd, tsvGzName);

  // Sidecar resolution cascade:
  // 1. Per-file JSON sidecar in funcDir
  const perFileJson = join(fd, tsvGzName.replace('.tsv.gz', '.json'));
  let sidecarPath: string | null = null;
  if (isReadable(perFileJson)) {
    sidecarPath = perFileJson;
  } else {
    // 2. Subject-level sidecar (run stripped): sub-XX/sub-XX_task-YY_physio.json
    const subDir = join(bidsRoot, `sub-${sub}`);
    const subLevelName = `sub-${sub}_task-${task}_physio.json`;
    const subLevelPath = join(subDir, subLevelName);
    if (isReadable(subLevelPath)) {
      sidecarPath = subLevelPath;
    } else {
      // 3. Top-level fallbacks
      for (const candidate of ['preproc_physio.json', 'physio.json']) {
        const p = join(bidsRoot, candidate);
        if (isReadable(p)) {
          sidecarPath = p;
          break;
        }
      }
    }
  }

  // Look for quality sidecar: *_desc-quality.json
  const qualityName = `${basePrefix}_desc-quality.json`;
  const qualityPath = join(fd, qualityName);
  const qualityJsonPath = isReadable(qualityPath) ? qualityPath : null;

  return { tsvGzPath, tsvGzName, sidecarPath, qualityJsonPath };
}

export function readPhysio(bidsRoot: string, sub: string, ses: string, task: string, run: string) {
  const found = findPhysioFiles(bidsRoot, sub, ses, task, run);
  if (!found || !found.sidecarPath) return null;

  const sidecar: PhysioSidecar = JSON.parse(readFileSync(found.sidecarPath, 'utf-8'));
  const tsvBuf = gunzipSync(readFileSync(found.tsvGzPath));
  const tsvText = tsvBuf.toString('utf-8');

  const numCols = sidecar.Columns.length;
  const columns: number[][] = Array.from({ length: numCols }, () => []);

  const lines = tsvText.split('\n');
  for (const line of lines) {
    if (line.length === 0) continue;
    // Skip header row if present
    if (Number.isNaN(Number(line.split('\t')[0]))) continue;
    const parts = line.split('\t');
    for (let c = 0; c < numCols; c++) {
      columns[c].push(Number(parts[c]));
    }
  }

  // Read quality sidecar if available
  let quality: Record<string, { assessment: string; percentValid: number }> | null = null;
  if (found.qualityJsonPath) {
    try {
      const qRaw = JSON.parse(readFileSync(found.qualityJsonPath, 'utf-8'));
      quality = {};
      for (const key of Object.keys(qRaw)) {
        if (key === 'Description') continue;
        const entry = qRaw[key];
        if (entry && typeof entry.QualityAssessment === 'string') {
          quality[key] = {
            assessment: entry.QualityAssessment,
            percentValid: entry.PercentageValid ?? null,
          };
        }
      }
    } catch {
      // ignore malformed quality files
    }
  }

  return {
    filename: found.tsvGzName,
    samplingFrequency: sidecar.SamplingFrequency,
    startTime: sidecar.StartTime,
    columns: sidecar.Columns,
    data: columns,
    numSamples: columns[0].length,
    quality,
  };
}

export function readConfounds(bidsderRoot: string, sub: string, ses: string, task: string, run: string) {
  const fd = funcDir(bidsderRoot, sub, ses);
  if (!existsSync(fd)) return null;

  let prefix = ses ? `sub-${sub}_ses-${ses}_task-${task}` : `sub-${sub}_task-${task}`;
  if (run) prefix += `_run-${run}`;

  const files = readdirSync(fd).filter(
    (f) => f.startsWith(prefix) && CONFOUNDS_RE.test(f),
  );
  if (files.length === 0) return null;

  const filename = files[0];
  const filePath = join(fd, filename);
  if (!isReadable(filePath)) return null;

  const text = readFileSync(filePath, 'utf-8');
  const lines = text.split('\n').filter((l) => l.length > 0);
  if (lines.length < 2) return null;

  const headers = lines[0].split('\t');
  const fdIdx = headers.indexOf('framewise_displacement');
  if (fdIdx === -1) return null;

  const fdValues: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const val = lines[i].split('\t')[fdIdx];
    fdValues.push(val === 'n/a' ? NaN : Number(val));
  }

  return {
    filename,
    numVolumes: fdValues.length,
    framewise_displacement: fdValues,
  };
}

export interface StoredAnnotation {
  id: string;
  onset_s: number;
  duration_s: number;
  trial_type: string;
  start_sample: number;
  end_sample: number;
}

export interface AnnotationsFile {
  sub: string;
  ses: string;
  task: string;
  run: string;
  channel: string;
  sampling_rate: number;
  annotations: StoredAnnotation[];
}

function annotationsFilePath(
  root: string,
  sub: string,
  ses: string,
  task: string,
  run: string,
  channel: string,
): string {
  const dir = ses ? join(root, `sub-${sub}`, `ses-${ses}`) : join(root, `sub-${sub}`);
  let base = ses ? `sub-${sub}_ses-${ses}_task-${task}` : `sub-${sub}_task-${task}`;
  if (run) base += `_run-${run}`;
  base += `_channel-${channel}_annotations.json`;
  return join(dir, base);
}

export function readAnnotations(
  root: string,
  sub: string,
  ses: string,
  task: string,
  run: string,
  channel: string,
): AnnotationsFile | null {
  const filePath = annotationsFilePath(root, sub, ses, task, run, channel);
  if (!isReadable(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

export function writeAnnotations(root: string, payload: AnnotationsFile): void {
  const filePath = annotationsFilePath(root, payload.sub, payload.ses, payload.task, payload.run, payload.channel);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

export function buildScans(bidsRoot: string, subjects: SubjectInfo[]): ScanEntry[] {
  const scans: ScanEntry[] = [];
  for (const subj of subjects) {
    for (const ses of subj.sessions) {
      for (const task of getTasks(bidsRoot, subj.id, ses)) {
        const runs = getRuns(bidsRoot, subj.id, ses, task);
        if (runs.length > 0) {
          for (const run of runs) {
            scans.push({ sub: subj.id, ses, task, run });
          }
        } else {
          scans.push({ sub: subj.id, ses, task, run: '' });
        }
      }
    }
  }
  return scans;
}
