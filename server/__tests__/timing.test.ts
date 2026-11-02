import { describe, it, expect } from 'vitest';
import { detectTriggerOnsets, verifyTriggerTiming } from '../bids-layout';

describe('detectTriggerOnsets', () => {
  it('returns the sample index of each rising edge in a 0/1 channel', () => {
    expect(detectTriggerOnsets([0, 0, 1, 1, 0, 0, 1, 0])).toEqual([2, 6]);
  });

  it('thresholds at the midpoint of the range, so 0/5 V and offset channels work', () => {
    expect(detectTriggerOnsets([0, 5, 5, 0, 0, 5])).toEqual([1, 5]);
    expect(detectTriggerOnsets([-1, -1, 3, -1, 3])).toEqual([2, 4]);
  });

  it('ignores values just below the midpoint', () => {
    // range 0..10, midpoint 5: 4.9 is low, 5 counts as high
    expect(detectTriggerOnsets([0, 4.9, 0, 5, 10])).toEqual([3]);
  });

  it('does not report sample 0 when the channel starts high', () => {
    expect(detectTriggerOnsets([1, 1, 0, 1])).toEqual([3]);
  });

  it('returns [] for a flat or empty channel', () => {
    expect(detectTriggerOnsets([0, 0, 0])).toEqual([]);
    expect(detectTriggerOnsets([1, 1, 1])).toEqual([]);
    expect(detectTriggerOnsets([])).toEqual([]);
  });
});

describe('verifyTriggerTiming', () => {
  const TR = 2;
  const FS = 50;
  const pulses = (first: number, n = 10, tr = TR) => Array.from({ length: n }, (_, k) => first + k * tr);

  it('unverified when there are no trigger pulses', () => {
    const t = verifyTriggerTiming([], TR, 10, FS);
    expect(t).toMatchObject({ status: 'unverified', offset: 0, triggerTimes: [] });
    expect(t.detail).toMatch(/No trigger pulses/);
  });

  it('unverified when there is no TR to check against', () => {
    const t = verifyTriggerTiming(pulses(0), null, 10, FS);
    expect(t.status).toBe('unverified');
    expect(t.offset).toBe(0);
    expect(t.detail).toMatch(/No BOLD RepetitionTime/);
  });

  it('verified when every interval matches TR, count matches and the first pulse is at 0', () => {
    const t = verifyTriggerTiming(pulses(0), TR, 10, FS);
    expect(t.status).toBe('verified');
    expect(t.offset).toBe(0);
    expect(t.triggerTimes).toEqual(pulses(0));
  });

  it('verified when the volume count is unknown', () => {
    expect(verifyTriggerTiming(pulses(0, 7), TR, null, FS).status).toBe('verified');
  });

  it('accepts intervals within 5% of TR and rejects anything beyond', () => {
    const jitter = [0, 2.09, 4.0, 6.09]; // 2.09, 1.91, 2.09 -> all within 0.1 s
    expect(verifyTriggerTiming(jitter, TR, null, FS).status).toBe('verified');
    const tooFar = [0, 2.11, 4.11];
    expect(verifyTriggerTiming(tooFar, TR, null, FS).status).toBe('mismatch');
  });

  it('first pulse within 5% of TR of t = 0 counts as verified, not corrected', () => {
    expect(verifyTriggerTiming(pulses(0.09), TR, 10, FS).status).toBe('verified');
    expect(verifyTriggerTiming(pulses(-0.09), TR, 10, FS).status).toBe('verified');
    expect(verifyTriggerTiming(pulses(0.11), TR, 10, FS).status).toBe('corrected');
  });

  it('onset tolerance is at least 2 samples when the sampling rate is low', () => {
    // fs = 10 Hz -> 2 samples = 0.2 s, larger than 5% of TR (0.1 s)
    expect(verifyTriggerTiming(pulses(0.15), TR, 10, 10).status).toBe('verified');
    expect(verifyTriggerTiming(pulses(0.25), TR, 10, 10).status).toBe('corrected');
  });

  it('corrected: shifts by the first pulse time and reports pulses on the new axis', () => {
    const t = verifyTriggerTiming(pulses(0.5), TR, 10, FS);
    expect(t.status).toBe('corrected');
    expect(t.offset).toBeCloseTo(0.5, 12);
    t.triggerTimes.forEach((v, k) => expect(v).toBeCloseTo(k * TR, 12));
  });

  it('corrected also works when the first pulse is before t = 0', () => {
    const t = verifyTriggerTiming(pulses(-0.7), TR, 10, FS);
    expect(t.status).toBe('corrected');
    expect(t.offset).toBeCloseTo(-0.7, 12);
    expect(t.triggerTimes[0]).toBeCloseTo(0, 12);
  });

  it('mismatch on a dropped pulse, naming how many intervals and where the first one is', () => {
    const dropped = pulses(0).filter((_, k) => k !== 4);
    const t = verifyTriggerTiming(dropped, TR, 10, FS);
    expect(t.status).toBe('mismatch');
    expect(t.offset).toBe(0);
    expect(t.triggerTimes).toEqual(dropped);
    expect(t.detail).toBe(
      '1 trigger interval(s) differ from TR 2 s (first: 4.000 s after pulse 4); using sidecar StartTime',
    );
  });

  it('mismatch when spacing is clean but the pulse count differs from the volume count', () => {
    // e.g. 2 dummy scans that fire triggers but are not in the BOLD file
    const t = verifyTriggerTiming(pulses(-4, 12), TR, 10, FS);
    expect(t.status).toBe('mismatch');
    expect(t.offset).toBe(0);
    expect(t.detail).toMatch(/^12 trigger pulses vs 10 volumes/);
  });

  it('a single pulse has no intervals to check and is judged on count and onset only', () => {
    expect(verifyTriggerTiming([0], TR, 1, FS).status).toBe('verified');
    expect(verifyTriggerTiming([0], TR, 10, FS).status).toBe('mismatch');
  });
});
