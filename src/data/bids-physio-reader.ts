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
  startTime: number;
  columns: string[];
  data: number[][];
  numSamples: number;
  quality: Record<string, ChannelQuality> | null;
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

export interface ConfoundsRaw {
  filename: string;
  numVolumes: number;
  framewise_displacement: number[];
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

/** Convert FD data to DataPoints using physio timing to derive TR. */
export function toFDPoints(confounds: ConfoundsRaw, raw: PhysioRaw): DataPoint[] {
  const physioDuration = (raw.numSamples - 1) / raw.samplingFrequency;
  const tr = physioDuration / confounds.numVolumes;
  const t0 = raw.startTime;
  const points: DataPoint[] = [];
  for (let i = 0; i < confounds.framewise_displacement.length; i++) {
    const val = confounds.framewise_displacement[i];
    if (val == null || Number.isNaN(val)) continue;
    points.push({ time: t0 + i * tr, value: val });
  }
  return points;
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
