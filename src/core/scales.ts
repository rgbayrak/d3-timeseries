import {
  scaleTime,
  scaleLinear,
  scaleBand,
  scaleOrdinal,
  scaleLog,
  scaleSqrt,
} from 'd3-scale';
import type { ScaleConfig, AnyScale, Dimensions } from './types';

export function createScale(
  config: ScaleConfig,
  axis: 'x' | 'y',
  dimensions: Dimensions,
): AnyScale {
  const range =
    axis === 'x'
      ? [0, dimensions.innerWidth]
      : [dimensions.innerHeight, 0];

  switch (config.type) {
    case 'time': {
      const s = scaleTime().range(range);
      if (config.domain) s.domain(config.domain as [Date, Date]);
      if (config.nice) s.nice();
      if (config.clamp) s.clamp(true);
      return s;
    }
    case 'linear': {
      const s = scaleLinear().range(range);
      if (config.domain) s.domain(config.domain as [number, number]);
      if (config.nice) s.nice();
      if (config.clamp) s.clamp(true);
      return s;
    }
    case 'log': {
      const s = scaleLog().range(range);
      if (config.domain) s.domain(config.domain as [number, number]);
      if (config.nice) s.nice();
      if (config.clamp) s.clamp(true);
      return s;
    }
    case 'sqrt': {
      const s = scaleSqrt().range(range);
      if (config.domain) s.domain(config.domain as [number, number]);
      if (config.nice) s.nice();
      if (config.clamp) s.clamp(true);
      return s;
    }
    case 'band': {
      const s = scaleBand<string>().range([range[0], range[1]]);
      if (config.domain) s.domain(config.domain as string[]);
      if (config.padding != null) s.padding(config.padding);
      return s;
    }
    case 'ordinal': {
      const s = scaleOrdinal<string, number>();
      if (config.domain) s.domain(config.domain as string[]);
      // ordinal scales use range, not continuous range
      s.range(
        config.domain
          ? (config.domain as string[]).map(
              (_, i, arr) => range[0] + (i / (arr.length - 1 || 1)) * (range[1] - range[0]),
            )
          : range,
      );
      return s;
    }
  }
}

export function updateScaleRange(
  scale: AnyScale,
  axis: 'x' | 'y',
  dimensions: Dimensions,
): void {
  const range =
    axis === 'x'
      ? [0, dimensions.innerWidth]
      : [dimensions.innerHeight, 0];

  // All D3 scales have .range() but the types don't unify well
  (scale as any).range(range);
}
