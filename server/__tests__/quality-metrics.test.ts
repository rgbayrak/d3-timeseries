import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildScans, getSubjects, readPhysio, resolveBidsRoots } from '../bids-layout';
import {
  runQualityMetrics,
  resolveDatasetPaths,
  waveformFile,
  physioChannels,
  scanQualityRows,
} from '../quality-metrics';
import { isPhysioChannel } from '../../src/quality/channels';
import {
  parseQualityTsv,
  scanId,
  TSV_HEADER,
  METRICS_TSV_NAME,
  DATASET_JSON_NAME,
  WAVEFORMS_DIR,
} from '../../src/quality/metrics-tsv';

// Runs the dataset-wide quality metrics on the synthetic fixtures in test/fixtures.

const FIXTURES = join(process.cwd(), 'test', 'fixtures');

let out: string;
beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), 'quality-metrics-'));
});
afterAll(() => {
  rmSync(out, { recursive: true, force: true });
});

describe('runQualityMetrics (bids-sessions fixture)', () => {
  const root = join(FIXTURES, 'bids-sessions');

  const der = join(root, 'derivatives', 'fmriprep');
  const allRaw = () =>
    buildScans(root, getSubjects(root)).map((s) => ({ scan: s, raw: readPhysio(root, s.sub, s.ses, s.task, s.run, der)! }));

  it('writes one row per scan and physiological channel, in scan order', () => {
    const { rows, summary, outDir } = runQualityMetrics({ dataDir: FIXTURES, dataset: 'bids-sessions', outRoot: out });
    const expectedRows = allRaw().flatMap(({ scan, raw }) =>
      raw.columns.filter(isPhysioChannel).map((channel) => ({ id: scanId(scan), channel })),
    );

    expect(rows.map((r) => ({ id: scanId(r), channel: r.channel }))).toEqual(expectedRows);
    expect(summary.channels).toEqual(['cardiac', 'respiratory']);
    expect(summary.nScans).toBe(4);
    expect(summary.nSubjects).toBe(2);
    expect(summary.failedScans).toEqual([]);
    expect(summary.samplingFrequencies).toEqual([50]);
    expect(summary.tasks).toEqual(['rest']);
    expect(summary.info.name).toBe('Synthetic physio fixture (sessions)');
    expect(summary.participants).toBeNull();
    expect(summary.channelUnits).toEqual({}); // fixture sidecars give no units
    expect(existsSync(join(outDir, METRICS_TSV_NAME))).toBe(true);
    expect(existsSync(join(outDir, DATASET_JSON_NAME))).toBe(true);
  });

  it('round-trips through the TSV, NaN included', () => {
    const { rows, outDir } = runQualityMetrics({ dataDir: FIXTURES, dataset: 'bids-sessions', outRoot: out });
    const text = readFileSync(join(outDir, METRICS_TSV_NAME), 'utf-8');
    expect(text.split('\n')[0].split('\t')).toEqual(TSV_HEADER);
    expect(parseQualityTsv(text)).toEqual(rows);
    expect(rows.find((r) => r.channel === 'cardiac')!.signalType).toBe('cardiac');
    expect(rows.find((r) => r.channel === 'respiratory')!.signalType).toBe('respiratory');
  });

  it('computes no metrics for the trigger channel and reports it as excluded', () => {
    const { rows, summary } = runQualityMetrics({ dataDir: FIXTURES, dataset: 'bids-sessions', outRoot: out });
    expect(rows.some((r) => r.channel === 'trigger')).toBe(false);
    const withTrigger = allRaw().filter(({ raw }) => raw.columns.includes('trigger')).length;
    expect(withTrigger).toBeGreaterThan(0);
    expect(summary.excludedChannels).toEqual([{ channel: 'trigger', reason: 'scanner trigger', scans: withTrigger }]);
  });

  it('filters a scan down to its physiological columns', () => {
    const { scan, raw } = allRaw()[0];
    expect(raw.columns).toContain('trigger');
    const kept = physioChannels(raw);
    expect(kept.raw.columns).toEqual(['cardiac', 'respiratory']);
    expect(kept.raw.data).toHaveLength(2);
    expect(kept.raw.data[1]).toBe(raw.data[raw.columns.indexOf('respiratory')]);
    expect(kept.signals).toEqual(['cardiac', 'respiratory']);
    expect(kept.excluded).toEqual([{ channel: 'trigger', reason: 'scanner trigger' }]);
    expect(scanQualityRows(scan, raw).map((r) => r.channel)).toEqual(['cardiac', 'respiratory']);
  });

  it('carries the desc-quality sidecar and timing status', () => {
    const { rows } = runQualityMetrics({ dataDir: FIXTURES, dataset: 'bids-sessions', outRoot: out });
    const resp = rows.find((r) => r.sub === '01' && r.ses === '01' && r.channel === 'respiratory')!;
    expect(resp.sidecarAssessment).toBe('Pass');
    expect(resp.sidecarPercentValid).toBe(0.9);
    expect(resp.timingStatus).not.toBe('');
    const noSidecar = rows.find((r) => r.sub === '02' && r.ses === '01')!;
    expect(noSidecar.sidecarAssessment).toBe('');
    expect(noSidecar.sidecarPercentValid).toBeNaN();
  });

  it('gives byte-identical output on a second run', () => {
    const a = runQualityMetrics({ dataDir: FIXTURES, dataset: 'bids-sessions', outRoot: out });
    const tsvA = readFileSync(join(a.outDir, METRICS_TSV_NAME), 'utf-8');
    const jsonA = readFileSync(join(a.outDir, DATASET_JSON_NAME), 'utf-8');
    const b = runQualityMetrics({ dataDir: FIXTURES, dataset: 'bids-sessions', outRoot: out });
    expect(readFileSync(join(b.outDir, METRICS_TSV_NAME), 'utf-8')).toBe(tsvA);
    expect(readFileSync(join(b.outDir, DATASET_JSON_NAME), 'utf-8')).toBe(jsonA);
  });

  it('writes a waveform envelope per scan', () => {
    const { outDir } = runQualityMetrics({ dataDir: FIXTURES, dataset: 'bids-sessions', outRoot: out, buckets: 100 });
    const wf = JSON.parse(
      readFileSync(join(outDir, WAVEFORMS_DIR, 'sub-01_ses-01_task-rest_run-01_waveforms.json'), 'utf-8'),
    );
    expect(wf.samplingFrequency).toBe(50);
    expect(wf.times).toHaveLength(100);
    // trigger is not physiological, so it gets no waveform
    expect(wf.channels.map((c: { channel: string }) => c.channel)).toEqual(['cardiac', 'respiratory']);
    for (const c of wf.channels) {
      expect(c.min).toHaveLength(100);
      c.min.forEach((lo: number, i: number) => expect(lo).toBeLessThanOrEqual(c.max[i]));
    }
    // times are increasing and start before scan onset (StartTime -2 s)
    expect(wf.times[0]).toBeLessThan(0);
    expect(wf.times[99]).toBeGreaterThan(wf.times[0]);
  });
});

