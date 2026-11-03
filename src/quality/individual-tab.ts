import type { ChartInstance } from '@/core';
import { renderDatasetInfo, TIMING_LABELS } from '@/viewer/info';
import type { DatasetInfo, TimingStatus } from '@/data/bids-physio-reader';
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
  scanSelect: HTMLSelectElement;
  prevBtn: HTMLButtonElement;
  nextBtn: HTMLButtonElement;
  filename: HTMLElement;
  datasetInfo: HTMLElement;
  participant: HTMLElement;
  scanDetails: HTMLElement;
  waveforms: HTMLElement;
  metricsTable: HTMLElement;
  histograms: HTMLElement;
}

export interface IndividualTab {
  /** Show one scan of a loaded dataset (first scan when scan is null) */
  show: (dataset: string, data: LoadedDataset, scan: ScanKeyLike | null) => void;
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

/** Channels × metrics, each value with its percentile within the same channel across the dataset */
function metricsTableHtml(scanRows: QualityRow[], all: QualityRow[], visible: VisibleMetrics): string {
  const keys = availableMetrics(scanRows, visible);
  if (keys.length === 0) return '<div class="muted">No metrics to show for this scan. Check the Metrics menu above.</div>';
  let html = '<table class="metrics-table"><thead><tr><th>Channel</th>';
  for (const k of keys) {
    const d = metricDef(k);
    html += `<th${d.description ? ` title="${esc(d.description)}"` : ''}>${esc(d.label)}</th>`;
  }
  html += '</tr></thead><tbody>';
  for (const r of scanRows) {
    const group = rowsForChannel(all, r.channel);
    html += `<tr><td>${esc(r.channel)}</td>`;
    for (const k of keys) {
      const v = r.metrics[k];
      const p = percentileRank(group.map((g) => g.metrics[k]), v);
      const pct = Number.isFinite(p) ? `<span class="pct">${ordinal(p)} pct</span>` : '';
      html += `<td>${esc(formatMetric(v, k))}${pct}</td>`;
    }
    html += '</tr>';
  }
  return html + '</tbody></table>';
}

export function createIndividualTab(
  els: IndividualTabElements,
  onSelectScan: (scan: ScanKeyLike) => void,
  /** Metrics currently chosen in the Metrics picker */
  getVisible: () => VisibleMetrics,
): IndividualTab {
  let charts: ChartInstance[] = [];
  let scans: ScanKeyLike[] = [];
  let current: ScanKeyLike | null = null;
  /** Ignores waveform responses for a scan the user has already left */
  let requestId = 0;


  function step(delta: number) {
    if (!current) return;
    const i = scans.findIndex((s) => sameScanKey(s, current!));
    const next = scans[i + delta];
    if (next) onSelectScan(next);
  }

  els.scanSelect.addEventListener('change', () => {
    const s = scans[Number(els.scanSelect.value)];
    if (s) onSelectScan(s);
  });
  els.prevBtn.addEventListener('click', () => step(-1));
  els.nextBtn.addEventListener('click', () => step(1));

  function histogramsFor(scanRows: QualityRow[], all: QualityRow[], units?: Record<string, string>) {
    els.histograms.innerHTML = '';
    for (const r of scanRows) {
      const group = rowsForChannel(all, r.channel);
      const keys = availableMetrics(group, getVisible());
      if (keys.length === 0) continue;
      const section = document.createElement('section');
      section.innerHTML =
        `<h4>Where this scan's ${esc(r.channel)} sits in the group</h4>` +
        `<div class="muted">Solid dark line: this scan. Dashed grey line: mean of all ${group.length} ${esc(r.channel)} recordings.</div>`;
      const grid = document.createElement('div');
      grid.className = 'hist-grid';
      section.appendChild(grid);
      els.histograms.appendChild(section);

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
        if (chart) charts.push(chart);
      }
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
      });
      if (chart) charts.push(chart);
    });
    const note = document.createElement('div');
    note.className = 'muted';
    note.textContent = 'Dashed line: scan onset (t = 0). Each band shows the min and max of the signal per time bin.';
    els.waveforms.appendChild(note);
  }

  return {
    show(dataset, data, scan) {
      const id = ++requestId;
      charts.forEach((c) => c.destroy());
      charts = [];

      scans = uniqueScans(data.rows);
      current = (scan && scans.find((s) => sameScanKey(s, scan))) ?? scans[0] ?? null;
      els.scanSelect.innerHTML = scans
        .map((s, i) => `<option value="${i}"${current && sameScanKey(s, current) ? ' selected' : ''}>${esc(scanId(s))}</option>`)
        .join('');
      const i = current ? scans.findIndex((s) => sameScanKey(s, current!)) : -1;
      els.prevBtn.disabled = i <= 0;
      els.nextBtn.disabled = i === -1 || i >= scans.length - 1;

      renderDatasetInfo(els.datasetInfo, data.summary.info as DatasetInfo);
      if (!els.datasetInfo.hasChildNodes()) els.datasetInfo.textContent = data.summary.dataset;

      if (!current) {
        els.filename.textContent = '';
        els.participant.innerHTML = '';
        els.scanDetails.innerHTML = '';
        els.waveforms.innerHTML = '';
        els.metricsTable.innerHTML = '<div class="muted">This dataset has no scans with metrics.</div>';
        els.histograms.innerHTML = '';
        return;
      }
      const notice =
        scan && !sameScanKey(current, scan)
          ? `<div class="muted">${esc(scanId(scan))} is not in this dataset; showing the first scan.</div>`
          : '';

      const scanRows = rowsForScan(data.rows, current);
      els.filename.textContent = scanRows[0].filename;
      els.participant.innerHTML = participantHtml(data.summary.participants, current.sub);
      els.scanDetails.innerHTML = notice + scanDetailsHtml(scanRows);
      els.metricsTable.innerHTML = metricsTableHtml(scanRows, data.rows, getVisible());
      histogramsFor(scanRows, data.rows, data.summary.channelUnits);
      void waveformsFor(dataset, current, id, data.summary.channelUnits);
    },
  };
}
