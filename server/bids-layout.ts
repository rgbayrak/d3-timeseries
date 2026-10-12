import { readdirSync, readFileSync, existsSync, accessSync, constants, mkdirSync, writeFileSync } from 'fs';
import { gunzipSync } from 'zlib';
import { join, dirname, basename } from 'path';

/** Matches physio .tsv.gz files (both _physio.tsv.gz and _desc-preproc_physio.tsv.gz) */
const PHYSIO_GZ_RE = /_physio\.tsv\.gz$/;

/** Matches confounds TSV files from fmriprep (plain or gzipped) */
const CONFOUNDS_RE = /_desc-confounds_timeseries\.tsv(\.gz)?$/;

/** Motion/intensity confound columns exposed to the viewer, in dropdown order */
export const CONFOUND_COLUMNS = [
  'framewise_displacement',
  'rmsd',
  'dvars',
  'std_dvars',
  'trans_x',
  'trans_y',
  'trans_z',
  'rot_x',
  'rot_y',
  'rot_z',
];

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

  // Look for quality sidecar: *_desc-quality.json, run-level first (e.g.
  // ..._run-01_desc-quality.json), then the run-less name
  const qualityJsonPath =
    [prefix, basePrefix]
      .map((p) => join(fd, `${p}_desc-quality.json`))
      .find((p) => isReadable(p)) ?? null;

  return { tsvGzPath, tsvGzName, sidecarPath, qualityJsonPath };
}

/**
 * Sample indices of rising edges in a trigger channel. The threshold is the
 * midpoint of the channel's range, so it works for 0/1, 0/5V, etc.
 */
export function detectTriggerOnsets(values: number[]): number[] {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!(max > min)) return [];
  const threshold = (min + max) / 2;
  const onsets: number[] = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i] >= threshold && values[i - 1] < threshold) onsets.push(i);
  }
  return onsets;
}

export function readPhysio(
  bidsRoot: string,
  sub: string,
  ses: string,
  task: string,
  run: string,
  bidsderRoot: string = bidsRoot,
) {
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

  const fs = sidecar.SamplingFrequency;
  const prefix = scanPrefix(sub, ses, task, run);
  const boldTiming = readBoldTiming(bidsRoot, bidsderRoot, sub, ses, prefix, task);
  const expectedVolumes =
    boldTiming?.volumeTiming?.length ?? countConfoundVolumes(bidsderRoot, sub, ses, prefix);

  const trigCol = sidecar.Columns.findIndex((c) => c.toLowerCase() === 'trigger');
  const triggerSec =
    trigCol === -1
      ? []
      : detectTriggerOnsets(columns[trigCol]).map((i) => sidecar.StartTime + i / fs);
  const timing = verifyTriggerTiming(triggerSec, boldTiming?.tr ?? null, expectedVolumes, fs);

  return {
    filename: found.tsvGzName,
    samplingFrequency: fs,
    startTime: sidecar.StartTime - timing.offset,
    timing,
    columns: sidecar.Columns,
    data: columns,
    numSamples: columns[0].length,
    quality,
  };
}

function scanPrefix(sub: string, ses: string, task: string, run: string): string {
  let prefix = ses ? `sub-${sub}_ses-${ses}_task-${task}` : `sub-${sub}_task-${task}`;
  if (run) prefix += `_run-${run}`;
  return prefix;
}

/**
 * Match a filename against a scan prefix. Run is a BIDS index, so it compares
 * numerically: run-01 matches run-1, and run-1 does not match run-10.
 */
function matchesPrefix(filename: string, prefix: string): boolean {
  const pattern = prefix.replace(/_run-0*(\d+)$/, '_run-0*$1');
  return new RegExp(`^${pattern}_`).test(filename);
}

export type TimingStatus ='verified' | 'corrected' | 'mismatch' | 'unverified';

export interface PhysioTiming {
  status: TimingStatus;
  /** Human-readable explanation shown in the viewer */
  detail: string;
  /** Seconds subtracted from the sidecar StartTime (non-zero only when 'corrected') */
  offset: number;
  /** Trigger pulse times (s) on the final scan-onset axis; empty if no trigger channel */
  triggerTimes: number[];
}

