import { describe, it, expect } from 'vitest';
import { METRIC_COLUMNS } from '../metrics-tsv';
import type { MetricKey, QualityRow } from '../metrics-tsv';
import {
  ALL_METRICS,
  METRIC_GROUPS,
  availableMetrics,
  defaultMetricPair,
  groupKeys,
  groupState,
  metricAxisChoices,
  metricAxisLabel,
  metricUnit,
  parseVisibleMetrics,
  serializeVisibleMetrics,
  toggleGroup,
  xAxisChoices,
  yAxisChoices,
} from '../model';

function row(metrics: Partial<Record<MetricKey, number>>): QualityRow {
  const m = {} as Record<MetricKey, number>;
  for (const c of METRIC_COLUMNS) m[c.key] = NaN;
  return {
    sub: '01',
    ses: '',
    task: 'rest',
    run: '',
    filename: 'f',
    channel: 'cardiac',
    signalType: 'cardiac',
    samplingFrequency: 100,
    numSamples: 100,
    durationS: 1,
    timingStatus: 'verified',
    sidecarAssessment: '',
    sidecarPercentValid: NaN,
    metrics: { ...m, ...metrics },
  };
}

describe('metric groups', () => {
  it('uses the viewer SQI table groups and covers every metric once', () => {
    expect(METRIC_GROUPS).toEqual(['Basic', 'Distribution', 'PaPaGei', 'PhysioQC']);
    expect(METRIC_GROUPS.flatMap(groupKeys).sort()).toEqual([...ALL_METRICS].sort());
    expect(groupKeys('PaPaGei')).toEqual(['svri', 'ipa', 'sqi']);
  });

  it('reports and toggles a group', () => {
    const all = new Set(ALL_METRICS);
    expect(groupState(all, 'PaPaGei')).toBe('all');
    const without = toggleGroup(all, 'PaPaGei');
    expect(groupState(without, 'PaPaGei')).toBe('none');
    expect(without.has('snr')).toBe(true);

    const partial = new Set<MetricKey>(['svri']);
    expect(groupState(partial, 'PaPaGei')).toBe('some');
    // a partly shown group is completed, not cleared
    expect(groupState(toggleGroup(partial, 'PaPaGei'), 'PaPaGei')).toBe('all');
  });
});

describe('stored choice', () => {
  it('defaults to every metric', () => {
    expect([...parseVisibleMetrics(null)]).toEqual(ALL_METRICS);
    expect([...parseVisibleMetrics('not json')]).toEqual(ALL_METRICS);
    expect([...parseVisibleMetrics('{"a":1}')]).toEqual(ALL_METRICS);
  });

  it('round-trips, drops unknown keys and keeps an empty choice', () => {
    const chosen = new Set<MetricKey>(['beatCorrelation', 'snr']);
    const stored = serializeVisibleMetrics(chosen);
    expect(stored).toBe('["snr","beatCorrelation"]');
    expect(parseVisibleMetrics(stored)).toEqual(chosen);
    expect([...parseVisibleMetrics('["snr","removedMetric"]')]).toEqual(['snr']);
    expect(parseVisibleMetrics('[]').size).toBe(0);
  });
});

describe('axis units', () => {
  const units = { cardiac: 'mV' };

  it('uses the channel unit for mean and SD, a fixed unit for ZCR, none otherwise', () => {
    expect(metricUnit('mean', 'cardiac', units)).toBe('mV');
    expect(metricUnit('stdDev', 'cardiac', units)).toBe('mV');
    expect(metricUnit('mean', 'respiratory', units)).toBeNull();
    expect(metricUnit('mean', 'cardiac')).toBeNull();
    expect(metricUnit('zeroCrossingRate', 'cardiac')).toBe('Hz');
    expect(metricUnit('snr', 'cardiac', units)).toBeNull();
  });

  it('adds the unit to axis labels without repeating one already there', () => {
    expect(metricAxisLabel('mean', 'cardiac', units)).toBe('Mean (mV)');
    expect(metricAxisLabel('mean', 'respiratory', units)).toBe('Mean');
    expect(metricAxisLabel('zeroCrossingRate', 'cardiac')).toBe('ZCR (Hz)');
    const rows = [row({ mean: 1, snr: 2 })];
    expect(metricAxisChoices(rows, undefined, units).map((c) => c.label)).toEqual(['Mean (mV)', 'SNR']);
  });
});

describe('hidden metrics leave the plots', () => {
  const rows = [row({ snr: 1, kurtosis: 2, beatCorrelation: 0.9 })];

  it('filters available metrics and axis menus', () => {
    const visible = new Set<MetricKey>(['snr', 'kurtosis']);
    expect(availableMetrics(rows)).toEqual(['snr', 'kurtosis', 'beatCorrelation']);
    expect(availableMetrics(rows, visible)).toEqual(['snr', 'kurtosis']);
    expect(metricAxisChoices(rows, visible).map((c) => c.value)).toEqual(['snr', 'kurtosis']);
    expect(yAxisChoices(rows, visible).map((c) => c.value)).toEqual(['snr', 'kurtosis']);
    expect(xAxisChoices(rows, null, rows, visible).map((c) => c.value)).toEqual(['snr', 'kurtosis']);
  });

  it('picks default axes among the visible metrics', () => {
    expect(defaultMetricPair(rows)).toEqual(['snr', 'beatCorrelation']);
    expect(defaultMetricPair(rows, new Set<MetricKey>(['snr', 'kurtosis']))).toEqual(['snr', 'kurtosis']);
  });

  it('shows nothing when every metric is hidden', () => {
    expect(availableMetrics(rows, new Set())).toEqual([]);
    expect(yAxisChoices(rows, new Set())).toEqual([]);
  });
});
