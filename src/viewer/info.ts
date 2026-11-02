import type { DatasetInfo, PhysioRaw, TimingStatus } from '@/data/bids-physio-reader';

/** "doi:10.x/y", "https://doi.org/10.x/y" or "10.x/y" -> bare DOI */
export function bareDoi(doi: string): string {
  return doi.replace(/^doi:/i, '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
}

/** Dataset name + metadata line, all taken from dataset_description.json; empty when there is nothing to show */
export function renderDatasetInfo(el: HTMLElement, info: DatasetInfo | null): void {
  el.innerHTML = '';
  if (!info || (!info.name && info.authors.length === 0 && !info.doi)) return;

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