/**
 * Check trigger pulses (times on the sidecar StartTime axis, where the first
 * BOLD volume should be at t = 0) against the BOLD TR and volume count.
 *
 * The sidecar StartTime is the BIDS reference. Triggers only move the onset
 * when they look like one clean pulse per volume (spacing matches TR, count
 * matches the number of volumes) and the first pulse is off from t = 0.
 * Anything else (dummy scans, dropped pulses, wrong sampling rate) is
 * reported as a mismatch and StartTime is kept.
 */
export function verifyTriggerTiming(
  triggerSec: number[],
  tr: number | null,
  expectedVolumes: number | null,
  fs: number,
): PhysioTiming {
  const keep = (status: TimingStatus, detail: string): PhysioTiming => ({
    status,
    detail,
    offset: 0,
    triggerTimes: triggerSec,
  });

  if (triggerSec.length === 0) {
    return keep('unverified', 'No trigger pulses; using sidecar StartTime as-is');
  }
  if (tr == null) {
    return keep('unverified', 'No BOLD RepetitionTime/VolumeTiming to check triggers against; using sidecar StartTime');
  }

  // Every pulse-to-pulse interval must match TR, not just on average: one
  // extra or dropped pulse shifts every volume after it.
  const intervals = triggerSec.slice(1).map((t, i) => t - triggerSec[i]);
  const badIdx = intervals.findIndex((dt) => Math.abs(dt - tr) > 0.05 * tr);
  if (badIdx !== -1) {
    const nBad = intervals.filter((dt) => Math.abs(dt - tr) > 0.05 * tr).length;
    return keep(
      'mismatch',
      `${nBad} trigger interval(s) differ from TR ${tr} s (first: ${intervals[badIdx].toFixed(3)} s after pulse ${badIdx + 1}); using sidecar StartTime`,
    );
  }
  if (expectedVolumes != null && triggerSec.length !== expectedVolumes) {
    return keep(
      'mismatch',
      `${triggerSec.length} trigger pulses vs ${expectedVolumes} volumes (dummy scans or dropped pulses?); using sidecar StartTime`,
    );
  }

  const offset = triggerSec[0];
  const tolerance = Math.max(0.05 * tr, 2 / fs);
  if (Math.abs(offset) <= tolerance) {
    return keep(
      'verified',
      `${triggerSec.length} trigger pulses match TR ${tr} s; first pulse at ${offset.toFixed(3)} s agrees with sidecar StartTime`,
    );
  }
  return {
    status: 'corrected',
    detail: `Sidecar StartTime puts the first trigger at ${offset.toFixed(3)} s; shifted so it is at 0 (pulses match TR ${tr} s and volume count)`,
    offset,
    triggerTimes: triggerSec.map((t) => t - offset),
  };
}

interface BoldTiming {
  tr: number;
  /** BIDS VolumeTiming (s, relative to the first volume), if the sidecar has it */
  volumeTiming: number[] | null;
}

/**
 * TR and volume onsets from the BOLD sidecar: scan-level raw sidecar, then
 * top-level task inheritance, then the derivatives' BOLD sidecars.
 * Returns null if no timing is found.
 */
function readBoldTiming(
  bidsRoot: string,
  bidsderRoot: string,
  sub: string,
  ses: string,
  prefix: string,
  task: string,
): BoldTiming | null {
  const candidates = [
    join(funcDir(bidsRoot, sub, ses), `${prefix}_bold.json`),
    join(bidsRoot, `task-${task}_bold.json`),
  ];
  const derFd = funcDir(bidsderRoot, sub, ses);
  if (existsSync(derFd)) {
    for (const f of readdirSync(derFd)) {
      if (matchesPrefix(f, prefix) && f.endsWith('_bold.json')) candidates.push(join(derFd, f));
    }
  }

  for (const path of candidates) {
    if (!isReadable(path)) continue;
    const meta = JSON.parse(readFileSync(path, 'utf-8'));
    if (Array.isArray(meta.VolumeTiming) && meta.VolumeTiming.length > 1) {
      const vt: number[] = meta.VolumeTiming;
      return { tr: vt[1] - vt[0], volumeTiming: vt };
    }
    if (typeof meta.RepetitionTime === 'number' && meta.RepetitionTime > 0) {
      return { tr: meta.RepetitionTime, volumeTiming: null };
    }
  }
  return null;
}

