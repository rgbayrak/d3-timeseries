import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  getSubjects,
  buildScans,
  readPhysio,
  readDatasetInfo,
  isReadable,
  findPhysioFiles,
  resolveBidsRoots,
} from './bids-layout';
import type { ScanEntry } from './bids-layout';
import { computeSQI } from '../src/data/sqi-metrics';
import { minMaxEnvelope, roundSig } from '../src/quality/envelope';
import { classifyChannel } from '../src/quality/channels';
import type { SignalType } from '../src/quality/channels';
import {
  METRIC_COLUMNS,
  METRICS_TSV_NAME,
  DATASET_JSON_NAME,
  WAVEFORMS_DIR,
  REPORT_PDF_NAME,
  rowsToTsv,
  scanId,
} from '../src/quality/metrics-tsv';
import type {
  MetricKey,
  QualityRow,
  DatasetQualityFile,
  ParticipantsTable,
  ParticipantColumnMeta,
  WaveformFile,
} from '../src/quality/metrics-tsv';

// Dataset-wide quality metrics: runs the per-channel metrics
// (src/data/sqi-metrics.ts) over every readable
// scan and writes them to data/quality/<dataset>/. Output depends only on the
// input files: scans are in sorted order and nothing time- or machine-specific
// is written.

export type PhysioResult = NonNullable<ReturnType<typeof readPhysio>>;

/** Buckets per channel in the waveform envelopes */
export const WAVEFORM_BUCKETS = 2000;

const DATASET_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface DatasetPaths {
  dataset: string;
  bidsRoot: string;
  derivRoot: string;
}

/**
 * Locate a dataset under dataDir. Handles plain BIDS (data/ds006644) and
 * layouts with the raw data in physprep/ next to fmriprep/ (data/shinobi).
 */
export function resolveDatasetPaths(
  dataDir: string,
  dataset: string,
  overrides: { bidsRoot?: string; derivRoot?: string } = {},
): DatasetPaths {
  if (!DATASET_NAME_RE.test(dataset)) {
    throw new Error(`Invalid dataset name "${dataset}" (letters, digits, '.', '_' and '-' only)`);
  }
  // Same physprep/fmriprep lookup as the dev server (server/bids-layout.ts)
  const { bidsRoot, derivRoot } = resolveBidsRoots(overrides.bidsRoot ?? join(dataDir, dataset), overrides.derivRoot);
  return { dataset, bidsRoot, derivRoot };
}

export interface PhysioChannels {
  /** The scan with only its physiological columns */
  raw: PhysioResult;
  /** Signal type of each kept column, same order as raw.columns */
  signals: SignalType[];
  /** Columns left out (trigger, markers, unknown names) */
  excluded: { channel: string; reason: string }[];
}

/** Keep only columns found in the physio channel dictionary (src/quality/channels.ts) */
export function physioChannels(raw: PhysioResult): PhysioChannels {
  const columns: string[] = [];
  const data: number[][] = [];
  const signals: SignalType[] = [];
  const excluded: { channel: string; reason: string }[] = [];
  raw.columns.forEach((channel, i) => {
    const c = classifyChannel(channel);
    if (c.physio) {
      columns.push(channel);
      data.push(raw.data[i]);
      signals.push(c.signal);
    } else {
      excluded.push({ channel, reason: c.reason });
    }
  });
  return { raw: { ...raw, columns, data }, signals, excluded };
}

/** One row per physiological channel of a scan; non-physio columns (e.g. trigger) get no row */
export function scanQualityRows(scan: ScanEntry, fullRaw: PhysioResult): QualityRow[] {
  const { raw, signals } = physioChannels(fullRaw);
  const { metrics } = computeSQI(raw);
  return metrics.map((m, i) => {
    const channel = raw.columns[i];
    const q = raw.quality?.[channel];
    const values = {} as Record<MetricKey, number>;
    for (const c of METRIC_COLUMNS) values[c.key] = m[c.key];
    return {
      sub: scan.sub,
      ses: scan.ses,
      task: scan.task,
      run: scan.run,
      filename: raw.filename,
      channel,
      signalType: signals[i],
      samplingFrequency: raw.samplingFrequency,
      numSamples: raw.numSamples,
      durationS: raw.numSamples / raw.samplingFrequency,
      timingStatus: raw.timing.status,
      sidecarAssessment: q?.assessment ?? '',
      sidecarPercentValid: q?.percentValid ?? NaN,
      metrics: values,
    };
  });
}

