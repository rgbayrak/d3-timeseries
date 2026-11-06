import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { checkFileName, checkStructure, parseBidsName } from '../bids-structure';
import { availableRuleVersions, compactRules, loadRules } from '../bids-rules';
import type { BidsRules } from '../bids-rules';
import { structureLine, structureText } from '../../src/data/bids-structure';

const FIXTURES = join(__dirname, '..', '..', 'test', 'fixtures');

let rules190: BidsRules;
beforeAll(() => {
  rules190 = loadRules('1.9.0')!;
});

describe('rules files', () => {
  it('has one per BIDS release from 1.6.0 to 1.11.2, oldest first', () => {
    expect(availableRuleVersions()).toEqual([
      '1.6.0', '1.7.0', '1.8.0', '1.9.0', '1.10.0', '1.10.1', '1.11.0', '1.11.1', '1.11.2',
    ]);
  });

  it('allows physio in func/ with the same entities in every version', () => {
    for (const v of availableRuleVersions()) {
      const r = loadRules(v)!;
      const physio = r.files.find((f) => f.datatypes.includes('func') && f.suffixes.includes('physio'));
      expect(physio?.extensions, v).toEqual(expect.arrayContaining(['.tsv.gz', '.json']));
      expect(physio?.entities, v).toMatchObject({ subject: 'required', task: 'required', run: 'optional', recording: 'optional' });
    }
  });

  it('compacts a compiled schema: entity keys and order, raw and common rules', () => {
    const r = compactRules(
      {
        bids_version: '9.9.9',
        objects: { entities: { subject: { name: 'sub' }, task: { name: 'task' } } },
        rules: {
          entities: ['subject', 'task'],
          files: {
            raw: { func: { physio: { datatypes: ['func'], suffixes: ['physio'], extensions: ['.tsv.gz'], entities: { subject: 'required', task: { level: 'required' } } } } },
            common: {
              core: { dataset_description: { level: 'required', path: 'dataset_description.json' } },
              tables: { scans: { suffixes: ['scans'], extensions: ['.tsv'], entities: { subject: 'required' } } },
            },
            deriv: { anything: { x: { suffixes: ['ignored'] } } },
          },
        },
      },
      'test',
    );
    expect(r.entities).toEqual([{ name: 'subject', key: 'sub' }, { name: 'task', key: 'task' }]);
    expect(r.files.map((f) => f.suffixes[0])).toEqual(['physio', 'scans']);
    expect(r.files[0].entities).toEqual({ subject: 'required', task: 'required' });
    expect(r.topLevel).toEqual([{ name: 'dataset_description.json', required: true, extensions: [''] }]);
  });
});

