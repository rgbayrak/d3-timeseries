import { describe, it, expect } from 'vitest';
import {
  verticalTickCount,
  MIN_Y_TICK_SPACING_PX,
  compactNumber,
  yLabelOffset,
  MIN_Y_LABEL_OFFSET_PX,
  AXIS_LABEL_GAP_PX,
} from '../axes';

describe('compact tick labels', () => {
  it('keeps small numbers as they are, without a thousands comma', () => {
    expect(compactNumber(0)).toBe('0');
    expect(compactNumber(-2.5)).toBe('-2.5');
    expect(compactNumber(1500)).toBe('1500');
    expect(compactNumber(0.1 + 0.2)).toBe('0.3');
  });

  it('uses k / M from 10 000, and moves up a unit instead of 1000k', () => {
    expect(compactNumber(12500)).toBe('12.5k');
    expect(compactNumber(-40000)).toBe('-40k');
    expect(compactNumber(2_000_000)).toBe('2M');
    expect(compactNumber(999_999)).toBe('1M');
  });

  it('writes tiny numbers with an exponent', () => {
    expect(compactNumber(0.00012)).toBe('1.2e-4');
  });
});

describe('y-axis title position', () => {
  it('stays where it was for short tick labels', () => {
    expect(yLabelOffset(14, 60)).toBe(MIN_Y_LABEL_OFFSET_PX);
  });

  it('moves past wide tick labels, but stays inside the margin', () => {
    expect(yLabelOffset(30, 60)).toBe(9 + 30 + AXIS_LABEL_GAP_PX);
    expect(yLabelOffset(80, 60)).toBe(60 - 14);
  });
});

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
