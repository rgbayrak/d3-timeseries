import { describe, it, expect } from 'vitest';
import { METRIC_COLUMNS } from '../metrics-tsv';
import type { MetricKey, ParticipantsTable, QualityRow } from '../metrics-tsv';
import {
  PARTICIPANT_PREFIX,
  MAX_CATEGORIES,
  axisText,
  axisValue,
  categoryLabel,
  jitter,
  xAxisChoices,
  yAxisChoices,
  metricAxisChoices,
  participantAxisChoices,
  participantValue,
  scatterData,
  summaryTable,
} from '../model';
import { buildPdf, A4_LANDSCAPE } from '../pdf';

function row(sub: string, metrics: Partial<Record<MetricKey, number>> = {}, over: Partial<QualityRow> = {}): QualityRow {
  const m = {} as Record<MetricKey, number>;
  for (const c of METRIC_COLUMNS) m[c.key] = NaN;
  return {
    sub,
    ses: '01',
    task: 'rest',
    run: '',
    filename: `sub-${sub}_physio.tsv.gz`,
    channel: 'cardiac',
    signalType: 'cardiac',
    samplingFrequency: 496,
    numSamples: 100,
    durationS: 100 / 496,
    timingStatus: 'verified',
    sidecarAssessment: '',
    sidecarPercentValid: NaN,
    ...over,
    metrics: { ...m, ...metrics },
  };
}

const participants: ParticipantsTable = {
  columns: ['species', 'age', 'sex', 'group', 'notes', 'empty'],
  meta: {
    age: { description: 'age of the participant', units: 'years' },
    sex: { levels: { m: 'male', f: 'female' } },
    group: { levels: { '1': 'Participants who received DMT + harmine during the retreat (long)' } },
  },
  rows: {
    '01': { species: 'homo sapiens', age: '32', sex: 'f', group: '1', notes: 'a', empty: 'n/a' },
    '02': { species: 'homo sapiens', age: '49', sex: 'm', group: '2', notes: 'b', empty: '' },
    '03': { species: 'homo sapiens', age: 'n/a', sex: 'm', group: '2', notes: 'c', empty: '' },
  },
};

describe('participant axes', () => {
  const rows = [row('01', { snr: 1 }), row('02', { snr: 2 }), row('03', { snr: 3 })];

  it('offers numeric and categorical participant columns, skipping empty ones', () => {
    const choices = participantAxisChoices(participants, rows);
    expect(choices.map((c) => c.value)).toEqual(
      ['species', 'age', 'sex', 'group', 'notes'].map((c) => PARTICIPANT_PREFIX + c),
    );
    const age = choices.find((c) => c.value === `${PARTICIPANT_PREFIX}age`)!;
    expect(age.label).toBe('age (years)');
    expect(age.categories).toBeNull();
    const sex = choices.find((c) => c.value === `${PARTICIPANT_PREFIX}sex`)!;
    expect(sex.rawCategories).toEqual(['f', 'm']);
    expect(sex.categories).toEqual(['female', 'male']);
    // numeric codes with Levels are categories; long level descriptions fall back to the raw value
    const group = choices.find((c) => c.value === `${PARTICIPANT_PREFIX}group`)!;
    expect(group.rawCategories).toEqual(['1', '2']);
    expect(group.categories).toEqual(['1', '2']);
  });

  it('only considers subjects that have metrics', () => {
    const choices = participantAxisChoices(participants, [row('01')]);
    expect(choices.find((c) => c.value === `${PARTICIPANT_PREFIX}age`)!.categories).toBeNull();
    expect(choices.find((c) => c.value === `${PARTICIPANT_PREFIX}sex`)!.rawCategories).toEqual(['f']);
  });

  it('drops categorical columns with too many values', () => {
    const many: ParticipantsTable = { columns: ['id2'], meta: {}, rows: {} };
    const rs: QualityRow[] = [];
    for (let i = 0; i <= MAX_CATEGORIES; i++) {
      const sub = String(i).padStart(2, '0');
      many.rows[sub] = { id2: `x${i}` };
      rs.push(row(sub));
    }
    expect(participantAxisChoices(many, rs)).toEqual([]);
    expect(participantAxisChoices(null, rs)).toEqual([]);
  });

  it('places rows on metric, numeric and categorical axes', () => {
    const [snr] = metricAxisChoices(rows);
    const choices = participantAxisChoices(participants, rows);
    const age = choices.find((c) => c.value === `${PARTICIPANT_PREFIX}age`)!;
    const sex = choices.find((c) => c.value === `${PARTICIPANT_PREFIX}sex`)!;

    expect(axisValue(rows[1], snr, participants)).toBe(2);
    expect(axisValue(rows[0], age, participants)).toBe(32);
    expect(axisValue(rows[2], age, participants)).toBeNaN(); // n/a
    const y = axisValue(rows[1], sex, participants); // m -> category 1
    expect(y).toBeGreaterThanOrEqual(0.75);
    expect(y).toBeLessThanOrEqual(1.25);

    expect(axisText(rows[1], sex, participants)).toBe('male');
    expect(axisText(rows[0], age, participants)).toBe('32');
    expect(axisText(rows[2], age, participants)).toBe('n/a');

    // sub-03 has no age, so it is left out of an age scatter (age on X, metric on Y)
    expect(scatterData(rows, age, snr, participants).map((d) => d.row.sub)).toEqual(['01', '02']);
  });

  it('jitters deterministically within a category row', () => {
    for (const r of rows) {
      expect(jitter(r)).toBe(jitter({ ...r }));
      expect(Math.abs(jitter(r))).toBeLessThanOrEqual(0.25);
    }
    expect(jitter(rows[0])).not.toBe(jitter(rows[1]));
  });

  it('reads values and level labels', () => {
    expect(participantValue(participants, '01', 'empty')).toBeNull();
    expect(participantValue(participants, '99', 'age')).toBeNull();
    expect(categoryLabel(participants, 'sex', 'f')).toBe('female');
    expect(categoryLabel(participants, 'sex', 'x')).toBe('x');
  });
});