describe('runQualityMetrics (bids-nosessions fixture)', () => {
  it('handles session-less, run-less scans', () => {
    const { rows, summary } = runQualityMetrics({ dataDir: FIXTURES, dataset: 'bids-nosessions', outRoot: out });
    expect(summary.nScans).toBe(2);
    expect(rows.every((r) => r.ses === '' && r.run === '')).toBe(true);
    expect(rows.map((r) => scanId(r))).toContain('sub-01_task-motor');
  });
});

describe('resolveDatasetPaths', () => {
  it('rejects names that could leave the data folder', () => {
    expect(() => resolveDatasetPaths(FIXTURES, '../etc')).toThrow(/Invalid dataset name/);
    expect(() => resolveDatasetPaths(FIXTURES, 'a/b')).toThrow(/Invalid dataset name/);
  });

  it('uses physprep/ and fmriprep/ when the dataset root is not BIDS itself', () => {
    const dir = mkdtempSync(join(tmpdir(), 'quality-paths-'));
    mkdirSync(join(dir, 'shinobi', 'physprep'), { recursive: true });
    mkdirSync(join(dir, 'shinobi', 'fmriprep'), { recursive: true });
    expect(resolveDatasetPaths(dir, 'shinobi')).toEqual({
      dataset: 'shinobi',
      bidsRoot: join(dir, 'shinobi', 'physprep'),
      derivRoot: join(dir, 'shinobi', 'fmriprep'),
    });
    rmSync(dir, { recursive: true, force: true });
  });

  it('gives the dev server the same roots for the dataset folder or its physprep/', () => {
    const dir = mkdtempSync(join(tmpdir(), 'quality-roots-'));
    mkdirSync(join(dir, 'shinobi', 'physprep'), { recursive: true });
    mkdirSync(join(dir, 'shinobi', 'fmriprep'), { recursive: true });
    const expected = { bidsRoot: join(dir, 'shinobi', 'physprep'), derivRoot: join(dir, 'shinobi', 'fmriprep') };
    expect(resolveBidsRoots(join(dir, 'shinobi'))).toEqual(expected);
    expect(resolveBidsRoots(join(dir, 'shinobi', 'physprep'))).toEqual(expected);
    // an explicit derivatives root wins
    expect(resolveBidsRoots(join(dir, 'shinobi'), '/elsewhere').derivRoot).toBe('/elsewhere');
    rmSync(dir, { recursive: true, force: true });
  });

  it('defaults to <root>/derivatives/fmriprep for plain BIDS', () => {
    const p = resolveDatasetPaths(FIXTURES, 'bids-sessions');
    expect(p.bidsRoot).toBe(join(FIXTURES, 'bids-sessions'));
    expect(p.derivRoot).toBe(join(FIXTURES, 'bids-sessions', 'derivatives', 'fmriprep'));
  });
});

