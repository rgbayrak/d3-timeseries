import { axisTop, axisRight, axisBottom, axisLeft } from 'd3-axis';
import type { Selection } from 'd3-selection';
import type { AxisConfig, AnyScale, Dimensions } from './types';

type SVGGSelection = Selection<SVGGElement, unknown, null, undefined>;

/** Least vertical space per y-axis tick label (px); closer than this the labels crowd */
export const MIN_Y_TICK_SPACING_PX = 30;

/**
 * Tick count for a vertical axis: as many as fit at MIN_Y_TICK_SPACING_PX
 * (at least 2), never more than the axis asks for (d3's default is 10). d3
 * treats the count as a hint and may use a few more or fewer "nice" ticks.
 */
export function verticalTickCount(innerHeight: number, requested?: number): number {
  const fit = Math.max(2, Math.floor(innerHeight / MIN_Y_TICK_SPACING_PX));
  return Math.min(requested ?? 10, fit);
}

/**
 * Short tick label for a number, at most about 5 characters, so y-axis ticks
 * stay narrow: 4 significant digits, k/M/G from 10 000, and an exponent below
 * 0.001. No thousands comma.
 */
export function compactNumber(d: unknown): string {
  const v = Number(d);
  if (!Number.isFinite(v)) return String(d);
  const a = Math.abs(v);
  if (a !== 0 && a < 1e-3) return v.toExponential(1);
  if (a < 1e4) return String(Number(v.toPrecision(4)));
  const units: [number, string][] = [[1e3, 'k'], [1e6, 'M'], [1e9, 'G']];
  for (let i = 0; i < units.length; i++) {
    const [div, suffix] = units[i];
    const n = Number((v / div).toPrecision(3));
    // 999 999 rounds to 1000k: move up to the next unit instead
    if (Math.abs(n) < 1000 || i === units.length - 1) return `${n}${suffix}`;
  }
  return String(v);
}

/** Gap between the widest tick label and the axis title (px) */
export const AXIS_LABEL_GAP_PX = 6;
/** Where the y-axis title sat before it was measured; short ticks keep it there (px) */
export const MIN_Y_LABEL_OFFSET_PX = 40;
/** Room the rotated title's letters need inside the left margin (px) */
const Y_LABEL_HEIGHT_PX = 14;
/** Width per character when the text can't be measured (tests) */
const FALLBACK_CHAR_PX = 7;

/**
 * Distance from the axis line to the y-axis title's baseline: past the widest
 * tick label (tick + padding + label + gap), never closer than
 * MIN_Y_LABEL_OFFSET_PX, and never so far that the title leaves the margin.
 */
export function yLabelOffset(widestTickPx: number, margin: number, tickSpace = 9): number {
  const needed = tickSpace + widestTickPx + AXIS_LABEL_GAP_PX;
  const room = Math.max(MIN_Y_LABEL_OFFSET_PX, margin - Y_LABEL_HEIGHT_PX);
  return Math.min(Math.max(MIN_Y_LABEL_OFFSET_PX, needed), room);
}

/** Width of the widest tick label in an axis group, measured when the browser can */
function widestTickLabel(group: SVGGSelection): number {
  let widest = 0;
  group.selectAll<SVGTextElement, unknown>('.tick text').each(function () {
    let w: number;
    try {
      w = this.getBBox().width;
    } catch {
      w = NaN;
    }
    if (!Number.isFinite(w) || w === 0) w = (this.textContent ?? '').length * FALLBACK_CHAR_PX;
    widest = Math.max(widest, w);
  });
  return widest;
}

