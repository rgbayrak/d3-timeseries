import { DATASET_JSON_NAME, METRICS_TSV_NAME, WAVEFORMS_DIR, parseQualityTsv, scanId } from './metrics-tsv';
import type { DatasetQualityFile, QualityRow, ScanKeyLike, WaveformFile } from './metrics-tsv';
import { RUN_LOG_NAME, parseLastRun } from './run-log';
import type { QualityRun } from './run-log';

// Loads the static files written by scripts/compute-quality-metrics.ts. The
// dev server serves them from data/quality/ directly; no API endpoint needed.
// Which dataset to show comes from the dev server (/api/bids/dataset), so the
// Stats tabs always match Explore and Annotate.

const QUALITY_BASE = '/data/quality';

/**
 * Fetch text, treating the dev server's HTML fallback (served for missing
 * files) as "not found".
 */
async function fetchText(url: string): Promise<string | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  if ((res.headers.get('content-type') ?? '').includes('text/html')) return null;
  return res.text();
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const text = await fetchText(url);
  if (text == null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export interface ServedDataset {
  /** Folder name under data/ (e.g. ds006644): where its quality metrics live */
  id: string;
  /** Name from dataset_description.json; the viewer keys its remembered scan on it */
  name: string | null;
}

/** The dataset the dev server is serving (BIDS_ROOT); null if the server can't say */
export async function fetchServedDataset(): Promise<ServedDataset | null> {
  const info = await fetchJson<{ id?: unknown; name?: unknown }>('/api/bids/dataset');
  if (!info || typeof info.id !== 'string' || info.id === '') return null;
  return { id: info.id, name: typeof info.name === 'string' ? info.name : null };
}

export interface LoadedDataset {
  summary: DatasetQualityFile;
  rows: QualityRow[];
  /** Last line of quality_runs.tsv; null for metrics computed before the run log existed */
  lastRun: QualityRun | null;
}

export async function fetchDatasetQuality(dataset: string): Promise<LoadedDataset | null> {
  const base = `${QUALITY_BASE}/${encodeURIComponent(dataset)}`;
  const [summary, tsv, runLog] = await Promise.all([
    fetchJson<DatasetQualityFile>(`${base}/${DATASET_JSON_NAME}`),
    fetchText(`${base}/${METRICS_TSV_NAME}`),
    fetchText(`${base}/${RUN_LOG_NAME}`).catch(() => null),
  ]);
  if (!summary || tsv == null) return null;
  return { summary, rows: parseQualityTsv(tsv), lastRun: runLog ? parseLastRun(runLog) : null };
}

/** Whether the served dataset's PDF report is saved, and where to open it */
export interface ReportStatus {
  exists: boolean;
  url: string;
}

export async function fetchReportStatus(): Promise<ReportStatus | null> {
  const res = await fetch('/api/quality-report').catch(() => null);
  if (!res?.ok) return null;
  return res.json();
}

/** Send the PDF the Stats tab built; the dev server saves it next to the metrics */
export async function saveReport(pdf: Blob): Promise<ReportStatus> {
  const res = await fetch('/api/quality-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf' },
    body: pdf,
  });
  if (!res.ok) throw new Error(`The server did not save the PDF (${res.status})`);
  return res.json();
}

export async function fetchWaveforms(dataset: string, scan: ScanKeyLike): Promise<WaveformFile | null> {
  return fetchJson<WaveformFile>(
    `${QUALITY_BASE}/${encodeURIComponent(dataset)}/${WAVEFORMS_DIR}/${scanId(scan)}_waveforms.json`,
  );
}
