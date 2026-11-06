import type { DatasetInfo, PhysioFileCount, PhysioRaw, TimingStatus } from '@/data/bids-physio-reader';
import type { QualityRun } from '@/quality/run-log';
import { descriptionNoticeLines } from '@/data/dataset-notice';
import type { NoticePart } from '@/data/dataset-notice';
import { structureLine } from '@/data/bids-structure';
import type { BidsStructure } from '@/data/bids-structure';

/** "doi:10.x/y", "https://doi.org/10.x/y" or "10.x/y" -> bare DOI */
export function bareDoi(doi: string): string {
  return doi.replace(/^doi:/i, '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
}

/** One notice line: file names and commands in the shared code style, links opening in a new tab */
function noticeLine(parts: NoticePart[]): HTMLElement {
  const div = document.createElement('div');
  div.className = 'dataset-notice';
  for (const part of parts) {
    if (typeof part === 'string') div.append(part);
    else if ('code' in part) {
      const code = document.createElement('span');
      code.className = 'now-viewing-file';
      code.textContent = part.code;
      div.append(code);
    } else {
      const a = document.createElement('a');
      a.href = part.link;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = part.link;
      div.append(a);
    }
  }
  return div;
}

/**
 * Dataset name + metadata line, all taken from dataset_description.json, then
 * what to fix when that file is missing or has no title or authors; empty
 * when there is nothing to show
 */
export function renderDatasetInfo(el: HTMLElement, info: DatasetInfo | null): void {
  el.innerHTML = '';
  const notices = descriptionNoticeLines(info?.description);
  if (!info || (!info.name && info.authors.length === 0 && !info.doi && notices.length === 0)) return;
  if (!info.name && info.authors.length === 0 && !info.doi) {
    for (const line of notices) el.appendChild(noticeLine(line));
    return;
  }

  const nameEl = document.createElement('div');
  nameEl.className = 'dataset-name';
  nameEl.textContent = info.name ?? '(unnamed dataset)';
  el.appendChild(nameEl);

  const meta = document.createElement('div');
  meta.className = 'dataset-meta';
  const parts: (string | Node)[] = [];
  if (info.authors.length) parts.push(info.authors.join(', '));
  if (info.bidsVersion) parts.push(`BIDS ${info.bidsVersion}`);
  if (info.license) parts.push(`License: ${info.license}`);
  if (info.doi) {
    const bare = bareDoi(info.doi);
    const a = document.createElement('a');
    a.href = `https://doi.org/${bare}`;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = `doi:${bare}`;
    parts.push(a);
  }
  for (const d of info.derivatives) {
    parts.push(`Derivatives: ${d.name}${d.version ? ` ${d.version}` : ''}`);
  }
  parts.forEach((p, i) => {
    if (i > 0) meta.append(' · ');
    meta.append(p);
  });
  el.appendChild(meta);
  // The header shows one line of each; hover for the full text
  nameEl.title = nameEl.textContent ?? '';
  meta.title = meta.textContent ?? '';
  for (const line of notices) el.appendChild(noticeLine(line));
}

// ── Dataset summary (between the dataset header and the dropdowns) ──

/** A piece of summary text; `code` pieces are file names, shown in the code style */
export type SummaryPart = string | { code: string };

/** What the page knows about the quality metrics: still loading (undefined), none, or found with their last logged run */
export type MetricsStatus = { found: false } | { found: true; lastRun: QualityRun | null };

const QUALITY_SCRIPT = 'scripts/compute-quality-metrics.ts';
const recordings = (n: number) => (n === 1 ? 'recording' : 'recordings');

/**
 * Downloaded line: "80 of 120 physio recordings in this dataset are downloaded
 * (checked with git-annex). The other 40 are listed but not fetched yet (datalad get)."
 * Null when the dataset lists none.
 */
export function downloadedLine(count: PhysioFileCount | undefined): SummaryPart[] | null {
  if (!count || count.onDisk === 0) return null;
  const how = `(checked with ${count.source})`;
  if (count.downloaded >= count.onDisk) {
    return [`All ${count.onDisk} physio ${recordings(count.onDisk)} in this dataset are downloaded ${how}.`];
  }
  const rest = count.onDisk - count.downloaded;
  return [
    `${count.downloaded} of ${count.onDisk} physio ${recordings(count.onDisk)} in this dataset are downloaded ${how}. ` +
      `The other ${rest} ${rest === 1 ? 'is' : 'are'} listed but not fetched yet (datalad get).`,
  ];
}

/**
 * Quality metrics line, from the last run in quality_runs.tsv: how many
 * recordings they cover and, when not all, how to cover the rest. Null while
 * the metrics are still loading.
 */
export function metricsLine(status: MetricsStatus | undefined): SummaryPart[] | null {
  if (!status) return null;
  if (!status.found) {
    return ['No quality metrics yet. Run ', { code: QUALITY_SCRIPT }, ' to compute them and open the Stats tab.'];
  }
  const run = status.lastRun;
  if (!run) {
    return ['Quality metrics are available, but the run was not logged. Rerun ', { code: QUALITY_SCRIPT }, ' to see how many recordings they cover.'];
  }
  const date = run.runDate.slice(0, 10);
  const failed = run.scansFailed > 0 ? `; ${run.scansFailed} could not be computed` : '';
  if (run.scansComputed >= run.scansAvailable) {
    return [`Quality metrics cover all ${run.scansAvailable} ${recordings(run.scansAvailable)} (computed on ${date}).`];
  }
  return [
    `Quality metrics cover ${run.scansComputed} of ${run.scansAvailable} ${recordings(run.scansAvailable)} ` +
      `(computed on ${date}${failed}), not the full dataset. To include the rest, download them and rerun `,
    { code: QUALITY_SCRIPT },
    '.',
  ];
}

/** Fill the summary with one line per known fact, or hide the section when there are none */
export function renderSummary(
  section: HTMLElement,
  el: HTMLElement,
  count: PhysioFileCount | undefined,
  metrics: MetricsStatus | undefined,
  structure?: BidsStructure | null,
): void {
  el.innerHTML = '';
  for (const line of [downloadedLine(count), metricsLine(metrics), structureLine(structure)]) {
    if (!line) continue;
    const div = document.createElement('div');
    for (const part of line) {
      if (typeof part === 'string') {
        div.append(part);
      } else if ('code' in part) {
        const code = document.createElement('span');
        code.className = 'now-viewing-file';
        code.textContent = part.code;
        div.append(code);
      } else {
        const a = document.createElement('a');
        a.href = part.link;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = part.link;
        div.append(a);
      }
    }
    el.appendChild(div);
  }
  section.style.display = el.childElementCount > 0 ? '' : 'none';
}

export const TIMING_LABELS: Record<TimingStatus, string> = {
  verified: 'Timing: trigger-verified',
  corrected: 'Timing: corrected from triggers',
  mismatch: 'Timing: triggers disagree',
  unverified: 'Timing: sidecar only',
};

/** Badge text for one channel's quality sidecar entry */
export function qualityBadgeLabel(channel: string, assessment: string, percentValid: number | null): string {
  let label = `${channel}: ${assessment}`;
  if (percentValid != null) label += ` (${(percentValid * 100).toFixed(0)}%)`;
  return label;
}

/** Timing badge (hover for the explanation) plus a pass/fail badge per channel with a quality entry */
export function renderQualityBadges(el: HTMLElement, raw: PhysioRaw): void {
  el.innerHTML = '';

  const timingBadge = document.createElement('span');
  timingBadge.className = `quality-badge timing-${raw.timing.status}`;
  timingBadge.textContent = TIMING_LABELS[raw.timing.status];
  timingBadge.title = raw.timing.detail;
  el.appendChild(timingBadge);

  if (!raw.quality) return;
  for (const ch of raw.columns) {
    const q = raw.quality[ch];
    if (!q) continue;
    const badge = document.createElement('span');
    badge.className = `quality-badge ${q.assessment.toLowerCase() === 'pass' ? 'pass' : 'fail'}`;
    badge.textContent = qualityBadgeLabel(ch, q.assessment, q.percentValid);
    el.appendChild(badge);
  }
}
