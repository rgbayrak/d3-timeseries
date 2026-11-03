import { describe, it, expect } from 'vitest';
import { SQI_COLUMNS, SQI_GROUPS, formatMetricValue } from '../sqi-table';
import { bareDoi, qualityBadgeLabel, TIMING_LABELS } from '../info';
import type { ChannelMetrics } from '@/data/sqi-metrics';

const metrics = (over: Partial<ChannelMetrics> = {}): ChannelMetrics => ({
  channelName: 'cardiac',
  mean: 0.123456,
  stdDev: 1,
  snr: Infinity,
  kurtosis: -1.5,
  skewness: 0,
  zeroCrossingRate: 2,
  svri: NaN,
  ipa: NaN,
  sqi: NaN,
  kurtosisWindowed: NaN,
  approxEntropy: NaN,
  beatCorrelation: 0.99,
  ...over,
});

describe('metric column definitions', () => {
  it('has a column definition for every metric', () => {
    const keys = Object.keys(metrics());
    expect(SQI_COLUMNS.map((c) => c.key).sort()).toEqual(keys.sort());
    for (const c of SQI_COLUMNS) {
      expect(c.group === 'always' || SQI_GROUPS.includes(c.group)).toBe(true);
    }
  });

  it('formats infinite and undefined values readably', () => {
    expect(formatMetricValue(Infinity, 2)).toBe('Inf');
    expect(formatMetricValue(-Infinity, 2)).toBe('-Inf');
    expect(formatMetricValue(NaN, 2)).toBe('N/A');
    expect(formatMetricValue(0.123456, 3)).toBe('0.123');
  });
});

describe('dataset info and badges', () => {
  it('normalises DOIs from dataset_description.json', () => {
    expect(bareDoi('doi:10.18112/openneuro.ds006644.v1.0.0')).toBe('10.18112/openneuro.ds006644.v1.0.0');
    expect(bareDoi('https://doi.org/10.1/x')).toBe('10.1/x');
    expect(bareDoi('http://dx.doi.org/10.1/x')).toBe('10.1/x');
    expect(bareDoi('10.1/x')).toBe('10.1/x');
  });

  it('labels quality badges with the assessment and percentage', () => {
    expect(qualityBadgeLabel('cardiac', 'pass', null)).toBe('cardiac: pass');
    expect(qualityBadgeLabel('cardiac', 'pass', 0.5)).toBe('cardiac: pass (50%)');
  });

  it('has a label for every timing status', () => {
    expect(Object.keys(TIMING_LABELS).sort()).toEqual(['corrected', 'mismatch', 'unverified', 'verified']);
  });
});
