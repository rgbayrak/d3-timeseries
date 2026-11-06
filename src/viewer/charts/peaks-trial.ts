import type { ChartInstance } from '@/core';
import type { DataPoint } from '@/data/bids-physio-reader';
import type { Peak } from '../peaks-trial';
import { xScaleOf, yScaleOf, xDomainOf, nearestPoint } from './shared';
import type { GroupSelection } from './shared';

// TRIAL (not a supported feature yet): peaks drawn as dots on the main signal.

/** Detected peak: filled blue dot */
export const PEAK_COLOR = '#466eb4';
/** Corrected peak: green ring, so it stays visible around a detected peak at the same time */
export const PEAK_CORRECTED_COLOR = '#1a9850';

/**
 * Draw the peaks inside the chart's time window, each on the signal value at
 * its time (nearest sample). Clears the group when there is nothing to draw.
 */
export function drawPeaks(chart: ChartInstance, group: GroupSelection, data: DataPoint[], peaks: Peak[]): void {
  group.selectAll('*').remove();
  if (peaks.length === 0 || data.length === 0) return;

  const [t0, t1] = xDomainOf(chart);
  const x = xScaleOf(chart);
  const y = yScaleOf(chart);
  const visible = peaks.filter((p) => p.time >= t0 && p.time <= t1);
  const at = (p: Peak) => ({ cx: x(p.time), cy: y(nearestPoint(data, p.time).value) });

  // Corrected rings first, detected dots on top
  for (const p of visible.filter((v) => v.corrected)) {
    const { cx, cy } = at(p);
    group
      .append('circle')
      .attr('cx', cx)
      .attr('cy', cy)
      .attr('r', 4.5)
      .attr('fill', 'none')
      .attr('stroke', PEAK_CORRECTED_COLOR)
      .attr('stroke-width', 1.5)
      .attr('pointer-events', 'none');
  }
  for (const p of visible.filter((v) => !v.corrected)) {
    const { cx, cy } = at(p);
    group
      .append('circle')
      .attr('cx', cx)
      .attr('cy', cy)
      .attr('r', 2.5)
      .attr('fill', PEAK_COLOR)
      .attr('pointer-events', 'none');
  }
}
