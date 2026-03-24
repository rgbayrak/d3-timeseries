import { select } from 'd3-selection';
import type { Selection } from 'd3-selection';

export function resolveContainer(
  selectorOrElement: string | HTMLElement,
): Selection<HTMLElement, unknown, null, undefined> {
  const selection = (
    typeof selectorOrElement === 'string'
      ? select(selectorOrElement)
      : select(selectorOrElement)
  ) as Selection<HTMLElement, unknown, null, undefined>;

  if (selection.empty()) {
    throw new Error(
      `Container not found: ${typeof selectorOrElement === 'string' ? selectorOrElement : 'provided element'}`,
    );
  }

  return selection;
}
