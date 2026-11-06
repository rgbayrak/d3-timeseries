import { describe, it, expect } from 'vitest';
import { matchPeakChannel, peaksForChannel } from '../peaks-trial';
import type { PeaksRaw } from '@/data/bids-physio-reader';

// TRIAL: peaks overlay

const peaks: PeaksRaw = {
  filename: 'sub-01_ses-001_task-bourne01_events.tsv',
  time: [1.046, 0.694, 0.694, 1.171, 1.171],
  channel: ['ECG', 'ECG', 'ECG', 'PPG', 'PPG'],
  corrected: [false, false, true, false, true],
};

describe('matchPeakChannel', () => {
  it('matches the same name, ignoring case and separators', () => {
    expect(matchPeakChannel('ecg', ['ECG', 'PPG'], ['ecg', 'ppg'])).toBe('ECG');
    expect(matchPeakChannel('PPG', ['ECG', 'PPG'], ['ecg', 'ppg'])).toBe('PPG');
  });

  it('prefers the full name over a numbered one', () => {
    expect(matchPeakChannel('ECG2', ['ECG', 'ECG2'], ['ECG', 'ECG2'])).toBe('ECG2');
  });

  it('never puts ECG peaks on PPG, although both are cardiac', () => {
    expect(matchPeakChannel('ppg', ['ECG'], ['ecg', 'ppg'])).toBeNull();
  });

  it('matches a generic column by signal type only when it is unambiguous', () => {
    expect(matchPeakChannel('cardiac', ['ECG'], ['cardiac', 'respiratory'])).toBe('ECG');
    // two cardiac peak channels: which one is "cardiac"?
    expect(matchPeakChannel('cardiac', ['ECG', 'PPG'], ['cardiac', 'respiratory'])).toBeNull();
    // two cardiac columns in the scan
    expect(matchPeakChannel('cardiac', ['ECG'], ['cardiac', 'ppg'])).toBeNull();
  });

  it('matches nothing for a non-physio column', () => {
    expect(matchPeakChannel('trigger', ['ECG'], ['ecg', 'trigger'])).toBeNull();
  });
});

describe('peaksForChannel', () => {
  it('keeps the matched channel, sorted by time, detected and corrected', () => {
    expect(peaksForChannel(peaks, 'ecg', ['ecg', 'ppg'])).toEqual([
      { time: 0.694, corrected: false },
      { time: 0.694, corrected: true },
      { time: 1.046, corrected: false },
    ]);
  });

  it('is empty without peaks or a match', () => {
    expect(peaksForChannel(null, 'ecg', ['ecg'])).toEqual([]);
    expect(peaksForChannel(peaks, 'respiratory', ['respiratory'])).toEqual([]);
  });
});
