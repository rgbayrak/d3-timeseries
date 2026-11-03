import type { ChannelMetrics } from '@/data/sqi-metrics';

// Labels, decimals, descriptions and groups for each per-channel quality metric.
// The Stats tabs (src/quality/model.ts) and their PDF take metric names from
// here. Explore and Annotate no longer shows a metrics table.

export interface ColDef {
  label: string;
  key: keyof ChannelMetrics;
  decimals: number;
  description?: string;
  /** 'always' is the channel name; the others are the metric groups below */
  group: string;
}

export const SQI_COLUMNS: ColDef[] = [
  { label: 'Channel', key: 'channelName', decimals: 0, group: 'always' },
  { label: 'Mean', key: 'mean', decimals: 4, group: 'Basic' },
  { label: 'Std Dev', key: 'stdDev', decimals: 4, description: 'Standard deviation (spread of values around the mean). Range: [0, +∞)', group: 'Basic' },
  { label: 'SNR', key: 'snr', decimals: 3, description: 'Signal-to-noise ratio (mean / std dev). Higher is cleaner.', group: 'Distribution' },
  { label: 'Kurtosis', key: 'kurtosis', decimals: 3, description: 'Excess kurtosis — tailedness of the distribution. 0 = normal, >0 = heavy tails, <0 = light tails.', group: 'Distribution' },
  { label: 'Skewness', key: 'skewness', decimals: 3, description: 'Asymmetry of the distribution. 0 = symmetric, >0 = right-skewed, <0 = left-skewed.', group: 'Distribution' },
  { label: 'ZCR (Hz)', key: 'zeroCrossingRate', decimals: 2, description: 'Zero-crossing rate — number of sign changes per second. Higher values indicate higher-frequency content.', group: 'Distribution' },
  { label: 'sVRI', key: 'svri', decimals: 3, description: 'Stress-induced Vascular Response Index — ratio of mean post- to pre-systolic amplitude, averaged across beats (PaPaGei).', group: 'PaPaGei' },
  { label: 'IPA', key: 'ipa', decimals: 3, description: 'Inflection Point Area ratio — systolic area / diastolic area split at dicrotic notch, averaged across beats (PaPaGei).', group: 'PaPaGei' },
  { label: 'SQI', key: 'sqi', decimals: 3, description: 'Signal Quality Index — mean skewness over 5-second windows (PaPaGei). Range: (-∞, +∞)', group: 'PaPaGei' },
  { label: 'Kurt (win)', key: 'kurtosisWindowed', decimals: 3, description: 'Mean excess kurtosis over 60 s windows (Elgendi 2016).', group: 'PhysioQC' },
  { label: 'ApEn', key: 'approxEntropy', decimals: 4, description: 'Approximate entropy — signal regularity (Elgendi 2016, m=2, r=0.2×SD). Lower = more regular.', group: 'PhysioQC' },
  { label: 'Beat Corr', key: 'beatCorrelation', decimals: 3, description: 'Mean Pearson correlation of each beat/breath vs average waveform (Romano 2023).', group: 'PhysioQC' },
];

export const SQI_GROUPS = ['Basic', 'Distribution', 'PaPaGei', 'PhysioQC'];

export function formatMetricValue(val: number, decimals: number): string {
  if (val === Infinity) return 'Inf';
  if (val === -Infinity) return '-Inf';
  if (Number.isNaN(val)) return 'N/A';
  return val.toFixed(decimals);
}
