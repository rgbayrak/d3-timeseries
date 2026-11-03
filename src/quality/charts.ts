import { area } from 'd3-shape';
import type { ScaleLinear } from 'd3-scale';
import { createChart } from '@/core';
import type { ChartInstance } from '@/core';
import { drawOnsetMarker } from '@/viewer/charts/shared';
import { histogramBins, finiteMean, paddedExtent } from './stats';
import { metricDef } from './model';
import type { MetricKey } from './metrics-tsv';

// Chart builders for the quality page, all on top of createChart().

type Linear = ScaleLinear<number, number>;

/**
 * Stats tabs theme (mirrors the CSS custom properties in quality.html).
 * Roles on the histograms: dark ink = this scan, dashed grey = group mean.
 */
export const THEME = {
  violet: '#7b4fd0',
  blue: '#4a6cd4',
  ink: '#231f3d',
  axis: '#9a95b5',
  grid: '#e6e2f3',
};

/**
 * One coordinated family for everything on the Stats pages: six medium-strength
 * hues (blue, teal, sky, gold, orange, magenta).
 * Rule: any new colour on these pages comes from this family (or THEME), not a
 * new hue. Only the pass/fail and timing badges keep their own green/amber/red,
 * because those colours mean pass and fail. Tables are never coloured: they
 * stay neutral grey (quality.html and the PDF table in report.ts).
 */
const FAMILY = {
  blue: '#466eb4',
  teal: '#41afaa',
  orange: '#d7642c',
  magenta: '#af4b91',
  sky: '#00a0e1',
  gold: '#e6a532',
};

/**
 * One colour per metric group (Basic, Distribution, PaPaGei, PhysioQC), used
 * wherever a metric appears: histogram bars and the Metrics menu dots. These
 * are the page's lead colours: the scatter palette is built from them.
 */
export const METRIC_GROUP_COLORS: Record<string, string> = {
  Basic: FAMILY.blue,
  Distribution: FAMILY.sky,
  PaPaGei: FAMILY.gold,
  PhysioQC: FAMILY.orange,
};

/**
 * Categorical palette for scatter colouring, determined by the four
 * metric-group colours, then the FAMILY colours they don't use (sky, gold) for
 * datasets with more categories. Assigned in this fixed order to sorted
 * category names; more than 6 categories wrap around. Dots get a white ring so
 * overlapping points stay separate.
 */
const GROUP_PALETTE = [
  METRIC_GROUP_COLORS.Basic,
  METRIC_GROUP_COLORS.PaPaGei,
  METRIC_GROUP_COLORS.Distribution,
  METRIC_GROUP_COLORS.PhysioQC,
];
export const PALETTE = [...GROUP_PALETTE, ...Object.values(FAMILY).filter((c) => !GROUP_PALETTE.includes(c))];

/** This scan's marker on the group histograms: dark ink (with a white halo), clear against every metric colour */
const SUBJECT_COLOR = THEME.ink;
/** Group-mean line on the histograms: dashed grey */
const MEAN_COLOR = '#6b6880';
/** Group distributions without a metric (waveform bands) */
const GROUP_COLOR = FAMILY.blue;

/** Histogram bar fill opacity: 0.7 = 30% transparent */
const HISTOGRAM_BAR_OPACITY = 0.7;

/** White ring around scatter dots so overlapping points stay separate */
const DOT_RING = '#fff';

/** Colour of a metric, from its group */
export function metricColor(key: MetricKey): string {
  return METRIC_GROUP_COLORS[metricDef(key).group] ?? GROUP_COLOR;
}

/** Give a fixed-size chart a viewBox so it scales down cleanly (narrow screens, print) */
function scaleToFit(chart: ChartInstance): void {
  const d = chart.getDimensions();
  chart.getLayers().svg.attr('viewBox', `0 0 ${d.outerWidth} ${d.outerHeight}`);
}

const shortNumber = (d: unknown) => {
  const v = Number(d);
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(1);
  return String(Number(v.toPrecision(4)));
};

// ── Scatter ──────────────────────────────────────────────

export interface ScatterPoint<T> {
  x: number;
  y: number;
  color: string;
  datum: T;
}

export interface ScatterOptions<T> {
  container: HTMLElement;
  points: ScatterPoint<T>[];
  xLabel: string;
  yLabel: string;
  tooltip?: (p: ScatterPoint<T>) => string;
  onDoubleClick?: (p: ScatterPoint<T>) => void;
  /**
   * Category names for a categorical X axis; point x values are then
   * category index (+ jitter), and each category gets one labelled column.
   */
  xCategories?: string[] | null;
  /** Fixed size (used for off-screen rendering); default fills the container */
  width?: number;
  height?: number;
}

