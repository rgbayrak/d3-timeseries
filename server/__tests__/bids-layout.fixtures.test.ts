import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import {
  getSubjects,
  getTasks,
  getRuns,
  findPhysioFiles,
  readPhysio,
  readConfounds,
  readEvents,
  readPeaks,
  readDatasetInfo,
  buildScans,
  resolveBidsRoots,
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
      description: {
        file: join(SES_ROOT, 'dataset_description.json'),
        source: 'main',
        missingFields: [],
        mainMissing: null,
      },
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

  it('reads MRIQC *_timeseries.tsv, using the lowest echo of a multi-echo run', () => {
    const c = readConfounds(NOSES_ROOT, join(NOSES_ROOT, 'derivatives', 'mriqc'), '01', '', 'motor', '')!;
    expect(c.filename).toBe('sub-01_task-motor_echo-1_timeseries.tsv');
    expect(Object.keys(c.columns)).toEqual(['framewise_displacement', 'dvars', 'trans_x', 'rot_x']);
    expect(c.columns.framewise_displacement[0]).toBeNaN();
    expect(c.columns.framewise_displacement[1]).toBeCloseTo(0.05, 9);
    // TR from the top-level task-motor_bold.json
    expect(c.volumeTimes).toEqual(Array.from({ length: N_VOLUMES }, (_, i) => i * TR));
  });

  it('returns null when there are no derivatives', () => {
    expect(readConfounds(NOSES_ROOT, NOSES_ROOT, '01', '', 'motor', '')).toBeNull();
  });
});

describe('fixture: events', () => {
  it('reads onsets, durations and the other columns as text', () => {
    const e = readEvents(NOSES_ROOT, '01', '', 'motor', '')!;
    expect(e.filename).toBe('sub-01_task-motor_events.tsv');
    // the row without an onset is dropped; an n/a duration counts as 0
    expect(e.onset).toEqual([0, 6, 12]);
    expect(e.duration).toEqual([4, 4, 0]);
    expect(e.columns).toEqual({
      trial_type: ['left', 'right', 'left'],
      response_time: ['0.52', 'n/a', '0.61'],
    });
  });

  it('uses the run-less events file for every run (BIDS inheritance)', () => {
    for (const run of ['1', '02']) {
      expect(readEvents(NOSES_ROOT, '01', '', 'motor', run)?.filename).toBe('sub-01_task-motor_events.tsv');
    }
  });

  it('returns null when the scan has no events file', () => {
    expect(readEvents(NOSES_ROOT, '02', '', 'motor', '')).toBeNull();
    expect(readEvents(SES_ROOT, '01', '01', 'rest', '01')).toBeNull();
  });

});

describe('physio stored outside the main BIDS folder', () => {
  // main/: dataset_description.json, task-motor_bold.json, events (no physio)
  // phys/: the physio files and sidecars only
  let dir: string;
  let main: string;
  let phys: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'bids-physio-root-'));
    main = join(dir, 'main');
    phys = join(dir, 'phys');
    const copy = (rel: string, to: string) => {
      mkdirSync(dirname(join(to, rel)), { recursive: true });
      cpSync(join(NOSES_ROOT, rel), join(to, rel));
    };
    for (const rel of ['dataset_description.json', 'task-motor_bold.json', 'sub-01/func/sub-01_task-motor_events.tsv']) {
      copy(rel, main);
    }
    for (const rel of [
      'physio.json',
      'sub-01/sub-01_task-motor_physio.json',
      'sub-01/func/sub-01_task-motor_physio.tsv.gz',
      'sub-02/func/sub-02_task-motor_physio.tsv.gz',
    ]) {
      copy(rel, phys);
    }
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('keeps an explicit physio root and the main folder for everything else', () => {
    expect(resolveBidsRoots(main, { physioRoot: phys })).toMatchObject({
      bidsRoot: main,
      physioRoot: phys,
      derivRoot: join(main, 'derivatives'), // no confounds anywhere: nothing found
    });
  });

  it('does not search outside the main folder for physio', () => {
    // phys/ is a sibling of main/: without BIDSPHYS_ROOT it is not used
    const r = resolveBidsRoots(main);
    expect(r.physioRoot).toBe(main);
    expect(r.notes.join(' ')).toMatch(/set BIDSPHYS_ROOT/);
  });

  it('finds scans in the physio root only', () => {
    expect(buildScans(phys, getSubjects(phys))).toEqual(buildScans(NOSES_ROOT, getSubjects(NOSES_ROOT)));
    expect(getSubjects(main)).toEqual([]);
  });

  it('reads BOLD timing and events from the main folder', () => {
    const r = readPhysio(phys, '01', '', 'motor', '', join(main, 'derivatives', 'fmriprep'), main)!;
    expect(r.timing.status).toBe('verified'); // TR from main/task-motor_bold.json
    expect(readEvents(main, '01', '', 'motor', '')?.filename).toBe('sub-01_task-motor_events.tsv');
    expect(readDatasetInfo(main, join(main, 'derivatives', 'fmriprep')).name).toBe(
      'Synthetic physio fixture (no sessions)',
    );
  });

  it('never reads BOLD sidecars from the physio root', () => {
    const empty = join(dir, 'empty');
    mkdirSync(empty, { recursive: true });
    cpSync(join(NOSES_ROOT, 'task-motor_bold.json'), join(phys, 'task-motor_bold.json'));
    const r = readPhysio(phys, '01', '', 'motor', '', join(empty, 'derivatives'), empty)!;
    expect(r.timing.status).toBe('unverified'); // no TR: the sidecar in phys/ is ignored
    rmSync(join(phys, 'task-motor_bold.json'));
  });
});

