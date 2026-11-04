import { line } from 'd3-shape';
import { pointer } from 'd3-selection';
import type { Selection } from 'd3-selection';
import type { ScaleLinear } from 'd3-scale';
import type { ChartInstance } from '@/core';
import type { DataPoint } from '@/data/bids-physio-reader';

export type LinearScale = ScaleLinear<number, number>;
export type GroupSelection = ReturnType<ChartInstance['getLayers']>['content'];
export type RectSelection = Selection<SVGRectElement, unknown, null, undefined>;
export type PathSelection = Selection<SVGPathElement, unknown, null, undefined>;

/** Width and margins shared by every viewer chart, so their time axes line up */
export const CHART_WIDTH = 960;
export const CHART_MARGIN_X = { left: 60, right: 20 };

export function xScaleOf(chart: ChartInstance): LinearScale {
  return chart.getScales().x as LinearScale;
}

export function yScaleOf(chart: ChartInstance): LinearScale {
  return chart.getScales().y as LinearScale;
}

export function xDomainOf(chart: ChartInstance): [number, number] {
  return xScaleOf(chart).domain() as [number, number];
}

/** Draw points as a line in the chart's current scales */
export function drawLine(path: PathSelection, chart: ChartInstance, points: DataPoint[]): void {
  const x = xScaleOf(chart);
  const y = yScaleOf(chart);
  const lineGen = line<DataPoint>()
    .x((d) => x(d.time))
    .y((d) => y(d.value));
  path.datum(points).attr('d', lineGen);
}

/** Value range of the points padded by 5% on each side (0.1 if flat); null if there are none */
export function paddedValueExtent(points: DataPoint[]): [number, number] | null {
  if (points.length === 0) return null;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const v = points[i].value;
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
  }
  const pad = (vMax - vMin) * 0.05 || 0.1;
  return [vMin - pad, vMax + pad];
}

/** Fit a chart's y domain to the visible samples */
export function fitYToVisible(chart: ChartInstance, visible: DataPoint[]): void {
  const extent = paddedValueExtent(visible);
  if (!extent) return;
  yScaleOf(chart).domain(extent);
  chart.renderAxesAndGrid();
}

/** Sample closest in time to t; points must be sorted by time and non-empty */
export function nearestPoint(points: DataPoint[], t: number): DataPoint {
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].time < t) lo = mid;
    else hi = mid;
  }
  return Math.abs(points[lo].time - t) < Math.abs(points[hi].time - t) ? points[lo] : points[hi];
}

/**
 * Dashed vertical line at scan onset (t = 0, first BOLD volume), the shared
 * reference for physio and confounds. Hidden when 0 is outside the x domain.
 */
export function drawOnsetMarker(chart: ChartInstance, group: GroupSelection, withLabel: boolean): void {
  const xScale = xScaleOf(chart);
  const [d0, d1] = xScale.domain();
  const height = chart.getDimensions().innerHeight;
  const x0 = xScale(0);

  group.selectAll('*').remove();
  if (!(d0 <= 0 && 0 <= d1)) return;
  group
    .append('line')
    .attr('x1', x0)
    .attr('x2', x0)
    .attr('y1', 0)
    .attr('y2', height)
    .attr('stroke', '#7b3fa0')
    .attr('stroke-width', 1.5)
    .attr('stroke-dasharray', '5 3')
    .attr('pointer-events', 'none');
  if (withLabel) {
    group
      .append('text')
      .attr('x', x0 + 4)
      .attr('y', 14)
      .attr('fill', '#7b3fa0')
      .style('font-size', 'var(--fs-xs)') // shared size (src/shell/tabs.css)
      .attr('pointer-events', 'none')
      .text('scan onset (t = 0)');
  }
}

/** Transparent rectangle over the plot area that receives mouse events */
export function appendOverlayRect(chart: ChartInstance): RectSelection {
  const dims = chart.getDimensions();
  return chart
    .getLayers()
    .overlay.append('rect')
    .attr('width', dims.innerWidth)
    .attr('height', dims.innerHeight)
    .attr('fill', 'transparent')
    .attr('cursor', 'crosshair');
}

export interface HoverOptions {
  /** Fill of the marker on the nearest sample */
  color: string;
  /** Tooltip HTML for the nearest sample */
  html: (p: DataPoint) => string;
  /** Skip hover updates while this returns true (e.g. during a brush drag) */
  isSuppressed?: () => boolean;
}

/**
 * Hover readout: a dashed vertical line and a marker on the sample nearest the
 * pointer, plus a tooltip. Events are namespaced (.hover) so they coexist with
 * other handlers on the same target.
 */
export function attachHover(
  chart: ChartInstance,
  target: RectSelection,
  points: DataPoint[],
  opts: HoverOptions,
): void {
  const overlay = chart.getLayers().overlay;
  const hoverLine = overlay
    .append('line')
    .attr('stroke', '#666')
    .attr('stroke-dasharray', '4 4')
    .attr('pointer-events', 'none')
    .style('opacity', 0);
  const hoverCircle = overlay
    .append('circle')
    .attr('r', 3)
    .attr('fill', opts.color)
    .attr('stroke', 'white')
    .attr('stroke-width', 1.5)
    .attr('pointer-events', 'none')
    .style('opacity', 0);

  target
    .on('mousemove.hover', (event: MouseEvent) => {
      if (opts.isSuppressed?.() || points.length === 0) return;
      const x = xScaleOf(chart);
      const y = yScaleOf(chart);
      const [mx] = pointer(event, target.node()!);
      const nearest = nearestPoint(points, x.invert(mx));
      const cx = x(nearest.time);
      const cy = y(nearest.value);

      hoverLine
        .attr('x1', cx)
        .attr('x2', cx)
        .attr('y1', 0)
        .attr('y2', chart.getDimensions().innerHeight)
        .style('opacity', 1);
      hoverCircle.attr('cx', cx).attr('cy', cy).style('opacity', 1);
      chart.getTooltip()?.show(opts.html(nearest), event.pageX, event.pageY);
    })
    .on('mouseleave.hover', () => {
      hoverLine.style('opacity', 0);
      hoverCircle.style('opacity', 0);
      chart.getTooltip()?.hide();
    });
}
