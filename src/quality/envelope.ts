// Min/max envelope downsampling for static waveform plots. Unlike a plain
// stride, keeping each bucket's min and max preserves cardiac peaks.

/** Round to `digits` significant digits; keeps output files small and deterministic */
export function roundSig(v: number, digits = 6): number {
  return Number.isFinite(v) ? Number(v.toPrecision(digits)) : v;
}

export interface Envelope {
  /** Centre sample index of each bucket */
  centres: number[];
  min: (number | null)[];
  max: (number | null)[];
}

/**
 * Split `values` into at most `buckets` contiguous buckets and keep each
 * bucket's min and max (null when a bucket holds only NaN).
 */
export function minMaxEnvelope(values: number[], buckets: number): Envelope {
  const n = values.length;
  const b = Math.max(0, Math.min(Math.floor(buckets), n));
  const env: Envelope = { centres: [], min: [], max: [] };
  for (let i = 0; i < b; i++) {
    const start = Math.floor((i * n) / b);
    const end = Math.floor(((i + 1) * n) / b);
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = start; j < end; j++) {
      const v = values[j];
      if (Number.isNaN(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    env.centres.push((start + end - 1) / 2);
    env.min.push(lo === Infinity ? null : roundSig(lo));
    env.max.push(hi === -Infinity ? null : roundSig(hi));
  }
  return env;
}