/** Interactive scatter: hover for details, double-click a point to open it */
export function drawScatter<T>(opts: ScatterOptions<T>): ChartInstance {
  const cats = opts.xCategories ?? null;
  const xDom: [number, number] = cats
    ? [-0.5, cats.length - 0.5]
    : paddedExtent(opts.points.map((p) => p.x)) ?? [0, 1];
  const yDom = paddedExtent(opts.points.map((p) => p.y)) ?? [0, 1];
  const fixed = opts.width !== undefined;
  const chart = createChart({
    container: opts.container,
    width: opts.width ?? (opts.container.clientWidth || 960),
    height: opts.height ?? 420,
    margin: { top: 12, right: 20, bottom: 48, left: 70 },
    xScale: { type: 'linear', domain: xDom, nice: !cats },
    yScale: { type: 'linear', domain: yDom, nice: true },
    xAxis: cats
      ? {
          position: 'bottom',
          label: opts.xLabel,
          tickCount: cats.length,
          tickFormat: (d) => (Number.isInteger(Number(d)) ? cats[Number(d)] ?? '' : ''),
        }
      : { position: 'bottom', label: opts.xLabel, tickFormat: shortNumber },
    yAxis: { position: 'left', label: opts.yLabel, tickFormat: shortNumber },
    grid: { x: { strokeColor: THEME.grid, opacity: 1 }, y: { strokeColor: THEME.grid, opacity: 1 } },
    tooltip: { enabled: !!opts.tooltip },
    resize: { enabled: !fixed, debounceMs: 100 },
  });
  if (fixed) scaleToFit(chart);

  const layers = chart.getLayers();
  // Points go in the overlay so they sit above the grid and get pointer events
  const dots = layers.overlay
    .selectAll<SVGCircleElement, ScatterPoint<T>>('circle')
    .data(opts.points)
    .join('circle')
    .attr('r', 4.5)
    .attr('fill', (p) => p.color)
    .attr('fill-opacity', 0.9)
    .attr('stroke', DOT_RING)
    .attr('stroke-width', 1.5)
    .attr('cursor', 'pointer');

  const place = () => {
    const { x, y } = chart.getScales() as { x: Linear; y: Linear };
    dots.attr('cx', (p) => x(p.x)).attr('cy', (p) => y(p.y));
  };
  place();
  chart.on('resize', place);

  const { tooltip, onDoubleClick } = opts;
  if (!tooltip || !onDoubleClick) {
    dots.attr('cursor', null);
    return chart;
  }
  dots
    .on('mouseenter', function (event: MouseEvent, p) {
      (this as SVGCircleElement).setAttribute('r', '7');
      (this as SVGCircleElement).setAttribute('stroke', THEME.ink);
      chart.getTooltip()?.show(tooltip(p), event.pageX, event.pageY);
    })
    .on('mousemove', (event: MouseEvent) => chart.getTooltip()?.move(event.pageX, event.pageY))
    .on('mouseleave', function () {
      (this as SVGCircleElement).setAttribute('r', '4.5');
      (this as SVGCircleElement).setAttribute('stroke', DOT_RING);
      chart.getTooltip()?.hide();
    })
    .on('dblclick', (event: MouseEvent, p) => {
      event.preventDefault();
      chart.getTooltip()?.hide();
      onDoubleClick(p);
    });

  return chart;
}

// ── Histogram ────────────────────────────────────────────

export interface HistogramOptions {
  container: HTMLElement;
  /** Group values (non-finite ones are ignored) */
  values: number[];
  /** One value to mark, e.g. the selected scan */
  marker?: number;
  /** Bar colour; normally metricColor(key) */
  color?: string;
  /** X-axis label: the metric name with its unit when known, e.g. "Mean (mV)" */
  xLabel?: string | null;
  width?: number;
  height?: number;
  bins?: number;
}

/**
 * Group distribution with a dashed line at the group mean and, if given, a
 * solid dark line (SUBJECT_COLOR) at the marker value. Returns null when there is nothing to plot.
 */
