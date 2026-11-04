import { describe, it, expect } from 'vitest';
import { nearestPoint, paddedValueExtent } from '../charts/shared';
import { confoundColor, splitByColor, confoundYDomain, FD_GOOD_MM, FD_ACCEPTABLE_MM } from '../charts/confounds';
import { windowLengthLabel } from '../charts/focus-context';

describe('window length over the overview selection', () => {
  it('rounds to whole seconds from 10 s, tenths from 1 s, hundredths below', () => {
    expect(windowLengthLabel(60)).toBe('60 sec');
    expect(windowLengthLabel(59.6)).toBe('60 sec');
    expect(windowLengthLabel(7.46)).toBe('7.5 sec');
    expect(windowLengthLabel(0.254)).toBe('0.25 sec');
  });

  it('shows nothing for an invalid length', () => {
    expect(windowLengthLabel(NaN)).toBe('');
    expect(windowLengthLabel(-1)).toBe('');
  });
});

const pts = (values: number[], dt = 1) => values.map((value, i) => ({ time: i * dt, value }));

describe('nearestPoint', () => {
  const series = pts([10, 20, 30, 40], 0.5); // times 0, 0.5, 1, 1.5

  it('finds the closest sample in time', () => {
    expect(nearestPoint(series, 0.6).time).toBe(0.5);
    expect(nearestPoint(series, 0.9).time).toBe(1);
  });

  it('clamps to the first and last samples outside the range', () => {
    expect(nearestPoint(series, -5).time).toBe(0);
    expect(nearestPoint(series, 99).time).toBe(1.5);
  });

  it('works for a single sample', () => {
    expect(nearestPoint(pts([7]), 3).value).toBe(7);
  });
});

describe('paddedValueExtent', () => {
  it('pads the value range by 5% on each side', () => {
    const [lo, hi] = paddedValueExtent(pts([0, 10, 5]))!;
    expect(lo).toBeCloseTo(-0.5, 12);
    expect(hi).toBeCloseTo(10.5, 12);
  });

  it('uses a fixed 0.1 pad for a flat signal, and null for no samples', () => {
    expect(paddedValueExtent(pts([3, 3]))).toEqual([2.9, 3.1]);
    expect(paddedValueExtent([])).toBeNull();
  });
});

describe('confound coloring', () => {
  it('colors FD by motion severity at the 0.2 / 0.5 mm thresholds', () => {
    const good = confoundColor(true, FD_GOOD_MM);
    const ok = confoundColor(true, FD_ACCEPTABLE_MM);
    const bad = confoundColor(true, FD_ACCEPTABLE_MM + 0.01);
    expect(new Set([good, ok, bad]).size).toBe(3);
    expect(confoundColor(true, 0)).toBe(good);
    expect(confoundColor(true, 0.3)).toBe(ok);
  });

  it('draws every other confound in a single color', () => {
    expect(new Set([-1, 0, 0.3, 5].map((v) => confoundColor(false, v))).size).toBe(1);
  });
});

describe('splitByColor', () => {
  const colorFor = (v: number) => (v > 0 ? 'pos' : 'neg');

  it('returns one segment when the color never changes', () => {
    const segs = splitByColor(pts([1, 2, 3]), colorFor);
    expect(segs).toHaveLength(1);
    expect(segs[0].data).toHaveLength(3);
  });

  it('starts a new segment at each color change, sharing boundary points so the line is continuous', () => {
    const p = pts([1, 2, -1, -2, 3]);
    const segs = splitByColor(p, colorFor);
    expect(segs.map((s) => s.color)).toEqual(['pos', 'neg', 'pos']);
    // each segment ends where the next begins
    for (let i = 0; i < segs.length - 1; i++) {
      const seg = segs[i].data;
      expect(seg[seg.length - 1]).toBe(segs[i + 1].data[1]);
    }
    // every point is drawn
    const drawn = new Set(segs.flatMap((s) => s.data));
    expect(drawn.size).toBe(p.length);
  });

  it('returns nothing for no points', () => {
    expect(splitByColor([], colorFor)).toEqual([]);
  });
});

describe('confoundYDomain', () => {
  it('anchors FD at 0 with 10% headroom', () => {
    const [lo, hi] = confoundYDomain(pts([0.1, 0.4, 0.2]), true);
    expect(lo).toBe(0);
    expect(hi).toBeCloseTo(0.44, 12);
  });

  it('falls back to 0.1 when FD is all zeros', () => {
    expect(confoundYDomain(pts([0, 0]), true)).toEqual([0, 0.1]);
  });

  it('pads signed confounds by 10% at both ends', () => {
    const [lo, hi] = confoundYDomain(pts([-1, 1]), false);
    expect(lo).toBeCloseTo(-1.2, 12);
    expect(hi).toBeCloseTo(1.2, 12);
  });
});
