import type { ChannelMetrics } from '../data/sqi-metrics';

// TSV format for dataset-wide quality metrics: one row per scan and channel.
// Shared by the Node script that writes it (server/quality-metrics.ts) and the
// quality page that reads it, so both agree on column names and number format.
// Relative imports only: this module is also loaded by Node scripts.

export type MetricKey = Exclude<keyof ChannelMetrics, 'channelName'>;

/** Metric columns, in TSV order; keys match ChannelMetrics */
export const METRIC_COLUMNS: { key: MetricKey; column: string }[] = [
  { key: 'mean', column: 'mean' },
  { key: 'stdDev', column: 'std_dev' },
  { key: 'snr', column: 'snr' },
  { key: 'kurtosis', column: 'kurtosis' },
  { key: 'skewness', column: 'skewness' },
  { key: 'zeroCrossingRate', column: 'zero_crossing_rate' },
  { key: 'svri', column: 'svri' },
  { key: 'ipa', column: 'ipa' },
  { key: 'sqi', column: 'sqi' },
  { key: 'kurtosisWindowed', column: 'kurtosis_windowed' },
  { key: 'approxEntropy', column: 'approx_entropy' },
  { key: 'beatCorrelation', column: 'beat_correlation' },
];

/** Scan/channel columns that precede the metrics */
const SCAN_COLUMNS = [
  'sub',
  'ses',
  'task',
  'run',
  'filename',
  'channel',
  'signal_type',
  'sampling_frequency',
  'n_samples',
  'duration_s',
  'timing_status',
  'sidecar_assessment',
  'sidecar_percent_valid',
] as const;

export const TSV_HEADER: string[] = [...SCAN_COLUMNS, ...METRIC_COLUMNS.map((c) => c.column)];

export const METRICS_TSV_NAME = 'quality_metrics.tsv';
export const DATASET_JSON_NAME = 'dataset.json';
export const WAVEFORMS_DIR = 'waveforms';

export interface ScanKeyLike {
  sub: string;
  ses: string;
  task: string;
  run: string;
}

export interface QualityRow extends ScanKeyLike {
  filename: string;
  channel: string;
  /** From the physio channel dictionary (src/quality/channels.ts), e.g. cardiac */
  signalType: string;
  samplingFrequency: number;
  numSamples: number;
  durationS: number;
  timingStatus: string;
  /** Pass/fail from the scan's desc-quality sidecar; '' if none */
  sidecarAssessment: string;
  /** 0-1 from the desc-quality sidecar; NaN if none */
  sidecarPercentValid: number;
  metrics: Record<MetricKey, number>;
}

/** BIDS-style scan prefix, e.g. sub-01_ses-02_task-rest_run-01 */
export function scanId(s: ScanKeyLike): string {
  const parts = [`sub-${s.sub}`];
  if (s.ses) parts.push(`ses-${s.ses}`);
  parts.push(`task-${s.task}`);
  if (s.run) parts.push(`run-${s.run}`);
  return parts.join('_');
}

export function sameScanKey(a: ScanKeyLike, b: ScanKeyLike): boolean {
  return a.sub === b.sub && a.ses === b.ses && a.task === b.task && a.run === b.run;
}

/** Shortest round-trip form (deterministic); n/a for NaN, inf/-inf for infinities */
export function formatNumber(v: number): string {
  if (Number.isNaN(v)) return 'n/a';
  if (v === Infinity) return 'inf';
  if (v === -Infinity) return '-inf';
  return String(v);
}

export function parseNumber(s: string): number {
  if (s === 'n/a' || s === '') return NaN;
  if (s === 'inf') return Infinity;
  if (s === '-inf') return -Infinity;
  return Number(s);
}

/** Text field: n/a when empty; tabs and newlines replaced so the TSV stays rectangular */
function formatText(s: string): string {
  const clean = s.replace(/[\t\r\n]+/g, ' ');
  return clean === '' ? 'n/a' : clean;
}