export function drawHistogram(opts: HistogramOptions): ChartInstance | null {
  const bins = histogramBins(opts.values, opts.bins ?? 20, opts.marker);
  if (bins.length === 0) {
    opts.container.textContent = 'No values';
    opts.container.classList.add('hist-empty');
    return null;
  }
  const maxCount = Math.max(1, ...bins.map((b) => b.count));
  const chart = createChart({
    container: opts.container,
    width: opts.width ?? 300,
    height: (opts.height ?? 150) + (opts.xLabel ? 12 : 0),
    margin: { top: 8, right: 12, bottom: opts.xLabel ? 38 : 26, left: 34 },
    xScale: { type: 'linear', domain: [bins[0].x0, bins[bins.length - 1].x1] },
    yScale: { type: 'linear', domain: [0, maxCount], nice: true },
    xAxis: { position: 'bottom', tickCount: 4, tickFormat: shortNumber, label: opts.xLabel ?? undefined },
    yAxis: { position: 'left', tickCount: 3, tickFormat: (d) => String(d) },
    tooltip: { enabled: true },
    resize: { enabled: false },
  });
  scaleToFit(chart);

  const { x, y } = chart.getScales() as { x: Linear; y: Linear };
  const content = chart.getLayers().content;
  const h = chart.getDimensions().innerHeight;

  content
    .selectAll('rect')
    .data(bins)
    .join('rect')
    .attr('x', (b) => x(b.x0) + 1)
    .attr('width', (b) => Math.max(0, x(b.x1) - x(b.x0) - 2)) // 2px gap between bars
    .attr('y', (b) => y(b.count))
    .attr('height', (b) => h - y(b.count))
    .attr('rx', 1.5)
    .attr('fill', opts.color ?? GROUP_COLOR)
    .attr('fill-opacity', HISTOGRAM_BAR_OPACITY)
    .on('mouseenter', (event: MouseEvent, b) =>
      chart.getTooltip()?.show(`${shortNumber(b.x0)} – ${shortNumber(b.x1)}: ${b.count}`, event.pageX, event.pageY),
    )
    .on('mouseleave', () => chart.getTooltip()?.hide());

  // Each line gets a white halo underneath so it stays visible on dark and light bars
  const vline = (v: number, color: string, dash: string | null, width: number) => {
    for (const [stroke, w, d] of [
      ['#fff', width + 2, null],
      [color, width, dash],
    ] as const) {
      content
        .append('line')
        .attr('x1', x(v))
        .attr('x2', x(v))
        .attr('y1', 0)
        .attr('y2', h)
        .attr('stroke', stroke)
        .attr('stroke-width', w)
        .attr('stroke-dasharray', d)
        .attr('pointer-events', 'none');
    }
  };

  const m = finiteMean(opts.values);
  if (Number.isFinite(m)) vline(m, MEAN_COLOR, '4 3', 1.4);
  if (opts.marker !== undefined && Number.isFinite(opts.marker)) vline(opts.marker, SUBJECT_COLOR, null, 2.5);

  return chart;
}

// ── Static waveform ──────────────────────────────────────

export interface WaveformOptions {
  container: HTMLElement;
  channel: string;
  times: number[];
  min: (number | null)[];
  max: (number | null)[];
  /** Signal unit from the physio sidecar, shown with the channel name */
  units?: string | null;
  /** Label the time axis (the bottom chart of a stack) */
  timeLabel?: boolean;
  width?: number;
  height?: number;
}

const TIME_AXIS_LABEL = 'Time from scan onset (s)';

/** Static min/max envelope of one channel over the whole recording, with the scan-onset marker */
export function drawWaveform(opts: WaveformOptions): ChartInstance | null {
  const { times } = opts;
  if (times.length === 0) return null;
  const yDom =
    paddedExtent([...opts.min, ...opts.max].filter((v): v is number => v != null), 0.05) ?? [0, 1];
  const extra = opts.timeLabel ? 14 : 0;
  const chart = createChart({
    container: opts.container,
    width: opts.width ?? 960,
    height: (opts.height ?? 120) + extra,
    margin: { top: 8, right: 20, bottom: 26 + extra, left: 60 },
    xScale: { type: 'linear', domain: [times[0], times[times.length - 1]] },
    yScale: { type: 'linear', domain: yDom },
    xAxis: { position: 'bottom', tickCount: 8, label: opts.timeLabel ? TIME_AXIS_LABEL : undefined },
    yAxis: {
      position: 'left',
      tickCount: 3,
      label: opts.units ? `${opts.channel} (${opts.units})` : opts.channel,
      tickFormat: shortNumber,
    },
    grid: { x: { strokeColor: THEME.grid, opacity: 1 } },
    tooltip: { enabled: false },
    resize: { enabled: false },
  });
  scaleToFit(chart);

  const { x, y } = chart.getScales() as { x: Linear; y: Linear };
  const idx = times.map((_, i) => i);
  const band = area<number>()
    .defined((i) => opts.min[i] != null && opts.max[i] != null)
    .x((i) => x(times[i]))
    .y0((i) => y(opts.min[i] as number))
    .y1((i) => y(opts.max[i] as number));

  const content = chart.getLayers().content;
  content
    .append('path')
    .datum(idx)
    .attr('d', band)
    .attr('fill', GROUP_COLOR)
    .attr('fill-opacity', 0.85)
    .attr('stroke', GROUP_COLOR)
    .attr('stroke-width', 0.6);
  drawOnsetMarker(chart, content.append('g'), false);
  return chart;
}
