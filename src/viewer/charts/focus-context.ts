import { createChart, createZoom, createBrush, cullToViewport, downsample } from '@/core';
import type { ChartInstance, BrushHandle } from '@/core';
import { pointer } from 'd3-selection';
import { toDataPoints, getViewExtent, getValueExtent } from '@/data/bids-physio-reader';
import type { PhysioRaw, DataPoint } from '@/data/bids-physio-reader';
import type { Annotation } from '../annotations';
import {
  CHART_WIDTH,
  CHART_MARGIN_X,
  xScaleOf,
  xDomainOf,
  drawLine,
  fitYToVisible,
  drawOnsetMarker,
  attachHover,
} from './shared';
import type { GroupSelection } from './shared';

export interface FocusContextOptions {
  raw: PhysioRaw;
  channel: string;
  getAnnotations: () => Annotation[];
  isAnnotateMode: () => boolean;
  /** A window was brushed on the focus chart while Annotate mode is on */
  onAnnotate: (domain: [number, number]) => void;
  /** The focus chart's time window changed (zoom, brush, reset) */
  onXDomainChange: (domain: [number, number]) => void;
  /** Extra marks on the focus chart (e.g. the peaks trial), redrawn with the signal line */
  drawOverlay?: (chart: ChartInstance, group: GroupSelection, data: DataPoint[]) => void;
}

export interface FocusContextHandle {
  focusChart: ChartInstance;
  getXDomain: () => [number, number];
  redrawAnnotations: () => void;
  /** Redraw the drawOverlay marks (e.g. after a toggle) */
  redrawOverlay: () => void;
  destroy: () => void;
}

/** Minimum brush width (px) on the focus chart; narrower drags are treated as clicks */
const MIN_BRUSH_PX = 5;

/** Room above the overview chart for the window-length label */
const CONTEXT_LABEL_SPACE = 16;

/** Window length shown over the overview's selection, e.g. "60 sec", "7.5 sec", "0.25 sec" */
export function windowLengthLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const s = seconds >= 10 ? Math.round(seconds) : seconds >= 1 ? Math.round(seconds * 10) / 10 : Math.round(seconds * 100) / 100;
  return `${s} sec`;
}

const ZOOM_BRUSH_STYLE = { fill: 'rgba(0,119,190,0.15)', stroke: 'rgba(0,119,190,0.4)' };
const ANNOTATE_BRUSH_STYLE = { fill: 'rgba(230,126,34,0.15)', stroke: 'rgba(230,126,34,0.5)' };

/**
 * Focus chart (top) and overview chart (bottom) for one channel. Dragging on
 * the focus chart zooms to the selection, or creates an annotation in Annotate
 * mode; dragging on the overview moves the focus window; double-click resets.
 */
