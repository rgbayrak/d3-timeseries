import { describe, it, expect } from 'vitest';
import { createAnnotation, toAnnotationsFile, fromAnnotationsFile, waveformAssessmentFromFile } from '../annotations';
import type { AnnotationsFile } from '@/data/bids-physio-reader';
import { escapeHtml, annotationListHtml, EMPTY_ANNOTATIONS_HTML, progressColor } from '../annotation-panel';

const scan = { sub: '01', ses: '02', task: 'rest', run: '01' };

describe('createAnnotation', () => {
  it('uses the brushed window and trims the label', () => {
    const a = createAnnotation([1.5, 3], '  fix  ');
    expect(a).toMatchObject({ start: 1.5, end: 3, label: 'fix' });
  });

  it('labels empty input "(untitled)"', () => {
    expect(createAnnotation([0, 1], '   ').label).toBe('(untitled)');
  });

  it('gives every annotation a distinct id', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createAnnotation([0, 1], 'x').id));
    expect(ids.size).toBe(50);
  });
});

describe('stored annotation format', () => {
  const annotations = [
    { id: 'a', start: 1.5, end: 3.5, label: 'fix' },
    { id: 'b', start: 10.01, end: 10.03, label: 'motion' },
  ];

  it('stores onset, duration and sample indices at the sampling rate', () => {
    const file = toAnnotationsFile(annotations, scan, 'cardiac', 100);
    expect(file).toMatchObject({ ...scan, channel: 'cardiac', sampling_rate: 100 });
    expect(file.annotations[0]).toEqual({
      id: 'a',
      onset_s: 1.5,
      duration_s: 2,
      trial_type: 'fix',
      start_sample: 150,
      end_sample: 350,
    });
    // sample indices are rounded to the nearest sample
    expect(file.annotations[1].start_sample).toBe(1001);
    expect(file.annotations[1].end_sample).toBe(1003);
  });

  it('round-trips through the stored format', () => {
    const back = fromAnnotationsFile(toAnnotationsFile(annotations, scan, 'cardiac', 100));
    expect(back).toHaveLength(2);
    back.forEach((a, i) => {
      expect(a.id).toBe(annotations[i].id);
      expect(a.label).toBe(annotations[i].label);
      expect(a.start).toBeCloseTo(annotations[i].start, 12);
      expect(a.end).toBeCloseTo(annotations[i].end, 12);
    });
  });
});

describe('whole-waveform rating and comment', () => {
  it('are stored first in the file, above the scan and the time windows', () => {
    const file = toAnnotationsFile([], scan, 'cardiac', 100, { quality: 'fixable', comment: 'drift after 300 s' });
    expect(Object.keys(file).slice(0, 2)).toEqual(['waveform_quality', 'waveform_comment']);
    expect(JSON.stringify(file).startsWith('{"waveform_quality":"fixable","waveform_comment":"drift after 300 s"')).toBe(true);
  });

  it('round-trip through the stored format', () => {
    const file = toAnnotationsFile([], scan, 'cardiac', 100, { quality: 'bad', comment: 'no signal' });
    expect(waveformAssessmentFromFile(file)).toEqual({ quality: 'bad', comment: 'no signal' });
  });

  it('default to no rating and no comment', () => {
    expect(toAnnotationsFile([], scan, 'cardiac', 100)).toMatchObject({ waveform_quality: null, waveform_comment: '' });
  });

  it('read files saved before they existed, and ignore unknown ratings', () => {
    const old = { ...scan, channel: 'cardiac', sampling_rate: 100, annotations: [] } as AnnotationsFile;
    expect(waveformAssessmentFromFile(old)).toEqual({ quality: null, comment: '' });
    const odd = { ...old, waveform_quality: 'great' } as unknown as AnnotationsFile;
    expect(waveformAssessmentFromFile(odd).quality).toBeNull();
  });
});

describe('annotation progress bar colour', () => {
  it('is yellow at the start, green halfway and blue when done', () => {
    expect(progressColor(0)).toBe('#e3b505');
    expect(progressColor(0.5)).toBe('#2fa36b');
    expect(progressColor(1)).toBe('#3b6fd8');
  });

  it('blends between them and clamps out-of-range values', () => {
    expect(progressColor(0.25)).not.toBe(progressColor(0));
    expect(progressColor(0.25)).not.toBe(progressColor(0.5));
    expect(progressColor(-1)).toBe('#e3b505');
    expect(progressColor(2)).toBe('#3b6fd8');
    expect(progressColor(NaN)).toBe('#e3b505');
  });
});

describe('annotation list', () => {
  it('shows a hint when there are no annotations', () => {
    expect(annotationListHtml([])).toBe(EMPTY_ANNOTATIONS_HTML);
  });

  it('shows the time range and escapes user-entered labels', () => {
    const html = annotationListHtml([{ id: 'a', start: 1, end: 2.5, label: '<img src=x onerror=alert(1)>' }]);
    expect(html).toContain('1.00s – 2.50s');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapeHtml escapes all HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});
