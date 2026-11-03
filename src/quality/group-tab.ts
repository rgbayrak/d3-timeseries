import type { ChartInstance } from '@/core';
import type { ScanKeyLike, QualityRow } from './metrics-tsv';
import type { LoadedDataset } from './data';
import { drawScatter, drawHistogram, metricColor, PALETTE } from './charts';
import {
  colorByOptions,
  boldFacts,
  availableMetrics,
  axisText,
  colorGroups,
  colorKey,
  datasetSummaryText,
  defaultChannel,
  defaultMetricPair,
  esc,
  metricAxisChoices,
  metricDef,
  metricAxisLabel,
  participantAxisChoices,
  rowsForChannel,
  scatterData,
  summaryTable,
  xAxisChoices,
  yAxisChoices,
} from './model';
import type { AxisChoice, ColorBy, VisibleMetrics } from './model';

export interface GroupTabElements {
  summary: HTMLElement;
  channelSelect: HTMLSelectElement;
  xSelect: HTMLSelectElement;
  ySelect: HTMLSelectElement;
  colorSelect: HTMLSelectElement;
  scatter: HTMLElement;
  legend: HTMLElement;
  note: HTMLElement;
  histTitle: HTMLElement;
  histograms: HTMLElement;
}

/** The user's current plot settings (the PDF report reuses them) */
export interface GroupSelection {
  channel: string;
  /** Metric key or participant column (PARTICIPANT_PREFIX + name) */
  xValue: string;
  /** Metric key */
  yValue: string;
  colorBy: ColorBy;
}

export interface GroupTab {
  show: (data: LoadedDataset) => void;
  selection: () => GroupSelection;
  /** Metrics picker changed: rebuild the axis menus and redraw */
  setVisibleMetrics: (visible: VisibleMetrics) => void;
}

const NOTHING_TO_SHOW = 'No metrics to show for this channel. Check Metrics shown in the sidebar.';

function scanLabel(r: ScanKeyLike): string {
  return [`sub-${r.sub}`, r.ses && `ses-${r.ses}`, `task-${r.task}`, r.run && `run-${r.run}`].filter(Boolean).join(' ');
}

const option = (value: string, label: string, selected: string) =>
  `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`;

function fillSelect(select: HTMLSelectElement, options: { value: string; label: string }[], selected: string) {
  select.innerHTML = options.map((o) => option(o.value, o.label, selected)).join('');
}

function summaryHtml(data: LoadedDataset): string {
  const s = data.summary;
  let html = `<p class="summary-text">${boldFacts(esc(datasetSummaryText(s, data.rows)))}</p>`;
  const table = summaryTable(data.rows, s.channels);
  if (table) {
    html += `<div class="summary-wrap"><table class="summary-table"><thead><tr>${table.header.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>`;
    for (const r of table.rows) html += `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`;
    html += '</tbody></table></div>';
  }
  if (s.failedScans.length > 0) {
    html += `<details class="failed-scans"><summary>${s.failedScans.length} scans could not be computed</summary><ul>`;
    html += s.failedScans.map((f) => `<li><code>${esc(f.scan)}</code>: ${esc(f.reason)}</li>`).join('');
    html += '</ul></details>';
  }
  return html;
}

/** One small histogram per visible metric with values, for one channel's rows */
function histogramGrid(
  container: HTMLElement,
  rows: QualityRow[],
  charts: ChartInstance[],
  visible: VisibleMetrics,
  units?: Record<string, string>,
) {
  const channel = rows[0]?.channel ?? '';
  container.innerHTML = '';
  for (const key of availableMetrics(rows, visible)) {
    // No title: the x-axis label names the metric; its description shows on hover
    const plot = document.createElement('div');
    const description = metricDef(key).description;
    if (description) plot.title = description;
    container.appendChild(plot);
    const values = rows.map((r) => r.metrics[key]);
    const chart = drawHistogram({
      container: plot,
      values,
      color: metricColor(key),
      xLabel: metricAxisLabel(key, channel, units),
    });
    if (chart) charts.push(chart);
  }
  if (!container.hasChildNodes()) container.textContent = NOTHING_TO_SHOW;
}

