import { describe, it, expect } from 'vitest';
import {
  toDataPoints,
  getTimeExtent,
  getViewExtent,
  getValueExtent,
  toConfoundPoints,
} from '../bids-physio-reader';
import type { PhysioRaw, ConfoundsRaw } from '../bids-physio-reader';

function makeRaw(overrides?: Partial<PhysioRaw>): PhysioRaw {
  return {
    filename: 'test_physio.tsv.gz',
    samplingFrequency: 100,
    startTime: 0,
    timing: { status: 'unverified', detail: '', offset: 0, triggerTimes: [] },
    columns: ['A', 'B'],
    data: [
      [1, 2, 3, 4, 5],
      [10, 20, 30, 40, 50],
    ],
    numSamples: 5,
    quality: null,
    ...overrides,
  };
}

describe('toDataPoints', () => {
  it('maps column data to time/value pairs', () => {
    const raw = makeRaw();
    const points = toDataPoints(raw, 'A');
    expect(points).toHaveLength(5);
    expect(points[0]).toEqual({ time: 0, value: 1 });
    expect(points[1]).toEqual({ time: 0.01, value: 2 });
    expect(points[4]).toEqual({ time: 0.04, value: 5 });
  });

  it('respects startTime offset', () => {
    const raw = makeRaw({ startTime: 10 });
    const points = toDataPoints(raw, 'A');
    expect(points[0].time).toBe(10);
    expect(points[1].time).toBeCloseTo(10.01);
  });

  it('works with second column', () => {
    const raw = makeRaw();
    const points = toDataPoints(raw, 'B');
    expect(points[0].value).toBe(10);
    expect(points[4].value).toBe(50);
  });

  it('throws for unknown channel', () => {
    const raw = makeRaw();
    expect(() => toDataPoints(raw, 'Z')).toThrow('Channel "Z" not found');
  });
});

describe('getTimeExtent', () => {
  it('returns correct start and end times', () => {
    const raw = makeRaw();
    const [t0, t1] = getTimeExtent(raw);
    expect(t0).toBe(0);
    // (5-1)/100 = 0.04
    expect(t1).toBeCloseTo(0.04);
  });

  it('accounts for startTime', () => {
    const raw = makeRaw({ startTime: 5 });
    const [t0, t1] = getTimeExtent(raw);
    expect(t0).toBe(5);
    expect(t1).toBeCloseTo(5.04);
  });
});

describe('getViewExtent', () => {
  it('starts at scan onset when physio starts before it', () => {
    const raw = makeRaw({ startTime: -1, numSamples: 201 });
    const [, t1] = getTimeExtent(raw);
    expect(getViewExtent(raw)).toEqual([0, t1]);
  });

  it('starts at scan onset when physio starts after it', () => {
    const raw = makeRaw({ startTime: 1 });
    const [, t1] = getTimeExtent(raw);
    expect(getViewExtent(raw)).toEqual([0, t1]);
  });
});

describe('getValueExtent', () => {
  it('returns min/max with 2% padding', () => {
    const raw = makeRaw();
    const [min, max] = getValueExtent(raw, 'A');
    // Data: [1,2,3,4,5], range=4, pad=0.08
    expect(min).toBeCloseTo(1 - 0.08);
    expect(max).toBeCloseTo(5 + 0.08);
  });

  it('handles negative values', () => {
    const raw = makeRaw({
      data: [[-10, -5, 0, 5, 10], [0, 0, 0, 0, 0]],
    });
    const [min, max] = getValueExtent(raw, 'A');
    // range=20, pad=0.4
    expect(min).toBeCloseTo(-10.4);
    expect(max).toBeCloseTo(10.4);
  });

  it('throws for unknown channel', () => {
    const raw = makeRaw();
    expect(() => getValueExtent(raw, 'Z')).toThrow('Channel "Z" not found');
  });
});

describe('toConfoundPoints', () => {
  it('without BOLD timing, derives TR from physio duration', () => {
    const raw = makeRaw({ numSamples: 1001, samplingFrequency: 100, startTime: 0 });
    // physio duration = 1000/100 = 10s
    const confounds: ConfoundsRaw = {
      filename: 'test_confounds.tsv',
      numVolumes: 5,
      volumeTimes: null,
      columns: { framewise_displacement: [0.1, 0.2, 0.3, 0.4, 0.5] },
    };
    const points = toConfoundPoints(confounds, 'framewise_displacement', raw);
    expect(points).toHaveLength(5);
    // TR = 10/5 = 2s
    expect(points[0]).toEqual({ time: 0, value: 0.1 });
    expect(points[1]).toEqual({ time: 2, value: 0.2 });
    expect(points[4]).toEqual({ time: 8, value: 0.5 });
  });

  it('filters NaN values', () => {
    const raw = makeRaw({ numSamples: 101, samplingFrequency: 100, startTime: 0 });
    const confounds: ConfoundsRaw = {
      filename: 'test_confounds.tsv',
      numVolumes: 4,
      volumeTimes: null,
      columns: { framewise_displacement: [NaN, 0.1, NaN, 0.2] },
    };
    const points = toConfoundPoints(confounds, 'framewise_displacement', raw);
    expect(points).toHaveLength(2);
    expect(points[0].value).toBe(0.1);
    expect(points[1].value).toBe(0.2);
  });

  it('without BOLD timing, accounts for startTime offset', () => {
    const raw = makeRaw({ numSamples: 501, samplingFrequency: 100, startTime: 5 });
    // duration = 500/100 = 5s, TR = 5/2 = 2.5s
    const confounds: ConfoundsRaw = {
      filename: 'test_confounds.tsv',
      numVolumes: 2,
      volumeTimes: null,
      columns: { framewise_displacement: [0.1, 0.2] },
    };
    const points = toConfoundPoints(confounds, 'framewise_displacement', raw);
    expect(points[0].time).toBe(5);
    expect(points[1].time).toBeCloseTo(7.5);
  });
});
