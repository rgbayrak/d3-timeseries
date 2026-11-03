import { DATASET_JSON_NAME, METRICS_TSV_NAME, WAVEFORMS_DIR, parseQualityTsv, scanId } from './metrics-tsv';
import type { DatasetQualityFile, QualityRow, ScanKeyLike, WaveformFile } from './metrics-tsv';

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
