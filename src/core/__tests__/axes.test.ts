import { describe, it, expect } from 'vitest';
import { verticalTickCount, MIN_Y_TICK_SPACING_PX } from '../axes';

describe('y-axis tick count', () => {
  it('fits one label per MIN_Y_TICK_SPACING_PX of height', () => {
    expect(MIN_Y_TICK_SPACING_PX).toBe(30);
    expect(verticalTickCount(220)).toBe(7); // the focus chart's plot area
    expect(verticalTickCount(90)).toBe(3); // a stacked channel
  });

  it('keeps at least 2 ticks and never more than d3 default 10', () => {
    expect(verticalTickCount(20)).toBe(2);
    expect(verticalTickCount(0)).toBe(2);
    expect(verticalTickCount(2000)).toBe(10);
  });

  it('never asks for more than the axis requested', () => {
    expect(verticalTickCount(300, 3)).toBe(3);
    expect(verticalTickCount(60, 8)).toBe(2);
  });
});