describe('participants', () => {
  it('reads participants.tsv rows and participants.json metadata', () => {
    const dir = mkdtempSync(join(tmpdir(), 'quality-participants-'));
    const src = join(FIXTURES, 'bids-nosessions');
    const ds = join(dir, 'ds');
    // Minimal copy: the fixture plus participants files
    mkdirSync(join(ds, 'sub-01', 'func'), { recursive: true });
    for (const f of ['dataset_description.json', 'physio.json', 'task-motor_bold.json']) {
      writeFileSync(join(ds, f), readFileSync(join(src, f)));
    }
    for (const f of ['sub-01_task-motor_physio.tsv.gz', 'sub-01_task-motor_desc-quality.json']) {
      writeFileSync(join(ds, 'sub-01', 'func', f), readFileSync(join(src, 'sub-01', 'func', f)));
    }
    // Subject sidecar with a unit for one column, to check channelUnits
    const sidecar = JSON.parse(readFileSync(join(src, 'sub-01', 'sub-01_task-motor_physio.json'), 'utf-8'));
    sidecar.cardiac = { Description: 'pulse oximeter', Units: 'mV' };
    writeFileSync(join(ds, 'sub-01', 'sub-01_task-motor_physio.json'), JSON.stringify(sidecar));
    writeFileSync(join(ds, 'participants.tsv'), 'participant_id\tage\tsex\nsub-01\t32\tf\n');
    writeFileSync(
      join(ds, 'participants.json'),
      JSON.stringify({ age: { Description: 'age', Units: 'years' }, sex: { Levels: { f: 'female' } } }),
    );

    const { summary } = runQualityMetrics({ dataDir: dir, dataset: 'ds', outRoot: join(dir, 'out') });
    expect(summary.participants).toEqual({
      columns: ['age', 'sex'],
      meta: { age: { description: 'age', units: 'years' }, sex: { levels: { f: 'female' } } },
      rows: { '01': { age: '32', sex: 'f' } },
    });
    expect(summary.channelUnits).toEqual({ cardiac: 'mV' });
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('waveformFile', () => {
  it('maps bucket centres onto the scan-onset axis', () => {
    const raw = readPhysio(join(FIXTURES, 'bids-nosessions'), '01', '', 'motor', '')!;
    const wf = waveformFile(raw, 10);
    expect(wf.times).toHaveLength(10);
    const firstCentre = (Math.floor(raw.numSamples / 10) - 1) / 2;
    expect(wf.times[0]).toBeCloseTo(raw.startTime + firstCentre / raw.samplingFrequency, 5);
  });
});
