import type { ScanEntry } from '@/data/bids-physio-reader';

/**
 * The scan `delta` steps away from `current` in hierarchy order, wrapping at
 * both ends. If `current` is not in the list, stepping starts from before the
 * first scan.
 */
export function stepScan(scans: ScanEntry[], current: ScanEntry, delta: number): ScanEntry {
  const idx = scans.findIndex(
    (s) => s.sub === current.sub && s.ses === current.ses && s.task === current.task && s.run === current.run,
  );
  return scans[(idx + delta + scans.length) % scans.length];
}

/**
 * Scan Explore and Annotate opens on, in order:
 *  1. one named in the link (e.g. "Open this scan in Explore and Annotate" from Stats),
 *  2. the earliest scan (hierarchy order) with nothing annotated yet for the channel,
 *     so a skipped scan always comes back,
 *  3. the last-viewed scan (everything annotated),
 *  4. the first scan.
 * Candidates that are not in `scans` are skipped.
 */
export function pickStartScan(
  scans: ScanEntry[],
  candidates: { linked?: ScanEntry | null; firstUnannotated?: ScanEntry | null; lastViewed?: ScanEntry | null },
): ScanEntry | undefined {
  const find = (c: ScanEntry | null | undefined) =>
    c ? scans.find((s) => s.sub === c.sub && s.ses === c.ses && s.task === c.task && s.run === c.run) : undefined;
  return find(candidates.linked) ?? find(candidates.firstUnannotated) ?? find(candidates.lastViewed) ?? scans[0];
}

/**
 * Resolve a search box query to a scan. Tried in order: a subject ("sub-03" or
 * "03", jumps to its first scan), a session of the current subject, then that
 * session in any subject. Returns null when nothing matches.
 */
export function resolveSearch(query: string, scans: ScanEntry[], currentSub: string): ScanEntry | null {
  const q = query.trim();
  if (!q) return null;
  const subId = q.startsWith('sub-') ? q.slice(4) : q;
  const sesId = q.startsWith('ses-') ? q.slice(4) : q;

  return (
    scans.find((s) => s.sub === subId) ??
    scans.find((s) => s.sub === currentSub && s.ses === sesId) ??
    scans.find((s) => s.ses === sesId) ??
    null
  );
}

/** True for a bare ←/→ press; modified presses are left to the browser (e.g. Alt+← for back) */
export function isScanStepKey(e: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>): boolean {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return false;
  return !(e.altKey || e.ctrlKey || e.metaKey || e.shiftKey);
}
