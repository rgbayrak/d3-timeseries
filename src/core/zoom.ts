import { zoom, zoomIdentity, zoomTransform } from 'd3-zoom';
import type { ZoomBehavior, ZoomTransform } from 'd3-zoom';
import type { Selection } from 'd3-selection';
import type { ScaleLinear } from 'd3-scale';
import 'd3-transition'; // side-effect: adds .transition() to selections
import type { ChartInstance, ZoomConfig, ZoomHandle } from './types';

export function createZoom(
  chart: ChartInstance,
  config: ZoomConfig = {},
): ZoomHandle {
  const {
    scaleExtent = [1, 100],
    constrainToData = true,
    doubleClickReset = true,
    resetDuration = 300,
    onZoom,
  } = config;

  const dims = () => chart.getDimensions();
  const xScale = () => chart.getScales().x as ScaleLinear<number, number>;

  // Immutable copy of the original x-scale — zoom rescales from this
  let referenceScale = xScale().copy();

  const layers = chart.getLayers();

  // Transparent rect for capturing mouse/touch events
  const zoomRect: Selection<SVGRectElement, unknown, null, undefined> = layers.overlay
    .append('rect')
    .attr('class', 'zoom-rect')
    .attr('width', dims().innerWidth)
    .attr('height', dims().innerHeight)
    .attr('fill', 'none')
    .attr('pointer-events', 'all')
    .style('cursor', 'grab');

  // Sync guard — prevents infinite loops between zoom ↔ brush
  let isSyncing = false;

  const zoomBehavior: ZoomBehavior<SVGRectElement, unknown> = zoom<SVGRectElement, unknown>()
    .scaleExtent(scaleExtent)
    .on('zoom', (event) => {
      const transform: ZoomTransform = event.transform;
      const newX = transform.rescaleX(referenceScale);
      const newDomain = newX.domain() as [number, number];

      // Always update the live x-scale domain and axes
      xScale().domain(newDomain);
      chart.renderAxesAndGrid();

      // Only fire callback for user-initiated zooms (not programmatic syncs)
      if (!isSyncing) {
        onZoom?.(newDomain, transform);
      }
    });

  // Constrain pan to data bounds
  function updateTranslateExtent(): void {
    if (constrainToData) {
      const d = dims();
      zoomBehavior.translateExtent([
        [0, 0],
        [d.innerWidth, d.innerHeight],
      ]);
    }
  }

  updateTranslateExtent();

  // Disable built-in double-click zoom — we handle it ourselves
  zoomRect.call(zoomBehavior);
  if (!doubleClickReset) {
    zoomRect.on('dblclick.zoom', null);
  } else {
    zoomRect.on('dblclick.zoom', () => {
      handle.reset(true);
    });
  }

  // Resize listener
  const onResize = () => {
    const d = dims();
    zoomRect.attr('width', d.innerWidth).attr('height', d.innerHeight);

    // Update reference scale range to match new width
    referenceScale = referenceScale.copy().range([0, d.innerWidth]) as ScaleLinear<number, number>;

    updateTranslateExtent();

    // Re-apply the current transform so the zoomed domain is preserved
    const currentTransform = zoomTransform(zoomRect.node()!);
    const newX = currentTransform.rescaleX(referenceScale);
    xScale().domain(newX.domain() as [number, number]);
    chart.renderAxesAndGrid();
  };
  chart.on('resize', onResize);

  const handle: ZoomHandle = {
    zoomToDomain(domain: [number, number], animate = false) {
      isSyncing = true;

      // Compute the transform that maps referenceScale → desired domain
      const d = dims();
      const fullDomain = referenceScale.domain() as [number, number];
      const fullRange = [0, d.innerWidth];
      const k = (fullDomain[1] - fullDomain[0]) / (domain[1] - domain[0]);
      const tx = -referenceScale(domain[0]) * k + fullRange[0] * k;
      // We only zoom on x so keep y identity
      const newTransform = zoomIdentity.scale(k).translate(tx / k, 0);

      if (animate) {
        zoomRect
          .transition()
          .duration(resetDuration)
          .call(zoomBehavior.transform as any, newTransform)
          .on('end', () => { isSyncing = false; });
      } else {
        zoomRect.call(zoomBehavior.transform, newTransform);
        isSyncing = false;
      }
    },

    reset(animate = false) {
      if (animate) {
        zoomRect
          .transition()
          .duration(resetDuration)
          .call(zoomBehavior.transform as any, zoomIdentity);
      } else {
        zoomRect.call(zoomBehavior.transform, zoomIdentity);
      }
    },

    getTransform() {
      return zoomTransform(zoomRect.node()!);
    },

    getZoomRect() {
      return zoomRect;
    },

    destroy() {
      chart.off('resize', onResize);
      zoomRect.on('.zoom', null);
      zoomRect.remove();
    },
  };

  return handle;
}
