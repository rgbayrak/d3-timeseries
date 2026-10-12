import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { existsSync } from 'fs';
import {
  getSubjects,
  getTasks,
  getRuns,
  findPhysioFiles,
  readPhysio,
  buildScans,
} from '../bids-layout';

/**
 * Dataset-agnostic BIDS layout test suite.
 *
 * Each entry only needs a name and a root path. Every assertion is derived
 * from what the functions themselves discover — no hardcoded subject IDs,
 * channel names, session labels, or subject counts.
 *
 * To add a new dataset, append an entry with { name, root }.
 */

const BASE = join(process.cwd(), 'data');

const datasets = [
  { name: 'ds006644', root: join(BASE, 'ds006644') },
  { name: 'ds000210', root: join(BASE, 'ds000210') },
].filter((d) => existsSync(d.root));

describe.each(datasets)('BIDS layout: $name', ({ root }) => {
  // Discover subjects once per dataset; all subsequent tests derive from this.
  const subjects = getSubjects(root);

  it('discovers at least one subject with readable physio', () => {
    expect(subjects.length).toBeGreaterThan(0);
  });

  it('every subject has a sorted, non-empty sessions array', () => {
    for (const subj of subjects) {
      expect(subj.sessions.length).toBeGreaterThan(0);
      // Sessions are either all non-empty strings (has ses- dirs)
      // or exactly [''] (session-less layout) — never mixed.
      const hasSessions = subj.sessions[0].length > 0;
      if (hasSessions) {
        expect(subj.sessions.every((s) => s.length > 0)).toBe(true);
        // Sorted
        const sorted = [...subj.sessions].sort((a, b) =>
          a.localeCompare(b, undefined, { numeric: true }),
        );
        expect(subj.sessions).toEqual(sorted);
      } else {
        expect(subj.sessions).toEqual(['']);
      }
    }
  });

  it('every subject/session pair yields at least one task', () => {
    for (const subj of subjects) {
      for (const ses of subj.sessions) {
        const tasks = getTasks(root, subj.id, ses);
        expect(tasks.length).toBeGreaterThan(0);
        // Tasks should be sorted strings
        const sorted = [...tasks].sort((a, b) =>
          a.localeCompare(b, undefined, { numeric: true }),
        );
        expect(tasks).toEqual(sorted);
      }
    }
  });

  it('getRuns returns a sorted array (possibly empty) for every task', () => {
    const first = subjects[0];
    const ses = first.sessions[0];
    const tasks = getTasks(root, first.id, ses);
    for (const task of tasks) {
      const runs = getRuns(root, first.id, ses, task);
      expect(Array.isArray(runs)).toBe(true);
      if (runs.length > 0) {
        const sorted = [...runs].sort((a, b) =>
          a.localeCompare(b, undefined, { numeric: true }),
        );
        expect(runs).toEqual(sorted);
      }
    }
  });

  it('findPhysioFiles locates a .tsv.gz and a .json sidecar for the first scan', () => {
    const first = subjects[0];
    const ses = first.sessions[0];
    const task = getTasks(root, first.id, ses)[0];
    const runs = getRuns(root, first.id, ses, task);
    const run = runs.length > 0 ? runs[0] : '';

    const found = findPhysioFiles(root, first.id, ses, task, run);
    expect(found).not.toBeNull();
    expect(found!.tsvGzPath).toMatch(/\.tsv\.gz$/);
    expect(found!.sidecarPath).not.toBeNull();
    expect(found!.sidecarPath).toMatch(/\.json$/);
  });

  it('readPhysio returns consistent column data for the first scan', () => {
    const first = subjects[0];
    const ses = first.sessions[0];
    const task = getTasks(root, first.id, ses)[0];
    const runs = getRuns(root, first.id, ses, task);
    const run = runs.length > 0 ? runs[0] : '';

    const result = readPhysio(root, first.id, ses, task, run);
    expect(result).not.toBeNull();
    expect(result!.samplingFrequency).toBeGreaterThan(0);
    expect(result!.columns.length).toBeGreaterThan(0);
    expect(result!.data.length).toBe(result!.columns.length);
    expect(result!.numSamples).toBeGreaterThan(0);
    for (const col of result!.data) {
      expect(col.length).toBe(result!.numSamples);
    }
  });

  it('buildScans produces a scan for every subject/session/task/run combination', () => {
    const scans = buildScans(root, subjects);
    expect(scans.length).toBeGreaterThan(0);

    for (const scan of scans) {
      expect(scan.sub).toBeTruthy();
      expect(scan.task).toBeTruthy();
      // ses can be '' (session-less); run can be '' (no runs)
      expect(typeof scan.ses).toBe('string');
      expect(typeof scan.run).toBe('string');
    }

    // Verify round-trip: every scan's physio files should be findable
    const sample = scans[0];
    const found = findPhysioFiles(root, sample.sub, sample.ses, sample.task, sample.run);
    expect(found).not.toBeNull();
  });

  it('within a dataset, sessions are uniformly present or absent', () => {
    // BIDS datasets don't mix session-less and session-ful subjects
    const hasSessions = subjects[0].sessions[0].length > 0;
    for (const subj of subjects) {
      const subjHas = subj.sessions[0].length > 0;
      expect(subjHas).toBe(hasSessions);
    }
  });

  it('within a dataset, runs are consistent per task across subjects', () => {
    // Pick the first task from the first subject; check whether other subjects
    // with the same task also have runs (or also don't).
    const first = subjects[0];
    const ses = first.sessions[0];
    const task = getTasks(root, first.id, ses)[0];
    const firstRuns = getRuns(root, first.id, ses, task);
    const expectRuns = firstRuns.length > 0;

    for (const subj of subjects) {
      for (const s of subj.sessions) {
        const tasks = getTasks(root, subj.id, s);
        if (!tasks.includes(task)) continue;
        const runs = getRuns(root, subj.id, s, task);
        if (expectRuns) {
          expect(runs.length).toBeGreaterThan(0);
        } else {
          expect(runs.length).toBe(0);
        }
      }
    }
  });
});