function findConfoundsFile(bidsderRoot: string, sub: string, ses: string, prefix: string): string | null {
  const fd = funcDir(bidsderRoot, sub, ses);
  if (!existsSync(fd)) return null;
  const name = readdirSync(fd).find((f) => matchesPrefix(f, prefix) && CONFOUNDS_RE.test(f));
  if (!name) return null;
  const path = join(fd, name);
  return isReadable(path) ? path : null;
}

function readConfoundsText(path: string): string {
  const buf = readFileSync(path);
  return (path.endsWith('.gz') ? gunzipSync(buf) : buf).toString('utf-8');
}

/** Number of volumes (data rows) in the confounds file, or null if there is none */
function countConfoundVolumes(bidsderRoot: string, sub: string, ses: string, prefix: string): number | null {
  const path = findConfoundsFile(bidsderRoot, sub, ses, prefix);
  if (!path) return null;
  return readConfoundsText(path).split('\n').filter((l) => l.length > 0).length - 1;
}

export function readConfounds(
  bidsRoot: string,
  bidsderRoot: string,
  sub: string,
  ses: string,
  task: string,
  run: string,
) {
  const prefix = scanPrefix(sub, ses, task, run);
  const filePath = findConfoundsFile(bidsderRoot, sub, ses, prefix);
  if (!filePath) return null;

  const lines = readConfoundsText(filePath).split('\n').filter((l) => l.length > 0);
  if (lines.length < 2) return null;

  const headers = lines[0].split('\t');
  const present = CONFOUND_COLUMNS.filter((c) => headers.includes(c));
  if (present.length === 0) return null;

  const columns: Record<string, number[]> = {};
  for (const c of present) columns[c] = [];
  const rows = lines.slice(1).map((l) => l.split('\t'));
  for (const c of present) {
    const idx = headers.indexOf(c);
    for (const row of rows) {
      const val = row[idx];
      columns[c].push(val === 'n/a' ? NaN : Number(val));
    }
  }

  // Volume onsets on the scan-onset axis (t = 0 = first volume)
  const bold = readBoldTiming(bidsRoot, bidsderRoot, sub, ses, prefix, task);
  const volumeTimes = bold
    ? Array.from({ length: rows.length }, (_, i) => bold.volumeTiming?.[i] ?? i * bold.tr)
    : null;

  return {
    filename: basename(filePath),
    numVolumes: rows.length,
    volumeTimes,
    columns,
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

export interface DatasetInfo {
  name: string | null;
  bidsVersion: string | null;
  datasetType: string | null;
  license: string | null;
  authors: string[];
  doi: string | null;
  /** Pipelines that generated the derivatives (e.g. fMRIPrep 23.0.2), if any */
  derivatives: { name: string; version: string | null }[];
}

function readJsonIfReadable(path: string): Record<string, unknown> | null {
  if (!isReadable(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

/** Dataset-level metadata from dataset_description.json (raw + derivatives) */
export function readDatasetInfo(bidsRoot: string, bidsderRoot: string): DatasetInfo {
  const raw = readJsonIfReadable(join(bidsRoot, 'dataset_description.json')) ?? {};
  const der = readJsonIfReadable(join(bidsderRoot, 'dataset_description.json'));
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);

  const generatedBy = Array.isArray(der?.GeneratedBy) ? der.GeneratedBy : [];
  return {
    name: str(raw.Name),
    bidsVersion: str(raw.BIDSVersion),
    datasetType: str(raw.DatasetType),
    license: str(raw.License),
    authors: Array.isArray(raw.Authors) ? raw.Authors.filter((a): a is string => typeof a === 'string') : [],
    doi: str(raw.DatasetDOI),
    derivatives: generatedBy
      .filter((g: { Name?: unknown }) => typeof g?.Name === 'string')
      .map((g: { Name: string; Version?: unknown }) => ({ name: g.Name, version: str(g.Version) })),
  };
}
