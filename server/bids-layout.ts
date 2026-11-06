import { readdirSync, readFileSync, existsSync, accessSync, constants, mkdirSync, writeFileSync } from 'fs';
import { gunzipSync } from 'zlib';
import { join, dirname, basename, relative } from 'path';
import { isPlaceholder } from '../src/data/dataset-notice';
import type { DescriptionField, DescriptionNotice, DescriptionSource } from '../src/data/dataset-notice';

/** Matches physio .tsv.gz files (both _physio.tsv.gz and _desc-preproc_physio.tsv.gz) */
const PHYSIO_GZ_RE = /_physio\.tsv\.gz$/;

/**
 * Per-volume confounds TSVs (plain or gzipped), in order of preference:
 * fMRIPrep ≥ 20.2, fMRIPrep 1.4–20.1, fMRIPrep < 1.4, then MRIQC's
 * *_timeseries.tsv (same column names: framewise_displacement, rot_x, …).
 */
const CONFOUNDS_PATTERNS = [
  /_desc-confounds_timeseries\.tsv(\.gz)?$/,
  /_desc-confounds_regressors\.tsv(\.gz)?$/,
  /_bold_confounds\.tsv(\.gz)?$/,
  /_timeseries\.tsv(\.gz)?$/,
];

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

/**
 * A scan's physio recording from physioRoot. BOLD timing for the trigger check
 * comes from bidsRoot (the main BIDS folder, normally the same as physioRoot),
 * then the derivatives.
 */