export function buildFocusContext(opts: FocusContextOptions): FocusContextHandle {
  const { raw, channel } = opts;
  const data = toDataPoints(raw, channel);
  const timeExtent = getViewExtent(raw);
  const valueExtent = getValueExtent(raw, channel);

  const focus = createChart({
    container: '#focus-chart',
    width: CHART_WIDTH,
    height: 280,
    margin: { top: 20, bottom: 40, ...CHART_MARGIN_X },
    xScale: { type: 'linear', domain: timeExtent },
    yScale: { type: 'linear', domain: valueExtent, nice: true },
    xAxis: { position: 'bottom', label: 'Time from scan onset (s)' },
    yAxis: { position: 'left', label: channel },
    grid: {
      x: { strokeColor: '#e0e0e0', opacity: 0.5 },
      y: { strokeColor: '#e0e0e0', opacity: 0.5 },
    },
    tooltip: { enabled: true },
    resize: { enabled: true, debounceMs: 100 },
  });

  const context = createChart({
    container: '#context-chart',
    width: CHART_WIDTH,
    height: 80 + CONTEXT_LABEL_SPACE,
    margin: { top: 4 + CONTEXT_LABEL_SPACE, bottom: 20, ...CHART_MARGIN_X },
    xScale: { type: 'linear', domain: timeExtent },
    yScale: { type: 'linear', domain: valueExtent },
    xAxis: { position: 'bottom', tickCount: 5 },
    yAxis: { position: 'left', hide: true },
    resize: { enabled: true, debounceMs: 100 },
  });

  const focusLayers = focus.getLayers();
  const contextLayers = context.getLayers();

  const annotationsGroup = focusLayers.content.append('g').attr('class', 'annotations-group');
  const focusLinePath = focusLayers.content
    .append('path')
    .attr('fill', 'none')
    .attr('stroke', '#2d8a8e')
    .attr('stroke-width', 1.2);
  const contextLinePath = contextLayers.content
    .append('path')
    .attr('fill', 'none')
    .attr('stroke', '#4a9e6f')
    .attr('stroke-width', 1)
    .attr('opacity', 0.6);
  const overlayGroup = focusLayers.content.append('g').attr('class', 'focus-overlay');
  const focusOnsetGroup = focusLayers.content.append('g').attr('class', 'onset-marker');
  const contextOnsetGroup = contextLayers.content.append('g').attr('class', 'onset-marker');

  // The overview always shows the whole recording, so draw it downsampled once
  const contextData = downsample(data, 2000);

  function drawFocusLine() {
    const visible = cullToViewport(data, xDomainOf(focus), (d: DataPoint) => d.time);
    fitYToVisible(focus, visible);
    drawLine(focusLinePath, focus, visible);
    drawOverlay(); // after fitYToVisible, so the marks use the new y scale
    drawOnsetMarker(focus, focusOnsetGroup, true);
  }

  function drawOverlay() {
    opts.drawOverlay?.(focus, overlayGroup, data);
  }

  function drawContextLine() {
    drawLine(contextLinePath, context, contextData);
    drawOnsetMarker(context, contextOnsetGroup, false);
  }

  function drawAnnotationBoxes() {
    const xScale = xScaleOf(focus);
    const height = focus.getDimensions().innerHeight;

    const sel = annotationsGroup
      .selectAll<SVGGElement, Annotation>('g.annotation')
      .data(opts.getAnnotations(), (d) => d.id);
    sel.exit().remove();

    const entered = sel.enter().append('g').attr('class', 'annotation');
    entered
      .append('rect')
      .attr('fill', 'rgba(230,126,34,0.12)')
      .attr('stroke', 'rgba(230,126,34,0.6)')
      .attr('stroke-width', 1)
      .attr('pointer-events', 'none');
    entered
      .append('text')
      .attr('fill', '#b5651d')
      .style('font-size', 'var(--fs-xs)') // shared size (src/shell/tabs.css)
      .attr('y', 14)
      .attr('pointer-events', 'none');

    const merged = entered.merge(sel);
    merged
      .select<SVGRectElement>('rect')
      .attr('x', (d) => xScale(d.start))
      .attr('width', (d) => Math.max(0, xScale(d.end) - xScale(d.start)))
      .attr('y', 0)
      .attr('height', height);
    merged
      .select<SVGTextElement>('text')
      .attr('x', (d) => xScale(d.start) + 4)
      .text((d) => d.label);
  }

  // Window length over the overview's selection: ├── 60 sec ──┤ (just the number when narrow)
  const windowLabel = contextLayers.overlay
    .append('g')
    .attr('class', 'window-length')
    .attr('pointer-events', 'none');
  const windowLineLeft = windowLabel.append('path');
  const windowLineRight = windowLabel.append('path');
  // style(), not attr(): SVG attributes can't read the shared CSS colour variables
  windowLabel.selectAll('path').attr('fill', 'none').style('stroke', 'var(--text-2)').attr('stroke-width', 1);
  const windowText = windowLabel
    .append('text')
    .attr('text-anchor', 'middle')
    .style('fill', 'var(--text)')
    .style('font-size', 'var(--fs-xs)') // shared size (src/shell/tabs.css)
    .style('font-weight', '600');

  function drawWindowLabel() {
    const [d0, d1] = xDomainOf(focus);
    const x = xScaleOf(context);
    const x0 = x(d0);
    const x1 = x(d1);
    const yLine = -CONTEXT_LABEL_SPACE / 2 - 1;
    const mid = (x0 + x1) / 2;
    windowText.attr('x', mid).attr('y', yLine + 4).text(windowLengthLabel(d1 - d0));
    const half = (windowText.node()?.getComputedTextLength() ?? 0) / 2 + 5;
    const room = (x1 - x0) / 2 - half;
    if (room < 6) {
      // Too narrow for the bracket: number only
      windowLineLeft.attr('d', null);
      windowLineRight.attr('d', null);
      return;
    }
    const cap = 4; // small end ticks pointing down at the window edges
    windowLineLeft.attr('d', `M${x0},${yLine + cap}V${yLine}H${mid - half}`);
    windowLineRight.attr('d', `M${mid + half},${yLine}H${x1}V${yLine + cap}`);
  }

  function redrawFocus() {
    drawFocusLine();
    drawAnnotationBoxes();
    drawWindowLabel(); // every change to the window goes through here
  }

  drawFocusLine();
  drawAnnotationBoxes();
  drawContextLine();
  drawWindowLabel();
  context.on('resize', () => {
    drawContextLine();
    drawWindowLabel();
  });

  let brush: BrushHandle | null = null;

  const zoom = createZoom(focus, {
    scaleExtent: [1, 100],
    constrainToData: true,
    doubleClickReset: true,
    resetDuration: 300,
    onZoom(xDomain) {
      redrawFocus();
      brush?.moveTo(xDomain);
      opts.onXDomainChange(xDomain);
    },
  });

  brush = createBrush(context, {
    onBrush(selection) {
      if (!selection) return;
      zoom.zoomToDomain(selection);
      redrawFocus();
      opts.onXDomainChange(selection);
    },
  });

  const zoomRect = zoom.getZoomRect();

  // Disable drag-to-pan and wheel-zoom; zooming is brush-only, plus double-click reset
  zoomRect
    .on('mousedown.zoom', null)
    .on('touchstart.zoom', null)
    .on('wheel.zoom', null)
    .style('cursor', 'crosshair');

  let brushStartX: number | null = null;

  attachHover(focus, zoomRect, data, {
    color: '#2d8a8e',
    html: (p) => `<div><strong>${p.time.toFixed(3)} s</strong></div><div>${channel}: ${p.value.toFixed(2)}</div>`,
    isSuppressed: () => brushStartX != null,
  });

  // Brush-to-zoom (or brush-to-annotate) on the focus chart
  const focusBrushRect = focusLayers.overlay
    .append('rect')
    .attr('class', 'focus-brush-rect')
    .attr('fill', ZOOM_BRUSH_STYLE.fill)
    .attr('stroke', ZOOM_BRUSH_STYLE.stroke)
    .attr('y', 0)
    .attr('height', focus.getDimensions().innerHeight)
    .attr('pointer-events', 'none')
    .style('display', 'none');

  zoomRect
    .on('mousedown.brush', (event: MouseEvent) => {
      const [mx] = pointer(event, zoomRect.node()!);
      const style = opts.isAnnotateMode() ? ANNOTATE_BRUSH_STYLE : ZOOM_BRUSH_STYLE;
      brushStartX = mx;
      focusBrushRect
        .attr('x', mx)
        .attr('width', 0)
        .attr('height', focus.getDimensions().innerHeight)
        .attr('fill', style.fill)
        .attr('stroke', style.stroke)
        .style('display', null);
    })
    .on('mousemove.brush', (event: MouseEvent) => {
      if (brushStartX == null) return;
      const [mx] = pointer(event, zoomRect.node()!);
      focusBrushRect.attr('x', Math.min(brushStartX, mx)).attr('width', Math.abs(mx - brushStartX));
    })
    .on('mouseup.brush mouseleave.brush', (event: MouseEvent) => {
      if (brushStartX == null) return;
      focusBrushRect.style('display', 'none');

      const [mx] = pointer(event, zoomRect.node()!);
      const x0 = Math.min(brushStartX, mx);
      const x1 = Math.max(brushStartX, mx);
      brushStartX = null;
      if (x1 - x0 < MIN_BRUSH_PX) return;

      const x = xScaleOf(focus);
      const domain: [number, number] = [x.invert(x0), x.invert(x1)];

      if (opts.isAnnotateMode()) {
        opts.onAnnotate(domain);
        return;
      }

      zoom.zoomToDomain(domain);
      redrawFocus();
      brush?.moveTo(domain);
      opts.onXDomainChange(domain);
    });

  focus.on('resize', redrawFocus);

  return {
    focusChart: focus,
    getXDomain: () => xDomainOf(focus),
    redrawAnnotations: drawAnnotationBoxes,
    redrawOverlay: drawOverlay,
    destroy() {
      zoom.destroy();
      brush?.destroy();
      focus.destroy();
      context.destroy();
    },
  };
}
