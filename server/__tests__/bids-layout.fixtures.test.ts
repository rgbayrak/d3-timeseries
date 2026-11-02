import { describe, it, expect } from 'vitest';
import { join } from 'path';
import {
  getSubjects,
  getTasks,
  getRuns,
  findPhysioFiles,
  readPhysio,
  readConfounds,
  readDatasetInfo,
  buildScans,
} from '../bids-layout';

/**
 * Exact-value tests against the synthetic datasets in test/fixtures
 * (regenerate with `python3 test/fixtures/make_fixtures.py`).
 *
 * Fixture constants, mirrored from make_fixtures.py:
 *   50 Hz physio, TR 2 s, 10 volumes, StartTime -2 s  ->  1100 samples
 */

const FIXTURES = join(process.cwd(), 'test', 'fixtures');
const SES_ROOT = join(FIXTURES, 'bids-sessions');
const SES_DER = join(SES_ROOT, 'derivatives', 'fmriprep');
const NOSES_ROOT = join(FIXTURES, 'bids-nosessions');

const FS = 50;
const TR = 2;
const N_VOLUMES = 10;
const N_SAMPLES = 1100;

describe('fixture: bids-sessions layout', () => {
  it('finds sub-01 and sub-02, and skips sub-03 whose physio is a broken symlink', () => {
    expect(getSubjects(SES_ROOT)).toEqual([
      { id: '01', sessions: ['01', '02'] },
      { id: '02', sessions: ['01', '02'] },
    ]);
  });

  it('lists tasks and runs', () => {
    expect(getTasks(SES_ROOT, '01', '01')).toEqual(['rest']);
    expect(getRuns(SES_ROOT, '01', '01', 'rest')).toEqual(['01']);
  });

  it('builds one scan per subject/session in hierarchy order', () => {
    const scans = buildScans(SES_ROOT, getSubjects(SES_ROOT));
    expect(scans).toEqual([
      { sub: '01', ses: '01', task: 'rest', run: '01' },
      { sub: '01', ses: '02', task: 'rest', run: '01' },
      { sub: '02', ses: '01', task: 'rest', run: '01' },
      { sub: '02', ses: '02', task: 'rest', run: '01' },
    ]);
  });

  it('uses the per-file sidecar and finds the run-level quality sidecar', () => {
    const found = findPhysioFiles(SES_ROOT, '01', '01', 'rest', '01');
    expect(found?.sidecarPath).toBe(
      join(SES_ROOT, 'sub-01', 'ses-01', 'func', 'sub-01_ses-01_task-rest_run-01_physio.json'),
    );
    expect(found?.qualityJsonPath).toBe(
      join(SES_ROOT, 'sub-01', 'ses-01', 'func', 'sub-01_ses-01_task-rest_run-01_desc-quality.json'),
    );
  });

  it('reads dataset and derivatives metadata', () => {
    expect(readDatasetInfo(SES_ROOT, SES_DER)).toEqual({
      name: 'Synthetic physio fixture (sessions)',
      bidsVersion: '1.9.0',
      datasetType: 'raw',
      license: 'CC0',
      authors: ['Fixture Author'],
      doi: 'doi:10.0000/fixture.sessions',
      derivatives: [{ name: 'fMRIPrep', version: '23.0.2' }],
    });
  });
});

describe('fixture: bids-sessions physio and timing', () => {
  const read = (sub: string, ses: string) => readPhysio(SES_ROOT, sub, ses, 'rest', '01', SES_DER)!;

  it('reads all samples and columns', () => {
    const r = read('01', '01');
    expect(r.samplingFrequency).toBe(FS);
    expect(r.columns).toEqual(['cardiac', 'respiratory', 'trigger']);
    expect(r.numSamples).toBe(N_SAMPLES);
    expect(r.data.every((c) => c.length === N_SAMPLES)).toBe(true);
  });

  it('parses the quality sidecar', () => {
    expect(read('01', '01').quality).toEqual({
      cardiac: { assessment: 'Pass', percentValid: 1 },
      respiratory: { assessment: 'Pass', percentValid: 0.9 },
    });
  });

  it('sub-01 ses-01: clean triggers at t = 0 -> verified, StartTime unchanged', () => {
    const r = read('01', '01');
    expect(r.timing.status).toBe('verified');
    expect(r.timing.offset).toBe(0);
    expect(r.startTime).toBe(-2);
    expect(r.timing.triggerTimes).toHaveLength(N_VOLUMES);
    expect(r.timing.triggerTimes[0]).toBeCloseTo(0, 9);
  });

  it('sub-01 ses-02: clean triggers 0.5 s late -> corrected, axis shifted by 0.5 s', () => {
    const r = read('01', '02');
    expect(r.timing.status).toBe('corrected');
    expect(r.timing.offset).toBeCloseTo(0.5, 9);
    expect(r.startTime).toBeCloseTo(-2.5, 9);
    expect(r.timing.triggerTimes[0]).toBeCloseTo(0, 9);
  });

  it('sub-02 ses-01: one dropped pulse -> mismatch, StartTime kept', () => {
    const r = read('02', '01');
    expect(r.timing.status).toBe('mismatch');
    expect(r.timing.offset).toBe(0);
    expect(r.startTime).toBe(-2);
    expect(r.timing.triggerTimes).toHaveLength(N_VOLUMES - 1);
    expect(r.timing.detail).toContain('1 trigger interval(s) differ from TR 2 s');
  });

  it('sub-02 ses-02: no trigger channel -> unverified', () => {
    const r = read('02', '02');
    expect(r.columns).toEqual(['cardiac', 'respiratory']);
    expect(r.timing.status).toBe('unverified');
    expect(r.timing.triggerTimes).toEqual([]);
  });
});