function parseText(s: string): string {
  return s === 'n/a' ? '' : s;
}

function rowCells(r: QualityRow): string[] {
  return [
    formatText(r.sub),
    formatText(r.ses),
    formatText(r.task),
    formatText(r.run),
    formatText(r.filename),
    formatText(r.channel),
    formatText(r.signalType),
    formatNumber(r.samplingFrequency),
    formatNumber(r.numSamples),
    formatNumber(r.durationS),
    formatText(r.timingStatus),
    formatText(r.sidecarAssessment),
    formatNumber(r.sidecarPercentValid),
    ...METRIC_COLUMNS.map((c) => formatNumber(r.metrics[c.key])),
  ];
}

export function rowsToTsv(rows: QualityRow[]): string {
  const lines = [TSV_HEADER.join('\t'), ...rows.map((r) => rowCells(r).join('\t'))];
  return lines.join('\n') + '\n';
}

/** Parse a quality metrics TSV; columns are found by header name, so order does not matter */
export function parseQualityTsv(text: string): QualityRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split('\t');
  const idx = new Map(header.map((h, i) => [h, i]));
  const missing = TSV_HEADER.filter((h) => !idx.has(h));
  if (missing.length > 0) throw new Error(`Quality metrics TSV is missing columns: ${missing.join(', ')}`);

  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    const cell = (name: string) => cells[idx.get(name)!] ?? '';
    const metrics = {} as Record<MetricKey, number>;
    for (const c of METRIC_COLUMNS) metrics[c.key] = parseNumber(cell(c.column));
    return {
      sub: parseText(cell('sub')),
      ses: parseText(cell('ses')),
      task: parseText(cell('task')),
      run: parseText(cell('run')),
      filename: parseText(cell('filename')),
      channel: parseText(cell('channel')),
      signalType: parseText(cell('signal_type')),
      samplingFrequency: parseNumber(cell('sampling_frequency')),
      numSamples: parseNumber(cell('n_samples')),
      durationS: parseNumber(cell('duration_s')),
      timingStatus: parseText(cell('timing_status')),
      sidecarAssessment: parseText(cell('sidecar_assessment')),
      sidecarPercentValid: parseNumber(cell('sidecar_percent_valid')),
      metrics,
    };
  });
}

// ── Companion files written next to the TSV ───────────────

/** Mirrors server/bids-layout.ts DatasetInfo */
export interface DatasetInfoLike {
  name: string | null;
  bidsVersion: string | null;
  datasetType: string | null;
  license: string | null;
  authors: string[];
  doi: string | null;
  derivatives: { name: string; version: string | null }[];
}

export interface ParticipantColumnMeta {
  description?: string;
  units?: string;
  levels?: Record<string, string>;
}

/** participants.tsv (+ participants.json descriptions); rows keyed by subject label without "sub-" */
export interface ParticipantsTable {
  columns: string[];
  meta: Record<string, ParticipantColumnMeta>;
  rows: Record<string, Record<string, string>>;
}

export interface DatasetQualityFile {
  dataset: string;
  info: DatasetInfoLike;
  nSubjects: number;
  nScans: number;
  channels: string[];
  tasks: string[];
  samplingFrequencies: number[];
  participants: ParticipantsTable | null;
  /** Scans listed by the BIDS layout that could not be read or computed */
  failedScans: { scan: string; reason: string }[];
  /** physio.tsv columns left out because they are not physiological (e.g. trigger), with the scan count */
  excludedChannels: { channel: string; reason: string; scans: number }[];
  /** Units per channel from the physio sidecars ("<column>": {"Units": …}), where given */
  channelUnits?: Record<string, string>;
  metricsFile: string;
}

/** Per-scan min/max envelope for the static waveform plots */
export interface WaveformFile {
  filename: string;
  samplingFrequency: number;
  /** Bucket centre times (s) on the scan-onset axis */
  times: number[];
  channels: { channel: string; min: (number | null)[]; max: (number | null)[] }[];
}