export function readPhysio(
  physioRoot: string,
  sub: string,
  ses: string,
  task: string,
  run: string,
  bidsderRoot: string = physioRoot,
  bidsRoot: string = physioRoot,
) {
  const found = findPhysioFiles(physioRoot, sub, ses, task, run);
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
 * TR and volume onsets from the BOLD sidecar: scan-level sidecar in the main
 * BIDS folder (exact name, then e.g. per-echo names), then top-level task
 * inheritance there, then the derivatives' BOLD sidecars. Never read from a
 * separate physio folder.
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
  const rawFd = funcDir(bidsRoot, sub, ses);
  const candidates = [join(rawFd, `${prefix}_bold.json`)];
  // Other raw sidecars of the run, e.g. multi-echo …_run-1_echo-1_bold.json
  if (existsSync(rawFd)) {
    const others = readdirSync(rawFd)
      .filter((f) => matchesPrefix(f, prefix) && f.endsWith('_bold.json'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (const f of others) candidates.push(join(rawFd, f));
  }
  candidates.push(join(bidsRoot, `task-${task}_bold.json`));
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

/**
 * The scan's confounds file in the derivatives func folder: the first readable
 * match of the most preferred CONFOUNDS_PATTERNS entry. Multi-echo runs
 * (…_echo-1_…, …_echo-2_…) share their motion, so the lowest echo is used.
 */
function findConfoundsFile(bidsderRoot: string, sub: string, ses: string, prefix: string): string | null {
  const fd = funcDir(bidsderRoot, sub, ses);
  if (!existsSync(fd)) return null;
  const files = readdirSync(fd)
    .filter((f) => matchesPrefix(f, prefix))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const pattern of CONFOUNDS_PATTERNS) {
    const name = files.find((f) => pattern.test(f) && isReadable(join(fd, f)));
    if (name) return join(fd, name);
  }
  return null;
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

/**
 * The scan's BIDS events file, following BIDS inheritance: the run's own file
 * in the imaging func folder, then the run-less file there (it applies to
 * every run), then a top-level task-<task>_events.tsv. Null if there is none.
 */
function findEventsFile(imagingRoot: string, sub: string, ses: string, task: string, run: string): string | null {
  const fd = funcDir(imagingRoot, sub, ses);
  const files = existsSync(fd) ? readdirSync(fd).filter((f) => f.endsWith('_events.tsv')) : [];

  /** Events file for `prefix` in fd; a run-less prefix never picks up a run's file */
  const inFuncDir = (prefix: string, withRun: boolean): string | null => {
    const candidates = files.filter((f) => matchesPrefix(f, prefix));
    const name =
      candidates.find((f) => f === `${prefix}_events.tsv`) ??
      candidates.find((f) => withRun || !/_run-/.test(f.slice(prefix.length)));
    return name ? join(fd, name) : null;
  };

  const candidates = [
    run ? inFuncDir(scanPrefix(sub, ses, task, run), true) : null,
    inFuncDir(scanPrefix(sub, ses, task, ''), false),
    join(imagingRoot, `task-${task}_events.tsv`),
  ];
  return candidates.find((p): p is string => p !== null && isReadable(p)) ?? null;
}

/**
 * Task events (BIDS *_events.tsv): onset and duration in seconds from the
 * first volume (the viewer's t = 0), plus every other column as text. Rows
 * without a numeric onset are dropped; an n/a duration counts as 0.
 * Read from the main BIDS folder (BidsRoots.bidsRoot), never from a separate physio folder.
 */
export function readEvents(imagingRoot: string, sub: string, ses: string, task: string, run: string) {
  const filePath = findEventsFile(imagingRoot, sub, ses, task, run);
  if (!filePath) return null;

  const lines = readFileSync(filePath, 'utf-8')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) return null;

  const headers = lines[0].split('\t').map((h) => h.trim());
  const onsetIdx = headers.indexOf('onset');
  if (onsetIdx < 0) return null;
  const durationIdx = headers.indexOf('duration');
  const other = headers.filter((h, i) => i !== onsetIdx && i !== durationIdx && h.length > 0);

  const onset: number[] = [];
  const duration: number[] = [];
  const columns: Record<string, string[]> = {};
  for (const c of other) columns[c] = [];

  for (const line of lines.slice(1)) {
    const row = line.split('\t').map((v) => v.trim());
    const t = Number(row[onsetIdx]);
    if (row[onsetIdx] === '' || !Number.isFinite(t)) continue;
    const d = durationIdx >= 0 ? Number(row[durationIdx]) : 0;
    onset.push(t);
    duration.push(Number.isFinite(d) && d > 0 ? d : 0);
    for (const c of other) columns[c].push(row[headers.indexOf(c)] ?? 'n/a');
  }
  if (onset.length === 0) return null;

  return { filename: basename(filePath), onset, duration, columns };
}

/** Peak rows in a physprep events file: r_peak, systolic_peak, …, each optionally _corrected */
const PEAK_TYPE_RE = /peak(_corrected)?$/i;

/**
 * TRIAL (not a supported feature yet): detected and corrected peaks from a
 * physprep-style events file in the physio folder (onset, duration,
 * trial_type such as r_peak / r_peak_corrected, channel such as ECG / PPG).
 * Only peak rows with a channel are kept. Null if there are none.
 */
export function readPeaks(physioRoot: string, sub: string, ses: string, task: string, run: string) {
  const events = readEvents(physioRoot, sub, ses, task, run);
  const types = events?.columns.trial_type;
  const channels = events?.columns.channel;
  if (!events || !types || !channels) return null;

  const time: number[] = [];
  const channel: string[] = [];
  const corrected: boolean[] = [];
  events.onset.forEach((t, i) => {
    const type = types[i] ?? '';
    const ch = channels[i] ?? '';
    if (!PEAK_TYPE_RE.test(type) || ch === '' || ch.toLowerCase() === 'n/a') return;
    time.push(t);
    channel.push(ch);
    corrected.push(/_corrected$/i.test(type));
  });
  return time.length > 0 ? { filename: events.filename, time, channel, corrected } : null;
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
  /** Whole-waveform rating (good, bad, fixable, unknown); first in the file. Absent in older files */
  waveform_quality?: 'good' | 'bad' | 'fixable' | 'unknown' | null;
  /** Whole-waveform quality analysis comment; absent in older files */
  waveform_comment?: string;
  sub: string;
  ses: string;
  task: string;
  run: string;
  channel: string;
  sampling_rate: number;
  annotations: StoredAnnotation[];
}

/** BIDS labels are alphanumeric only (BIDS spec, "Entities") */
const LABEL_RE = /^[A-Za-z0-9]+$/;
/** Channel names are physio column names; allow _ and - but never path separators or dots */
const CHANNEL_RE = /^[A-Za-z0-9_-]+$/;

export interface ScanKey {
  sub: string;
  ses?: string;
  task?: string;
  run?: string;
  channel?: string;
}

/**
 * Check request-supplied identifiers before they are used to build a file
 * path. Returns an error message, or null if every given field is safe.
 * `ses` and `run` may be '' (session-less / run-less layouts); `sub` may not.
 */
export function validateScanKey(key: ScanKey): string | null {
  if (!LABEL_RE.test(key.sub)) return `Invalid sub label: ${JSON.stringify(key.sub)}`;
  for (const field of ['ses', 'task', 'run'] as const) {
    const v = key[field];
    if (v !== undefined && v !== '' && !LABEL_RE.test(v)) {
      return `Invalid ${field} label: ${JSON.stringify(v)}`;
    }
  }
  if (key.channel !== undefined && !CHANNEL_RE.test(key.channel)) {
    return `Invalid channel name: ${JSON.stringify(key.channel)}`;
  }
  return null;
}

function annotationsFilePath(
  root: string,
  sub: string,
  ses: string,
  task: string,
  run: string,
  channel: string,
): string {
  // Defence in depth: the server validates first, but never build a path from unchecked input
  const error = validateScanKey({ sub, ses, task, run, channel });
  if (error) throw new Error(error);
  const dir = ses
    ? join(root, `sub-${sub}`, `ses-${ses}`, 'func')
    : join(root, `sub-${sub}`, 'func');
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

/** Channel name check on its own (same rule as validateScanKey); error message or null */
export function validateChannel(channel: string): string | null {
  return CHANNEL_RE.test(channel) ? null : `Invalid channel name: ${JSON.stringify(channel)}`;
}

/**
 * A scan's channel counts as annotated once anything about it was saved: a
 * full-recording signal quality rating, notes, or at least one time window.
 */
export function isAnnotated(file: AnnotationsFile | null): boolean {
  if (!file) return false;
  return (
    file.waveform_quality != null ||
    (typeof file.waveform_comment === 'string' && file.waveform_comment.trim() !== '') ||
    (Array.isArray(file.annotations) && file.annotations.length > 0)
  );
}

/**
 * How many of the given scans are annotated for one channel ("24/80 annotated"),
 * and the first one that is not, in the scans' order (hierarchy order), so
 * Explore and Annotate can open it: a skipped scan is never forgotten.
 */
export function annotationProgress<S extends { sub: string; ses: string; task: string; run: string }>(
  root: string,
  scans: S[],
  channel: string,
): { annotated: number; total: number; firstUnannotated: S | null } {
  let annotated = 0;
  let firstUnannotated: S | null = null;
  for (const s of scans) {
    if (isAnnotated(readAnnotations(root, s.sub, s.ses, s.task, s.run, channel))) annotated++;
    else firstUnannotated ??= s;
  }
  return { annotated, total: scans.length, firstUnannotated };
}

export function writeAnnotations(root: string, payload: AnnotationsFile): void {
  const filePath = annotationsFilePath(root, payload.sub, payload.ses, payload.task, payload.run, payload.channel);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

export interface BidsRoots {
  /** Main BIDS folder: dataset_description.json, participants.tsv, events, BOLD sidecars */
  bidsRoot: string;
  /** Folder holding the *_physio.tsv.gz files and their sidecars; normally bidsRoot */
  physioRoot: string;
  /** Derivatives folder: confounds and the derivatives' dataset_description.json */
  derivRoot: string;
  /** How each root was chosen, for the startup log */
  notes: string[];
}

/** Sub-folders of dir, sorted, skipping hidden ones */
function childDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * First file name in dir's sub-XX/[ses-YY/]func/ folders that passes test,
 * or null. Names are listed whether or not the files are downloaded, and the
 * search stops at the first match.
 */
function findInFuncDirs(dir: string, test: (name: string) => boolean): string | null {
  for (const sub of childDirs(dir).filter((d) => d.startsWith('sub-'))) {
    const subDir = join(dir, sub);
    const sessions = childDirs(subDir).filter((d) => d.startsWith('ses-'));
    for (const fd of [join(subDir, 'func'), ...sessions.map((s) => join(subDir, s, 'func'))]) {
      if (!existsSync(fd)) continue;
      const hit = readdirSync(fd).find(test);
      if (hit) return hit;
    }
  }
  return null;
}

/** Rank of the best confounds pattern found in dir (lower is better), or null */
function confoundsRank(dir: string): number | null {
  let best: number | null = null;
  findInFuncDirs(dir, (f) => {
    const rank = CONFOUNDS_PATTERNS.findIndex((p) => p.test(f));
    if (rank !== -1 && (best === null || rank < best)) best = rank;
    return best === 0; // keep looking until the most preferred pattern is seen
  });
  return best;
}

/**
 * Physio and derivatives roots for a main BIDS folder, found by what the
 * folders contain (sub-XX/[ses-YY/]func/ files), never by folder name.
 *
 * - Physio: the main folder when it has *_physio.tsv.gz files; else the
 *   first folder inside it, or inside its derivatives/, that has them.
 * - Derivatives: the folder inside derivatives/ with confounds files,
 *   preferring fMRIPrep's over MRIQC's (CONFOUNDS_PATTERNS order).
 *
 * Physio or derivatives stored outside the main folder are not searched for:
 * pass them as overrides (BIDSPHYS_ROOT, BIDSDER_ROOT), which always win.
 */
export function resolveBidsRoots(
  bidsRoot: string,
  overrides: { physioRoot?: string; derivRoot?: string } = {},
): BidsRoots {
  const notes: string[] = [];
  const derivativesDir = join(bidsRoot, 'derivatives');
  const isPhysio = (f: string) => PHYSIO_GZ_RE.test(f);

  let physioRoot = overrides.physioRoot;
  if (physioRoot) notes.push('physio root given explicitly');
  else if (findInFuncDirs(bidsRoot, isPhysio)) {
    physioRoot = bidsRoot;
    notes.push('physio files found in the main BIDS folder');
  } else {
    const candidates = [
      ...childDirs(bidsRoot).filter((d) => !d.startsWith('sub-') && d !== 'derivatives').map((d) => join(bidsRoot, d)),
      ...childDirs(derivativesDir).map((d) => join(derivativesDir, d)),
    ].filter((d) => findInFuncDirs(d, isPhysio));
    physioRoot = candidates[0] ?? bidsRoot;
    if (candidates.length === 0) notes.push('no *_physio.tsv.gz files found; set BIDSPHYS_ROOT if they are stored elsewhere');
    else notes.push(`physio files found in ${physioRoot}`);
    if (candidates.length > 1) {
      notes.push(`physio files also in ${candidates.slice(1).join(', ')}; set BIDSPHYS_ROOT to choose`);
    }
  }

  let derivRoot = overrides.derivRoot;
  if (derivRoot) notes.push('derivatives root given explicitly');
  else {
    const ranked = childDirs(derivativesDir)
      .map((d) => ({ dir: join(derivativesDir, d), rank: confoundsRank(join(derivativesDir, d)) }))
      .filter((c): c is { dir: string; rank: number } => c.rank !== null)
      .sort((a, b) => a.rank - b.rank); // stable: name order within a rank
    derivRoot = ranked[0]?.dir ?? derivativesDir;
    if (ranked.length === 0) notes.push('no confounds files found; set BIDSDER_ROOT if the derivatives are stored elsewhere');
    else notes.push(`confounds found in ${derivRoot}`);
    if (ranked.length > 1) {
      notes.push(`confounds also in ${ranked.slice(1).map((c) => c.dir).join(', ')}; set BIDSDER_ROOT to choose`);
    }
  }

  return { bidsRoot, physioRoot, derivRoot, notes };
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
  /** Where the title and authors came from, and what the user should fix */
  description: DescriptionNotice;
}

function readJsonIfReadable(path: string): Record<string, unknown> | null {
  if (!isReadable(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

/** http(s) URL as is, a DOI as https://doi.org/…; anything else (bids: URIs, relative paths) is null */
function webLink(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (/^https?:\/\//i.test(s)) return s;
  const doi = s.replace(/^doi:/i, '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  return /^10\.\d{4,}\//.test(doi) ? `https://doi.org/${doi}` : null;
}

/**
 * The main BIDS folder as a DataLad subdataset of the folder above it: its
 * URL and install command from that folder's .gitmodules, or null.
 */
function subdatasetSource(bidsRoot: string): { url: string | null; command: string } | null {
  const parent = dirname(bidsRoot);
  const gitmodules = join(parent, '.gitmodules');
  if (!isReadable(gitmodules)) return null;
  const rel = relative(parent, bidsRoot);
  // [submodule "…"] sections, each with path = … and url = … (DataLad may add datalad-url)
  for (const section of readFileSync(gitmodules, 'utf-8').split(/^\s*\[submodule\b/m).slice(1)) {
    const field = (key: string) => section.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, 'm'))?.[1] ?? null;
    if (field('path') !== rel) continue;
    return {
      url: webLink(field('datalad-url')) ?? webLink(field('url')),
      command: `cd ${parent} && datalad get -n ${rel} && datalad get ${rel}/dataset_description.json`,
    };
  }
  return null;
}

/** First web link in a description's SourceDatasets ([{ URL, DOI, Version }]), or null */
function sourceDatasetLink(desc: Record<string, unknown> | null): string | null {
  const sources = Array.isArray(desc?.SourceDatasets) ? desc.SourceDatasets : [];
  for (const s of sources as { URL?: unknown; DOI?: unknown }[]) {
    const link = webLink(s?.URL) ?? webLink(s?.DOI);
    if (link) return link;
  }
  return null;
}

/**
 * Dataset-level metadata from dataset_description.json (main + derivatives).
 * When the main BIDS folder has none, the title and authors come from the
 * physio folder's description, then the derivatives', and
 * description.mainMissing says where to get the main one. Placeholder titles
 * and authors (n/a, Unknown, Author 1, …) are dropped and listed in
 * description.missingFields.
 */
export function readDatasetInfo(bidsRoot: string, bidsderRoot: string, physioRoot: string = bidsRoot): DatasetInfo {
  const mainPath = join(bidsRoot, 'dataset_description.json');
  const main = readJsonIfReadable(mainPath);
  const der = readJsonIfReadable(join(bidsderRoot, 'dataset_description.json'));
  const physioPath = join(physioRoot, 'dataset_description.json');
  const physio = physioRoot !== bidsRoot ? readJsonIfReadable(physioPath) : null;
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);

  // Title and authors: main, else physio, else derivatives
  const [source, file, desc]: [DescriptionSource, string | null, Record<string, unknown>] = main
    ? ['main', mainPath, main]
    : physio
      ? ['physio', physioPath, physio]
      : der
        ? ['derivatives', join(bidsderRoot, 'dataset_description.json'), der]
        : ['none', null, {}];
  const name = isPlaceholder(desc.Name) ? null : (desc.Name as string).trim();
  const authors = Array.isArray(desc.Authors)
    ? desc.Authors.filter((a): a is string => !isPlaceholder(a)).map((a) => a.trim())
    : [];
  const missingFields: DescriptionField[] = [];
  if (!name) missingFields.push('Name');
  if (authors.length === 0) missingFields.push('Authors');

  let mainMissing: DescriptionNotice['mainMissing'] = null;
  if (!main) {
    const sub = subdatasetSource(bidsRoot);
    mainMissing = {
      path: mainPath,
      url: sub?.url ?? sourceDatasetLink(physio) ?? sourceDatasetLink(der),
      command: sub?.command ?? null,
    };
  }

  // The other fields describe the main dataset only, never a fallback pipeline
  const raw = main ?? {};
  const generatedBy = Array.isArray(der?.GeneratedBy) ? der.GeneratedBy : [];
  return {
    name,
    bidsVersion: str(raw.BIDSVersion),
    datasetType: str(raw.DatasetType),
    license: str(raw.License),
    authors,
    doi: str(raw.DatasetDOI),
    derivatives: generatedBy
      .filter((g: { Name?: unknown }) => typeof g?.Name === 'string')
      .map((g: { Name: string; Version?: unknown }) => ({ name: g.Name, version: str(g.Version) })),
    description: { file, source, missingFields, mainMissing },
  };
}
