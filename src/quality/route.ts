import type { ScanKeyLike } from './metrics-tsv';

// Link to one scan on the Stats page (the dataset is whatever the dev server serves):
//   /quality.html#scan?sub=01&ses=01&task=rest&run=01
// Only the part after "?" is read, so older #subject?… links still open their scan.

/** The scan named in a quality.html hash, or null (Stats then opens the scan last shown in either tab) */
export function parseScanHash(hash: string): ScanKeyLike | null {
  const h = hash.replace(/^#/, '');
  const q = h.indexOf('?');
  if (q === -1) return null;
  const params = new URLSearchParams(h.slice(q + 1));
  const sub = params.get('sub');
  const task = params.get('task');
  if (!sub || !task) return null;
  return { sub, ses: params.get('ses') ?? '', task, run: params.get('run') ?? '' };
}

export function scanHash(scan: ScanKeyLike): string {
  const params = new URLSearchParams();
  params.set('sub', scan.sub);
  if (scan.ses) params.set('ses', scan.ses);
  params.set('task', scan.task);
  if (scan.run) params.set('run', scan.run);
  return `#scan?${params.toString()}`;
}

/** Address of the Stats page for one scan, e.g. for a double-click in Explore and Annotate */
export function statsUrl(scan: ScanKeyLike): string {
  return `/quality.html${scanHash(scan)}`;
}
