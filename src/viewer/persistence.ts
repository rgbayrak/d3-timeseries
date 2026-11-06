import type { ScanEntry } from '@/data/bids-physio-reader';
import type { RestoredSelection } from './state';

// Last-viewed scan in localStorage. A per-browser convenience only: storage can
// be unavailable (private mode, blocked site data), so every access is wrapped
// and failures are ignored.

export interface LastViewed extends ScanEntry {
  channel: string;
  confound: string;
  /** Events column; absent in entries saved before the events figure existed */
  event?: string;
  /** Absent in entries saved before stacked channels existed */
  stacked?: string[];
}

/** Key used until dataset info has loaded */
export const DEFAULT_LAST_VIEWED_KEY = 'bids-physio-viewer:last-viewed';

/** Storage key scoped per dataset, so switching datasets doesn't resume a scan that isn't there */
export function lastViewedKey(datasetName: string | null | undefined): string {
  return `${DEFAULT_LAST_VIEWED_KEY}:${datasetName ?? 'unnamed'}`;
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function saveLastViewed(key: string, value: LastViewed, store: Storage | null = storage()): void {
  try {
    store?.setItem(key, JSON.stringify(value));
  } catch {
    // ignore: storage unavailable or full
  }
}

export function readLastViewed(key: string, store: Storage | null = storage()): LastViewed | null {
  try {
    const raw = store?.getItem(key);
    return raw ? (JSON.parse(raw) as LastViewed) : null;
  } catch {
    return null;
  }
}

/** The saved scan if it still exists in the dataset, plus the selection to restore with it */
export function resumeFrom(
  saved: LastViewed | null,
  scans: ScanEntry[],
): { scan: ScanEntry; selection: RestoredSelection } | null {
  if (!saved) return null;
  const scan = scans.find(
    (s) => s.sub === saved.sub && s.ses === saved.ses && s.task === saved.task && s.run === saved.run,
  );
  if (!scan) return null;
  return {
    scan,
    selection: {
      channel: saved.channel,
      confound: saved.confound,
      event: typeof saved.event === 'string' ? saved.event : '',
      stacked: Array.isArray(saved.stacked) ? saved.stacked : [],
    },
  };
}
