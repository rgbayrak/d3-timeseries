import { describe, it, expect } from 'vitest';
import {
  isRestTask,
  eventCategories,
  defaultEventColumn,
  isCounterColumn,
  usefulEventColumns,
  isWordColumn,
  MAX_EVENT_CATEGORIES,
} from '../events';
import type { EventsRaw } from '@/data/bids-physio-reader';

const events = (columns: Record<string, string[]>): EventsRaw => ({
  filename: 'sub-01_task-motor_events.tsv',
  onset: [0, 10],
  duration: [5, 5],
  columns,
});

describe('isRestTask', () => {
  it('matches resting-state task labels only', () => {
    for (const t of ['rest', 'Rest', 'resting', 'restingstate']) expect(isRestTask(t)).toBe(true);
    for (const t of ['motor', 'handgrasp', 'prerest']) expect(isRestTask(t)).toBe(false);
  });
});

describe('eventCategories', () => {
  it('lists categories in first-seen order, ignoring n/a', () => {
    expect(eventCategories(['right', 'left', 'n/a', 'right'])).toEqual(['right', 'left']);
  });

  it('allows up to MAX_EVENT_CATEGORIES categories', () => {
    const ten = Array.from({ length: MAX_EVENT_CATEGORIES }, (_, i) => `c${i}`);
    expect(eventCategories(ten)).toEqual(ten);
    expect(eventCategories([...ten, 'one-more'])).toBeNull();
  });

  it('is null for numeric or empty columns', () => {
    expect(eventCategories(['0.52', '0.61', 'n/a'])).toBeNull();
    expect(eventCategories(['n/a', ''])).toBeNull();
  });
});

describe('defaultEventColumn', () => {
  it('prefers trial_type, then condition', () => {
    expect(defaultEventColumn(events({ response_time: ['1', '2'], condition: ['a', 'b'], trial_type: ['x', 'y'] }))).toBe(
      'trial_type',
    );
    expect(defaultEventColumn(events({ response_time: ['1', '2'], condition: ['a', 'b'] }))).toBe('condition');
  });

  it('then a categorical column named like a condition, then any categorical column', () => {
    expect(defaultEventColumn(events({ response_time: ['1', '2'], stim_type: ['a', 'b'] }))).toBe('stim_type');
    expect(defaultEventColumn(events({ response_time: ['1', '2'], hand: ['left', 'right'] }))).toBe('hand');
  });

  it('falls back to the first column, or none', () => {
    expect(defaultEventColumn(events({ response_time: ['1', '2'] }))).toBe('response_time');
    expect(defaultEventColumn(events({}))).toBe('');
  });

  it('never picks a counter', () => {
    expect(defaultEventColumn(events({ trial_number: ['1', '2', '3'], response_time: ['0.5', '0.4', '0.6'] }))).toBe(
      'response_time',
    );
    expect(defaultEventColumn(events({ trial_number: ['1', '2', '3'] }))).toBe('');
  });
});

describe('counters (e.g. trial_number)', () => {
  it('are numeric, never repeat and only rise or only fall', () => {
    expect(isCounterColumn(['1', '2', '3', '4'])).toBe(true);
    expect(isCounterColumn(['10', '7', '4'])).toBe(true);
    expect(isCounterColumn(['1', '2', '4', '9', 'n/a'])).toBe(true); // gaps and n/a still a counter
  });

  it('exclude repeating, unordered, text or too-short columns', () => {
    expect(isCounterColumn(['1', '2', '1', '2'])).toBe(false); // condition codes
    expect(isCounterColumn(['0.52', '0.48', '0.61'])).toBe(false); // response times
    expect(isCounterColumn(['a', 'b', 'c'])).toBe(false);
    expect(isCounterColumn(['1', '2'])).toBe(false);
  });

  it('are left out of the useful columns', () => {
    const e = events({ trial_type: ['go', 'stop', 'go'], trial_number: ['1', '2', '3'] });
    expect(usefulEventColumns(e)).toEqual(['trial_type']);
  });
});

describe('isWordColumn', () => {
  it('accepts short words such as cue words', () => {
    expect(isWordColumn(['apple', 'chair', 'n/a', 'river'])).toBe(true);
  });

  it('rejects numbers, long text, paths and file names', () => {
    expect(isWordColumn(['0.5', '0.7'])).toBe(false);
    expect(isWordColumn(['a sentence that is far too long'])).toBe(false);
    expect(isWordColumn(['stimuli/apple'])).toBe(false);
    expect(isWordColumn(['apple.png'])).toBe(false);
    expect(isWordColumn(['n/a'])).toBe(false);
  });
});
