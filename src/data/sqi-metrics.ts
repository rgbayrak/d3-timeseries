import { mean, deviation, min, max, median } from 'd3-array';
import type { PhysioRaw } from './bids-physio-reader';

export interface ChannelMetrics {
  channelName: string;
  mean: number;
  stdDev: number;
  min: number;
  max: number;
  median: number;
  percentNonZero: number;
  snr: number;
  kurtosis: number;
  skewness: number;
  zeroCrossingRate: number;
  svri: number;
  ipa: number;
  sqi: number;
  kurtosisWindowed: number;
  approxEntropy: number;
  beatCorrelation: number;
}

export interface SQIResults {
  metrics: ChannelMetrics[];
}

// ── Peak / trough helpers ────────────────────────────────

/** Local maxima with minimum sample distance between peaks. */
function findPeaks(data: number[], minDistance: number): number[] {
  const peaks: number[] = [];
  for (let i = 1; i < data.length - 1; i++) {
    if (data[i] > data[i - 1] && data[i] >= data[i + 1]) {
      if (peaks.length === 0 || i - peaks[peaks.length - 1] >= minDistance) {
        peaks.push(i);
      } else if (data[i] > data[peaks[peaks.length - 1]]) {
        peaks[peaks.length - 1] = i;
      }
    }
  }
  return peaks;
}

/** Index of the minimum value in data[start..end). */
function indexOfMin(data: number[], start: number, end: number): number {
  let idx = start;
  for (let i = start + 1; i < end; i++) {
    if (data[i] < data[idx]) idx = i;
  }
  return idx;
}

/**
 * Approximate dicrotic notch: first local minimum in the first 60 %
 * of the descent from a systolic peak to the next trough.
 */
function findDicroticNotch(data: number[], peak: number, nextTrough: number): number {
  const searchEnd = Math.min(
    peak + Math.max(3, Math.floor(0.6 * (nextTrough - peak))),
    data.length - 1,
  );
  for (let i = peak + 2; i < searchEnd; i++) {
    if (data[i] <= data[i - 1] && data[i] <= data[i + 1]) {
      return i;
    }
  }
  return indexOfMin(data, peak + 1, searchEnd + 1);
}

// ── PhysioQC helpers ─────────────────────────────────────

/** Approximate entropy (Pincus 1991) with embedding dimension m and tolerance r. */
function approximateEntropy(data: number[], m: number, r: number): number {
  const N = data.length;

  function phi(dim: number): number {
    const len = N - dim + 1;
    if (len <= 0) return 0;
    const counts = new Float64Array(len);
    for (let i = 0; i < len; i++) {
      let count = 0;
      for (let j = 0; j < len; j++) {
        // Chebyshev distance (max absolute difference)
        let maxDiff = 0;
        for (let k = 0; k < dim; k++) {
          const diff = Math.abs(data[i + k] - data[j + k]);
          if (diff > maxDiff) maxDiff = diff;
        }
        if (maxDiff <= r) count++;
      }
      counts[i] = count / len;
    }
    let sum = 0;
    for (let i = 0; i < len; i++) {
      sum += Math.log(counts[i]);
    }
    return sum / len;
  }

  return phi(m) - phi(m + 1);
}

/** Linearly resample a segment to a fixed number of points. */
function resampleLinear(segment: number[], targetLength: number): number[] {
  const n = segment.length;
  if (n === 0) return new Array(targetLength).fill(0);
  if (n === 1) return new Array(targetLength).fill(segment[0]);
  const result = new Array<number>(targetLength);
  for (let i = 0; i < targetLength; i++) {
    const t = (i / (targetLength - 1)) * (n - 1);
    const lo = Math.floor(t);
    const hi = Math.min(lo + 1, n - 1);
    const frac = t - lo;
    result[i] = segment[lo] * (1 - frac) + segment[hi] * frac;
  }
  return result;
}

/** Pearson correlation coefficient between two equal-length arrays. */
function pearsonCorrelation(a: number[], b: number[]): number {
  const n = a.length;
  let sumA = 0, sumB = 0;
  for (let i = 0; i < n; i++) { sumA += a[i]; sumB += b[i]; }
  const meanA = sumA / n;
  const meanB = sumB / n;

  let cov = 0, varA = 0, varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (varA === 0 || varB === 0) return NaN;
  return cov / Math.sqrt(varA * varB);
}

// ── Channel metrics ──────────────────────────────────────