describe('file names', () => {
  const inFunc = { datatype: 'func', sub: '01', ses: '01' };

  it('splits entities, suffix and the full extension', () => {
    expect(parseBidsName('sub-01_ses-01_task-rest_physio.tsv.gz')).toEqual({
      entities: [['sub', '01'], ['ses', '01'], ['task', 'rest']],
      suffix: 'physio',
      extension: '.tsv.gz',
    });
    expect(parseBidsName('sub-01_task')).toBeNull();
  });

  it('accepts a valid physio file and its sidecar', () => {
    expect(checkFileName('sub-01_ses-01_task-rest_run-01_recording-cardiac_physio.tsv.gz', rules190, inFunc)).toBeNull();
    expect(checkFileName('sub-01_ses-01_task-rest_run-01_physio.json', rules190, inFunc)).toBeNull();
  });

  it('names each kind of problem', () => {
    const check = (name: string) => checkFileName(name, rules190, inFunc);
    expect(check('sub-01_ses-01_task-rest_foo.tsv')).toMatch(/suffix "_foo" is not allowed in func\//);
    expect(check('sub-01_ses-01_task-rest_physio.csv')).toMatch(/extension ".csv" is not allowed/);
    expect(check('sub-01_ses-01_physio.tsv.gz')).toMatch(/missing required entity "task-"/);
    expect(check('sub-01_ses-01_task-rest_echo-1_physio.tsv.gz')).toMatch(/entity "echo-" is not allowed/);
    expect(check('sub-01_task-rest_ses-01_physio.tsv.gz')).toMatch(/not in the BIDS order/);
    expect(check('sub-02_ses-01_task-rest_physio.tsv.gz')).toMatch(/does not match the folder sub-01/);
    expect(check('sub-01_task-rest_physio.tsv.gz')).toMatch(/missing "ses-01"/);
    expect(check('sub-01_ses-01_task-re_st_physio.tsv.gz')).toMatch(/not a BIDS file name/);
    expect(check('sub-01_ses-01_xyz-1_task-rest_physio.tsv.gz')).toMatch(/unknown entity "xyz-"/);
  });

  it('allows tables and inherited sidecars in subject and session folders', () => {
    const subLevel = { datatype: null, sub: '01', ses: null };
    expect(checkFileName('sub-01_sessions.tsv', rules190, subLevel)).toBeNull();
    expect(checkFileName('sub-01_task-motor_physio.json', rules190, subLevel)).toBeNull();
    expect(checkFileName('sub-01_task-motor_physio.tsv.gz', rules190, subLevel)).toMatch(/not allowed/);
  });
});

describe('checkStructure', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'bids-structure-'));
    writeFileSync(join(dir, 'dataset_description.json'), '{}');
    mkdirSync(join(dir, 'sub-01', 'func'), { recursive: true });
    mkdirSync(join(dir, 'sub-01', 'notes'), { recursive: true });
    writeFileSync(join(dir, 'sub-01', 'func', 'sub-01_task-rest_physio.tsv.gz'), '');
    writeFileSync(join(dir, 'sub-01', 'func', 'sub-01_task-rest_foo.tsv'), '');
    mkdirSync(join(dir, 'derivatives', 'whatever'), { recursive: true }); // not checked
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('checks the synthetic fixtures against BIDS 1.9.0: only their quality sidecars are not raw BIDS', () => {
    for (const name of ['bids-sessions', 'bids-nosessions']) {
      const s = checkStructure(join(FIXTURES, name), '1.9.0');
      expect(s.state, name).toBe('checked');
      if (s.state !== 'checked') continue;
      expect(s.missing, name).toEqual([]);
      expect(s.filesChecked, name).toBeGreaterThan(0);
      expect(s.problems.length, name).toBeGreaterThan(0);
      for (const p of s.problems) expect(p.message, `${name} ${p.path}`).toMatch(/not a BIDS file name/);
      for (const p of s.problems) expect(p.path, name).toMatch(/_desc-quality\.json$/);
    }
  });

  it('reports bad names and unknown folders, and skips derivatives', () => {
    const s = checkStructure(dir, '1.9.0');
    expect(s.state).toBe('checked');
    if (s.state !== 'checked') return;
    expect(s.filesChecked).toBe(2);
    expect(s.problems.map((p) => p.path).sort()).toEqual(['sub-01/func/sub-01_task-rest_foo.tsv', 'sub-01/notes']);
  });

  it('lists required top-level files that are missing (README and CHANGES in 1.6.0)', () => {
    const s = checkStructure(dir, '1.6.0');
    expect(s.state === 'checked' && s.missing).toEqual(['README', 'CHANGES']);
  });

  it('does not check a version without rules, and says why', () => {
    expect(checkStructure(dir, '1.4.1')).toMatchObject({ state: 'no-rules', reason: 'older' });
    expect(checkStructure(dir, '0.0.1')).toMatchObject({ state: 'no-rules', reason: 'older' });
    expect(checkStructure(dir, '2.0.0')).toMatchObject({ state: 'no-rules', reason: 'newer' });
    expect(checkStructure(dir, '1.9.5')).toMatchObject({ state: 'no-rules', reason: 'unknown' });
    expect(checkStructure(dir, 'latest')).toMatchObject({ state: 'no-rules', reason: 'unknown' });
    expect(checkStructure(dir, null)).toEqual({ state: 'no-version' });
  });
});

describe('summary line', () => {
  it('warns that an old version has no schema and asks for an issue', () => {
    const text = structureText(
      structureLine({ state: 'no-rules', declared: '1.4.1', reason: 'older', available: ['1.6.0', '1.11.2'] })!,
    );
    expect(text).toContain('BIDS version 1.4.1 is older than 1.6.0');
    expect(text).toContain('so the schema is not matched');
    expect(text).toContain('please open an issue at https://github.com/rgbayrak/physai-qa-interactive/issues');
  });

  it('says the names follow the version, or gives examples', () => {
    const base = { state: 'checked' as const, version: '1.9.0', filesChecked: 1234, missing: [] };
    expect(structureText(structureLine({ ...base, problemCount: 0, problems: [] })!)).toBe(
      'File and folder names follow BIDS 1.9.0 (1,234 files checked).',
    );
    const text = structureText(
      structureLine({ ...base, missing: ['README'], problemCount: 1, problems: [{ path: 'sub-01/func/x.tsv', message: 'bad' }] })!,
    );
    expect(text).toBe(
      '1 name does not follow BIDS 1.9.0 (1,234 files checked), for example sub-01/func/x.tsv: bad. Missing required by BIDS 1.9.0: README.',
    );
  });
});
