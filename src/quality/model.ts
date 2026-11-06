import { SQI_COLUMNS, formatMetricValue } from '@/viewer/sqi-table';
import { METRIC_COLUMNS, sameScanKey, scanId } from './metrics-tsv';
import type { MetricKey, QualityRow, ScanKeyLike, ParticipantsTable } from './metrics-tsv';
import { finiteValues } from './stats';
import { runSentence } from './run-log';
import type { QualityRun } from './run-log';

// Pure helpers behind the Stats tab, the scatter plot in Explore and Annotate and the PDF (no DOM access).

export interface MetricDef {
  key: MetricKey;
  label: string;
  description?: string;
  decimals: number;
  /** Group from SQI_COLUMNS (Basic, Distribution, PaPaGei, PhysioQC) */
  group: string;
}

/** Metric labels, descriptions and groups come from SQI_COLUMNS (src/viewer/sqi-table.ts), the one list of metric names */
export const METRIC_DEFS: MetricDef[] = METRIC_COLUMNS.map((c) => {
  const col = SQI_COLUMNS.find((s) => s.key === c.key);
  return {
    key: c.key,
    label: col?.label ?? c.column,
    description: col?.description,
    decimals: col?.decimals ?? 3,
    group: col?.group ?? 'Other',
  };
});

/** Metric groups in first-appearance order */
export const METRIC_GROUPS: string[] = [...new Set(METRIC_DEFS.map((m) => m.group))];

// ── Metric visibility (Metrics shown on the Stats tab) ───

/** Which metrics are shown; a missing set means all of them */
export type VisibleMetrics = ReadonlySet<MetricKey>;

export const ALL_METRICS: MetricKey[] = METRIC_DEFS.map((m) => m.key);

/** Read a stored list of metric keys; null, malformed or unknown entries fall back to all metrics */
export function parseVisibleMetrics(stored: string | null): Set<MetricKey> {
  if (stored === null) return new Set(ALL_METRICS);
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return new Set(ALL_METRICS);
    return new Set(ALL_METRICS.filter((k) => parsed.includes(k)));
  } catch {
    return new Set(ALL_METRICS);
  }
}

/** Stored form: metric keys in the standard order */
export function serializeVisibleMetrics(visible: VisibleMetrics): string {
  return JSON.stringify(ALL_METRICS.filter((k) => visible.has(k)));
}

export function groupKeys(group: string): MetricKey[] {
  return METRIC_DEFS.filter((m) => m.group === group).map((m) => m.key);
}

/** Metrics measured in the channel's own unit (from the physio sidecar, when it gives one) */
const IN_CHANNEL_UNITS: readonly MetricKey[] = ['mean', 'stdDev'];

/** Fixed units for metrics that have one; the rest are unitless ratios or indices */
const FIXED_UNITS: Partial<Record<MetricKey, string>> = { zeroCrossingRate: 'Hz' };

/** Unit of a metric for one channel, or null when it has none or it is not known */
export function metricUnit(key: MetricKey, channel: string, channelUnits?: Record<string, string>): string | null {
  if (IN_CHANNEL_UNITS.includes(key)) return channelUnits?.[channel] ?? null;
  return FIXED_UNITS[key] ?? null;
}

/** Axis label for a metric: its label plus the unit, unless the label already carries it ("ZCR (Hz)") */
export function metricAxisLabel(key: MetricKey, channel: string, channelUnits?: Record<string, string>): string {
  const label = metricDef(key).label;
  const unit = metricUnit(key, channel, channelUnits);
  return unit && !label.includes(`(${unit})`) ? `${label} (${unit})` : label;
}

export function metricDef(key: MetricKey): MetricDef {
  return METRIC_DEFS.find((m) => m.key === key)!;
}

export function formatMetric(value: number, key: MetricKey): string {
  return formatMetricValue(value, metricDef(key).decimals);
}

/** Scans in the order they first appear (the TSV is already sorted) */
export function uniqueScans(rows: QualityRow[]): ScanKeyLike[] {
  const out: ScanKeyLike[] = [];
  for (const r of rows) {
    if (!out.some((s) => sameScanKey(s, r))) out.push({ sub: r.sub, ses: r.ses, task: r.task, run: r.run });
  }
  return out;
}

export function rowsForScan(rows: QualityRow[], scan: ScanKeyLike): QualityRow[] {
  return rows.filter((r) => sameScanKey(r, scan));
}

export function rowsForChannel(rows: QualityRow[], channel: string): QualityRow[] {
  return rows.filter((r) => r.channel === channel);
}

/** Metrics with at least one finite value among the rows, limited to the visible ones when given */
export function availableMetrics(rows: QualityRow[], visible?: VisibleMetrics): MetricKey[] {
  return ALL_METRICS.filter(
    (k) => (!visible || visible.has(k)) && rows.some((r) => Number.isFinite(r.metrics[k])),
  );
}

