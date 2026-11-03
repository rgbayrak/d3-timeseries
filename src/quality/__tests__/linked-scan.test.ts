import { describe, it, expect } from 'vitest';
import { lastViewedKey, readLastViewed, saveLastViewed } from '@/viewer/persistence';
import { shareScanWithViewer, viewerScan } from '../linked-scan';

/** Minimal in-memory Storage for Node */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

const NAME = 'DMT-HAR-MED';

describe('scan shared with Explore and Annotate', () => {
  it('reads the scan the viewer last showed for this dataset', () => {
    const store = memoryStorage();
    saveLastViewed(
      lastViewedKey(NAME),
      { sub: '03', ses: '02', task: 'rest', run: '', channel: 'cardiac', confound: 'framewise_displacement' },
      store,
    );
    expect(viewerScan(NAME, store)).toEqual({ sub: '03', ses: '02', task: 'rest', run: '' });
    // another dataset's entry is not used
    expect(viewerScan('Other dataset', store)).toBeNull();
  });

  it('returns null when nothing was saved or the entry is malformed', () => {
    const store = memoryStorage();
    expect(viewerScan(NAME, store)).toBeNull();
    store.setItem(lastViewedKey(NAME), '{"channel":"cardiac"}');
    expect(viewerScan(NAME, store)).toBeNull();
  });

  it('writes the scan for the viewer, keeping its channel choices', () => {
    const store = memoryStorage();
    saveLastViewed(
      lastViewedKey(NAME),
      { sub: '01', ses: '01', task: 'rest', run: '', channel: 'respiratory', confound: 'dvars', stacked: ['cardiac'] },
      store,
    );
    shareScanWithViewer(NAME, { sub: '05', ses: '02', task: 'rest', run: '' }, store);
    expect(readLastViewed(lastViewedKey(NAME), store)).toEqual({
      sub: '05',
      ses: '02',
      task: 'rest',
      run: '',
      channel: 'respiratory',
      confound: 'dvars',
      stacked: ['cardiac'],
    });
  });

  it('writes a usable entry when the viewer has none yet', () => {
    const store = memoryStorage();
    shareScanWithViewer(null, { sub: '02', ses: '', task: 'motor', run: '' }, store);
    expect(readLastViewed(lastViewedKey(null), store)).toEqual({
      sub: '02',
      ses: '',
      task: 'motor',
      run: '',
      channel: '',
      confound: '',
      stacked: [],
    });
    expect(viewerScan(null, store)).toEqual({ sub: '02', ses: '', task: 'motor', run: '' });
  });
});
