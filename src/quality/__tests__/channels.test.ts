import { describe, it, expect } from 'vitest';
import { classifyChannel, channelKeys, isPhysioChannel, PHYSIO_CHANNELS, NON_PHYSIO_CHANNELS } from '../channels';

describe('physio channel dictionary', () => {
  it('accepts every column name found in the local datasets', () => {
    // ds000210, ds006644: cardiac, respiratory (+ trigger)
    // movie10, shinobi (physprep): PPG, ECG, RSP, EDA, EDATonic, EDAPhasic
    expect(['cardiac', 'respiratory'].map(classifyChannel)).toEqual([
      { physio: true, signal: 'cardiac' },
      { physio: true, signal: 'respiratory' },
    ]);
    expect(['PPG', 'ECG', 'RSP', 'EDA', 'EDATonic', 'EDAPhasic'].map((c) => classifyChannel(c))).toEqual([
      { physio: true, signal: 'cardiac' },
      { physio: true, signal: 'cardiac' },
      { physio: true, signal: 'respiratory' },
      { physio: true, signal: 'electrodermal' },
      { physio: true, signal: 'electrodermal' },
      { physio: true, signal: 'electrodermal' },
    ]);
  });

  it('excludes trigger and other scanner/event columns', () => {
    for (const name of ['trigger', 'Trigger', 'TTL', 'scanner_trigger', 'trigger2', 'stim', 'Marker']) {
      expect(isPhysioChannel(name), name).toBe(false);
    }
    expect(classifyChannel('trigger')).toEqual({ physio: false, reason: 'scanner trigger' });
  });

  it('excludes unknown columns instead of guessing', () => {
    expect(classifyChannel('mystery')).toEqual({ physio: false, reason: 'not in the physio channel dictionary' });
    expect(isPhysioChannel('constructor')).toBe(false);
    expect(isPhysioChannel('')).toBe(false);
  });

  it('tolerates case, separators and lead/channel numbers', () => {
    expect(channelKeys('ECG_2')).toEqual(['ecg2', 'ecg']);
    expect(classifyChannel('ECG_2')).toEqual({ physio: true, signal: 'cardiac' });
    expect(classifyChannel('Resp-Belt')).toEqual({ physio: true, signal: 'respiratory' });
    expect(classifyChannel('CO2')).toEqual({ physio: true, signal: 'gas' });
    expect(classifyChannel('etCO2')).toEqual({ physio: true, signal: 'gas' });
  });

  it('keeps the two dictionaries disjoint', () => {
    const overlap = Object.keys(PHYSIO_CHANNELS).filter((k) => k in NON_PHYSIO_CHANNELS);
    expect(overlap).toEqual([]);
  });
});
