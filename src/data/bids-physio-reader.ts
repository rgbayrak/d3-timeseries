export interface SubjectInfo {
  id: string;
  sessions: string[];
}

export interface ChannelQuality {
  assessment: string;
  percentValid: number | null;
}

export interface PhysioRaw {
  filename: string;
  samplingFrequency: number;
  /** Time (s) of the first sample relative to scan onset (t = 0 = first volume) */
  startTime: number;
  /** How startTime was established and whether trigger pulses confirm it */
  timing: PhysioTiming;
  columns: string[];
  data: number[][];
  numSamples: number;
  quality: Record<string, ChannelQuality> | null;
}

export type TimingStatus = 'verified' | 'corrected' | 'mismatch' | 'unverified';

/** Mirrors server/bids-layout.ts PhysioTiming */
export interface PhysioTiming {
  status: TimingStatus;
  detail: string;
  offset: number;
  /** Trigger pulse times (s) on the scan-onset axis; empty if no trigger channel */
  triggerTimes: number[];
}

export interface DataPoint {
  time: number;
  value: number;
}

export interface ScanEntry {
  sub: string;
  ses: string;
  task: string;
  run: string;
}

export async function fetchSubjects(): Promise<SubjectInfo[]> {
  const res = await fetch('/api/bids/subjects');
  const json = await res.json();
  return json.subjects;
}

/** Mirrors server/bids-layout.ts DatasetInfo (from dataset_description.json) */
export interface DatasetInfo {
  name: string | null;
  bidsVersion: string | null;
  datasetType: string | null;
  license: string | null;
  authors: string[];
  doi: string | null;
  derivatives: { name: string; version: string | null }[];
}

export async function fetchDatasetInfo(): Promise<DatasetInfo | null> {
  const res = await fetch('/api/bids/dataset');
  if (!res.ok) return null;
  return res.json();
}

export async function fetchScans(): Promise<ScanEntry[]> {
  const res = await fetch('/api/bids/scans');
  const json = await res.json();
  return json.scans;
}

export async function fetchTasks(sub: string, ses: string): Promise<string[]> {
  const res = await fetch(`/api/bids/tasks?sub=${sub}&ses=${ses}`);
  const json = await res.json();
  return json.tasks;
}

export async function fetchRuns(sub: string, ses: string, task: string): Promise<string[]> {
  const res = await fetch(`/api/bids/runs?sub=${sub}&ses=${ses}&task=${task}`);
  const json = await res.json();
  return json.runs;
}

export async function fetchPhysioRaw(sub: string, ses: string, task: string, run: string): Promise<PhysioRaw> {
  const res = await fetch(`/api/bids/physio?sub=${sub}&ses=${ses}&task=${task}&run=${run}`);
  if (!res.ok) throw new Error(`Failed to fetch physio for sub-${sub} ses-${ses} task-${task} run-${run}`);
  return res.json();
}

export function toDataPoints(raw: PhysioRaw, channel: string): DataPoint[] {
  const colIdx = raw.columns.indexOf(channel);
  if (colIdx === -1) throw new Error(`Channel "${channel}" not found`);

  const col = raw.data[colIdx];
  const points: DataPoint[] = new Array(raw.numSamples);
  const dt = 1 / raw.samplingFrequency;
  const t0 = raw.startTime;

  for (let i = 0; i < raw.numSamples; i++) {
    points[i] = { time: t0 + i * dt, value: col[i] };
  }
  return points;
}

export function getTimeExtent(raw: PhysioRaw): [number, number] {
  const t0 = raw.startTime;
  const t1 = t0 + (raw.numSamples - 1) / raw.samplingFrequency;
  return [t0, t1];
}

/**
 * Visible time range for all charts: starts at scan onset (t = 0), not where
 * the physio recording starts, so pre-scan physio is out of view.
 */
export function getViewExtent(raw: PhysioRaw): [number, number] {
  const [, t1] = getTimeExtent(raw);
  return [0, Math.max(t1, 0)];
}

export interface ConfoundsRaw {
  filename: string;
  numVolumes: number;
  /** Onset (s) of each volume relative to the first volume, from the BOLD sidecar; null if unknown */
  volumeTimes: number[] | null;
  /** Confound column name → one value per volume (NaN for n/a) */
  columns: Record<string, number[]>;
}

export async function fetchConfounds(
  sub: string,
  ses: string,
  task: string,
  run: string,
): Promise<ConfoundsRaw | null> {
  const res = await fetch(`/api/bids/confounds?sub=${sub}&ses=${ses}&task=${task}&run=${run}`);
  if (!res.ok) return null;
  return res.json();
}

/**
 * Convert one confound column to DataPoints on the scan-onset time axis
 * (t = 0 at the first volume, same axis as the physio signal).
 * Volume i sits at volumeTimes[i] (from the BOLD sidecar). Without BOLD
 * timing, volumes are spread evenly across the physio recording, which is
 * only approximate and wrong when physio starts before the scan.
 */
export function toConfoundPoints(confounds: ConfoundsRaw, column: string, raw: PhysioRaw): DataPoint[] {
  const values = confounds.columns[column] ?? [];
  const physioDuration = (raw.numSamples - 1) / raw.samplingFrequency;
  const fallbackTr = physioDuration / confounds.numVolumes;
  const timeOf = (i: number) =>
    confounds.volumeTimes?.[i] ?? raw.startTime + i * fallbackTr;
  const points: DataPoint[] = [];
  for (let i = 0; i < values.length; i++) {
    const val = values[i];
    if (val == null || Number.isNaN(val)) continue;
    points.push({ time: timeOf(i), value: val });
  }
  return points;
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

export async function fetchAnnotations(
  sub: string,
  ses: string,
  task: string,
  run: string,
  channel: string,
): Promise<AnnotationsFile | null> {
  const res = await fetch(
    `/api/bids/annotations?sub=${sub}&ses=${ses}&task=${task}&run=${run}&channel=${encodeURIComponent(channel)}`,
  );
  if (!res.ok) return null;
  return res.json();
}

export async function saveAnnotations(payload: AnnotationsFile): Promise<void> {
  const res = await fetch('/api/bids/annotations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to save annotations');
}

export function getValueExtent(raw: PhysioRaw, channel: string): [number, number] {
  const colIdx = raw.columns.indexOf(channel);
  if (colIdx === -1) throw new Error(`Channel "${channel}" not found`);

  const col = raw.data[colIdx];
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < col.length; i++) {
    if (col[i] < min) min = col[i];
    if (col[i] > max) max = col[i];
  }
  const pad = (max - min) * 0.02;
  return [min - pad, max + pad];
}
