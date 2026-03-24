import { axisTop, axisRight, axisBottom, axisLeft } from 'd3-axis';
import type { Selection } from 'd3-selection';
import type { AxisConfig, AnyScale, Dimensions } from './types';

type SVGGSelection = Selection<SVGGElement, unknown, null, undefined>;

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

  if (config.tickCount != null) generator.ticks(config.tickCount);
  if (config.tickFormat) generator.tickFormat(config.tickFormat as any);

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
      group
        .append('text')
        .attr('class', labelClass)
        .attr('transform', 'rotate(-90)')
        .attr('x', -dimensions.innerHeight / 2)
        .attr('y', config.position === 'left' ? -40 : 40)
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