export function renderAxis(
  group: SVGGSelection,
  scale: AnyScale,
  config: AxisConfig | undefined,
  dimensions: Dimensions,
): void {
  if (!config || config.hide) {
    group.selectAll('*').remove();
    return;
  }

  const generators = {
    top: axisTop,
    right: axisRight,
    bottom: axisBottom,
    left: axisLeft,
  } as const;

  const generator = generators[config.position](scale as any);

  const vertical = config.position === 'left' || config.position === 'right';
  if (vertical) {
    // Fewer ticks on short charts, so the y-axis labels never crowd
    generator.ticks(verticalTickCount(dimensions.innerHeight, config.tickCount ?? undefined));
  } else if (config.tickCount != null) {
    generator.ticks(config.tickCount);
  }
  if (config.tickFormat) generator.tickFormat(config.tickFormat as any);
  // Numeric y axes without their own format get short labels (no "12,500")
  else if (vertical && typeof (scale as any).ticks === 'function') generator.tickFormat(compactNumber as any);

  group.call(generator as any);

  // Position the axis group
  if (config.position === 'bottom') {
    group.attr('transform', `translate(0,${dimensions.innerHeight})`);
  } else if (config.position === 'right') {
    group.attr('transform', `translate(${dimensions.innerWidth},0)`);
  }

  // Axis label
  const labelClass = 'axis-label';
  group.selectAll(`.${labelClass}`).remove();

  if (config.label) {
    if (config.position === 'bottom' || config.position === 'top') {
      group
        .append('text')
        .attr('class', labelClass)
        .attr('x', dimensions.innerWidth / 2)
        .attr('y', config.position === 'bottom' ? 35 : -10)
        .attr('text-anchor', 'middle')
        .attr('fill', 'currentColor')
        .text(config.label);
    } else {
      // Clear of the widest tick label, so 4+ digit ticks don't run into the title
      const left = config.position === 'left';
      const margin = left ? dimensions.margin.left : dimensions.margin.right;
      // On the right the letters sit between the baseline and the axis, so count their height too
      const widest = widestTickLabel(group) + (left ? 0 : Y_LABEL_HEIGHT_PX);
      const offset = yLabelOffset(widest, margin + (left ? 0 : Y_LABEL_HEIGHT_PX));
      group
        .append('text')
        .attr('class', labelClass)
        .attr('transform', 'rotate(-90)')
        .attr('x', -dimensions.innerHeight / 2)
        .attr('y', left ? -offset : offset)
        .attr('text-anchor', 'middle')
        .attr('fill', 'currentColor')
        .text(config.label);
    }
  }
}

export function renderGrid(
  xGroup: SVGGSelection,
  yGroup: SVGGSelection,
  scales: { x: AnyScale; y: AnyScale },
  config: { x?: boolean | { strokeColor?: string; opacity?: number; dasharray?: string };
            y?: boolean | { strokeColor?: string; opacity?: number; dasharray?: string } } | undefined,
  dimensions: Dimensions,
  /** The y-axis' own tick count, so horizontal grid lines sit on its labels */
  yTickCount?: number,
): void {
  if (!config) {
    xGroup.selectAll('*').remove();
    yGroup.selectAll('*').remove();
    return;
  }

  // X grid (vertical lines)
  if (config.x) {
    const xGen = axisBottom(scales.x as any)
      .tickSize(-dimensions.innerHeight)
      .tickFormat(() => '');

    xGroup
      .attr('transform', `translate(0,${dimensions.innerHeight})`)
      .call(xGen as any);

    xGroup.select('.domain').remove();

    const style = typeof config.x === 'object' ? config.x : {};
    xGroup
      .selectAll('line')
      .attr('stroke', style.strokeColor ?? '#e0e0e0')
      .attr('stroke-opacity', style.opacity ?? 0.7)
      .attr('stroke-dasharray', style.dasharray ?? '');
  } else {
    xGroup.selectAll('*').remove();
  }

  // Y grid (horizontal lines)
  if (config.y) {
    const yGen = axisLeft(scales.y as any)
      .ticks(verticalTickCount(dimensions.innerHeight, yTickCount))
      .tickSize(-dimensions.innerWidth)
      .tickFormat(() => '');

    yGroup.call(yGen as any);

    yGroup.select('.domain').remove();

    const style = typeof config.y === 'object' ? config.y : {};
    yGroup
      .selectAll('line')
      .attr('stroke', style.strokeColor ?? '#e0e0e0')
      .attr('stroke-opacity', style.opacity ?? 0.7)
      .attr('stroke-dasharray', style.dasharray ?? '');
  } else {
    yGroup.selectAll('*').remove();
  }
}
