import { brushX } from 'd3-brush';
import type { BrushBehavior, D3BrushEvent } from 'd3-brush';
import type { ScaleLinear } from 'd3-scale';
import type { ChartInstance, BrushConfig, BrushHandle } from './types';

export function createBrush(
  chart: ChartInstance,
  config: BrushConfig = {},
): BrushHandle {
  const {
    selectionFill = 'rgba(0,119,190,0.15)',
    onBrush,
  } = config;

  const dims = () => chart.getDimensions();
  const xScale = () => chart.getScales().x as ScaleLinear<number, number>;
  const layers = chart.getLayers();

  let currentSelection: [number, number] | null = null;
  let isSyncing = false;

  const brushGroup = layers.overlay.append('g').attr('class', 'brush');

  const brushBehavior: BrushBehavior<unknown> = brushX<unknown>()
    .extent([[0, 0], [dims().innerWidth, dims().innerHeight]])
    .on('start brush end', (event: D3BrushEvent<unknown>) => {
      if (isSyncing) return;

      const sel = event.selection as [number, number] | null;
      if (sel) {
        const scale = xScale();
        currentSelection = [scale.invert(sel[0]), scale.invert(sel[1])];
      } else {
        currentSelection = null;
      }

      onBrush?.(currentSelection);
    });

  brushGroup.call(brushBehavior);

  // Style the brush selection rectangle
  brushGroup.select('.selection')
    .attr('fill', selectionFill)
    .attr('stroke', 'rgba(0,119,190,0.4)');

  // Initialize brush to full extent
  brushGroup.call(
    brushBehavior.move as any,
    [0, dims().innerWidth],
  );

  // Resize listener
  const onResize = () => {
    const d = dims();
    brushBehavior.extent([[0, 0], [d.innerWidth, d.innerHeight]]);
    brushGroup.call(brushBehavior);

    // Re-apply current selection in pixel space
    if (currentSelection) {
      const scale = xScale();
      isSyncing = true;
      brushGroup.call(
        brushBehavior.move as any,
        [scale(currentSelection[0]), scale(currentSelection[1])],
      );
      isSyncing = false;
    }
  };
  chart.on('resize', onResize);

  const handle: BrushHandle = {
    moveTo(domain: [number, number]) {
      isSyncing = true;
      const scale = xScale();
      currentSelection = domain;
      brushGroup.call(
        brushBehavior.move as any,
        [scale(domain[0]), scale(domain[1])],
      );
      isSyncing = false;
    },

    clear() {
      isSyncing = true;
      currentSelection = null;
      brushGroup.call(brushBehavior.move as any, null);
      isSyncing = false;
    },

    getSelection() {
      return currentSelection;
    },

    destroy() {
      chart.off('resize', onResize);
      brushGroup.on('.brush', null);
      brushGroup.remove();
    },
  };

  return handle;
}
