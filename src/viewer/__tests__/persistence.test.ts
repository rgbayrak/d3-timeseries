import { describe, it, expect } from 'vitest';
import { lastViewedKey, saveLastViewed, readLastViewed, resumeFrom } from '../persistence';
import type { LastViewed } from '../persistence';

/** Minimal in-memory Storage */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

const throwingStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('quota');
  },
} as unknown as Storage;

const scans = [
  { sub: '01', ses: '01', task: 'rest', run: '01' },
  { sub: '02', ses: '01', task: 'rest', run: '01' },
];

const saved: LastViewed = {
  ...scans[1],
  channel: 'respiratory',
  confound: 'rot_x',
  event: 'trial_type',
  stacked: ['cardiac'],
};

describe('last-viewed storage', () => {
  it('scopes the key per dataset', () => {
    expect(lastViewedKey('ds006644')).not.toBe(lastViewedKey('ds000210'));
    expect(lastViewedKey(null)).toMatch(/:unnamed$/);
  });

  it('round-trips through storage', () => {
    const store = memoryStorage();
    saveLastViewed('k', saved, store);
    expect(readLastViewed('k', store)).toEqual(saved);
  });

  it('returns null for a missing or corrupt entry', () => {
    const store = memoryStorage();
    expect(readLastViewed('k', store)).toBeNull();
    store.setItem('k', '{not json');
    expect(readLastViewed('k', store)).toBeNull();
  });

  it('never throws when storage is blocked or unavailable', () => {
    expect(() => saveLastViewed('k', saved, throwingStorage)).not.toThrow();
    expect(readLastViewed('k', throwingStorage)).toBeNull();
    expect(readLastViewed('k', null)).toBeNull();
  });
});

describe('resumeFrom', () => {
  it('resumes the saved scan with its channel, confound, events column and stack', () => {
    expect(resumeFrom(saved, scans)).toEqual({
      scan: scans[1],
      selection: { channel: 'respiratory', confound: 'rot_x', event: 'trial_type', stacked: ['cardiac'] },
    });
  });

  it('treats entries saved before the events figure existed as no events column', () => {
    const old: LastViewed = { ...saved };
    delete old.event;
    expect(resumeFrom(old, scans)?.selection.event).toBe('');
  });

  it('returns null when the saved scan is no longer in the dataset', () => {
    expect(resumeFrom({ ...saved, sub: '99' }, scans)).toBeNull();
    expect(resumeFrom(null, scans)).toBeNull();
  });

  it('treats entries saved before stacked channels existed as an empty stack', () => {
    const old: LastViewed = { ...saved };
    delete old.stacked;
    expect(resumeFrom(old, scans)?.selection.stacked).toEqual([]);
  });
});