describe('resolveBidsRoots: found by content, not folder names', () => {
  // Empty files are enough: roots are chosen from file names only
  let dir: string;
  const touch = (path: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '');
  };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'bids-roots-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('uses the main folder for physio, and finds the derivatives with confounds, in plain BIDS', () => {
    expect(resolveBidsRoots(SES_ROOT)).toMatchObject({ bidsRoot: SES_ROOT, physioRoot: SES_ROOT, derivRoot: SES_DER });
    // MRIQC timeseries count as confounds too, whatever the folder is called
    expect(resolveBidsRoots(NOSES_ROOT)).toMatchObject({
      physioRoot: NOSES_ROOT,
      derivRoot: join(NOSES_ROOT, 'derivatives', 'mriqc'),
    });
  });

  it('finds physio in any folder inside the main folder, or inside its derivatives/', () => {
    const main = join(dir, 'a');
    touch(join(main, 'sub-01', 'ses-1', 'func', 'sub-01_ses-1_task-x_bold.json'));
    touch(join(main, 'recordings-v2', 'sub-01', 'ses-1', 'func', 'sub-01_ses-1_task-x_physio.tsv.gz'));
    expect(resolveBidsRoots(main).physioRoot).toBe(join(main, 'recordings-v2'));

    const main2 = join(dir, 'b');
    touch(join(main2, 'sub-01', 'func', 'sub-01_task-x_bold.json'));
    touch(join(main2, 'derivatives', 'cleaned', 'sub-01', 'func', 'sub-01_task-x_desc-clean_physio.tsv.gz'));
    expect(resolveBidsRoots(main2).physioRoot).toBe(join(main2, 'derivatives', 'cleaned'));
  });

  it('prefers fMRIPrep confounds over MRIQC timeseries, then folder name order', () => {
    const main = join(dir, 'c');
    touch(join(main, 'sub-01', 'func', 'sub-01_task-x_physio.tsv.gz'));
    touch(join(main, 'derivatives', 'aaa-qc', 'sub-01', 'func', 'sub-01_task-x_timeseries.tsv'));
    touch(join(main, 'derivatives', 'zzz-prep', 'sub-01', 'func', 'sub-01_task-x_desc-confounds_timeseries.tsv'));
    const r = resolveBidsRoots(main);
    expect(r.derivRoot).toBe(join(main, 'derivatives', 'zzz-prep'));
    expect(r.notes.join(' ')).toMatch(/also in .*aaa-qc.*set BIDSDER_ROOT/);
  });

  it('picks the first physio folder by name when several have physio, and says so', () => {
    const main = join(dir, 'd');
    touch(join(main, 'sub-01', 'func', 'sub-01_task-x_bold.json'));
    touch(join(main, 'two', 'sub-01', 'func', 'sub-01_task-x_physio.tsv.gz'));
    touch(join(main, 'one', 'sub-01', 'func', 'sub-01_task-x_physio.tsv.gz'));
    const r = resolveBidsRoots(main);
    expect(r.physioRoot).toBe(join(main, 'one'));
    expect(r.notes.join(' ')).toMatch(/also in .*two.*set BIDSPHYS_ROOT/);
  });

  it('lets explicit physio and derivatives roots win', () => {
    const r = resolveBidsRoots(SES_ROOT, { physioRoot: '/elsewhere/physio', derivRoot: '/elsewhere/der' });
    expect(r).toMatchObject({ bidsRoot: SES_ROOT, physioRoot: '/elsewhere/physio', derivRoot: '/elsewhere/der' });
  });
});

