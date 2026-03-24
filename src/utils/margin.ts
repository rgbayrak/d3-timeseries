import type { Margin } from '@/core/types';

const DEFAULT_MARGIN: Margin = {
  top: 20,
  right: 20,
  bottom: 40,
  left: 50,
};

export function resolveMargin(partial?: Partial<Margin>): Margin {
  return { ...DEFAULT_MARGIN, ...partial };
}