describe('fixture: bids-sessions confounds', () => {
  it('extracts only motion columns, in dropdown order, with n/a as NaN', () => {
    const c = readConfounds(SES_ROOT, SES_DER, '01', '01', 'rest', '01')!;
    expect(c.filename).toBe('sub-01_ses-01_task-rest_run-01_desc-confounds_timeseries.tsv');
    expect(c.numVolumes).toBe(N_VOLUMES);
    expect(Object.keys(c.columns)).toEqual(['framewise_displacement', 'trans_x', 'rot_x']);
    expect(c.columns.framewise_displacement[0]).toBeNaN();
    expect(c.columns.framewise_displacement[1]).toBeCloseTo(0.05, 9);
  });

  it('places volumes at i * RepetitionTime from the raw BOLD sidecar', () => {
    const c = readConfounds(SES_ROOT, SES_DER, '01', '01', 'rest', '01')!;
    expect(c.volumeTimes).toEqual(Array.from({ length: N_VOLUMES }, (_, i) => i * TR));
  });

  it('matches run-01 to unpadded run-1 derivatives and uses their VolumeTiming', () => {
    const c = readConfounds(SES_ROOT, SES_DER, '02', '01', 'rest', '01')!;
    expect(c.filename).toBe('sub-02_ses-01_task-rest_run-1_desc-confounds_timeseries.tsv');
    expect(c.volumeTimes).toEqual(Array.from({ length: N_VOLUMES }, (_, i) => i * TR));
  });

  it('returns null when there are no derivatives', () => {
    expect(readConfounds(NOSES_ROOT, NOSES_ROOT, '01', '', 'motor', '')).toBeNull();
  });
});

describe('fixture: bids-nosessions', () => {
  it('reports session-less subjects as sessions [""] and scans with no run', () => {
    const subjects = getSubjects(NOSES_ROOT);
    expect(subjects).toEqual([
      { id: '01', sessions: [''] },
      { id: '02', sessions: [''] },
    ]);
    expect(buildScans(NOSES_ROOT, subjects)).toEqual([
      { sub: '01', ses: '', task: 'motor', run: '' },
      { sub: '02', ses: '', task: 'motor', run: '' },
    ]);
  });

  it('sub-01: subject-level sidecar and run-less quality sidecar', () => {
    const found = findPhysioFiles(NOSES_ROOT, '01', '', 'motor', '');
    expect(found?.sidecarPath).toBe(join(NOSES_ROOT, 'sub-01', 'sub-01_task-motor_physio.json'));
    expect(found?.qualityJsonPath).toBe(join(NOSES_ROOT, 'sub-01', 'func', 'sub-01_task-motor_desc-quality.json'));
  });

  it('sub-01: skips the TSV header row and verifies triggers against top-level task-motor_bold.json', () => {
    const r = readPhysio(NOSES_ROOT, '01', '', 'motor', '')!;
    expect(r.numSamples).toBe(N_SAMPLES);
    expect(r.data[0].every((v) => Number.isFinite(v))).toBe(true);
    expect(r.timing.status).toBe('verified');
  });

  it('sub-02: falls back to the top-level physio.json', () => {
    const found = findPhysioFiles(NOSES_ROOT, '02', '', 'motor', '');
    expect(found?.sidecarPath).toBe(join(NOSES_ROOT, 'physio.json'));
    const r = readPhysio(NOSES_ROOT, '02', '', 'motor', '')!;
    expect(r.columns).toEqual(['cardiac', 'respiratory']);
    expect(r.timing.status).toBe('unverified');
  });

  it('reads dataset metadata with missing fields as null', () => {
    expect(readDatasetInfo(NOSES_ROOT, NOSES_ROOT)).toEqual({
      name: 'Synthetic physio fixture (no sessions)',
      bidsVersion: '1.9.0',
      datasetType: null,
      license: null,
      authors: [],
      doi: null,
      derivatives: [],
    });
  });
});