/** Default scatter axes: SNR against beat correlation where available, else the first available metrics */
export function defaultMetricPair(rows: QualityRow[]): [MetricKey, MetricKey] {
  const avail = availableMetrics(rows);
  const pick = (prefs: MetricKey[], exclude?: MetricKey): MetricKey =>
    prefs.find((k) => avail.includes(k) && k !== exclude) ??
    avail.find((k) => k !== exclude) ??
    prefs[0];
  const x = pick(['snr', 'stdDev', 'mean']);
  const y = pick(['beatCorrelation', 'kurtosis', 'skewness'], x);
  return [x, y];
}

/** 'none': one colour for every point (the dataset has nothing to colour by) */
export type ColorBy = 'task' | 'ses' | 'timingStatus' | 'sidecarAssessment' | 'none';

/** Every possible Colour by choice; colorByOptions() keeps the ones a dataset has */
export const COLOR_BY_OPTIONS: { key: Exclude<ColorBy, 'none'>; label: string }[] = [
  { key: 'task', label: 'Task' },
  { key: 'ses', label: 'Session' },
  { key: 'timingStatus', label: 'Timing check' },
  { key: 'sidecarAssessment', label: 'Sidecar pass/fail' },
];

export function colorByLabel(by: ColorBy): string {
  return by === 'none' ? 'None' : (COLOR_BY_OPTIONS.find((o) => o.key === by)?.label ?? by);
}

export function colorKey(row: QualityRow, by: ColorBy): string {
  if (by === 'none') return 'All recordings';
  return row[by] || '(none)';
}

/**
 * Colour by choices that mean something for these rows: at least one row has
 * a value, and there are at least two different groups. A dataset without
 * sessions has no Session choice; one with a single task has no Task choice.
 */
export function colorByOptions(rows: QualityRow[]): { key: Exclude<ColorBy, 'none'>; label: string }[] {
  return COLOR_BY_OPTIONS.filter(
    (o) => rows.some((r) => r[o.key]) && new Set(rows.map((r) => colorKey(r, o.key))).size >= 2,
  );
}

