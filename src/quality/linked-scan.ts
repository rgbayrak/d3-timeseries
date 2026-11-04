import { lastViewedKey, readLastViewed, saveLastViewed } from '@/viewer/persistence';
import type { ScanKeyLike } from './metrics-tsv';

// Links the scan shown in Explore and Annotate with the one in Stats, through
// the viewer's own "last viewed" entry in localStorage
// (src/viewer/persistence.ts). The viewer resumes from that entry when it
// loads, so no viewer code changes: Stats reads it to open the viewer's scan,
// and writes it so the viewer opens the scan shown here.

/** Scan last shown in Explore and Annotate for this dataset, if any */
export function viewerScan(datasetName: string | null, store?: Storage | null): ScanKeyLike | null {
  const saved = readLastViewed(lastViewedKey(datasetName), store);
  if (!saved || typeof saved.sub !== 'string' || typeof saved.task !== 'string') return null;
  return { sub: saved.sub, ses: saved.ses ?? '', task: saved.task, run: saved.run ?? '' };
}

/**
 * Make Explore and Annotate open `scan` next time. Keeps the viewer's channel,
 * confound and stacked channels; the viewer falls back to its defaults if they
 * don't exist for this scan.
 */
export function shareScanWithViewer(datasetName: string | null, scan: ScanKeyLike, store?: Storage | null): void {
  const key = lastViewedKey(datasetName);
  const prev = readLastViewed(key, store);
  saveLastViewed(
    key,
    {
      sub: scan.sub,
      ses: scan.ses,
      task: scan.task,
      run: scan.run,
      channel: prev?.channel ?? '',
      confound: prev?.confound ?? '',
      stacked: prev?.stacked ?? [],
    },
    store,
  );
}
