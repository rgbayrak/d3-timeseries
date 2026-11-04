import type { ChartInstance } from '@/core';
import type { ScanKeyLike } from './metrics-tsv';
import { sameScanKey } from './metrics-tsv';
import type { LoadedDataset } from './data';
import { drawScatter, HIGHLIGHT_COLOR, PALETTE } from './charts';
import {
  axisText,
  channelName,
  colorByLabel,
  colorByOptions,
  colorGroups,
  colorKey,
  defaultMetricPair,
  esc,
  metricAxisChoices,
  participantAxisChoices,
  rowsForChannel,
  scatterData,
  xAxisChoices,
  yAxisChoices,
} from './model';
import type { AxisChoice, ColorBy } from './model';

// Scatter plot of two quality metrics across every recording of one channel,
// shown at the bottom of Explore and Annotate. The channel is the one chosen in
// the page's Channel dropdown (setChannel); X can also be a participant
// variable from participants.tsv. Receives its elements and the loaded
// dataset; double-clicking a point calls onOpenScan.

export interface ScatterElements {
  xSelect: HTMLSelectElement;
  ySelect: HTMLSelectElement;
  colorSelect: HTMLSelectElement;
  chart: HTMLElement;
  legend: HTMLElement;
  note: HTMLElement;
}

export interface ScatterPanel {
  show: (data: LoadedDataset) => void;
  /** The scan open in Explore and Annotate: its point is drawn larger and pinkish red */
  setCurrentScan: (scan: ScanKeyLike | null) => void;
  /** The channel chosen in Explore and Annotate's Channel dropdown */
  setChannel: (channel: string) => void;
}

function scanLabel(r: ScanKeyLike): string {
  return [`sub-${r.sub}`, r.ses && `ses-${r.ses}`, `task-${r.task}`, r.run && `run-${r.run}`].filter(Boolean).join(' ');
}

/**
 * Colour legend HTML: the Colour by name, then a swatch per group, then the
 * viewed scan's swatch set apart, e.g. "Session: ● 01 ● 02 · ● Now viewing".
 * `title` null: one colour for every point, so no groups are listed.
 */
export function legendHtml(
  title: string | null,
  groups: { label: string; color: string }[],
  showViewed: boolean,
): string {
  const swatch = (color: string, label: string) =>
    `<span class="legend-item"><span class="swatch" style="background:${color}"></span>${esc(label)}</span>`;
  const groupPart =
    title && groups.length > 0
      ? `<span class="legend-group"><span class="legend-title">${esc(title)}:</span>${groups.map((g) => swatch(g.color, g.label)).join('')}</span>`
      : '';
  const viewed = showViewed ? `<span class="legend-group legend-viewed">${swatch(HIGHLIGHT_COLOR, 'Now viewing')}</span>` : '';
  return groupPart + viewed;
}

const option = (value: string, label: string, selected: string) =>
  `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`;

function fillSelect(select: HTMLSelectElement, options: { value: string; label: string }[], selected: string) {
  select.innerHTML = options.map((o) => option(o.value, o.label, selected)).join('');
}

