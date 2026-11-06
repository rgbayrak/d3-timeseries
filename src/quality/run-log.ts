// One line per quality metrics run, appended by scripts/compute-quality-metrics.ts
// to data/quality/<dataset>/quality_runs.tsv; the Stats tab reads the last line.
// Relative imports only: this module is also loaded by Node scripts.

export const RUN_LOG_NAME = 'quality_runs.tsv';
export const RUN_LOG_HEADER = ['run_date', 'scans_computed', 'scans_available', 'scans_failed', 'count_source'];

export interface QualityRun {
  /** Local date and time of the run, e.g. 2026-11-05T15:40:12 */
  runDate: string;
  /** Scans whose metrics were computed */
  scansComputed: number;
  /** Physio files listed in the dataset, downloaded or not */
  scansAvailable: number;
  /** Downloaded scans that could not be computed */
  scansFailed: number;
  /** How the available count was made: git-annex or files on disk */
  countSource: string;
}

/** Local date and time without milliseconds or time zone, e.g. 2026-11-05T15:40:12 */
export function localTimestamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function runLogLine(run: QualityRun): string {
  return [run.runDate, run.scansComputed, run.scansAvailable, run.scansFailed, run.countSource].join('\t');
}

/** The last well-formed run in the log, or null if there is none */
export function parseLastRun(tsv: string): QualityRun | null {
  const lines = tsv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  for (let i = lines.length - 1; i >= 1; i--) {
    const [runDate, computed, available, failed, source] = lines[i].split('\t');
    const nums = [computed, available, failed].map(Number);
    if (!runDate || nums.some((n) => !Number.isInteger(n) || n < 0)) continue;
    return {
      runDate,
      scansComputed: nums[0],
      scansAvailable: nums[1],
      scansFailed: nums[2],
      countSource: source ?? '',
    };
  }
  return null;
}

/** Listed scans that were not downloaded when the metrics ran */
export function notDownloaded(run: QualityRun): number {
  return Math.max(0, run.scansAvailable - run.scansComputed - run.scansFailed);
}

/** "Quality metrics were last computed on 2026-11-05 for 78 of 120 scans (40 not downloaded, 2 failed)." */
export function runSentence(run: QualityRun): string {
  const missing = notDownloaded(run);
  const notes = [missing > 0 ? `${missing} not downloaded` : '', run.scansFailed > 0 ? `${run.scansFailed} failed` : '']
    .filter(Boolean)
    .join(', ');
  return (
    `Quality metrics were last computed on ${run.runDate.slice(0, 10)} for ${run.scansComputed} of ` +
    `${run.scansAvailable} ${run.scansAvailable === 1 ? 'scan' : 'scans'}${notes ? ` (${notes})` : ''}.`
  );
}
