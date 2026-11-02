import { createChart, cullToViewport } from '@/core';
import type { ChartInstance } from '@/core';
import { toDataPoints, getValueExtent } from '@/data/bids-physio-reader';
import type { PhysioRaw, DataPoint } from '@/data/bids-physio-reader';
import {
  CHART_WIDTH,
  CHART_MARGIN_X,
  xScaleOf,
  xDomainOf,
  drawLine,
  fitYToVisible,
  drawOnsetMarker,
  appendOverlayRect,
  attachHover,
} from './shared';

export interface StackChartsOptions {
  sectionEl: HTMLElement;
  raw: PhysioRaw;
  channels: string[];
  /** Initial time window, normally the focus chart's current one */
  xDomain: [number, number];
}

export interface StackChartsHandle {
  /** Follow the focus chart's time window */
  setXDomain: (domain: [number, number]) => void;
  destroy: () => void;
}

/**
 * One compact chart per stacked channel. Each follows the focus chart's time
 * window and auto-fits its y-axis to the visible samples. Returns null (with
 * the section hidden) when no channels are stacked.
 */
export function buildStackCharts(opts: StackChartsOptions): StackChartsHandle | null {
  const { sectionEl, raw } = opts;
  sectionEl.innerHTML = '';
  sectionEl.style.display = 'none';
  if (opts.channels.length === 0) return null;
  sectionEl.style.display = '';

  const charts: ChartInstance[] = [];
  const redrawers: (() => void)[] = [];

  for (const channel of opts.channels) {
    const data = toDataPoints(raw, channel);
    if (data.length === 0) continue;

    const el = document.createElement('div');
    el.className = 'stack-chart';
    sectionEl.appendChild(el);

    const chart = createChart({
      container: el,
      width: CHART_WIDTH,
      height: 140,
      margin: { top: 10, bottom: 30, ...CHART_MARGIN_X },
      xScale: { type: 'linear', domain: opts.xDomain },
      yScale: { type: 'linear', domain: getValueExtent(raw, channel), nice: true },
      xAxis: { position: 'bottom', tickCount: 5 },
      yAxis: { position: 'left', label: channel },
      grid: {
        x: { strokeColor: '#e0e0e0', opacity: 0.5 },
        y: { strokeColor: '#e0e0e0', opacity: 0.5 },
      },
      tooltip: { enabled: true },
      resize: { enabled: true, debounceMs: 100 },
    });
    charts.push(chart);

    const layers = chart.getLayers();
    const linePath = layers.content
      .append('path')
      .attr('fill', 'none')
      .attr('stroke', '#2d8a8e')
      .attr('stroke-width', 1.2);
    const onsetGroup = layers.content.append('g').attr('class', 'onset-marker');

    const draw = () => {
      const visible = cullToViewport(data, xDomainOf(chart), (d: DataPoint) => d.time);
      fitYToVisible(chart, visible);
      drawLine(linePath, chart, visible);
      drawOnsetMarker(chart, onsetGroup, false);
    };
    draw();
    redrawers.push(draw);

    const overlayRect = appendOverlayRect(chart);
    attachHover(chart, overlayRect, data, {
      color: '#2d8a8e',
      html: (p) => `<div><strong>${p.time.toFixed(3)} s</strong></div><div>${channel}: ${p.value.toFixed(2)}</div>`,
    });

    chart.on('resize', () => {
      const d = chart.getDimensions();
      overlayRect.attr('width', d.innerWidth).attr('height', d.innerHeight);
      draw();
    });
  }

  return {
    setXDomain(domain) {
      charts.forEach((chart, i) => {
        xScaleOf(chart).domain(domain);
        redrawers[i]();
      });
    },
    destroy() {
      for (const c of charts) c.destroy();
      sectionEl.innerHTML = '';
      sectionEl.style.display = 'none';
    },
  };
}
