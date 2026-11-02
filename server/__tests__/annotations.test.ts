import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readAnnotations, writeAnnotations, validateScanKey } from '../bids-layout';
import type { AnnotationsFile } from '../bids-layout';

const payload = (over: Partial<AnnotationsFile> = {}): AnnotationsFile => ({
  sub: '01',
  ses: '02',
  task: 'rest',
  run: '01',
  channel: 'cardiac',
  sampling_rate: 50,
  annotations: [
    { id: 'a1', onset_s: 1.5, duration_s: 2, trial_type: 'fix', start_sample: 75, end_sample: 175 },
  ],
  ...over,
});

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'physio-annotations-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('annotations storage', () => {
  it('round-trips a payload under sub-XX/ses-YY/func/', () => {
    writeAnnotations(root, payload());
    expect(
      existsSync(join(root, 'sub-01', 'ses-02', 'func', 'sub-01_ses-02_task-rest_run-01_channel-cardiac_annotations.json')),
    ).toBe(true);
    expect(readAnnotations(root, '01', '02', 'rest', '01', 'cardiac')).toEqual(payload());
  });

  it('uses sub-XX/func/ and drops ses/run from the name for session- and run-less scans', () => {
    writeAnnotations(root, payload({ ses: '', run: '' }));
    expect(existsSync(join(root, 'sub-01', 'func', 'sub-01_task-rest_channel-cardiac_annotations.json'))).toBe(true);
    expect(readAnnotations(root, '01', '', 'rest', '', 'cardiac')?.annotations).toHaveLength(1);
  });

  it('keeps channels apart and overwrites on save', () => {
    writeAnnotations(root, payload());
    writeAnnotations(root, payload({ channel: 'respiratory', annotations: [] }));
    writeAnnotations(root, payload({ annotations: [] }));
    expect(readAnnotations(root, '01', '02', 'rest', '01', 'cardiac')?.annotations).toEqual([]);
    expect(readdirSync(join(root, 'sub-01', 'ses-02', 'func'))).toHaveLength(2);
  });

  it('returns null when there is no file, or the file is not valid JSON', () => {
    expect(readAnnotations(root, '01', '02', 'rest', '01', 'cardiac')).toBeNull();
    const dir = join(root, 'sub-01', 'ses-02', 'func');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'sub-01_ses-02_task-rest_run-01_channel-cardiac_annotations.json'), '{not json');
    expect(readAnnotations(root, '01', '02', 'rest', '01', 'cardiac')).toBeNull();
  });
});

describe('path safety', () => {
  it.each([
    ['sub', { sub: '../../etc' }],
    ['sub', { sub: '' }],
    ['ses', { ses: '../x' }],
    ['task', { task: 'rest/../../x' }],
    ['run', { run: '01_x' }],
    ['channel', { channel: '../../x' }],
    ['channel', { channel: 'a\\b' }],
    ['channel', { channel: 'a.json' }],
  ])('rejects an unsafe %s', (field, bad) => {
    const error = validateScanKey({ sub: '01', ses: '01', task: 'rest', run: '01', channel: 'cardiac', ...bad });
    expect(error).toMatch(new RegExp(`Invalid ${field}`));
  });

  it('accepts alphanumeric labels, empty ses/run, and channel names with _ or -', () => {
    expect(validateScanKey({ sub: '01', ses: '', task: 'rest', run: '', channel: 'resp_belt-2' })).toBeNull();
    expect(validateScanKey({ sub: 'pilot3', task: 'movie10' })).toBeNull();
  });

  it('writeAnnotations refuses a traversal payload and writes nothing', () => {
    expect(() => writeAnnotations(root, payload({ sub: '../../escaped' }))).toThrow(/Invalid sub/);
    expect(() => writeAnnotations(root, payload({ channel: '../../../escaped' }))).toThrow(/Invalid channel/);
    expect(readdirSync(root)).toEqual([]);
    expect(existsSync(join(root, '..', 'escaped'))).toBe(false);
  });

  it('readAnnotations refuses traversal instead of reading outside the root', () => {
    expect(() => readAnnotations(root, '01', '02', 'rest', '01', '../../secret')).toThrow(/Invalid channel/);
  });
});