describe('scatter axis options', () => {
  const rows = [row('01', { snr: 1, kurtosis: 5 }), row('02', { snr: 2, kurtosis: 6 }), row('03', { snr: 3 })];

  it('offers metrics and participant variables on X, metrics only on Y', () => {
    const x = xAxisChoices(rows, participants, rows).map((c) => c.value);
    expect(x.slice(0, 2)).toEqual(['snr', 'kurtosis']);
    expect(x).toContain(`${PARTICIPANT_PREFIX}age`);
    expect(yAxisChoices(rows).map((c) => c.value)).toEqual(['snr', 'kurtosis']);
  });
});

describe('summaryTable', () => {
  it('is omitted when the dataset has no sidecar and no empty recordings', () => {
    expect(summaryTable([row('01', { snr: 1 })], ['cardiac'])).toBeNull();
  });

  it('adds only the columns the dataset has', () => {
    expect(summaryTable([row('01', { snr: 1 }, { sidecarAssessment: 'Pass' })], ['cardiac'])).toEqual({
      header: ['Channel', 'Scans', 'Sidecar pass', 'Sidecar fail'],
      rows: [['cardiac', '1', '1', '0']],
    });
    expect(summaryTable([row('01')], ['cardiac'])!.header).toEqual(['Channel', 'Scans', 'No metric values']);
  });
});

describe('buildPdf', () => {
  const text = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);
  const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

  it('writes one page per image with a valid cross-reference table', () => {
    const pdf = buildPdf([
      { jpeg: fakeJpeg, width: 1684, height: 1190 },
      { jpeg: fakeJpeg, width: 1684, height: 1190 },
    ]);
    const s = text(pdf);
    expect(s.startsWith('%PDF-1.4\n')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(s).toContain('/Type /Pages /Kids [3 0 R 6 0 R] /Count 2');
    expect(s).toContain(`/MediaBox [0 0 ${A4_LANDSCAPE.width} ${A4_LANDSCAPE.height}]`);
    expect(s).toContain('/Width 1684 /Height 1190');
    expect(s).toContain(`/Filter /DCTDecode /Length ${fakeJpeg.length}`);

    // Every xref offset points at the start of its "N 0 obj"
    const startxref = Number(/startxref\n(\d+)/.exec(s)![1]);
    expect(s.slice(startxref, startxref + 4)).toBe('xref');
    const entries = s.slice(startxref).split('\n').slice(3, 3 + 8);
    entries.forEach((line, i) => {
      const offset = Number(line.slice(0, 10));
      expect(s.slice(offset).startsWith(`${i + 1} 0 obj`)).toBe(true);
    });
    expect(s).toContain('/Size 9 /Root 1 0 R');
  });

  it('embeds the JPEG bytes unchanged', () => {
    const pdf = buildPdf([{ jpeg: fakeJpeg, width: 10, height: 10 }]);
    const s = text(pdf);
    const start = s.indexOf('stream\n', s.indexOf('/DCTDecode')) + 'stream\n'.length;
    expect([...pdf.slice(start, start + fakeJpeg.length)]).toEqual([...fakeJpeg]);
  });
});
