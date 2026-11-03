// Small pure helpers for the group plots.

export function finiteValues(values: number[]): number[] {
  return values.filter((v) => Number.isFinite(v));
}

/** Mean of the finite values; NaN if there are none */
export function finiteMean(values: number[]): number {
  const f = finiteValues(values);
  if (f.length === 0) return NaN;
  let s = 0;
  for (const v of f) s += v;
  return s / f.length;
}

/** [min, max] of the finite values padded by `pad` of the range (±0.5 if flat); null if none */
export function paddedExtent(values: number[], pad = 0.05): [number, number] | null {
  const f = finiteValues(values);
  if (f.length === 0) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of f) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo === hi) return [lo - 0.5, hi + 0.5];
  const p = (hi - lo) * pad;
  return [lo - p, hi + p];
}

export interface Bin {
  x0: number;
  x1: number;
  count: number;
}

/**
 * Equal-width histogram of the finite values. `include` widens the range so a
 * marker value (e.g. one subject) always falls inside it. The last bin is
 * closed on the right. Returns [] when there is nothing to bin.
 */
export function histogramBins(values: number[], binCount = 20, include?: number): Bin[] {
  const f = finiteValues(values);
  const all = include !== undefined && Number.isFinite(include) ? [...f, include] : f;
  if (all.length === 0 || binCount < 1) return [];
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of all) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo === hi) {
    return [{ x0: lo - 0.5, x1: hi + 0.5, count: f.length }];
  }
  const width = (hi - lo) / binCount;
  const bins: Bin[] = Array.from({ length: binCount }, (_, i) => ({
    x0: lo + i * width,
    x1: i === binCount - 1 ? hi : lo + (i + 1) * width,
    count: 0,
  }));
  for (const v of f) {
    const i = Math.min(binCount - 1, Math.floor((v - lo) / width));
    bins[i].count++;
  }
  return bins;
}

/** Percentile rank (0-100) of `value` among the finite values: share strictly below plus half of ties */
export function percentileRank(values: number[], value: number): number {
  const f = finiteValues(values);
  if (f.length === 0 || !Number.isFinite(value)) return NaN;
  let below = 0;
  let equal = 0;
  for (const v of f) {
    if (v < value) below++;
    else if (v === value) equal++;
  }
  return ((below + equal / 2) / f.length) * 100;
}
