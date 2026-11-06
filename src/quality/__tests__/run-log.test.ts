import { describe, it, expect } from 'vitest';
import { parseLastRun, runSentence, notDownloaded, localTimestamp, runLogLine } from '../run-log';
import { downloadedLine, metricsLine } from '@/viewer/info';

const HEADER = 'run_date\tscans_computed\tscans_available\tscans_failed\tcount_source';
const run = { runDate: '2026-11-05T15:40:12', scansComputed: 78, scansAvailable: 120, scansFailed: 2, countSource: 'git-annex' };

describe('parseLastRun', () => {
  it('reads the last run', () => {
    const tsv = `${HEADER}\n2026-11-04T10:00:00\t10\t120\t0\tfiles on disk\n${runLogLine(run)}\n`;
    expect(parseLastRun(tsv)).toEqual(run);
  });

  it('skips a malformed last line, and is null without runs', () => {
    expect(parseLastRun(`${HEADER}\n${runLogLine(run)}\n2026-11-06\tbroken\n`)).toEqual(run);
    expect(parseLastRun(`${HEADER}\n`)).toBeNull();
    expect(parseLastRun('')).toBeNull();
  });
});

describe('run sentence', () => {
  it('gives the date and coverage, with what was left out', () => {
    expect(notDownloaded(run)).toBe(40);
    expect(runSentence(run)).toBe(
      'Quality metrics were last computed on 2026-11-05 for 78 of 120 scans (40 not downloaded, 2 failed).',
    );
  });

  it('leaves out the notes when every listed scan was computed', () => {
    expect(runSentence({ ...run, scansComputed: 120, scansFailed: 0 })).toBe(
      'Quality metrics were last computed on 2026-11-05 for 120 of 120 scans.',
    );
  });

  it('writes local time without milliseconds', () => {
    expect(localTimestamp(new Date(2026, 10, 5, 9, 4, 7))).toBe('2026-11-05T09:04:07');
  });
});

const SCRIPT = { code: 'scripts/compute-quality-metrics.ts' };

describe('dataset summary: downloaded line', () => {
  it('gives downloaded of listed recordings, how they were counted, and the rest', () => {
    expect(downloadedLine({ onDisk: 120, downloaded: 80, source: 'git-annex' })).toEqual([
      '80 of 120 physio recordings in this dataset are downloaded (checked with git-annex). ' +
        'The other 40 are listed but not fetched yet (datalad get).',
    ]);
  });

  it('says all when every recording is here, and is null when none are listed', () => {
    expect(downloadedLine({ onDisk: 3, downloaded: 3, source: 'files on disk' })).toEqual([
      'All 3 physio recordings in this dataset are downloaded (checked with files on disk).',
    ]);
    expect(downloadedLine({ onDisk: 0, downloaded: 0, source: 'files on disk' })).toBeNull();
    expect(downloadedLine(undefined)).toBeNull();
  });
});

describe('dataset summary: quality metrics line', () => {
  it('gives the coverage and how to include the rest when it is partial', () => {
    expect(metricsLine({ found: true, lastRun: run })).toEqual([
      'Quality metrics cover 78 of 120 recordings (computed on 2026-11-05; 2 could not be computed), ' +
        'not the full dataset. To include the rest, download them and rerun ',
      SCRIPT,
      '.',
    ]);
  });

  it('says all when the run covered every recording', () => {
    expect(metricsLine({ found: true, lastRun: { ...run, scansComputed: 120, scansFailed: 0 } })).toEqual([
      'Quality metrics cover all 120 recordings (computed on 2026-11-05).',
    ]);
  });

  it('points to the script when there are no metrics or no logged run, and is null while loading', () => {
    expect(metricsLine({ found: false })).toContainEqual(SCRIPT);
    expect(metricsLine({ found: true, lastRun: null })).toContainEqual(SCRIPT);
    expect(metricsLine(undefined)).toBeNull();
  });
});
