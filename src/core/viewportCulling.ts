import { bisector } from 'd3-array';

/**
 * Binary-search slice of sorted data to the visible x-domain + buffer.
 * O(log n) — for 1M points zoomed to 2 s at 2048 Hz, yields ~4100 points.
 */
export function cullToViewport<T>(
  data: T[],
  xDomain: [number, number],
  accessor: (d: T) => number,
  buffer = 1,
): T[] {
  if (data.length === 0) return data;

  const bis = bisector(accessor);
  const lo = Math.max(0, bis.left(data, xDomain[0]) - buffer);
  const hi = Math.min(data.length, bis.right(data, xDomain[1]) + buffer);

  return data.slice(lo, hi);
}

/**
 * Uniform stride downsampling.  Keeps first and last points.
 * Used for the context chart which always shows the full signal.
 */
export function downsample<T>(data: T[], maxPoints: number): T[] {
  if (data.length <= maxPoints) return data;

  const stride = (data.length - 1) / (maxPoints - 1);
  const result: T[] = [];

  for (let i = 0; i < maxPoints - 1; i++) {
    result.push(data[Math.round(i * stride)]);
  }
  result.push(data[data.length - 1]);

  return result;
}
