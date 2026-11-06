import type { ScaleBand } from 'd3-scale';
import { createChart } from '@/core';
import type { EventsRaw } from '@/data/bids-physio-reader';
import { CATEGORY_PALETTE } from '@/quality/charts';
import { escapeHtml } from '../annotation-panel';
import { eventCategories, isWordColumn } from '../events';
import { CHART_WIDTH, CHART_MARGIN_X, xScaleOf, drawOnsetMarker } from './shared';

/** Block colour when the column is not drawn one lane per category */
export const SINGLE_LANE_COLOR = '#9aa0a6';
/** Label of the one lane (and its legend entry) in that case */
const SINGLE_LANE = 'all events';

const LANE_HEIGHT_PX = 22;
const MIN_HEIGHT_PX = 90;
/** Zero- or very short-duration events still get a visible block */
const MIN_BLOCK_PX = 2;
const MARGIN = { top: 10, bottom: 40, ...CHART_MARGIN_X };
/** Rough width of one character at --fs-xs (13px), to tell whether a word fits its block */
const WORD_CHAR_PX = 7.5;

export interface EventsChartOptions {
  sectionEl: HTMLElement;
  labelEl: HTMLElement;
  legendEl: HTMLElement;
  events: EventsRaw;
  column: string;
  /** Initial time window, normally the focus chart's current one */
  xDomain: [number, number];
}

export interface EventsChartHandle {
  /** Follow the focus chart's time window */
  setXDomain: (domain: [number, number]) => void;
  destroy: () => void;
}

interface EventBlock {
  onset: number;
  duration: number;
  value: string;
  lane: string;
}

/**
 * Task events as time-locked blocks (onset → onset + duration) on the
 * scan-onset axis. A categorical column with at most MAX_EVENT_CATEGORIES
 * values gets one coloured lane per category; any other column draws every
 * event in one grey lane, with the value in the tooltip (and, for short
 * words such as cue words, written on the block when it fits). Returns null and
 * hides the section when there are no events.
 */
export function buildEventsChart(opts: EventsChartOptions): EventsChartHandle | null {
  const { events, column } = opts;
  const values = events.columns[column] ?? [];
  const categories = eventCategories(values);
  const lanes = categories ?? [SINGLE_LANE];

  const blocks: EventBlock[] = events.onset.map((onset, i) => {
    const value = values[i] ?? 'n/a';
    return { onset, duration: events.duration[i] ?? 0, value, lane: categories ? value : SINGLE_LANE };
  });
  // Categorical: events with a missing value have no lane
  const drawn = blocks.filter((b) => lanes.includes(b.lane));
  if (drawn.length === 0) {
    opts.sectionEl.style.display = 'none';
    return null;
  }
  opts.sectionEl.style.display = '';
  opts.labelEl.textContent = events.filename;

  const colorOf = (lane: string) =>
    categories ? CATEGORY_PALETTE[lanes.indexOf(lane) % CATEGORY_PALETTE.length] : SINGLE_LANE_COLOR;
  // Colour key, e.g. "trial_type: ● left ● right"; the column name in the shared code style.
  // With no column to show (only onset/duration or counters) the key is just "● all events".
  const items = lanes
    .map(
      (l) =>
        `<span class="legend-item"><span class="swatch" style="background:${colorOf(l)}"></span>${escapeHtml(l)}</span>`,
    )
    .join('');
  const title = column
    ? `<span class="legend-title"><span class="channel-name">${escapeHtml(column)}</span>:</span>`
    : '';
  opts.legendEl.innerHTML = `<span class="legend-group">${title}${items}</span>`;

  // One grey lane of short words (e.g. cue words): write each word on its block
  const showWords = !categories && column !== '' && isWordColumn(values);

  const height = Math.max(MIN_HEIGHT_PX, lanes.length * LANE_HEIGHT_PX + MARGIN.top + MARGIN.bottom);
  const chart = createChart({
    container: '#events-chart',
    width: CHART_WIDTH,
    height,
    margin: MARGIN,
    xScale: { type: 'linear', domain: opts.xDomain },
    // Reversed so the first category is the top lane (the y range runs bottom → top)
    yScale: { type: 'band', domain: [...lanes].reverse(), padding: 0.2 },
    xAxis: { position: 'bottom', label: 'Time from scan onset (s)' },
    yAxis: { position: 'left', tickFormat: () => '' },
    tooltip: { enabled: true },
    resize: { enabled: true, debounceMs: 100 },
  });

  const layers = chart.getLayers();
  const yScale = chart.getScales().y as ScaleBand<string>;
  const blocksGroup = layers.content.append('g').attr('class', 'event-blocks');
  const wordsGroup = layers.content.append('g').attr('class', 'event-words');
  const onsetGroup = layers.content.append('g').attr('class', 'onset-marker');
  const tooltip = chart.getTooltip();

  const tooltipHtml = (b: EventBlock) =>
    (column ? `<div><strong>${escapeHtml(column)}: ${escapeHtml(b.value)}</strong></div>` : '') +
    `<div>onset ${b.onset.toFixed(2)} s, duration ${b.duration.toFixed(2)} s</div>`;

  const blockWidth = (b: EventBlock) => {
    const x = xScaleOf(chart);
    return Math.max(MIN_BLOCK_PX, x(b.onset + b.duration) - x(b.onset));
  };

  function drawWords() {
    if (!showWords) return;
    const x = xScaleOf(chart);
    const mid = (yScale(SINGLE_LANE) ?? 0) + yScale.bandwidth() / 2;
    // Only words that fit inside their block; more appear as you zoom in
    const fitting = drawn.filter((b) => b.value !== 'n/a' && b.value.length * WORD_CHAR_PX + 6 <= blockWidth(b));
    wordsGroup
      .selectAll<SVGTextElement, EventBlock>('text')
      .data(fitting)
      .join('text')
      .attr('x', (b) => x(b.onset) + blockWidth(b) / 2)
      .attr('y', mid)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('fill', 'var(--text)')
      .style('font-size', 'var(--fs-xs)') // shared size (src/shell/tabs.css)
      .attr('pointer-events', 'none')
      .text((b) => b.value);
  }

  function draw() {
    const x = xScaleOf(chart);
    blocksGroup
      .selectAll<SVGRectElement, EventBlock>('rect')
      .data(drawn)
      .join('rect')
      .attr('x', (b) => x(b.onset))
      .attr('width', blockWidth)
      .attr('y', (b) => yScale(b.lane) ?? 0)
      .attr('height', yScale.bandwidth())
      .attr('fill', (b) => colorOf(b.lane))
      .attr('fill-opacity', 0.85)
      .on('mouseover', (event: MouseEvent, b) => tooltip?.show(tooltipHtml(b), event.pageX, event.pageY))
      .on('mousemove', (event: MouseEvent) => tooltip?.move(event.pageX, event.pageY))
      .on('mouseleave', () => tooltip?.hide());
    drawWords();
    drawOnsetMarker(chart, onsetGroup, false);
  }

  draw();
  chart.on('resize', draw);

  return {
    setXDomain(domain) {
      xScaleOf(chart).domain(domain);
      chart.renderAxesAndGrid();
      draw();
    },
    destroy() {
      chart.destroy();
      opts.legendEl.innerHTML = '';
    },
  };
}