/** Sorted distinct colour groups */
export function colorGroups(rows: QualityRow[], by: ColorBy): string[] {
  return [...new Set(rows.map((r) => colorKey(r, by)))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
}

export interface ChannelSummary {
  channel: string;
  scans: number;
  pass: number;
  fail: number;
  /** Scans with every metric non-finite (e.g. a flat channel) */
  noValues: number;
}

export function channelSummaries(rows: QualityRow[], channels: string[]): ChannelSummary[] {
  return channels.map((channel) => {
    const rs = rowsForChannel(rows, channel);
    return {
      channel,
      scans: rs.length,
      pass: rs.filter((r) => r.sidecarAssessment.toLowerCase() === 'pass').length,
      fail: rs.filter((r) => r.sidecarAssessment !== '' && r.sidecarAssessment.toLowerCase() !== 'pass').length,
      noValues: rs.filter((r) => finiteValues(Object.values(r.metrics)).length === 0).length,
    };
  });
}

/** Timing check result counted once per scan */
export function timingCounts(rows: QualityRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const scan of uniqueScans(rows)) {
    const r = rows.find((x) => sameScanKey(x, scan))!;
    const k = r.timingStatus || '(none)';
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

/** Per-channel table with only the columns this dataset has; null when there is nothing beyond the scan count */
export function summaryTable(rows: QualityRow[], channels: string[]): { header: string[]; rows: string[][] } | null {
  const counts = channelSummaries(rows, channels);
  const hasSidecar = rows.some((r) => r.sidecarAssessment !== '');
  const hasNoValues = counts.some((c) => c.noValues > 0);
  if (!hasSidecar && !hasNoValues) return null;
  const cols: { label: string; cell: (c: ChannelSummary) => string }[] = [
    { label: 'Channel', cell: (c) => c.channel },
    { label: 'Scans', cell: (c) => String(c.scans) },
  ];
  if (hasSidecar) {
    cols.push({ label: 'Sidecar pass', cell: (c) => String(c.pass) });
    cols.push({ label: 'Sidecar fail', cell: (c) => String(c.fail) });
  }
  if (hasNoValues) cols.push({ label: 'No metric values', cell: (c) => String(c.noValues) });
  return { header: cols.map((c) => c.label), rows: counts.map((c) => cols.map((col) => col.cell(c))) };
}

// ── Scatter Y axis: quality metrics or participant columns ─────────────

/** Select value prefix for participant columns ("participant:age") */
export const PARTICIPANT_PREFIX = 'participant:';

/** Categorical participant columns with more distinct values than this are left out (likely identifiers) */
export const MAX_CATEGORIES = 12;

export interface AxisChoice {
  /** Select value: a metric key, or PARTICIPANT_PREFIX + column */
  value: string;
  label: string;
  /** Category labels, one column each on the X axis; null for numeric axes */
  categories: string[] | null;
  /** Raw participants.tsv values in category order (participant categorical axes only) */
  rawCategories?: string[];
}

const missing = (v: string | undefined) => v === undefined || v === '' || v.toLowerCase() === 'n/a';

/** participants.tsv value for a subject; null when missing or n/a */
export function participantValue(table: ParticipantsTable | null, sub: string, column: string): string | null {
  const v = table?.rows[sub]?.[column];
  return missing(v) ? null : (v as string);
}

/** Display label for a categorical value: its participants.json level when short, else the raw value */
export function categoryLabel(table: ParticipantsTable | null, column: string, value: string): string {
  const level = table?.meta[column]?.levels?.[value];
  return level && level.length <= 20 ? level : value;
}

/**
 * Participant columns usable as a scatter axis, for the subjects in `rows`:
 * numeric when every present value is a number and participants.json gives
 * no Levels, otherwise categorical (at most MAX_CATEGORIES distinct values).
 * Columns with no values are skipped.
 */
export function participantAxisChoices(table: ParticipantsTable | null, rows: QualityRow[]): AxisChoice[] {
  if (!table) return [];
  const subs = [...new Set(rows.map((r) => r.sub))];
  const out: AxisChoice[] = [];
  for (const column of table.columns) {
    const values = subs.map((s) => participantValue(table, s, column)).filter((v): v is string => v !== null);
    if (values.length === 0) continue;
    const meta = table.meta[column] ?? {};
    const label = meta.units ? `${column} (${meta.units})` : column;
    // Coded columns (e.g. group 1/2) are categorical when participants.json gives them Levels
    const hasLevels = Object.keys(meta.levels ?? {}).length > 0;
    const numeric = !hasLevels && values.every((v) => v.trim() !== '' && Number.isFinite(Number(v)));
    if (numeric) {
      out.push({ value: PARTICIPANT_PREFIX + column, label, categories: null });
      continue;
    }
    const raw = [...new Set(values)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (raw.length > MAX_CATEGORIES) continue;
    out.push({
      value: PARTICIPANT_PREFIX + column,
      label,
      categories: raw.map((v) => categoryLabel(table, column, v)),
      rawCategories: raw,
    });
  }
  return out;
}

/** Metric axis options for one channel's rows; labels carry units where known */
export function metricAxisChoices(rows: QualityRow[], channelUnits?: Record<string, string>): AxisChoice[] {
  const avail = availableMetrics(rows);
  const channel = rows[0]?.channel ?? '';
  return METRIC_DEFS.filter((m) => avail.includes(m.key)).map((m) => ({
    value: m.key,
    label: metricAxisLabel(m.key, channel, channelUnits),
    categories: null,
  }));
}

/** Deterministic offset in [-0.25, 0.25] per recording, so points in one category column don't overlap */
export function jitter(row: QualityRow): number {
  const s = `${scanId(row)}|${row.channel}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) / 4294967295 - 0.5) * 0.5;
}

/**
 * Position of a row on an axis: the metric value, the numeric participant
 * value, or category index + jitter (so points in one category don't overlap).
 * NaN when missing.
 */
export function axisValue(row: QualityRow, choice: AxisChoice, table: ParticipantsTable | null): number {
  if (!choice.value.startsWith(PARTICIPANT_PREFIX)) return row.metrics[choice.value as MetricKey];
  const v = participantValue(table, row.sub, choice.value.slice(PARTICIPANT_PREFIX.length));
  if (v === null) return NaN;
  if (!choice.categories) return Number(v);
  const i = (choice.rawCategories ?? []).indexOf(v);
  return i === -1 ? NaN : i + jitter(row);
}

/** Text shown for a row's value on an axis (tooltips, reports) */
export function axisText(row: QualityRow, choice: AxisChoice, table: ParticipantsTable | null): string {
  if (!choice.value.startsWith(PARTICIPANT_PREFIX)) {
    return formatMetric(row.metrics[choice.value as MetricKey], choice.value as MetricKey);
  }
  const column = choice.value.slice(PARTICIPANT_PREFIX.length);
  const v = participantValue(table, row.sub, column);
  if (v === null) return 'n/a';
  return choice.categories ? categoryLabel(table, column, v) : v;
}

/** Scatter X options: quality metrics with values for this channel, then participant variables */
export function xAxisChoices(
  channelRows: QualityRow[],
  table: ParticipantsTable | null,
  allRows: QualityRow[],
  channelUnits?: Record<string, string>,
): AxisChoice[] {
  return [...metricAxisChoices(channelRows, channelUnits), ...participantAxisChoices(table, allRows)];
}

/** Scatter Y options: every quality metric with values for this channel */
export function yAxisChoices(channelRows: QualityRow[], channelUnits?: Record<string, string>): AxisChoice[] {
  return metricAxisChoices(channelRows, channelUnits);
}

export interface ScatterDatum {
  row: QualityRow;
  x: number;
  y: number;
}

/** Rows with a finite position on both axes */
export function scatterData(
  rows: QualityRow[],
  x: AxisChoice,
  y: AxisChoice,
  table: ParticipantsTable | null,
): ScatterDatum[] {
  const out: ScatterDatum[] = [];
  for (const row of rows) {
    const xv = axisValue(row, x, table);
    const yv = axisValue(row, y, table);
    if (Number.isFinite(xv) && Number.isFinite(yv)) out.push({ row, x: xv, y: yv });
  }
  return out;
}

/** "a", "a and b", "a, b and c" */
export function humanList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const TIMING_PHRASES: Record<string, string> = {
  verified: 'confirmed by scanner trigger pulses',
  corrected: 'corrected using scanner trigger pulses',
  mismatch: 'inconsistent with the scanner trigger pulses (sidecar timing kept)',
  unverified: 'taken from the sidecar only (no trigger pulses to check against)',
};

export interface SummaryInput {
  nSubjects: number;
  nScans: number;
  tasks: string[];
  samplingFrequencies: number[];
  channels: string[];
}

/**
 * Plain-text paragraph describing the dataset's scans, channels and timing,
 * ending with when the metrics were last computed and their coverage (if the
 * run log has it)
 */
export function datasetSummaryText(s: SummaryInput, rows: QualityRow[], lastRun: QualityRun | null = null): string {
  const sentences: string[] = [];

  let first = `This dataset has ${plural(s.nScans, 'scan')} from ${plural(s.nSubjects, 'subject')}`;
  if (s.tasks.length === 1) first += `, all from the ${s.tasks[0]} task`;
  else if (s.tasks.length > 1) first += ` across ${s.tasks.length} tasks (${humanList(s.tasks)})`;
  sentences.push(first + '.');

  const rates = s.samplingFrequencies.map((f) => `${f} Hz`);
  if (rates.length === 1) sentences.push(`Physiological signals were sampled at ${rates[0]}.`);
  else if (rates.length > 1) sentences.push(`Sampling rates vary between scans (${humanList(rates)}).`);

  const counts = channelSummaries(rows, s.channels);
  if (counts.length > 0) {
    if (counts.every((c) => c.scans === s.nScans)) {
      const names = humanList(s.channels);
      const capitalised = names.charAt(0).toUpperCase() + names.slice(1);
      sentences.push(`${capitalised} ${s.channels.length === 1 ? 'is' : 'are'} recorded in every scan.`);
    } else {
      sentences.push(`Recorded channels: ${humanList(counts.map((c) => `${c.channel} (${plural(c.scans, 'scan')})`))}.`);
    }
  }

  const timing = Object.entries(timingCounts(rows)).filter(([k]) => k in TIMING_PHRASES);
  if (timing.length === 1) {
    const [status, n] = timing[0];
    const scope = n === s.nScans ? `all ${plural(n, 'scan')}` : plural(n, 'scan');
    sentences.push(`Scan-onset timing was ${TIMING_PHRASES[status]} for ${scope}.`);
  } else if (timing.length > 1) {
    const parts = Object.keys(TIMING_PHRASES)
      .map((status) => timing.find(([k]) => k === status))
      .filter((t): t is [string, number] => !!t)
      .map(([status, n]) => `${TIMING_PHRASES[status]} for ${plural(n, 'scan')}`);
    sentences.push(`Scan-onset timing was ${humanList(parts)}.`);
  }

  if (lastRun) sentences.push(runSentence(lastRun));

  return sentences.join(' ');
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** A channel name (physio TSV column) as HTML, in the shared file-name style (.channel-name in src/shell/tabs.css) */
export function channelName(channel: string): string {
  return `<span class="channel-name">${esc(channel)}</span>`;
}

export function formatSeconds(s: number): string {
  if (!Number.isFinite(s)) return 'n/a';
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return m > 0 ? `${m} min ${sec.toFixed(0)} s` : `${sec.toFixed(1)} s`;
}

/** Ordinal suffix for a percentile, e.g. 78 -> "78th" */
export function ordinal(n: number): string {
  const r = Math.round(n);
  const mod100 = r % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[r % 10] ?? 'th';
  return `${r}${suffix}`;
}
