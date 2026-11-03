import type { ChartInstance } from '@/core';
import { TIMING_LABELS } from '@/viewer/info';
import type { TimingStatus } from '@/data/bids-physio-reader';
import { sameScanKey, scanId } from './metrics-tsv';
import type { MetricKey, QualityRow, ScanKeyLike, ParticipantsTable } from './metrics-tsv';
import { fetchWaveforms } from './data';
import type { LoadedDataset } from './data';
import { drawHistogram, drawWaveform, metricColor } from './charts';
import {
  availableMetrics,
  esc,
  formatMetric,
  formatSeconds,
  metricDef,
  metricAxisLabel,
  ordinal,
  rowsForChannel,
  rowsForScan,
  uniqueScans,
} from './model';
import type { VisibleMetrics } from './model';
import { percentileRank } from './stats';

export interface IndividualTabElements {
  prevBtn: HTMLButtonElement;
  nextBtn: HTMLButtonElement;
  filename: HTMLElement;
  participant: HTMLElement;
  scanDetails: HTMLElement;
  waveforms: HTMLElement;
  /** One section per channel: its metrics table, then its histograms */
  metrics: HTMLElement;
}

export interface IndividualTab {
  /** Show one scan of a loaded dataset (first scan when scan is null); returns the scan shown */
  show: (dataset: string, data: LoadedDataset, scan: ScanKeyLike | null) => ScanKeyLike | null;
  /**
   * Metrics picker changed: redraw only the metric tables and histograms of the
   * scan shown, keeping the waveforms and the scroll position
   */
  refreshMetrics: () => void;
}

function participantHtml(table: ParticipantsTable | null, sub: string): string {
  const row = table?.rows[sub];
  if (!table || !row) return '<div class="muted">No participants.tsv entry for this subject.</div>';
  const cells = table.columns.map((col) => {
    const meta = table.meta[col] ?? {};
    const value = row[col] ?? '';
    const level = meta.levels?.[value];
    const shown = value === '' || value === 'n/a' ? 'n/a' : value + (meta.units ? ` ${meta.units}` : '');
    const tip = [meta.description, level].filter(Boolean).join(' — ');
    const levelText = level && level.length <= 30 && level !== value ? ` (${level})` : '';
    return `<div class="kv"${tip ? ` title="${esc(tip)}"` : ''}><span class="k">${esc(col)}</span><span class="v">${esc(shown + levelText)}</span></div>`;
  });
  return `<div class="kv-grid">${cells.join('')}</div>`;
}

function scanDetailsHtml(rows: QualityRow[]): string {
  const r = rows[0];
  const timing = TIMING_LABELS[r.timingStatus as TimingStatus] ?? `Timing: ${r.timingStatus || 'n/a'}`;
  const kv: [string, string][] = [
    ['subject', `sub-${r.sub}`],
    ...(r.ses ? ([['session', `ses-${r.ses}`]] as [string, string][]) : []),
    ['task', r.task],
    ...(r.run ? ([['run', `run-${r.run}`]] as [string, string][]) : []),
    ['sampling rate', `${r.samplingFrequency} Hz`],
    ['duration', formatSeconds(r.durationS)],
    ['samples', String(r.numSamples)],
    ['channels', rows.map((x) => x.channel).join(', ')],
  ];
  let html = `<div class="kv-grid">${kv
    .map(([k, v]) => `<div class="kv"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`)
    .join('')}</div>`;
  html += `<div class="badges"><span class="quality-badge timing-${esc(r.timingStatus)}">${esc(timing)}</span>`;
  for (const x of rows) {
    if (!x.sidecarAssessment) continue;
    const cls = x.sidecarAssessment.toLowerCase() === 'pass' ? 'pass' : 'fail';
    const pct = Number.isFinite(x.sidecarPercentValid) ? ` (${(x.sidecarPercentValid * 100).toFixed(0)}%)` : '';
    html += `<span class="quality-badge ${cls}">${esc(`${x.channel}: ${x.sidecarAssessment}${pct}`)}</span>`;
  }
  return html + '</div>';
}

/**
 * One channel's metrics for this scan, each value with its percentile within the
 * same channel across the dataset. Only metrics this scan has a value for, so
 * there are no empty cells from metrics that belong to another channel.
 */
function channelTableHtml(r: QualityRow, group: QualityRow[], keys: MetricKey[]): string {
  let head = '';
  let body = '';
  for (const k of keys) {
    const d = metricDef(k);
    head += `<th${d.description ? ` title="${esc(d.description)}"` : ''}>${esc(d.label)}</th>`;
    const v = r.metrics[k];
    const p = percentileRank(group.map((g) => g.metrics[k]), v);
    const pct = Number.isFinite(p) ? `<span class="pct">${ordinal(p)} pct</span>` : '';
    body += `<td>${esc(formatMetric(v, k))}${pct}</td>`;
  }
  return `<div class="metrics-wrap"><table class="metrics-table"><thead><tr>${head}</tr></thead><tbody><tr>${body}</tr></tbody></table></div>`;
}

