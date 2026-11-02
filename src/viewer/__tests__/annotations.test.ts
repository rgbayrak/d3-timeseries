import { describe, it, expect } from 'vitest';
import { createAnnotation, toAnnotationsFile, fromAnnotationsFile } from '../annotations';
import { escapeHtml, annotationListHtml, EMPTY_ANNOTATIONS_HTML } from '../annotation-panel';

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