/** Min/max envelope of every physiological channel, on the scan-onset time axis */
export function waveformFile(fullRaw: PhysioResult, buckets = WAVEFORM_BUCKETS): WaveformFile {
  const { raw } = physioChannels(fullRaw);
  const fs = raw.samplingFrequency;
  const channels = raw.columns.map((channel, i) => {
    const env = minMaxEnvelope(raw.data[i], buckets);
    return { channel, min: env.min, max: env.max, centres: env.centres };
  });
  const centres = channels[0]?.centres ?? [];
  return {
    filename: raw.filename,
    samplingFrequency: fs,
    times: centres.map((c) => roundSig(raw.startTime + c / fs, 7)),
    channels: channels.map(({ channel, min, max }) => ({ channel, min, max })),
  };
}

function splitTsvLine(line: string): string[] {
  return line.replace(/\r$/, '').split('\t');
}

/** participants.tsv + participants.json; null if there is no readable participants.tsv */
export function readParticipants(bidsRoot: string): ParticipantsTable | null {
  const tsvPath = join(bidsRoot, 'participants.tsv');
  if (!isReadable(tsvPath)) return null;
  const lines = readFileSync(tsvPath, 'utf-8').split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;
  const header = splitTsvLine(lines[0]);
  const idCol = header.indexOf('participant_id');
  if (idCol === -1) return null;

  const rows: Record<string, Record<string, string>> = {};
  for (const line of lines.slice(1)) {
    const cells = splitTsvLine(line);
    const id = (cells[idCol] ?? '').replace(/^sub-/, '');
    if (!id) continue;
    const row: Record<string, string> = {};
    header.forEach((h, i) => {
      if (i !== idCol) row[h] = cells[i] ?? '';
    });
    rows[id] = row;
  }

  const meta: Record<string, ParticipantColumnMeta> = {};
  const jsonPath = join(bidsRoot, 'participants.json');
  if (isReadable(jsonPath)) {
    try {
      const raw = JSON.parse(readFileSync(jsonPath, 'utf-8')) as Record<string, Record<string, unknown>>;
      for (const col of header) {
        const entry = raw[col];
        if (!entry || typeof entry !== 'object') continue;
        const m: ParticipantColumnMeta = {};
        if (typeof entry.Description === 'string') m.description = entry.Description;
        if (typeof entry.Units === 'string') m.units = entry.Units;
        if (entry.Levels && typeof entry.Levels === 'object') {
          m.levels = Object.fromEntries(
            Object.entries(entry.Levels as Record<string, unknown>).filter(
              (e): e is [string, string] => typeof e[1] === 'string',
            ),
          );
        }
        meta[col] = m;
      }
    } catch {
      // ignore malformed participants.json
    }
  }

  return { columns: header.filter((_, i) => i !== idCol), meta, rows };
}

const byNumeric = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/**
 * Units of a scan's columns from its physio sidecar, where it describes a
 * column as an object with a string "Units" (e.g. "cardiac": {"Units": "mV"}).
 */
export function readChannelUnits(bidsRoot: string, scan: ScanEntry): Record<string, string> {
  const found = findPhysioFiles(bidsRoot, scan.sub, scan.ses, scan.task, scan.run);
  if (!found?.sidecarPath) return {};
  try {
    const sidecar = JSON.parse(readFileSync(found.sidecarPath, 'utf-8')) as Record<string, unknown>;
    const units: Record<string, string> = {};
    for (const [key, value] of Object.entries(sidecar)) {
      const u = (value as { Units?: unknown } | null)?.Units;
      if (value && typeof value === 'object' && typeof u === 'string' && u.trim() !== '') units[key] = u.trim();
    }
    return units;
  } catch {
    return {};
  }
}

export interface QualityRunOptions {
  /** Folder holding the datasets, normally <project>/data */
  dataDir: string;
  dataset: string;
  /** Output root; results go to <outRoot>/<dataset>/. Default <dataDir>/quality */
  outRoot?: string;
  bidsRoot?: string;
  derivRoot?: string;
  buckets?: number;
  log?: (msg: string) => void;
}

export interface QualityRunResult {
  outDir: string;
  rows: QualityRow[];
  summary: DatasetQualityFile;
}