function computeChannelMetrics(
  data: number[],
  channelName: string,
  samplingFrequency: number,
): ChannelMetrics {
  const n = data.length;

  const mu = mean(data) ?? 0;
  const sd = deviation(data) ?? 0;
  const lo = min(data) ?? 0;
  const hi = max(data) ?? 0;
  const med = median(data) ?? 0;

  // Percent non-zero
  let nonZeroCount = 0;
  for (let i = 0; i < n; i++) {
    if (data[i] !== 0) nonZeroCount++;
  }
  const percentNonZero = n > 0 ? (nonZeroCount / n) * 100 : 0;

  // SNR
  const snr = sd === 0 ? Infinity : mu / sd;

  // Skewness and kurtosis (single pass)
  let m3 = 0;
  let m4 = 0;
  for (let i = 0; i < n; i++) {
    const d = data[i] - mu;
    const d2 = d * d;
    m3 += d2 * d;
    m4 += d2 * d2;
  }

  let skewness: number;
  let kurtosis: number;
  if (sd === 0 || n < 3) {
    skewness = NaN;
    kurtosis = NaN;
  } else {
    const sd3 = sd * sd * sd;
    const sd4 = sd3 * sd;
    skewness = m3 / (n * sd3);
    kurtosis = m4 / (n * sd4) - 3; // excess kurtosis
  }

  // Zero-crossing rate
  let crossings = 0;
  for (let i = 1; i < n; i++) {
    if ((data[i] >= 0 && data[i - 1] < 0) || (data[i] < 0 && data[i - 1] >= 0)) {
      crossings++;
    }
  }
  const durationSec = n > 0 ? n / samplingFrequency : 1;
  const zeroCrossingRate = crossings / durationSec;

  // ── PaPaGei morphology metrics (cardiac / PPG only) ─────

  const isPulsatile = /cardiac|ppg|pulse|ecg|pleth/i.test(channelName);
  const isRespiratory = /respiratory|resp|rsp|chest|belt|breath/i.test(channelName);

  const minPeakDist = Math.max(1, Math.floor(0.3 * samplingFrequency));
  const peaks = isPulsatile ? findPeaks(data, minPeakDist) : [];

  let svri = NaN;
  let ipa = NaN;

  if (isPulsatile && peaks.length >= 2) {
    // Trough boundaries: one before each peak + one after the last
    const troughs: number[] = [indexOfMin(data, 0, peaks[0] + 1)];
    for (let p = 0; p < peaks.length - 1; p++) {
      troughs.push(indexOfMin(data, peaks[p], peaks[p + 1]));
    }
    troughs.push(indexOfMin(data, peaks[peaks.length - 1], n));

    // sVRI: mean post-systolic / mean pre-systolic per beat, averaged
    //   sVRI(x) = [sys × Σ(i=sys..n) x_i] / [(n−sys) × Σ(i=1..sys) x_i]
    let svriSum = 0;
    let svriCount = 0;
    for (let b = 0; b < peaks.length; b++) {
      const bStart = troughs[b];
      const bEnd = troughs[b + 1];
      const sys = peaks[b] - bStart;
      const beatLen = bEnd - bStart;
      if (sys <= 0 || sys >= beatLen) continue;

      let preSum = 0;
      for (let j = bStart; j < peaks[b]; j++) preSum += data[j];
      let postSum = 0;
      for (let j = peaks[b]; j < bEnd; j++) postSum += data[j];

      if (preSum === 0) continue;
      const v = (sys * postSum) / ((beatLen - sys) * preSum);
      if (isFinite(v)) { svriSum += v; svriCount++; }
    }
    if (svriCount > 0) svri = svriSum / svriCount;

    // IPA: systolic area / diastolic area per beat, split at dicrotic notch
    //   IPA(x) = ∫₀^n̂ x dn / ∫_{n̂}^n x dn
    let ipaSum = 0;
    let ipaCount = 0;
    for (let b = 0; b < peaks.length; b++) {
      const bStart = troughs[b];
      const bEnd = troughs[b + 1];
      if (bEnd - bStart < 3) continue;

      const notch = findDicroticNotch(data, peaks[b], bEnd);

      let systolicArea = 0;
      for (let j = bStart; j <= notch; j++) systolicArea += data[j];
      let diastolicArea = 0;
      for (let j = notch + 1; j < bEnd; j++) diastolicArea += data[j];

      if (diastolicArea === 0) continue;
      const v = systolicArea / diastolicArea;
      if (isFinite(v)) { ipaSum += v; ipaCount++; }
    }
    if (ipaCount > 0) ipa = ipaSum / ipaCount;
  }

  // SQI: mean skewness over 5-second windows (cardiac / PPG only)
  //   SQI(x) = (1/W) Σ_w [m₃ / m₂^(3/2)]
  //   m_i = (1/(5f)) Σ_{j=1}^{5f} [x_j − μ]^i
  let sqi = NaN;
  const windowSize = Math.floor(5 * samplingFrequency);
  if (isPulsatile && windowSize > 2 && n >= windowSize) {
    const numWindows = Math.floor(n / windowSize);
    let sqiSum = 0;
    let sqiCount = 0;

    for (let w = 0; w < numWindows; w++) {
      const wStart = w * windowSize;

      let wSum = 0;
      for (let j = wStart; j < wStart + windowSize; j++) wSum += data[j];
      const wMean = wSum / windowSize;

      let wm2 = 0;
      let wm3 = 0;
      for (let j = wStart; j < wStart + windowSize; j++) {
        const d = data[j] - wMean;
        const d2 = d * d;
        wm2 += d2;
        wm3 += d2 * d;
      }
      wm2 /= windowSize;
      wm3 /= windowSize;

      const denom = Math.pow(wm2, 1.5);
      if (denom === 0) continue;
      sqiSum += wm3 / denom;
      sqiCount++;
    }
    if (sqiCount > 0) sqi = sqiSum / sqiCount;
  }

  // ── PhysioQC: Windowed Kurtosis (Elgendi 2016, 60 s windows) ──
  let kurtosisWindowed = NaN;
  const kurtWinSize = Math.floor(60 * samplingFrequency);
  if (isPulsatile && kurtWinSize > 2 && n >= kurtWinSize) {
    const numWin = Math.floor(n / kurtWinSize);
    let kurtSum = 0;
    let kurtCount = 0;

    for (let w = 0; w < numWin; w++) {
      const wStart = w * kurtWinSize;

      let wSum = 0;
      for (let j = wStart; j < wStart + kurtWinSize; j++) wSum += data[j];
      const wMean = wSum / kurtWinSize;

      let wm2 = 0;
      let wm4 = 0;
      for (let j = wStart; j < wStart + kurtWinSize; j++) {
        const d = data[j] - wMean;
        const d2 = d * d;
        wm2 += d2;
        wm4 += d2 * d2;
      }
      wm2 /= kurtWinSize;
      wm4 /= kurtWinSize;

      if (wm2 === 0) continue;
      kurtSum += wm4 / (wm2 * wm2) - 3; // excess kurtosis
      kurtCount++;
    }
    if (kurtCount > 0) kurtosisWindowed = kurtSum / kurtCount;
  }

  // ── PhysioQC: Approximate Entropy (Elgendi 2016, 1 s windows) ──
  let approxEntropy = NaN;
  const apenWinSize = Math.floor(1 * samplingFrequency);
  if (isPulsatile && apenWinSize > 2 && n >= apenWinSize) {
    const numWin = Math.floor(n / apenWinSize);
    let apenSum = 0;
    let apenCount = 0;

    for (let w = 0; w < numWin; w++) {
      const wStart = w * apenWinSize;
      const window: number[] = [];
      let wSum = 0;
      for (let j = wStart; j < wStart + apenWinSize; j++) {
        window.push(data[j]);
        wSum += data[j];
      }
      const wMean = wSum / apenWinSize;
      let wVar = 0;
      for (let j = 0; j < apenWinSize; j++) {
        const d = window[j] - wMean;
        wVar += d * d;
      }
      const wStd = Math.sqrt(wVar / apenWinSize);
      if (wStd === 0) continue;

      const val = approximateEntropy(window, 2, 0.2 * wStd);
      if (isFinite(val)) { apenSum += val; apenCount++; }
    }
    if (apenCount > 0) approxEntropy = apenSum / apenCount;
  }

  // ── PhysioQC: Beat/Breath Correlation (Romano 2023) ────────
  let beatCorrelation = NaN;
  if (isPulsatile || isRespiratory) {
    const bcMinDist = isRespiratory
      ? Math.max(1, Math.floor(1.5 * samplingFrequency))
      : minPeakDist;
    const bcPeaks = (isPulsatile && peaks.length >= 2) ? peaks : findPeaks(data, bcMinDist);

    if (bcPeaks.length >= 3) {
      const TARGET_LEN = 100;
      const segments: number[][] = [];

      for (let p = 0; p < bcPeaks.length - 1; p++) {
        const seg = data.slice(bcPeaks[p], bcPeaks[p + 1]);
        if (seg.length >= 2) {
          segments.push(resampleLinear(seg, TARGET_LEN));
        }
      }

      if (segments.length >= 2) {
        // Compute average waveform
        const avgWaveform = new Array<number>(TARGET_LEN).fill(0);
        for (const seg of segments) {
          for (let i = 0; i < TARGET_LEN; i++) avgWaveform[i] += seg[i];
        }
        for (let i = 0; i < TARGET_LEN; i++) avgWaveform[i] /= segments.length;

        // Mean Pearson correlation of each segment vs average
        let corrSum = 0;
        let corrCount = 0;
        for (const seg of segments) {
          const r = pearsonCorrelation(seg, avgWaveform);
          if (isFinite(r)) { corrSum += r; corrCount++; }
        }
        if (corrCount > 0) beatCorrelation = corrSum / corrCount;
      }
    }
  }

  return {
    channelName,
    mean: mu,
    stdDev: sd,
    min: lo,
    max: hi,
    median: med,
    percentNonZero,
    snr,
    kurtosis,
    skewness,
    zeroCrossingRate,
    svri,
    ipa,
    sqi,
    kurtosisWindowed,
    approxEntropy,
    beatCorrelation,
  };
}

export function computeSQI(raw: PhysioRaw): SQIResults {
  const metrics: ChannelMetrics[] = [];
  for (let i = 0; i < raw.columns.length; i++) {
    metrics.push(
      computeChannelMetrics(raw.data[i], raw.columns[i], raw.samplingFrequency),
    );
  }
  return { metrics };
}
