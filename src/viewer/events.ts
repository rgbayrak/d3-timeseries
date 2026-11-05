import type { EventsRaw } from '@/data/bids-physio-reader';

// Pure helpers for the events figure: which scans get one, which column it
// shows by default, and whether that column is drawn as one lane per category.

/** Most categories drawn as separate lanes; more than this falls back to one lane */
export const MAX_EVENT_CATEGORIES = 10;

/** Resting-state tasks (rest, resting, restingstate, …) have no events figure */
export function isRestTask(task: string): boolean {
  return /^rest/i.test(task);
}

/** Longest value still drawn as a word on its event block */
export const MAX_WORD_LENGTH = 16;

const isMissing = (v: string) => v === '' || v.toLowerCase() === 'n/a';
const isNumeric = (v: string) => v.trim() !== '' && Number.isFinite(Number(v));

/**
 * A counter such as trial_number (1, 2, 3, …): every value numeric, none
 * repeated, and only rising (or only falling). It carries no information
 * about the events, so it is not offered in the Event dropdown.
 */
export function isCounterColumn(values: string[]): boolean {
  const present = values.filter((v) => !isMissing(v));
  if (present.length < 3 || !present.every(isNumeric)) return false;
  const nums = present.map(Number);
  const rising = nums.every((n, i) => i === 0 || n > nums[i - 1]);
  const falling = nums.every((n, i) => i === 0 || n < nums[i - 1]);
  return rising || falling;
}

/** Events columns worth showing: every column except counters */
export function usefulEventColumns(events: EventsRaw): string[] {
  return Object.keys(events.columns).filter((c) => !isCounterColumn(events.columns[c]));
}

/**
 * Short words (e.g. cue words: apple, chair): text values of at most
 * MAX_WORD_LENGTH characters that are not numbers, paths or file names.
 * Such values are written on their event blocks.
 */
export function isWordColumn(values: string[]): boolean {
  const present = values.filter((v) => !isMissing(v));
  return (
    present.length > 0 &&
    present.every(
      (v) => !isNumeric(v) && v.length <= MAX_WORD_LENGTH && !/[/\\]/.test(v) && !/\.[A-Za-z0-9]{2,4}$/.test(v),
    )
  );
}

/**
 * Distinct categories of an events column in first-seen order, or null when
 * the column is numeric, empty, or has more than MAX_EVENT_CATEGORIES values.
 */
export function eventCategories(values: string[]): string[] | null {
  const present = values.filter((v) => !isMissing(v));
  if (present.length === 0) return null;
  if (present.every((v) => Number.isFinite(Number(v)))) return null;
  const categories = [...new Set(present)];
  return categories.length <= MAX_EVENT_CATEGORIES ? categories : null;
}

/**
 * Column the events figure shows first: trial_type, then condition, then a
 * column named like a condition (…type…, …condition…, …stim…), then the first
 * categorical column, else the first column. Counters are never picked.
 */
export function defaultEventColumn(events: EventsRaw): string {
  const columns = usefulEventColumns(events);
  const byName =
    columns.find((c) => c === 'trial_type') ??
    columns.find((c) => c === 'condition') ??
    columns.find((c) => /type|condition|stim/i.test(c) && eventCategories(events.columns[c]) !== null);
  return byName ?? columns.find((c) => eventCategories(events.columns[c]) !== null) ?? columns[0] ?? '';
}
