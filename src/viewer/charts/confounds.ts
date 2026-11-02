import { createChart } from '@/core';
import { toConfoundPoints, getViewExtent } from '@/data/bids-physio-reader';
import type { PhysioRaw, ConfoundsRaw, DataPoint } from '@/data/bids-physio-reader';
import {
  CHART_WIDTH,
  CHART_MARGIN_X,
  xScaleOf,
  yScaleOf,
  drawLine,
  drawOnsetMarker,
  appendOverlayRect,
  attachHover,
} from './shared';
import type { GroupSelection, PathSelection } from './shared';

/** Axis label and tooltip unit for each confound column */
export const CONFOUND_UNITS: Record<string, { label: string; unit: string }> = {
  framewise_displacement: { label: 'FD (mm)', unit: 'mm' },
  rmsd: { label: 'RMSD (mm)', unit: 'mm' },
  dvars: { label: 'DVARS', unit: '' },
  std_dvars: { label: 'Std DVARS', unit: '' },
  trans_x: { label: 'trans_x (mm)', unit: 'mm' },
  trans_y: { label: 'trans_y (mm)', unit: 'mm' },
  trans_z: { label: 'trans_z (mm)', unit: 'mm' },
  rot_x: { label: 'rot_x (rad)', unit: 'rad' },
  rot_y: { label: 'rot_y (rad)', unit: 'rad' },
  rot_z: { label: 'rot_z (rad)', unit: 'rad' },
};

/** FD reference lines (mm): upper bounds of the "good" and "acceptable" motion ranges */
export const FD_GOOD_MM = 0.2;
export const FD_ACCEPTABLE_MM = 0.5;

/** Line color for a confound value; only FD is colored by motion severity */
export function confoundColor(isFD: boolean, v: number): string {
  if (!isFD) return '#3b6ea5';
  if (v <= FD_GOOD_MM) return '#66c2a5'; // green: good
  if (v <= FD_ACCEPTABLE_MM) return '#fdae61'; // amber: acceptable
  return '#d73027'; // red: excessive
}

/**
 * Split a line into runs of the same color. Consecutive runs share their
 * boundary points so the drawn line stays continuous.
 */
export function splitByColor(
  points: DataPoint[],
  colorFor: (v: number) => string,
): { data: DataPoint[]; color: string }[] {
  const segments: { data: DataPoint[]; color: string }[] = [];
  let current: DataPoint[] = [];
  let currentColor = '';

  for (let i = 0; i < points.length; i++) {
    const color = colorFor(points[i].value);
    if (color !== currentColor) {
      if (current.length > 0) {
        if (i > 0) current.push(points[i]);
        segments.push({ data: [...current], color: currentColor });
      }
      current = i > 0 ? [points[i - 1], points[i]] : [points[i]];
      currentColor = color;
    } else {
      current.push(points[i]);
    }
  }
  if (current.length > 0) segments.push({ data: current, color: currentColor });
  return segments;
}

/**
 * Y domain for a confound. FD is non-negative and anchored at 0 with 10%
 * headroom; signed confounds (e.g. translations) are padded 10% at both ends.
 */
export function confoundYDomain(points: DataPoint[], isFD: boolean): [number, number] {
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const d of points) {
    if (d.value < vMin) vMin = d.value;
    if (d.value > vMax) vMax = d.value;
  }
  if (isFD) return [0, vMax * 1.1 || 0.1];
  const pad = (vMax - vMin) * 0.1 || Math.abs(vMax) * 0.1 || 0.1;
  return [vMin - pad, vMax + pad];
}

export interface ConfoundsChartOptions {
  sectionEl: HTMLElement;
  labelEl: HTMLElement;
  confounds: ConfoundsRaw;
  raw: PhysioRaw;
  column: string;
}

export interface ConfoundsChartHandle {
  /** Follow the focus chart's time window */
  setXDomain: (domain: [number, number]) => void;
  destroy: () => void;
}

function appendThresholdLine(group: GroupSelection, cls: string, y: number, width: number, color: string) {
  group
    .append('line')
    .attr('class', cls)
    .attr('x1', 0)
    .attr('x2', width)
    .attr('y1', y)
    .attr('y2', y)
    .attr('stroke', color)
    .attr('stroke-dasharray', '6 3')
    .attr('stroke-width', 1)
    .attr('opacity', 0.6);
}

/**
 * Chart of one motion confound on the scan-onset axis. Returns null and hides
 * the section when the column has no plottable values.
 */
export function buildConfoundsChart(opts: ConfoundsChartOptions): ConfoundsChartHandle | null {
  const { column } = opts;
  const isFD = column === 'framewise_displacement';
  const { label: yLabel, unit } = CONFOUND_UNITS[column] ?? { label: column, unit: '' };

  const points = toConfoundPoints(opts.confounds, column, opts.raw);
  if (points.length === 0) {
    opts.sectionEl.style.display = 'none';
    return null;
  }
  opts.sectionEl.style.display = '';
  opts.labelEl.textContent = opts.confounds.filename;

  const yDomain = confoundYDomain(points, isFD);
  const chart = createChart({
    container: '#confounds-chart',
    width: CHART_WIDTH,
    height: 170,
    margin: { top: 10, bottom: 40, ...CHART_MARGIN_X },
    xScale: { type: 'linear', domain: getViewExtent(opts.raw) },
    yScale: { type: 'linear', domain: yDomain, nice: true },
    xAxis: { position: 'bottom', label: 'Time from scan onset (s)' },
    yAxis: { position: 'left', label: yLabel },
    grid: { y: { strokeColor: '#e0e0e0', opacity: 0.5 } },
    tooltip: { enabled: true },
    resize: { enabled: true, debounceMs: 100 },
  });

  const layers = chart.getLayers();
  const dims = chart.getDimensions();
  const yScale = yScaleOf(chart);

  if (isFD && yDomain[1] >= FD_GOOD_MM) {
    appendThresholdLine(layers.content, 'fd-threshold-02', yScale(FD_GOOD_MM), dims.innerWidth, '#66c2a5');
  }
  if (isFD && yDomain[1] >= FD_ACCEPTABLE_MM) {
    appendThresholdLine(layers.content, 'fd-threshold-05', yScale(FD_ACCEPTABLE_MM), dims.innerWidth, '#fc8d62');
  }

  const segmentsGroup = layers.content.append('g').attr('class', 'confound-segments');
  const onsetGroup = layers.content.append('g').attr('class', 'onset-marker');

  function draw() {
    segmentsGroup.selectAll('path').remove();
    for (const seg of splitByColor(points, (v) => confoundColor(isFD, v))) {
      const path = segmentsGroup
        .append('path')
        .attr('fill', 'none')
        .attr('stroke', seg.color)
        .attr('stroke-width', 2) as PathSelection;
      drawLine(path, chart, seg.data);
    }
    drawOnsetMarker(chart, onsetGroup, false);
  }

  draw();

  const overlayRect = appendOverlayRect(chart);
  attachHover(chart, overlayRect, points, {
    color: '#d95f02',
    html: (p) =>
      `<div><strong>${p.time.toFixed(2)} s</strong></div><div>${column}: ${p.value.toFixed(4)}${unit ? ` ${unit}` : ''}</div>`,
  });

  chart.on('resize', draw);

  return {
    setXDomain(domain) {
      xScaleOf(chart).domain(domain);
      chart.renderAxesAndGrid();
      draw();
      const w = chart.getDimensions().innerWidth;
      layers.content.select('.fd-threshold-02').attr('x2', w);
      layers.content.select('.fd-threshold-05').attr('x2', w);
    },
    destroy: () => chart.destroy(),
  };
}