describe('fixture: peaks (trial)', () => {
  it('keeps peak rows with a channel, flagging the corrected ones', () => {
    expect(readPeaks(SES_ROOT, '01', '02', 'rest', '01')).toEqual({
      filename: 'sub-01_ses-02_task-rest_run-01_events.tsv',
      time: [0.694, 0.694, 1.046, 1.171, 1.171],
      channel: ['ECG', 'ECG', 'ECG', 'PPG', 'PPG'],
      corrected: [false, true, false, false, true],
    });
  });

  it('returns null for events without peaks or without a channel column', () => {
    expect(readPeaks(NOSES_ROOT, '01', '', 'motor', '')).toBeNull(); // task events only
    expect(readPeaks(SES_ROOT, '01', '01', 'rest', '01')).toBeNull(); // no events file
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
      description: {
        file: join(NOSES_ROOT, 'dataset_description.json'),
        source: 'main',
        missingFields: ['Authors'], // the fixture lists no authors
        mainMissing: null,
      },
    });
  });
});

describe('readDatasetInfo: missing or placeholder dataset description', () => {
  let dir: string;
  const write = (path: string, content: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  };
  const desc = (o: object) => JSON.stringify(o);
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'bids-description-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('drops placeholder titles and authors and lists them as missing', () => {
    const main = join(dir, 'placeholder');
    write(join(main, 'dataset_description.json'), desc({ Name: 'n/a', Authors: ['Unknown', '[Author 1]', '', 'Ada'] }));
    const info = readDatasetInfo(main, join(main, 'derivatives'));
    expect(info.name).toBeNull();
    expect(info.authors).toEqual(['Ada']); // a real one-word name is kept
    expect(info.description).toMatchObject({ source: 'main', missingFields: ['Name'], mainMissing: null });
  });

  it('falls back to the physio folder, then the derivatives, for the title and authors', () => {
    const main = join(dir, 'fallback', 'main');
    const phys = join(dir, 'fallback', 'phys');
    const der = join(dir, 'fallback', 'der');
    write(join(der, 'dataset_description.json'), desc({ Name: 'Pipeline output', DatasetType: 'derivative' }));
    expect(readDatasetInfo(main, der, phys)).toMatchObject({
      name: 'Pipeline output',
      license: null, // other fields never come from a fallback
      description: { source: 'derivatives', file: join(der, 'dataset_description.json') },
    });
    write(join(phys, 'dataset_description.json'), desc({ Name: 'Physio outputs', Authors: ['Lab'], License: 'CC0' }));
    const info = readDatasetInfo(main, der, phys);
    expect(info).toMatchObject({ name: 'Physio outputs', authors: ['Lab'], license: null });
    expect(info.description).toMatchObject({
      source: 'physio',
      mainMissing: { path: join(main, 'dataset_description.json'), url: null, command: null },
    });
  });

  it('links to the main dataset from the DataLad parent .gitmodules', () => {
    const ds = join(dir, 'superds');
    write(
      join(ds, '.gitmodules'),
      '[submodule "physprep"]\n\tpath = physprep\n\turl = https://example.org/physprep.git\n' +
        '[submodule "data"]\n\tpath = data\n\turl = ./data\n\tdatalad-url = https://example.org/main.git\n',
    );
    const m = readDatasetInfo(join(ds, 'data'), join(ds, 'der')).description.mainMissing!;
    expect(m.url).toBe('https://example.org/main.git'); // datalad-url wins over a relative url
    expect(m.command).toBe(`cd ${ds} && datalad get -n data && datalad get data/dataset_description.json`);
  });

  it('links to SourceDatasets (URL or DOI) and ignores links that are not web links', () => {
    const main = join(dir, 'source', 'main');
    const phys = join(dir, 'source', 'phys');
    write(
      join(phys, 'dataset_description.json'),
      desc({ Name: 'Physio', SourceDatasets: [{ URL: 'bids::' }, { URL: '../raw' }, { DOI: 'doi:10.1234/abcd' }] }),
    );
    expect(readDatasetInfo(main, join(dir, 'none'), phys).description.mainMissing?.url).toBe(
      'https://doi.org/10.1234/abcd',
    );
  });

  it('reports no description at all', () => {
    const info = readDatasetInfo(join(dir, 'empty'), join(dir, 'empty-der'));
    expect(info.name).toBeNull();
    expect(info.description).toMatchObject({ file: null, source: 'none', missingFields: ['Name', 'Authors'] });
  });
});