export function createScatterPanel(els: ScatterElements, onOpenScan: (scan: ScanKeyLike) => void): ScatterPanel {
  let data: LoadedDataset | null = null;
  let channel = '';
  let xValue = 'snr';
  let yValue = 'beatCorrelation';
  /** Set from the dataset's choices in show() */
  let colorBy: ColorBy = 'task';
  let chart: ChartInstance | null = null;
  let xChoices: AxisChoice[] = [];
  let yChoices: AxisChoice[] = [];
  let current: ScanKeyLike | null = null;

  /**
   * Redraw without moving the page. The plot sits at the bottom of Explore and
   * Annotate: while it is rebuilt the page is briefly shorter (drawing measures
   * the container, which lays the page out), and the browser would pull the
   * scroll position up. Hold the plot's height, then put the scroll back.
   */
  function render() {
    if (!data) return;
    const y = window.scrollY;
    els.chart.style.minHeight = `${els.chart.offsetHeight}px`;
    try {
      draw();
    } finally {
      els.chart.style.minHeight = '';
      window.scrollTo(0, y);
    }
  }

  function draw() {
    if (!data) return;
    chart?.destroy();
    chart = null;
    const rows = rowsForChannel(data.rows, channel);
    const table = data.summary.participants;
    const xChoice = xChoices.find((c) => c.value === xValue);
    const yChoice = yChoices.find((c) => c.value === yValue);

    els.chart.innerHTML = '';
    els.legend.innerHTML = '';
    if (!data.summary.channels.includes(channel)) {
      // e.g. trigger, or a column the metrics script skipped
      els.chart.innerHTML = `<div class="empty">No quality metrics for ${channel ? channelName(channel) : 'this channel'}. Choose a physiological channel in the Channel dropdown above.</div>`;
      els.note.textContent = '';
      return;
    }
    if (!xChoice || !yChoice) {
      els.chart.innerHTML = '<div class="empty">This channel has no metric values to plot.</div>';
      els.note.textContent = '';
      return;
    }
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
      els.chart.innerHTML = '<div class="empty">No scans have values on both axes for this channel.</div>';
    } else {
      chart = drawScatter({
        container: els.chart,
        points,
        xLabel: xChoice.label,
        yLabel: yChoice.label,
        xCategories: xChoice.categories,
        tooltip: (p) =>
          `<div><strong>${esc(scanLabel(p.datum))}</strong></div>` +
          `<div>${channelName(p.datum.channel)} · ${esc(colorKey(p.datum, colorBy))}</div>` +
          `<div>${esc(xChoice.label)}: ${esc(axisText(p.datum, xChoice, table))}</div>` +
          `<div>${esc(yChoice.label)}: ${esc(axisText(p.datum, yChoice, table))}</div>` +
          '<div style="opacity:.7">double-click to open in Stats</div>',
        onDoubleClick: (p) => onOpenScan(p.datum),
        highlight: (p) => current !== null && sameScanKey(p.datum, current),
      });
    }
    // Legend says what the colours are: "Session: ● 01 ● 02", then the viewed scan apart
    els.legend.innerHTML = legendHtml(
      colorBy === 'none' ? null : colorByLabel(colorBy),
      groups.map((g) => ({ label: g, color: colorOf(g) })),
      current !== null && points.some((p) => sameScanKey(p.datum, current!)),
    );
    const hidden = rows.length - points.length;
    els.note.textContent =
      `${points.length} of ${rows.length} scans plotted` +
      (hidden > 0 ? ` (${hidden} without a value on one of the axes).` : '.');
  }

  /**
   * Rebuild the X/Y option lists for the channel, keeping the current choices
   * when still valid. Every metric in quality_metrics.tsv with values for this
   * channel is offered.
   */
  function refreshAxisSelects() {
    if (!data) return;
    const rows = rowsForChannel(data.rows, channel);
    const units = data.summary.channelUnits;
    const metrics = metricAxisChoices(rows, units);
    const participantChoices = participantAxisChoices(data.summary.participants, data.rows);
    xChoices = xAxisChoices(rows, data.summary.participants, data.rows, units);
    yChoices = yAxisChoices(rows, units);

    const [defX, defY] = defaultMetricPair(rows);
    if (!xChoices.some((c) => c.value === xValue)) xValue = defX;
    if (!yChoices.some((c) => c.value === yValue)) yValue = defY;

    const group = (label: string, choices: AxisChoice[], selected: string) =>
      choices.length ? `<optgroup label="${esc(label)}">${choices.map((c) => option(c.value, c.label, selected)).join('')}</optgroup>` : '';
    els.xSelect.innerHTML =
      group('Quality metrics', metrics, xValue) + group('Participant (participants.tsv)', participantChoices, xValue);
    fillSelect(els.ySelect, yChoices, yValue);
  }

  els.xSelect.addEventListener('change', () => {
    xValue = els.xSelect.value;
    render();
  });
  els.ySelect.addEventListener('change', () => {
    yValue = els.ySelect.value;
    render();
  });
  els.colorSelect.addEventListener('change', () => {
    colorBy = els.colorSelect.value as ColorBy;
    render();
  });

  return {
    show(next) {
      data = next;
      // Only choices this dataset has (no Session without sessions, no Task with one task);
      // with none at all, hide the menu and draw every point in one colour
      const colorChoices = colorByOptions(next.rows);
      if (!colorChoices.some((o) => o.key === colorBy)) colorBy = colorChoices[0]?.key ?? 'none';
      fillSelect(els.colorSelect, colorChoices.map((o) => ({ value: o.key, label: o.label })), colorBy);
      const colorLabel = els.colorSelect.closest('label');
      if (colorLabel) colorLabel.style.display = colorChoices.length ? '' : 'none';
      refreshAxisSelects();
      render();
    },

    setCurrentScan(scan) {
      if (current && scan && sameScanKey(current, scan)) return;
      current = scan;
      render();
    },

    setChannel(next) {
      if (next === channel) return;
      channel = next;
      refreshAxisSelects();
      render();
    },
  };
}
