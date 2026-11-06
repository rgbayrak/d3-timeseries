import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync } from 'fs';
import { gzipSync } from 'zlib';
import { tmpdir } from 'os';
import { join } from 'path';
import { countPhysioFiles, listPhysioPaths, parseAnnexMissing } from '../availability';
import { appendQualityRun } from '../quality-run-log';
import { parseLastRun } from '../../src/quality/run-log';

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'physio-availability-'));
  // downloaded: real gzip content
  mkdirSync(join(dir, 'sub-01', 'func'), { recursive: true });
  writeFileSync(join(dir, 'sub-01', 'func', 'sub-01_task-rest_physio.tsv.gz'), gzipSync('1\t2\n'));
  // not downloaded, unlocked mode: a readable git-annex pointer file
  mkdirSync(join(dir, 'sub-02', 'ses-01', 'func'), { recursive: true });
  writeFileSync(
    join(dir, 'sub-02', 'ses-01', 'func', 'sub-02_ses-01_task-rest_physio.tsv.gz'),
    '/annex/objects/SHA256E-s123--abc.tsv.gz\n',
  );
  // not downloaded, locked mode: a dangling symlink
  mkdirSync(join(dir, 'sub-03', 'func'), { recursive: true });
  symlinkSync('../../.git/annex/objects/not-fetched', join(dir, 'sub-03', 'func', 'sub-03_task-rest_physio.tsv.gz'));
  // not physio: ignored
  writeFileSync(join(dir, 'sub-01', 'func', 'sub-01_task-rest_events.tsv'), 'onset\n');
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('physio file count', () => {
  it('lists every physio file, downloaded or not, with and without sessions', () => {
    expect(listPhysioPaths(dir)).toEqual([
      'sub-01/func/sub-01_task-rest_physio.tsv.gz',
      'sub-02/ses-01/func/sub-02_ses-01_task-rest_physio.tsv.gz',
      'sub-03/func/sub-03_task-rest_physio.tsv.gz',
    ]);
  });

  it('counts only files with gzip content as downloaded when git-annex is not used', () => {
    expect(countPhysioFiles(dir, false)).toEqual({ onDisk: 3, downloaded: 1, source: 'files on disk' });
  });

  it('is zero for a folder without physio files', () => {
    expect(countPhysioFiles(join(dir, 'missing'), false)).toEqual({ onDisk: 0, downloaded: 0, source: 'files on disk' });
  });

  it('reads the paths git-annex reports as missing', () => {
    const out = 'sub-02/ses-01/func/sub-02_ses-01_task-rest_physio.tsv.gz\nsub-03/func/sub-03_task-rest_physio.tsv.gz\n\n';
    expect([...parseAnnexMissing(out)]).toEqual([
      'sub-02/ses-01/func/sub-02_ses-01_task-rest_physio.tsv.gz',
      'sub-03/func/sub-03_task-rest_physio.tsv.gz',
    ]);
  });
});

describe('quality metrics run log', () => {
  it('writes the header once, then one line per run', () => {
    const out = join(dir, 'quality', 'ds-test');
    const run = { runDate: '2026-11-05T15:40:12', scansComputed: 78, scansAvailable: 120, scansFailed: 2, countSource: 'git-annex' };
    appendQualityRun(out, run);
    const path = appendQualityRun(out, { ...run, runDate: '2026-11-06T09:12:40', scansComputed: 118 });
    const lines = readFileSync(path, 'utf-8').trim().split('\n');
    expect(lines).toEqual([
      'run_date\tscans_computed\tscans_available\tscans_failed\tcount_source',
      '2026-11-05T15:40:12\t78\t120\t2\tgit-annex',
      '2026-11-06T09:12:40\t118\t120\t2\tgit-annex',
    ]);
    expect(parseLastRun(readFileSync(path, 'utf-8'))?.scansComputed).toBe(118);
  });
});