export function createIndividualTab(
  els: IndividualTabElements,
  onSelectScan: (scan: ScanKeyLike) => void,
  /** Metrics currently chosen in the Metrics picker */
  getVisible: () => VisibleMetrics,
): IndividualTab {
  /** Waveform charts (redrawn only when the scan changes) */
  let charts: ChartInstance[] = [];
  /** Histograms (also redrawn when the visible metrics change) */
  let histCharts: ChartInstance[] = [];
  let scans: ScanKeyLike[] = [];
  let current: ScanKeyLike | null = null;
  /** What the metrics part was last drawn from, for refreshMetrics */
  let shown: { scanRows: QualityRow[]; all: QualityRow[]; units?: Record<string, string> } | null = null;
  /** Ignores waveform responses for a scan the user has already left */
  let requestId = 0;

  function step(delta: number) {
    if (!current) return;
    const i = scans.findIndex((s) => sameScanKey(s, current!));
    const next = scans[i + delta];
    if (next) onSelectScan(next);
  }

  els.prevBtn.addEventListener('click', () => step(-1));
  els.nextBtn.addEventListener('click', () => step(1));

  /** Per channel: its table for this scan, then where the scan sits in the group's histograms */
  function metricsFor(scanRows: QualityRow[], all: QualityRow[], units?: Record<string, string>) {
    shown = { scanRows, all, units };
    histCharts.forEach((c) => c.destroy());
    histCharts = [];
    els.metrics.innerHTML = '';
    for (const r of scanRows) {
      const group = rowsForChannel(all, r.channel);
      const tableKeys = availableMetrics([r], getVisible());
      const keys = availableMetrics(group, getVisible());
      if (keys.length === 0) continue;
      const section = document.createElement('section');
      section.innerHTML =
        `<h4>${esc(r.channel)}</h4>` +
        (tableKeys.length ? channelTableHtml(r, group, tableKeys) : '') +
        `<div class="muted">Solid dark line: this scan. Dashed grey line: mean of all ${group.length} ${esc(r.channel)} recordings.</div>`;
      const grid = document.createElement('div');
      grid.className = 'hist-grid';
      section.appendChild(grid);
      els.metrics.appendChild(section);

      for (const k of keys as MetricKey[]) {
        // No title: the x-axis label names the metric; its description shows on hover
        const plot = document.createElement('div');
        const description = metricDef(k).description;
        if (description) plot.title = description;
        grid.appendChild(plot);
        const marker = Number.isFinite(r.metrics[k]) ? r.metrics[k] : undefined;
        const chart = drawHistogram({
          container: plot,
          values: group.map((g) => g.metrics[k]),
          marker,
          color: metricColor(k),
          xLabel: metricAxisLabel(k, r.channel, units),
        });
        if (chart) histCharts.push(chart);
      }
    }
    if (!els.metrics.hasChildNodes()) {
      els.metrics.innerHTML = '<div class="muted">No metrics to show for this scan. Check Metrics shown in the sidebar.</div>';
    }
  }

  async function waveformsFor(dataset: string, scan: ScanKeyLike, id: number, units?: Record<string, string>) {
    els.waveforms.innerHTML = '<div class="muted">Loading waveforms…</div>';
    const wf = await fetchWaveforms(dataset, scan);
    if (id !== requestId) return;
    els.waveforms.innerHTML = '';
    if (!wf) {
      els.waveforms.innerHTML = '<div class="muted">No waveform file for this scan. Re-run the quality metrics script.</div>';
      return;
    }
    wf.channels.forEach((ch, i) => {
      const el = document.createElement('div');
      el.className = 'waveform-chart';
      els.waveforms.appendChild(el);
      const chart = drawWaveform({
        container: el,
        channel: ch.channel,
        times: wf.times,
        min: ch.min,
        max: ch.max,
        units: units?.[ch.channel],
        timeLabel: i === wf.channels.length - 1,
        // Fill the graphs column (3/4 of the page beside the sidebar)
        width: el.clientWidth || undefined,
      });
      if (chart) charts.push(chart);
    });
    const note = document.createElement('div');
    note.className = 'muted';
    note.textContent = 'Dashed line: scan onset (t = 0). Each band shows the min and max of the signal per time bin.';
    els.waveforms.appendChild(note);
  }

  return {
    refreshMetrics() {
      // Synchronous redraw: no gap is painted, so the scroll position holds
      if (shown) metricsFor(shown.scanRows, shown.all, shown.units);
    },

    show(dataset, data, scan) {
      const id = ++requestId;
      charts.forEach((c) => c.destroy());
      charts = [];
      shown = null;

      scans = uniqueScans(data.rows);
      current = (scan && scans.find((s) => sameScanKey(s, scan))) ?? scans[0] ?? null;
      const i = current ? scans.findIndex((s) => sameScanKey(s, current!)) : -1;
      els.prevBtn.disabled = i <= 0;
      els.nextBtn.disabled = i === -1 || i >= scans.length - 1;

      if (!current) {
        els.filename.textContent = '';
        els.participant.innerHTML = '';
        els.scanDetails.innerHTML = '';
        els.waveforms.innerHTML = '';
        els.metrics.innerHTML = '<div class="muted">This dataset has no scans with metrics.</div>';
        return null;
      }
      const notice =
        scan && !sameScanKey(current, scan)
          ? `<div class="muted">${esc(scanId(scan))} is not in this dataset; showing the first scan.</div>`
          : '';

      const scanRows = rowsForScan(data.rows, current);
      els.filename.textContent = scanRows[0].filename;
      els.participant.innerHTML = participantHtml(data.summary.participants, current.sub);
      els.scanDetails.innerHTML = notice + scanDetailsHtml(scanRows);
      metricsFor(scanRows, data.rows, data.summary.channelUnits);
      void waveformsFor(dataset, current, id, data.summary.channelUnits);
      return current;
    },
  };
}
