import { describe, it, expect } from 'vitest';
import { descriptionNoticeLines, isPlaceholder, noticeText } from '../dataset-notice';
import type { DescriptionNotice } from '../dataset-notice';

const ok: DescriptionNotice = { file: '/ds/dataset_description.json', source: 'main', missingFields: [], mainMissing: null };
const text = (n: DescriptionNotice) => descriptionNoticeLines(n).map(noticeText);

describe('isPlaceholder', () => {
  it('flags empty, letterless and stock placeholder values', () => {
    for (const v of ['', '   ', '123', '-', 'n/a', 'N/A', 'NA', 'None', 'Unknown', '[Unspecified]', 'TODO', '"TBD"', 'Author', 'Author 1', '[Author1]', null, 3]) {
      expect(isPlaceholder(v)).toBe(true);
    }
  });

  it('keeps real names, including one-word names', () => {
    for (const v of ['Ada', 'Jane Doe', 'The CNeuroMod team', 'Friends', 'Authority study']) {
      expect(isPlaceholder(v)).toBe(false);
    }
  });
});

describe('descriptionNoticeLines', () => {
  it('says nothing when the main description has a title and authors', () => {
    expect(descriptionNoticeLines(ok)).toEqual([]);
    expect(descriptionNoticeLines(undefined)).toEqual([]);
  });

  it('asks for the missing fields in the file that was read', () => {
    expect(text({ ...ok, missingFields: ['Name', 'Authors'] })).toEqual([
      'No dataset title or authors found in /ds/dataset_description.json. Add "Name" and "Authors" to it so the header, Stats tab and PDF report name the dataset.',
    ]);
    expect(text({ ...ok, missingFields: ['Authors'] })[0]).toMatch(/^No dataset authors found in .*Add "Authors" to it/);
  });

  it('asks to download the main description, with the link and command when known', () => {
    const missing: DescriptionNotice = {
      file: '/ds/physprep/dataset_description.json',
      source: 'physio',
      missingFields: [],
      mainMissing: { path: '/ds/data/dataset_description.json', url: 'https://example.org/main.git', command: 'cd /ds && datalad get -n data' },
    };
    expect(text(missing)).toEqual([
      "The main BIDS folder's dataset description was not found at /ds/data/dataset_description.json. " +
        'Download it from https://example.org/main.git (cd /ds && datalad get -n data), or add one with "Name" and "Authors".',
      "The name shown is from the physio folder's description (/ds/physprep/dataset_description.json).",
    ]);
    const parts = descriptionNoticeLines(missing)[0];
    expect(parts).toContainEqual({ link: 'https://example.org/main.git' });
    expect(parts).toContainEqual({ code: '/ds/data/dataset_description.json' });
  });

  it('still says what is missing when no link is known', () => {
    const lines = text({
      file: null,
      source: 'none',
      missingFields: ['Name', 'Authors'],
      mainMissing: { path: '/ds/dataset_description.json', url: null, command: null },
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/Download the main BIDS dataset from its source repository, or add one/);
  });
});
