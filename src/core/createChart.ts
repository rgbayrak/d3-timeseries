import type {
  ChartConfig,
  ChartInstance,
  ChartLayers,
  Dimensions,
  ChartEvent,
  ChartEventCallback,
  TooltipInstance,
} from './types';
import { resolveContainer, resolveMargin, uid } from '@/utils';
import { createScale, updateScaleRange } from './scales';
import { renderAxis, renderGrid } from './axes';
import { createClipPath, updateClipPath } from './clipPath';
import { createResizeObserver } from './resize';
import { createTooltip } from './tooltip';

export function createChart(config: ChartConfig): ChartInstance {
  // ── Resolve basics ──────────────────────────────────────
  const container = resolveContainer(config.container);
  const containerEl = container.node()!;
  const margin = resolveMargin(config.margin);

  const computeDimensions = (outerW: number, outerH: number): Dimensions => ({
    outerWidth: outerW,
    outerHeight: outerH,
    innerWidth: outerW - margin.left - margin.right,
    innerHeight: outerH - margin.top - margin.bottom,
    margin,
  });

  let dimensions = computeDimensions(
    config.width ?? (containerEl.clientWidth || 600),
    config.height ?? (containerEl.clientHeight || 400),
  );

  // ── Create SVG + layer groups ───────────────────────────
  const svg = container
    .append('svg')
    .attr('width', dimensions.outerWidth)
    .attr('height', dimensions.outerHeight)
    .attr('style', 'max-width: 100%; height: auto;');

  const defs = svg.append('defs');

  const root = svg
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  // z-order: grid -> axes -> content (clipped) -> overlay
  const xGrid = root.append('g').attr('class', 'grid grid-x');
  const yGrid = root.append('g').attr('class', 'grid grid-y');
  const xAxis = root.append('g').attr('class', 'axis axis-x');
  const yAxis = root.append('g').attr('class', 'axis axis-y');

  const clipId = uid('clip');
  createClipPath(defs, clipId, dimensions);

  const content = root
    .append('g')
    .attr('class', 'content')
    .attr('clip-path', `url(#${clipId})`);

  const overlay = root.append('g').attr('class', 'overlay');

  const layers: ChartLayers = {
    svg, root, defs, xGrid, yGrid, xAxis, yAxis, content, overlay,
  };

  // ── Scales ──────────────────────────────────────────────
  let xScale = createScale(config.xScale, 'x', dimensions);
  let yScale = createScale(config.yScale, 'y', dimensions);

  // ── Tooltip ─────────────────────────────────────────────
  const tooltip: TooltipInstance | null = createTooltip(config.tooltip);

  // ── Event system ────────────────────────────────────────
  const listeners = new Map<ChartEvent, Set<ChartEventCallback>>();

  function emit(event: ChartEvent, data?: unknown): void {
    listeners.get(event)?.forEach((cb) => cb(data));
  }

  // ── Render helpers ──────────────────────────────────────
  function renderAxesAndGrid(): void {
    renderAxis(
      layers.xAxis,
      xScale,
      config.xAxis ?? { position: 'bottom' },
      dimensions,
    );
    renderAxis(
      layers.yAxis,
      yScale,
      config.yAxis ?? { position: 'left' },
      dimensions,
    );
    renderGrid(
      layers.xGrid,
      layers.yGrid,
      { x: xScale, y: yScale },
      config.grid,
      dimensions,
    );
  }

  // Initial render
  renderAxesAndGrid();

  // ── Resize observer ─────────────────────────────────────
  const resizeHandle = createResizeObserver(
    containerEl,
    config.resize,
    (width) => {
      instance.resize(width);
    },
  );
  resizeHandle.observe();

  // ── Public instance ─────────────────────────────────────
  const instance: ChartInstance = {
    update(params) {
      emit('beforeUpdate', params?.data);

      // Recreate scales if config changed
      if (params?.config?.xScale) {
        xScale = createScale(params.config.xScale, 'x', dimensions);
      } else {
        updateScaleRange(xScale, 'x', dimensions);
      }
      if (params?.config?.yScale) {
        yScale = createScale(params.config.yScale, 'y', dimensions);
      } else {
        updateScaleRange(yScale, 'y', dimensions);
      }

      renderAxesAndGrid();
      emit('afterUpdate', params?.data);
    },

    resize(width?, height?) {
      const w = width ?? (containerEl.clientWidth || dimensions.outerWidth);
      const h = height ?? config.height ?? dimensions.outerHeight;
      dimensions = computeDimensions(w, h);

      svg
        .attr('width', dimensions.outerWidth)
        .attr('height', dimensions.outerHeight);

      updateScaleRange(xScale, 'x', dimensions);
      updateScaleRange(yScale, 'y', dimensions);
      updateClipPath(defs, clipId, dimensions);

      renderAxesAndGrid();
      emit('resize', dimensions);
    },

    destroy() {
      emit('destroy');
      resizeHandle.disconnect();
      tooltip?.destroy();
      svg.remove();
      listeners.clear();
    },

    renderAxesAndGrid,

    getDimensions: () => dimensions,

    getScales: () => ({ x: xScale, y: yScale }),

    getLayers: () => layers,

    getClipId: () => clipId,

    getTooltip: () => tooltip,

    on(event: ChartEvent, callback: ChartEventCallback) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(callback);
    },

    off(event: ChartEvent, callback: ChartEventCallback) {
      listeners.get(event)?.delete(callback);
    },
  };

  return instance;
}
