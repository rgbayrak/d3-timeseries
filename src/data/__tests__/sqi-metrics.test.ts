import { describe, it, expect } from 'vitest';
import { computeSQI } from '../sqi-metrics';
import type { ChannelMetrics } from '../sqi-metrics';
import type { PhysioRaw } from '../bids-physio-reader';

/**
 * SQI metrics on synthetic signals whose statistics are known analytically.
 * A pure sine has mean 0, SD 1/sqrt(2), skewness 0, excess kurtosis -1.5,
 * and crosses zero twice per cycle; every cycle has the same shape, so
 * beat-to-beat correlation is 1.
 */

const FS = 100;
const DURATION_S = 60; // long enough for the 60 s windowed kurtosis

function sine(freqHz: number, { offset = 0, amplitude = 1, phase = 0.1 } = {}): number[] {
  return Array.from({ length: FS * DURATION_S }, (_, i) =>
    offset + amplitude * Math.sin(2 * Math.PI * freqHz * (i / FS) + phase),
  );
}

function metricsFor(columns: Record<string, number[]>): Record<string, ChannelMetrics> {
  const names = Object.keys(columns);
  const raw: PhysioRaw = {
    filename: 'synthetic_physio.tsv.gz',
    samplingFrequency: FS,
    startTime: 0,
    timing: { status: 'unverified', detail: '', offset: 0, triggerTimes: [] },
    columns: names,
    data: names.map((n) => columns[n]),
    numSamples: columns[names[0]].length,
    quality: null,
  };
  return Object.fromEntries(computeSQI(raw).metrics.map((m) => [m.channelName, m]));
}

describe('computeSQI: basic statistics', () => {
  const m = metricsFor({ signal: sine(1) }).signal;

  it('returns one entry per channel, in column order', () => {
    const r = metricsFor({ b: sine(1), a: sine(2) });
    expect(Object.keys(r)).toEqual(['b', 'a']);
  });

  it('mean and SD of a sine', () => {
    expect(m.mean).toBeCloseTo(0, 6);
    expect(m.stdDev).toBeCloseTo(Math.SQRT1_2, 3);
  });

  it('does not compute min, max, median or percent non-zero', () => {
    for (const key of ['min', 'max', 'median', 'percentNonZero']) expect(m).not.toHaveProperty(key);
  });

  it('skewness 0 and excess kurtosis -1.5', () => {
    expect(m.skewness).toBeCloseTo(0, 3);
    expect(m.kurtosis).toBeCloseTo(-1.5, 2);
  });

  it('zero-crossing rate is twice the frequency', () => {
    expect(metricsFor({ s: sine(1) }).s.zeroCrossingRate).toBeCloseTo(2, 1);
    expect(metricsFor({ s: sine(3) }).s.zeroCrossingRate).toBeCloseTo(6, 1);
  });

  it('SNR is mean / SD', () => {
    const shifted = metricsFor({ s: sine(1, { offset: 5 }) }).s;
    expect(shifted.snr).toBeCloseTo(5 / Math.SQRT1_2, 2);
  });

  it('a flat channel has infinite SNR and undefined shape statistics', () => {
    const flat = metricsFor({ s: new Array(1000).fill(3) }).s;
    expect(flat.stdDev).toBe(0);
    expect(flat.snr).toBe(Infinity);
    expect(flat.skewness).toBeNaN();
    expect(flat.kurtosis).toBeNaN();
  });
});

describe('computeSQI: channel-type specific metrics', () => {
  const r = metricsFor({
    cardiac: sine(1),
    respiratory: sine(0.25),
    trigger: sine(0.5),
  });

  it('cardiac: morphology and PhysioQC metrics are computed', () => {
    const c = r.cardiac;
    expect(c.beatCorrelation).toBeCloseTo(1, 3);
    expect(c.sqi).toBeCloseTo(0, 2);               // windowed skewness of a sine
    expect(c.kurtosisWindowed).toBeCloseTo(-1.5, 2);
    expect(Number.isFinite(c.approxEntropy)).toBe(true);
    expect(Number.isFinite(c.svri)).toBe(true);
    expect(Number.isFinite(c.ipa)).toBe(true);
  });

  it('respiratory: breath correlation only, no cardiac morphology', () => {
    const c = r.respiratory;
    expect(c.beatCorrelation).toBeCloseTo(1, 3);
    for (const k of ['svri', 'ipa', 'sqi', 'kurtosisWindowed', 'approxEntropy'] as const) {
      expect(c[k]).toBeNaN();
    }
  });

  it('other channels: no channel-specific metrics', () => {
    const c = r.trigger;
    for (const k of ['beatCorrelation', 'svri', 'ipa', 'sqi', 'kurtosisWindowed', 'approxEntropy'] as const) {
      expect(c[k]).toBeNaN();
    }
  });

  it('recognises pulsatile channels by name (ppg, pulse, ecg, pleth)', () => {
    const names = metricsFor({ PPG: sine(1), pulse_ox: sine(1), ECG: sine(1), pleth: sine(1) });
    for (const m of Object.values(names)) expect(m.beatCorrelation).toBeCloseTo(1, 3);
  });

  it('windowed kurtosis needs at least 60 s of data', () => {
    const short = sine(1).slice(0, FS * 30);
    expect(metricsFor({ cardiac: short }).cardiac.kurtosisWindowed).toBeNaN();
  });

  it('a noisy beat lowers beat correlation', () => {
    const noisy = sine(1);
    // corrupt one second in the middle with a square wave
    for (let i = 30 * FS; i < 31 * FS; i++) noisy[i] = i % 10 < 5 ? 1 : -1;
    expect(metricsFor({ cardiac: noisy }).cardiac.beatCorrelation).toBeLessThan(0.99);
  });
});
