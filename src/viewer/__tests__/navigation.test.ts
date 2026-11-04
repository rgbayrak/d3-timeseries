import { describe, it, expect } from 'vitest';
import { stepScan, resolveSearch, isScanStepKey, pickStartScan } from '../navigation';
import { validStacked, toggleStacked, physioColumns } from '../controls';

describe('physioColumns', () => {
  it('offers only physiological channels, never trigger', () => {
    expect(physioColumns(['cardiac', 'respiratory', 'trigger'])).toEqual(['cardiac', 'respiratory']);
  });

  it('falls back to every column when none is in the dictionary', () => {
    expect(physioColumns(['foo', 'bar'])).toEqual(['foo', 'bar']);
  });
});

const s = (sub: string, ses: string, run = '01') => ({ sub, ses, task: 'rest', run });
const scans = [s('01', '01'), s('01', '02'), s('02', '01'), s('02', '02')];

describe('pickStartScan', () => {
  it('opens a linked scan first, then the earliest unannotated, then the last viewed, then the first', () => {
    const all = { linked: scans[3], firstUnannotated: scans[1], lastViewed: scans[2] };
    expect(pickStartScan(scans, all)).toEqual(scans[3]);
    expect(pickStartScan(scans, { ...all, linked: null })).toEqual(scans[1]);
    expect(pickStartScan(scans, { lastViewed: scans[2], firstUnannotated: null })).toEqual(scans[2]);
    expect(pickStartScan(scans, {})).toEqual(scans[0]);
  });

  it('skips candidates that are not in the dataset', () => {
    expect(pickStartScan(scans, { linked: s('99', '01'), firstUnannotated: scans[1] })).toEqual(scans[1]);
    expect(pickStartScan([], {})).toBeUndefined();
  });
});

describe('stepScan', () => {
  it('steps forward and back in hierarchy order', () => {
    expect(stepScan(scans, scans[1], 1)).toEqual(scans[2]);
    expect(stepScan(scans, scans[1], -1)).toEqual(scans[0]);
  });

  it('wraps around at both ends', () => {
    expect(stepScan(scans, scans[3], 1)).toEqual(scans[0]);
    expect(stepScan(scans, scans[0], -1)).toEqual(scans[3]);
  });

  it('starts from the beginning when the current scan is not in the list', () => {
    expect(stepScan(scans, s('99', '01'), 1)).toEqual(scans[0]);
  });
});

describe('resolveSearch', () => {
  it('matches a subject with or without the sub- prefix, at its first scan', () => {
    expect(resolveSearch('sub-02', scans, '01')).toEqual(scans[2]);
    expect(resolveSearch('02', scans, '01')).toEqual(scans[2]);
  });

  it('prefers a session of the current subject over other subjects', () => {
    const many = [s('01', '01'), s('01', '05'), s('03', '07'), s('04', '05')];
    expect(resolveSearch('ses-05', many, '04')).toEqual(many[3]);
    expect(resolveSearch('ses-07', many, '04')).toEqual(many[2]);
  });

  it('a bare label matches a subject before a session', () => {
    // "01" is both a subject and a session label
    expect(resolveSearch('01', scans, '02')).toEqual(scans[0]);
  });

  it('returns null for no match or an empty query', () => {
    expect(resolveSearch('sub-99', scans, '01')).toBeNull();
    expect(resolveSearch('   ', scans, '01')).toBeNull();
  });
});

describe('isScanStepKey', () => {
  const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
    key: k,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...mods,
  });

  it('accepts bare left/right arrows only', () => {
    expect(isScanStepKey(key('ArrowLeft'))).toBe(true);
    expect(isScanStepKey(key('ArrowRight'))).toBe(true);
    expect(isScanStepKey(key('ArrowUp'))).toBe(false);
  });

  it('leaves modified arrows to the browser (e.g. Alt+Left = back)', () => {
    expect(isScanStepKey(key('ArrowLeft', { altKey: true }))).toBe(false);
    expect(isScanStepKey(key('ArrowRight', { metaKey: true }))).toBe(false);
  });
});

describe('stacked channel selection', () => {
  const columns = ['cardiac', 'respiratory', 'trigger', 'ppg'];

  it('drops the main channel and channels the scan lacks', () => {
    expect(validStacked(['respiratory', 'cardiac', 'eda'], columns, 'cardiac')).toEqual(['respiratory']);
  });

  it('keeps column order regardless of click order', () => {
    let stacked: string[] = [];
    stacked = toggleStacked(stacked, columns, 'ppg', true);
    stacked = toggleStacked(stacked, columns, 'respiratory', true);
    expect(stacked).toEqual(['respiratory', 'ppg']);
    expect(toggleStacked(stacked, columns, 'ppg', false)).toEqual(['respiratory']);
  });
});