/** Compute metrics for every readable scan and write the TSV, dataset.json, waveforms and index */
export function runQualityMetrics(opts: QualityRunOptions): QualityRunResult {
  const log = opts.log ?? (() => {});
  const paths = resolveDatasetPaths(opts.dataDir, opts.dataset, {
    bidsRoot: opts.bidsRoot,
    derivRoot: opts.derivRoot,
  });
  if (!existsSync(paths.bidsRoot)) throw new Error(`Dataset folder not found: ${paths.bidsRoot}`);

  const outRoot = opts.outRoot ?? join(opts.dataDir, 'quality');
  const outDir = join(outRoot, paths.dataset);
  const waveDir = join(outDir, WAVEFORMS_DIR);
  // The waveforms folder is ours alone; clear it so scans that disappeared leave no stale files
  rmSync(waveDir, { recursive: true, force: true });
  mkdirSync(waveDir, { recursive: true });
  // The PDF report describes the old metrics: remove it, Stats builds and saves a new one when it next opens
  rmSync(join(outDir, REPORT_PDF_NAME), { force: true });

  const subjects = getSubjects(paths.bidsRoot);
  const scans = buildScans(paths.bidsRoot, subjects);
  log(`${paths.dataset}: ${scans.length} readable scans from ${subjects.length} subjects (${paths.bidsRoot})`);

  const rows: QualityRow[] = [];
  const failedScans: { scan: string; reason: string }[] = [];
  const channels = new Set<string>();
  const tasks = new Set<string>();
  const rates = new Set<number>();
  const subjectsWithRows = new Set<string>();
  const excludedCounts = new Map<string, { reason: string; scans: number }>();
  const channelUnits = new Map<string, string>();

  scans.forEach((scan, i) => {
    const id = scanId(scan);
    try {
      const raw = readPhysio(paths.bidsRoot, scan.sub, scan.ses, scan.task, scan.run, paths.derivRoot);
      if (!raw) {
        failedScans.push({ scan: id, reason: 'physio file or sidecar not found' });
        log(`  [${i + 1}/${scans.length}] ${id}: skipped (physio file or sidecar not found)`);
        return;
      }
      const { excluded } = physioChannels(raw);
      for (const e of excluded) {
        const prev = excludedCounts.get(e.channel);
        excludedCounts.set(e.channel, { reason: e.reason, scans: (prev?.scans ?? 0) + 1 });
      }
      const scanRows = scanQualityRows(scan, raw);
      if (scanRows.length === 0) {
        failedScans.push({ scan: id, reason: 'no physiological channels' });
        log(`  [${i + 1}/${scans.length}] ${id}: skipped (no physiological channels in ${raw.columns.join(', ')})`);
        return;
      }
      rows.push(...scanRows);
      scanRows.forEach((r) => channels.add(r.channel));
      // First unit seen for a channel wins (scans are in sorted order, so this is deterministic)
      const units = readChannelUnits(paths.bidsRoot, scan);
      for (const r of scanRows) {
        if (units[r.channel] && !channelUnits.has(r.channel)) channelUnits.set(r.channel, units[r.channel]);
      }
      tasks.add(scan.task);
      rates.add(raw.samplingFrequency);
      subjectsWithRows.add(scan.sub);
      writeFileSync(join(waveDir, `${id}_waveforms.json`), JSON.stringify(waveformFile(raw, opts.buckets)));
      const skipped = excluded.length ? ` (excluded: ${excluded.map((e) => e.channel).join(', ')})` : '';
      log(`  [${i + 1}/${scans.length}] ${id}: ${scanRows.map((r) => r.channel).join(', ')}${skipped}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failedScans.push({ scan: id, reason });
      log(`  [${i + 1}/${scans.length}] ${id}: failed (${reason})`);
    }
  });

  const summary: DatasetQualityFile = {
    dataset: paths.dataset,
    info: readDatasetInfo(paths.bidsRoot, paths.derivRoot),
    nSubjects: subjectsWithRows.size,
    nScans: scans.length - failedScans.length,
    channels: [...channels].sort(byNumeric),
    tasks: [...tasks].sort(byNumeric),
    samplingFrequencies: [...rates].sort((a, b) => a - b),
    participants: readParticipants(paths.bidsRoot),
    failedScans,
    excludedChannels: [...excludedCounts]
      .map(([channel, v]) => ({ channel, reason: v.reason, scans: v.scans }))
      .sort((a, b) => byNumeric(a.channel, b.channel)),
    channelUnits: Object.fromEntries([...channelUnits].sort((a, b) => byNumeric(a[0], b[0]))),
    metricsFile: METRICS_TSV_NAME,
  };

  writeFileSync(join(outDir, METRICS_TSV_NAME), rowsToTsv(rows));
  writeFileSync(join(outDir, DATASET_JSON_NAME), JSON.stringify(summary, null, 2) + '\n');
  log(`Wrote ${rows.length} rows to ${join(outDir, METRICS_TSV_NAME)}`);

  return { outDir, rows, summary };
}
