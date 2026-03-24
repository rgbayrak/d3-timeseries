import type { Selection } from 'd3-selection';
import type { Dimensions } from './types';

export function createClipPath(
  defs: Selection<SVGDefsElement, unknown, null, undefined>,
  id: string,
  dimensions: Dimensions,
): void {
  defs
    .append('clipPath')
    .attr('id', id)
    .append('rect')
    .attr('width', dimensions.innerWidth)
    .attr('height', dimensions.innerHeight);
}

export function updateClipPath(
  defs: Selection<SVGDefsElement, unknown, null, undefined>,
  id: string,
  dimensions: Dimensions,
): void {
  defs
    .select(`#${id} rect`)
    .attr('width', dimensions.innerWidth)
    .attr('height', dimensions.innerHeight);
}