export function createGroupTab(
  els: GroupTabElements,
  onOpenScan: (scan: ScanKeyLike) => void,
  initialVisible: VisibleMetrics,
): GroupTab {
  let visible = initialVisible;
  let data: LoadedDataset | null = null;
  let channel = '';
  let xValue = 'snr';
  let yValue = 'beatCorrelation';
  /** Set from the dataset's choices in show() */
  let colorBy: ColorBy = 'task';
  let charts: ChartInstance[] = [];
  let xChoices: AxisChoice[] = [];
  let yChoices: AxisChoice[] = [];

  function renderPlots() {
    if (!data) return;
    charts.forEach((c) => c.destroy());
    charts = [];
    const rows = rowsForChannel(data.rows, channel);
    const table = data.summary.participants;
    const xChoice = xChoices.find((c) => c.value === xValue);
    const yChoice = yChoices.find((c) => c.value === yValue);

    els.scatter.innerHTML = '';
    els.legend.innerHTML = '';
    if (!xChoice || !yChoice) {
      els.scatter.innerHTML = `<div class="empty">${NOTHING_TO_SHOW}</div>`;
      els.note.textContent = '';
    } else {
      // Colours come from the whole dataset, so a category keeps its colour across channels
      const allGroups = colorGroups(data.rows, colorBy);
      const colorOf = (g: string) => PALETTE[allGroups.indexOf(g) % PALETTE.length];
      const groups = colorGroups(rows, colorBy);
      const points = scatterData(rows, xChoice, yChoice, table).map((d) => ({
        x: d.x,
        y: d.y,
        color: colorOf(colorKey(d.row, colorBy)),
        datum: d.row,
      }));
      if (points.length === 0) {
        els.scatter.innerHTML = '<div class="empty">No scans have values on both axes for this channel.</div>';
      } else {
        charts.push(
          drawScatter({
            container: els.scatter,
            points,
            xLabel: xChoice.label,
            yLabel: yChoice.label,
            xCategories: xChoice.categories,
            tooltip: (p) =>
              `<div><strong>${esc(scanLabel(p.datum))}</strong></div>` +
              `<div>${esc(p.datum.channel)} · ${esc(colorKey(p.datum, colorBy))}</div>` +
              `<div>${esc(xChoice.label)}: ${esc(axisText(p.datum, xChoice, table))}</div>` +
              `<div>${esc(yChoice.label)}: ${esc(axisText(p.datum, yChoice, table))}</div>` +
              '<div style="opacity:.7">double-click to open</div>',
            onDoubleClick: (p) => onOpenScan(p.datum),
          }),
        );
      }
      els.legend.innerHTML = groups
        .map((g) => `<span class="legend-item"><span class="swatch" style="background:${colorOf(g)}"></span>${esc(g)}</span>`)
        .join('');
      const hidden = rows.length - points.length;
      els.note.textContent =
        `${points.length} of ${rows.length} scans plotted` +
        (hidden > 0 ? ` (${hidden} without a value on one of the axes).` : '.');
    }

    els.histTitle.textContent = `How each ${channel} metric is distributed`;
    histogramGrid(els.histograms, rows, charts, visible, data.summary.channelUnits);
  }

  /** Rebuild the X/Y option lists for the channel, keeping the current choices when still valid */
  function refreshAxisSelects() {
    if (!data) return;
    const rows = rowsForChannel(data.rows, channel);
    const units = data.summary.channelUnits;
    const metrics = metricAxisChoices(rows, visible, units);
    const participantChoices = participantAxisChoices(data.summary.participants, data.rows);
    xChoices = xAxisChoices(rows, data.summary.participants, data.rows, visible, units);
    yChoices = yAxisChoices(rows, visible, units);

    const [defX, defY] = defaultMetricPair(rows, visible);
    if (!xChoices.some((c) => c.value === xValue)) xValue = defX;
    if (!yChoices.some((c) => c.value === yValue)) yValue = defY;

    const group = (label: string, choices: AxisChoice[], selected: string) =>
      choices.length ? `<optgroup label="${esc(label)}">${choices.map((c) => option(c.value, c.label, selected)).join('')}</optgroup>` : '';
    els.xSelect.innerHTML =
      group('Quality metrics', metrics, xValue) + group('Participant (participants.tsv)', participantChoices, xValue);
    fillSelect(els.ySelect, yChoices, yValue);
  }

  els.channelSelect.addEventListener('change', () => {
    channel = els.channelSelect.value;
    refreshAxisSelects();
    renderPlots();
  });
  els.xSelect.addEventListener('change', () => {
    xValue = els.xSelect.value;
    renderPlots();
  });
  els.ySelect.addEventListener('change', () => {
    yValue = els.ySelect.value;
    renderPlots();
  });
  els.colorSelect.addEventListener('change', () => {
    colorBy = els.colorSelect.value as ColorBy;
    renderPlots();
  });

  return {
    show(next) {
      data = next;
      els.summary.innerHTML = summaryHtml(next);

      const channels = next.summary.channels;
      if (!channels.includes(channel)) channel = defaultChannel(channels);
      fillSelect(els.channelSelect, channels.map((c) => ({ value: c, label: c })), channel);
      // Only choices this dataset has (no Session without sessions, no Task with one task);
      // with none at all, hide the menu and draw every point in one colour
      const colorChoices = colorByOptions(next.rows);
      if (!colorChoices.some((o) => o.key === colorBy)) colorBy = colorChoices[0]?.key ?? 'none';
      fillSelect(els.colorSelect, colorChoices.map((o) => ({ value: o.key, label: o.label })), colorBy);
      const colorLabel = els.colorSelect.closest('label');
      if (colorLabel) colorLabel.style.display = colorChoices.length ? '' : 'none';
      refreshAxisSelects();
      renderPlots();
    },

    selection: () => ({ channel, xValue, yValue, colorBy }),

    setVisibleMetrics(next) {
      visible = next;
      refreshAxisSelects();
      renderPlots();
    },
  };
}
