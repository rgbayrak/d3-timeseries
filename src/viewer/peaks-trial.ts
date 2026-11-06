import type { PeaksRaw } from '@/data/bids-physio-reader';
import { channelKeys, classifyChannel } from '@/quality/channels';

// TRIAL (not a supported feature yet): match the peaks in a physprep-style
// events file to the channel shown in the main chart. All of the peaks trial
// lives in this file and charts/peaks-trial.ts, so it is easy to remove.

export interface Peak {
  time: number;
  /** true for a corrected peak, false for a detected one */
  corrected: boolean;
}

/**
 * Peak channel (as written in the events file) that belongs to the selected
 * physio column, or null:
 *  1. same name after the dictionary's normalisation (ECG ↔ ecg), full name first
 *  2. else, for a generic column name (e.g. cardiac), the one peak channel of the
 *     same signal type, but only when the scan has a single physio column of
 *     that type; ECG and PPG are both cardiac, so type alone must not decide
 */
export function matchPeakChannel(selected: string, peakChannels: string[], physioColumns: string[]): string | null {
  const unique = [...new Set(peakChannels)];
  const [selFull, ...selRest] = channelKeys(selected);
  const full = unique.find((p) => channelKeys(p)[0] === selFull);
  if (full) return full;
  const selKeys = new Set([selFull, ...selRest]);
  const partial = unique.find((p) => channelKeys(p).some((k) => selKeys.has(k)));
  if (partial) return partial;

  const sel = classifyChannel(selected);
  if (!sel.physio) return null;
  const sameType = (name: string) => {
    const c = classifyChannel(name);
    return c.physio && c.signal === sel.signal;
  };
  if (physioColumns.filter(sameType).length !== 1) return null;
  const candidates = unique.filter(sameType);
  return candidates.length === 1 ? candidates[0] : null;
}

/** Peaks of the selected column, sorted by time; empty when none match */
export function peaksForChannel(peaks: PeaksRaw | null, selected: string, physioColumns: string[]): Peak[] {
  if (!peaks) return [];
  const channel = matchPeakChannel(selected, peaks.channel, physioColumns);
  if (!channel) return [];
  const out: Peak[] = [];
  peaks.time.forEach((time, i) => {
    if (peaks.channel[i] === channel) out.push({ time, corrected: peaks.corrected[i] });
  });
  return out.sort((a, b) => a.time - b.time);
}
