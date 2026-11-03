import {
  DATASET_JSON_NAME,
  INDEX_JSON_NAME,
  METRICS_TSV_NAME,
  WAVEFORMS_DIR,
  parseQualityTsv,
  scanId,
} from './metrics-tsv';
import type {
  DatasetQualityFile,
  QualityIndexFile,
  QualityRow,
  ScanKeyLike,
  WaveformFile,
} from './metrics-tsv';

// Loads the static files written by scripts/compute-quality-metrics.ts. The
// dev server serves them from data/quality/ directly; no API endpoint needed.

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

export async function fetchQualityIndex(): Promise<string[]> {
  const index = await fetchJson<QualityIndexFile>(`${QUALITY_BASE}/${INDEX_JSON_NAME}`);
  return Array.isArray(index?.datasets) ? index.datasets : [];
}

export interface LoadedDataset {
  summary: DatasetQualityFile;
  rows: QualityRow[];
}

export async function fetchDatasetQuality(dataset: string): Promise<LoadedDataset | null> {
  const base = `${QUALITY_BASE}/${encodeURIComponent(dataset)}`;
  const [summary, tsv] = await Promise.all([
    fetchJson<DatasetQualityFile>(`${base}/${DATASET_JSON_NAME}`),
    fetchText(`${base}/${METRICS_TSV_NAME}`),
  ]);
  if (!summary || tsv == null) return null;
  return { summary, rows: parseQualityTsv(tsv) };
}

export async function fetchWaveforms(dataset: string, scan: ScanKeyLike): Promise<WaveformFile | null> {
  return fetchJson<WaveformFile>(
    `${QUALITY_BASE}/${encodeURIComponent(dataset)}/${WAVEFORMS_DIR}/${scanId(scan)}_waveforms.json`,
  );
}
