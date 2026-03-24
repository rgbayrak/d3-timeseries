import { createChart, createZoom, createBrush, cullToViewport, downsample } from '@/core';
import type { ChartInstance, ZoomHandle, BrushHandle } from '@/core';
import { line } from 'd3-shape';
import { pointer } from 'd3-selection';
import type { ScaleLinear } from 'd3-scale';
import {
  fetchSubjects,
  fetchScans,
  fetchTasks,
  fetchRuns,
  fetchPhysioRaw,
  fetchConfounds,
  toDataPoints,
  toFDPoints,
  getTimeExtent,
  getValueExtent,
} from '@/data/bids-physio-reader';
import type { SubjectInfo, ScanEntry, PhysioRaw, ConfoundsRaw, DataPoint } from '@/data/bids-physio-reader';
import { computeSQI } from '@/data/sqi-metrics';
import type { SQIResults, ChannelMetrics } from '@/data/sqi-metrics';

// ── DOM refs ────────────────────────────────────────────
const subjectSelect = document.getElementById('subject-select') as HTMLSelectElement;
const sessionSelect = document.getElementById('session-select') as HTMLSelectElement;
const taskSelect = document.getElementById('task-select') as HTMLSelectElement;
const runSelect = document.getElementById('run-select') as HTMLSelectElement;
const runLabel = document.getElementById('run-label') as HTMLLabelElement;
const channelSelect = document.getElementById('channel-select') as HTMLSelectElement;
const prevBtn = document.getElementById('prev-btn') as HTMLButtonElement;
const nextBtn = document.getElementById('next-btn') as HTMLButtonElement;
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const filenameEl = document.getElementById('filename')!;
const qualityBadgesEl = document.getElementById('quality-badges')!;
const loadingEl = document.getElementById('loading')!;
const confoundsSectionEl = document.getElementById('confounds-section')!;
const confoundsLabelEl = document.getElementById('confounds-label')!;
const computeSqiBtn = document.getElementById('compute-sqi-btn') as HTMLButtonElement;
const sqiSectionEl = document.getElementById('sqi-section')!;
const hideSqiBtn = document.getElementById('hide-sqi-btn') as HTMLButtonElement;
const sqiTableContainer = document.getElementById('sqi-table-container')!;
const sqiColControls = document.getElementById('sqi-col-controls')!;

// ── State ───────────────────────────────────────────────
let subjects: SubjectInfo[] = [];
let allScans: ScanEntry[] = [];
let cachedRaw: PhysioRaw | null = null;
let cachedConfounds: ConfoundsRaw | null = null;
let cachedSQI: SQIResults | null = null;
let currentSub = '';
let currentSes = '';
let currentTask = '';
let currentRun = '';

let focusChart: ChartInstance | null = null;
let contextChart: ChartInstance | null = null;
let confoundsChart: ChartInstance | null = null;
let zoomHandle: ZoomHandle | null = null;
let brushHandle: BrushHandle | null = null;

// ── Helpers ─────────────────────────────────────────────
function setLoading(msg: string) {
  loadingEl.textContent = msg;
}

function renderQualityBadges(raw: PhysioRaw) {
  qualityBadgesEl.innerHTML = '';
  if (!raw.quality) return;
  for (const ch of raw.columns) {
    const q = raw.quality[ch];
    if (!q) continue;
    const isPass = q.assessment.toLowerCase() === 'pass';
    const badge = document.createElement('span');
    badge.className = `quality-badge ${isPass ? 'pass' : 'fail'}`;
    let label = `${ch}: ${q.assessment}`;
    if (q.percentValid != null) {
      label += ` (${(q.percentValid * 100).toFixed(0)}%)`;
    }
    badge.textContent = label;
    qualityBadgesEl.appendChild(badge);
  }
}

function formatMetricValue(val: number, decimals: number): string {
  if (val === Infinity) return 'Inf';
  if (val === -Infinity) return '-Inf';
  if (Number.isNaN(val)) return 'N/A';
  return val.toFixed(decimals);
}

// ── SQI table column definitions + visibility ────────────
interface ColDef {
  label: string;
  key: keyof ChannelMetrics;
  decimals: number;
  description?: string;
  group: string;
}

const sqiColumns: ColDef[] = [
  { label: 'Channel', key: 'channelName', decimals: 0, group: 'always' },
  { label: 'Mean', key: 'mean', decimals: 4, group: 'Basic' },
  { label: 'Std Dev', key: 'stdDev', decimals: 4, description: 'Standard deviation (spread of values around the mean). Range: [0, +\u221E)', group: 'Basic' },
  { label: 'Min', key: 'min', decimals: 4, group: 'Basic' },
  { label: 'Max', key: 'max', decimals: 4, group: 'Basic' },
  { label: 'Median', key: 'median', decimals: 4, description: 'Middle value when samples are sorted', group: 'Basic' },
  { label: '% Non-Zero', key: 'percentNonZero', decimals: 2, description: 'Percentage of samples that are not exactly zero.', group: 'Basic' },
  { label: 'SNR', key: 'snr', decimals: 3, description: 'Signal-to-noise ratio (mean / std dev). Higher is cleaner.', group: 'Distribution' },
  { label: 'Kurtosis', key: 'kurtosis', decimals: 3, description: 'Excess kurtosis \u2014 tailedness of the distribution. 0 = normal, >0 = heavy tails, <0 = light tails.', group: 'Distribution' },
  { label: 'Skewness', key: 'skewness', decimals: 3, description: 'Asymmetry of the distribution. 0 = symmetric, >0 = right-skewed, <0 = left-skewed.', group: 'Distribution' },
  { label: 'ZCR (Hz)', key: 'zeroCrossingRate', decimals: 2, description: 'Zero-crossing rate \u2014 number of sign changes per second. Higher values indicate higher-frequency content.', group: 'Distribution' },
  { label: 'sVRI', key: 'svri', decimals: 3, description: 'Stress-induced Vascular Response Index \u2014 ratio of mean post- to pre-systolic amplitude, averaged across beats (PaPaGei).', group: 'PaPaGei' },
  { label: 'IPA', key: 'ipa', decimals: 3, description: 'Inflection Point Area ratio \u2014 systolic area / diastolic area split at dicrotic notch, averaged across beats (PaPaGei).', group: 'PaPaGei' },
  { label: 'SQI', key: 'sqi', decimals: 3, description: 'Signal Quality Index \u2014 mean skewness over 5-second windows (PaPaGei). Range: (-\u221E, +\u221E)', group: 'PaPaGei' },
  { label: 'Kurt (win)', key: 'kurtosisWindowed', decimals: 3, description: 'Mean excess kurtosis over 60 s windows (Elgendi 2016).', group: 'PhysioQC' },
  { label: 'ApEn', key: 'approxEntropy', decimals: 4, description: 'Approximate entropy \u2014 signal regularity (Elgendi 2016, m=2, r=0.2\u00D7SD). Lower = more regular.', group: 'PhysioQC' },
  { label: 'Beat Corr', key: 'beatCorrelation', decimals: 3, description: 'Mean Pearson correlation of each beat/breath vs average waveform (Romano 2023).', group: 'PhysioQC' },
];

const sqiGroups = ['Basic', 'Distribution', 'PaPaGei', 'PhysioQC'];
const visibleCols = new Set<string>(sqiColumns.filter((c) => c.group === 'always' || c.group === 'Basic').map((c) => c.key));
let lastSQIResults: SQIResults | null = null;

function buildSQIControls() {
  // Group buttons
  let html = '<div class="sqi-groups">';
  for (const g of sqiGroups) {
    const groupKeys = sqiColumns.filter((c) => c.group === g).map((c) => c.key);
    const active = groupKeys.every((k) => visibleCols.has(k)) ? ' active' : '';
    html += `<button type="button" class="${active.trim()}" data-group="${g}">${g}</button>`;
  }
  html += '</div>';

  // Individual checkboxes
  html += '<div class="sqi-checkboxes">';
  for (const c of sqiColumns) {
    if (c.group === 'always') continue;
    const checked = visibleCols.has(c.key) ? ' checked' : '';
    html += `<label><input type="checkbox" data-col="${c.key}"${checked}>${c.label}</label>`;
  }
  html += '</div>';

  sqiColControls.innerHTML = html;

  // Group button clicks
  sqiColControls.querySelectorAll<HTMLButtonElement>('.sqi-groups button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const group = btn.dataset.group!;
      const groupKeys = sqiColumns.filter((c) => c.group === group).map((c) => c.key);
      const allVisible = groupKeys.every((k) => visibleCols.has(k));

      for (const k of groupKeys) {
        if (allVisible) visibleCols.delete(k);
        else visibleCols.add(k);
      }

      btn.classList.toggle('active', !allVisible);
      syncCheckboxes();
      if (lastSQIResults) renderSQITableBody(lastSQIResults);
    });
  });

  // Checkbox clicks
  sqiColControls.querySelectorAll<HTMLInputElement>('.sqi-checkboxes input').forEach((cb) => {
    cb.addEventListener('change', () => {
      const key = cb.dataset.col!;
      if (cb.checked) visibleCols.add(key);
      else visibleCols.delete(key);
      syncGroupButtons();
      if (lastSQIResults) renderSQITableBody(lastSQIResults);
    });
  });
}

function syncCheckboxes() {
  sqiColControls.querySelectorAll<HTMLInputElement>('.sqi-checkboxes input').forEach((cb) => {
    cb.checked = visibleCols.has(cb.dataset.col!);
  });
}

function syncGroupButtons() {
  sqiColControls.querySelectorAll<HTMLButtonElement>('.sqi-groups button').forEach((btn) => {
    const group = btn.dataset.group!;
    const groupKeys = sqiColumns.filter((c) => c.group === group).map((c) => c.key);
    btn.classList.toggle('active', groupKeys.every((k) => visibleCols.has(k)));
  });
}

function renderSQITableBody(results: SQIResults) {
  const active = sqiColumns.filter((c) => c.group === 'always' || visibleCols.has(c.key));

  let html = '<table><thead><tr>';
  for (const c of active) {
    const tip = c.description ? ` data-tip="${c.description}"` : '';
    html += `<th${tip}>${c.label}</th>`;
  }
  html += '</tr></thead><tbody>';

  for (const m of results.metrics) {
    html += '<tr>';
    for (const c of active) {
      const val = m[c.key];
      if (typeof val === 'string') {
        html += `<td>${val}</td>`;
      } else {
        html += `<td>${formatMetricValue(val, c.decimals)}</td>`;
      }
    }
    html += '</tr>';
  }

  html += '</tbody></table>';
  sqiTableContainer.innerHTML = html;
}

function renderSQITable(results: SQIResults) {
  lastSQIResults = results;
  buildSQIControls();
  renderSQITableBody(results);
  sqiSectionEl.style.display = '';
}

computeSqiBtn.addEventListener('click', () => {
  if (!cachedRaw) return;

  if (cachedSQI) {
    renderSQITable(cachedSQI);
    return;
  }

  computeSqiBtn.disabled = true;
  setLoading('Computing SQI...');

  // Yield to UI before heavy computation
  setTimeout(() => {
    cachedSQI = computeSQI(cachedRaw!);
    renderSQITable(cachedSQI);
    computeSqiBtn.disabled = false;
    setLoading('');
  }, 0);
});

hideSqiBtn.addEventListener('click', () => {
  sqiSectionEl.style.display = 'none';
});

function populateSelect(el: HTMLSelectElement, values: string[], selected?: string) {
  el.innerHTML = '';
  for (const v of values) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    if (v === selected) opt.selected = true;
    el.appendChild(opt);
  }
}

async function populateTasks(sub: string, ses: string, selected?: string) {
  const tasks = await fetchTasks(sub, ses);
  populateSelect(taskSelect, tasks, selected ?? tasks[0]);
}

async function populateRuns(sub: string, ses: string, task: string, selected?: string) {
  const runs = await fetchRuns(sub, ses, task);
  if (runs.length > 0) {
    populateSelect(runSelect, runs, selected ?? runs[0]);
    runLabel.style.display = '';
  } else {
    runSelect.innerHTML = '';
    runLabel.style.display = 'none';
  }
  return runs;
}

// ── Teardown ────────────────────────────────────────────
function destroyCharts() {
  zoomHandle?.destroy();
  brushHandle?.destroy();
  focusChart?.destroy();
  contextChart?.destroy();
  confoundsChart?.destroy();
  zoomHandle = null;
  brushHandle = null;
  focusChart = null;
  contextChart = null;
  confoundsChart = null;
}

// Callback for confounds zoom sync — set by buildConfoundsChart
let syncConfoundsXDomain: ((domain: [number, number]) => void) | null = null;

// ── Build charts ────────────────────────────────────────
function buildCharts(raw: PhysioRaw, channel: string) {
  destroyCharts();
  syncConfoundsXDomain = null;

  const data = toDataPoints(raw, channel);
  const timeExtent = getTimeExtent(raw);
  const valueExtent = getValueExtent(raw, channel);

  // Focus chart
  focusChart = createChart({
    container: '#focus-chart',
    width: 960,
    height: 350,
    margin: { top: 20, right: 20, bottom: 40, left: 60 },
    xScale: { type: 'linear', domain: timeExtent },
    yScale: { type: 'linear', domain: valueExtent, nice: true },
    xAxis: { position: 'bottom', label: 'Time (s)' },
    yAxis: { position: 'left', label: channel },
    grid: {
      x: { strokeColor: '#e0e0e0', opacity: 0.5 },
      y: { strokeColor: '#e0e0e0', opacity: 0.5 },
    },
    tooltip: { enabled: true },
    resize: { enabled: true, debounceMs: 100 },
  });

  // Context chart
  contextChart = createChart({
    container: '#context-chart',
    width: 960,
    height: 80,
    margin: { top: 4, right: 20, bottom: 20, left: 60 },
    xScale: { type: 'linear', domain: timeExtent },
    yScale: { type: 'linear', domain: valueExtent },
    xAxis: { position: 'bottom', tickCount: 5 },
    yAxis: { position: 'left', hide: true },
    resize: { enabled: true, debounceMs: 100 },
  });

  // Line paths
  const focusLayers = focusChart.getLayers();
  const contextLayers = contextChart.getLayers();

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

  const contextData = downsample(data, 2000);

  function drawFocusLine() {
    const { x, y } = focusChart!.getScales();
    const xDomain = (x as ScaleLinear<number, number>).domain() as [number, number];
    const visible = cullToViewport(data, xDomain, (d: DataPoint) => d.time);

    // Auto-fit Y to visible data
    if (visible.length > 0) {
      let vMin = Infinity;
      let vMax = -Infinity;
      for (let i = 0; i < visible.length; i++) {
        const v = visible[i].value;
        if (v < vMin) vMin = v;
        if (v > vMax) vMax = v;
      }
      const pad = (vMax - vMin) * 0.05 || 0.1;
      (y as ScaleLinear<number, number>).domain([vMin - pad, vMax + pad]);
      focusChart!.renderAxesAndGrid();
    }

    const lineGen = line<DataPoint>()
      .x((d) => (x as ScaleLinear<number, number>)(d.time))
      .y((d) => (y as ScaleLinear<number, number>)(d.value));

    focusLinePath.datum(visible).attr('d', lineGen);
  }

  function drawContextLine() {
    const { x, y } = contextChart!.getScales();

    const lineGen = line<DataPoint>()
      .x((d) => (x as ScaleLinear<number, number>)(d.time))
      .y((d) => (y as ScaleLinear<number, number>)(d.value));

    contextLinePath.datum(contextData).attr('d', lineGen);
  }

  drawFocusLine();
  drawContextLine();
  contextChart.on('resize', drawContextLine);

  // Zoom
  zoomHandle = createZoom(focusChart, {
    scaleExtent: [1, 100],
    constrainToData: true,
    doubleClickReset: true,
    resetDuration: 300,
    onZoom(xDomain) {
      drawFocusLine();
      brushHandle!.moveTo(xDomain);
      syncConfoundsXDomain?.(xDomain);
    },
  });

  // Brush
  brushHandle = createBrush(contextChart, {
    onBrush(selection) {
      if (!selection) return;
      zoomHandle!.zoomToDomain(selection);
      drawFocusLine();
      syncConfoundsXDomain?.(selection);
    },
  });

  // Hover
  const hoverLine = focusLayers.overlay
    .append('line')
    .attr('stroke', '#666')
    .attr('stroke-dasharray', '4 4')
    .attr('pointer-events', 'none')
    .style('opacity', 0);

  const hoverCircle = focusLayers.overlay
    .append('circle')
    .attr('r', 3)
    .attr('fill', '#2d8a8e')
    .attr('stroke', 'white')
    .attr('stroke-width', 1.5)
    .attr('pointer-events', 'none')
    .style('opacity', 0);

  const zoomRect = zoomHandle.getZoomRect();

  // Disable drag-to-pan and wheel-zoom; keep only double-click-reset
  zoomRect
    .on('mousedown.zoom', null)
    .on('touchstart.zoom', null)
    .on('wheel.zoom', null)
    .style('cursor', 'crosshair');

  // Brush-to-zoom on the focus chart
  let brushStartX: number | null = null;
  const focusBrushRect = focusLayers.overlay
    .append('rect')
    .attr('class', 'focus-brush-rect')
    .attr('fill', 'rgba(0,119,190,0.15)')
    .attr('stroke', 'rgba(0,119,190,0.4)')
    .attr('y', 0)
    .attr('height', focusChart.getDimensions().innerHeight)
    .attr('pointer-events', 'none')
    .style('display', 'none');

  zoomRect
    .on('mousedown.brush', (event: MouseEvent) => {
      const [mx] = pointer(event, zoomRect.node()!);
      brushStartX = mx;
      focusBrushRect
        .attr('x', mx)
        .attr('width', 0)
        .attr('height', focusChart!.getDimensions().innerHeight)
        .style('display', null);
    })
    .on('mousemove.brush', (event: MouseEvent) => {
      if (brushStartX == null) return;
      const [mx] = pointer(event, zoomRect.node()!);
      focusBrushRect
        .attr('x', Math.min(brushStartX, mx))
        .attr('width', Math.abs(mx - brushStartX));
    })
    .on('mouseup.brush mouseleave.brush', (event: MouseEvent) => {
      if (brushStartX == null) return;
      focusBrushRect.style('display', 'none');

      const [mx] = pointer(event, zoomRect.node()!);
      const x0 = Math.min(brushStartX, mx);
      const x1 = Math.max(brushStartX, mx);
      brushStartX = null;

      // Only zoom if selection is at least 5px wide
      if (x1 - x0 < 5) return;

      const { x } = focusChart!.getScales();
      const domain: [number, number] = [
        (x as ScaleLinear<number, number>).invert(x0),
        (x as ScaleLinear<number, number>).invert(x1),
      ];
      zoomHandle!.zoomToDomain(domain);
      drawFocusLine();
      brushHandle!.moveTo(domain);
      syncConfoundsXDomain?.(domain);
    });

  zoomRect
    .on('mousemove.hover', (event: MouseEvent) => {
      if (brushStartX != null) return; // suppress hover during brush drag
      const { x, y } = focusChart!.getScales();
      const d = focusChart!.getDimensions();
      const [mx] = pointer(event, zoomRect.node()!);
      const hoveredTime = (x as ScaleLinear<number, number>).invert(mx);

      // Binary search for nearest sample
      let lo = 0;
      let hi = data.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (data[mid].time < hoveredTime) lo = mid;
        else hi = mid;
      }
      const nearest =
        Math.abs(data[lo].time - hoveredTime) < Math.abs(data[hi].time - hoveredTime)
          ? data[lo]
          : data[hi];

      const cx = (x as ScaleLinear<number, number>)(nearest.time);
      const cy = (y as ScaleLinear<number, number>)(nearest.value);

      hoverLine
        .attr('x1', cx)
        .attr('x2', cx)
        .attr('y1', 0)
        .attr('y2', d.innerHeight)
        .style('opacity', 1);

      hoverCircle.attr('cx', cx).attr('cy', cy).style('opacity', 1);

      const tooltip = focusChart!.getTooltip();
      tooltip?.show(
        `<div><strong>${nearest.time.toFixed(3)} s</strong></div><div>${channel}: ${nearest.value.toFixed(2)}</div>`,
        event.pageX,
        event.pageY,
      );
    })
    .on('mouseleave.hover', () => {
      hoverLine.style('opacity', 0);
      hoverCircle.style('opacity', 0);
      focusChart!.getTooltip()?.hide();
    });

  // Resize: redraw focus line
  focusChart.on('resize', () => {
    drawFocusLine();
  });
}

// ── Build confounds (FD) chart ──────────────────────────
function buildConfoundsChart(confounds: ConfoundsRaw, raw: PhysioRaw) {
  confoundsChart?.destroy();
  confoundsChart = null;
  syncConfoundsXDomain = null;

  const fdData = toFDPoints(confounds, raw);
  if (fdData.length === 0) {
    confoundsSectionEl.style.display = 'none';
    return;
  }

  confoundsSectionEl.style.display = '';
  confoundsLabelEl.textContent = confounds.filename;

  const timeExtent = getTimeExtent(raw);

  // Compute y extent for FD
  let fdMax = 0;
  for (const d of fdData) {
    if (d.value > fdMax) fdMax = d.value;
  }
  const yMax = fdMax * 1.1 || 0.1; // 10% headroom, fallback if all zeros

  confoundsChart = createChart({
    container: '#confounds-chart',
    width: 960,
    height: 170,
    margin: { top: 10, right: 20, bottom: 40, left: 60 },
    xScale: { type: 'linear', domain: timeExtent },
    yScale: { type: 'linear', domain: [0, yMax], nice: true },
    xAxis: { position: 'bottom', label: 'Time (s)' },
    yAxis: { position: 'left', label: 'FD (mm)' },
    grid: {
      y: { strokeColor: '#e0e0e0', opacity: 0.5 },
    },
    tooltip: { enabled: true },
    resize: { enabled: true, debounceMs: 100 },
  });

  const layers = confoundsChart.getLayers();

  const dims = confoundsChart.getDimensions();

  // Reference lines for FD ranges
  const { y: yScale } = confoundsChart.getScales();

  // 0.2mm reference line (upper bound of "good" range)
  if (yMax >= 0.2) {
    const thresh02Y = (yScale as ScaleLinear<number, number>)(0.2);
    layers.content
      .append('line')
      .attr('class', 'fd-threshold-02')
      .attr('x1', 0)
      .attr('x2', dims.innerWidth)
      .attr('y1', thresh02Y)
      .attr('y2', thresh02Y)
      .attr('stroke', '#66c2a5')
      .attr('stroke-dasharray', '6 3')
      .attr('stroke-width', 1)
      .attr('opacity', 0.6);
  }

  // 0.5mm reference line (upper bound of "acceptable" range)
  if (yMax >= 0.5) {
    const thresh05Y = (yScale as ScaleLinear<number, number>)(0.5);
    layers.content
      .append('line')
      .attr('class', 'fd-threshold-05')
      .attr('x1', 0)
      .attr('x2', dims.innerWidth)
      .attr('y1', thresh05Y)
      .attr('y2', thresh05Y)
      .attr('stroke', '#fc8d62')
      .attr('stroke-dasharray', '6 3')
      .attr('stroke-width', 1)
      .attr('opacity', 0.6);
  }

  // Container for colored FD segments
  const fdSegmentsGroup = layers.content.append('g').attr('class', 'fd-segments');

  function drawFDLine() {
    const { x, y } = confoundsChart!.getScales();

    // Clear previous segments
    fdSegmentsGroup.selectAll('path').remove();

    // Segment data by FD value ranges and draw with different colors
    const segments: { data: DataPoint[]; color: string }[] = [];
    let currentSegment: DataPoint[] = [];
    let currentColor = '';

    const getColorForFD = (fd: number): string => {
      if (fd <= 0.2) return '#66c2a5'; // green - excellent
      if (fd <= 0.5) return '#fdae61'; // amber - acceptable
      return '#d73027'; // red - excessive
    };

    for (let i = 0; i < fdData.length; i++) {
      const color = getColorForFD(fdData[i].value);

      if (color !== currentColor) {
        if (currentSegment.length > 0) {
          // Add previous point to maintain continuity
          if (i > 0) currentSegment.push(fdData[i]);
          segments.push({ data: [...currentSegment], color: currentColor });
        }
        currentSegment = i > 0 ? [fdData[i - 1], fdData[i]] : [fdData[i]];
        currentColor = color;
      } else {
        currentSegment.push(fdData[i]);
      }
    }

    // Push final segment
    if (currentSegment.length > 0) {
      segments.push({ data: currentSegment, color: currentColor });
    }

    // Draw each segment with its color
    const lineGen = line<DataPoint>()
      .x((d) => (x as ScaleLinear<number, number>)(d.time))
      .y((d) => (y as ScaleLinear<number, number>)(d.value));

    segments.forEach((seg) => {
      fdSegmentsGroup
        .append('path')
        .datum(seg.data)
        .attr('d', lineGen)
        .attr('fill', 'none')
        .attr('stroke', seg.color)
        .attr('stroke-width', 2);
    });
  }

  drawFDLine();

  // Sync callback: update x domain when physio zooms
  syncConfoundsXDomain = (domain: [number, number]) => {
    if (!confoundsChart) return;
    const { x } = confoundsChart.getScales();
    (x as ScaleLinear<number, number>).domain(domain);
    confoundsChart.renderAxesAndGrid();
    drawFDLine();

    // Redraw threshold lines at new width (if present)
    const d = confoundsChart.getDimensions();
    layers.content.select('.fd-threshold-02').attr('x2', d.innerWidth);
    layers.content.select('.fd-threshold-05').attr('x2', d.innerWidth);
  };

  // Hover
  const hoverLine = layers.overlay
    .append('line')
    .attr('stroke', '#666')
    .attr('stroke-dasharray', '4 4')
    .attr('pointer-events', 'none')
    .style('opacity', 0);

  const hoverCircle = layers.overlay
    .append('circle')
    .attr('r', 3)
    .attr('fill', '#d95f02')
    .attr('stroke', 'white')
    .attr('stroke-width', 1.5)
    .attr('pointer-events', 'none')
    .style('opacity', 0);

  // Use overlay rect for mouse events
  const overlayRect = layers.overlay
    .append('rect')
    .attr('width', dims.innerWidth)
    .attr('height', dims.innerHeight)
    .attr('fill', 'transparent')
    .attr('cursor', 'crosshair');

  overlayRect
    .on('mousemove', (event: MouseEvent) => {
      const { x, y } = confoundsChart!.getScales();
      const d = confoundsChart!.getDimensions();
      const [mx] = pointer(event, overlayRect.node()!);
      const hoveredTime = (x as ScaleLinear<number, number>).invert(mx);

      // Find nearest FD point
      let lo = 0;
      let hi = fdData.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (fdData[mid].time < hoveredTime) lo = mid;
        else hi = mid;
      }
      const nearest =
        Math.abs(fdData[lo].time - hoveredTime) < Math.abs(fdData[hi].time - hoveredTime)
          ? fdData[lo]
          : fdData[hi];

      const cx = (x as ScaleLinear<number, number>)(nearest.time);
      const cy = (y as ScaleLinear<number, number>)(nearest.value);

      hoverLine
        .attr('x1', cx)
        .attr('x2', cx)
        .attr('y1', 0)
        .attr('y2', d.innerHeight)
        .style('opacity', 1);

      hoverCircle.attr('cx', cx).attr('cy', cy).style('opacity', 1);

      confoundsChart!.getTooltip()?.show(
        `<div><strong>${nearest.time.toFixed(2)} s</strong></div><div>FD: ${nearest.value.toFixed(4)} mm</div>`,
        event.pageX,
        event.pageY,
      );
    })
    .on('mouseleave', () => {
      hoverLine.style('opacity', 0);
      hoverCircle.style('opacity', 0);
      confoundsChart!.getTooltip()?.hide();
    });

  // Resize
  confoundsChart.on('resize', drawFDLine);
}

// ── Data loading ────────────────────────────────────────
async function loadPhysio(sub: string, ses: string, task: string, run: string) {
  if (sub === currentSub && ses === currentSes && task === currentTask && run === currentRun && cachedRaw) {
    buildCharts(cachedRaw, channelSelect.value);
    if (cachedConfounds) buildConfoundsChart(cachedConfounds, cachedRaw);
    else confoundsSectionEl.style.display = 'none';
    if (cachedSQI) renderSQITable(cachedSQI);
    return;
  }

  cachedSQI = null;
  sqiSectionEl.style.display = 'none';
  sqiTableContainer.innerHTML = '';

  setLoading('Loading...');
  try {
    const [physioRaw, confoundsRaw] = await Promise.all([
      fetchPhysioRaw(sub, ses, task, run),
      fetchConfounds(sub, ses, task, run),
    ]);

    cachedRaw = physioRaw;
    cachedConfounds = confoundsRaw;
    currentSub = sub;
    currentSes = ses;
    currentTask = task;
    currentRun = run;

    filenameEl.textContent = cachedRaw.filename;
    renderQualityBadges(cachedRaw);
    const preferredChannel = cachedRaw.columns.includes(channelSelect.value)
      ? channelSelect.value
      : cachedRaw.columns[0];
    populateSelect(channelSelect, cachedRaw.columns, preferredChannel);
    buildCharts(cachedRaw, channelSelect.value);

    if (cachedConfounds) {
      buildConfoundsChart(cachedConfounds, cachedRaw);
    } else {
      confoundsSectionEl.style.display = 'none';
    }

    setLoading('');
  } catch (err) {
    setLoading(`Error: ${err}`);
  }
}

// ── Event handlers ──────────────────────────────────────
subjectSelect.addEventListener('change', async () => {
  const sub = subjectSelect.value;
  const info = subjects.find((s) => s.id === sub);
  if (!info) return;
  populateSelect(sessionSelect, info.sessions);
  await populateTasks(sub, sessionSelect.value);
  await populateRuns(sub, sessionSelect.value, taskSelect.value);
  loadPhysio(sub, sessionSelect.value, taskSelect.value, runSelect.value ?? '');
});

sessionSelect.addEventListener('change', async () => {
  await populateTasks(subjectSelect.value, sessionSelect.value);
  await populateRuns(subjectSelect.value, sessionSelect.value, taskSelect.value);
  loadPhysio(subjectSelect.value, sessionSelect.value, taskSelect.value, runSelect.value ?? '');
});

taskSelect.addEventListener('change', async () => {
  await populateRuns(subjectSelect.value, sessionSelect.value, taskSelect.value);
  loadPhysio(subjectSelect.value, sessionSelect.value, taskSelect.value, runSelect.value ?? '');
});

runSelect.addEventListener('change', () => {
  loadPhysio(subjectSelect.value, sessionSelect.value, taskSelect.value, runSelect.value ?? '');
});

channelSelect.addEventListener('change', () => {
  if (cachedRaw) {
    buildCharts(cachedRaw, channelSelect.value);
    if (cachedConfounds) buildConfoundsChart(cachedConfounds, cachedRaw);
  }
});

async function goToScan(scan: ScanEntry) {
  subjectSelect.value = scan.sub;
  const info = subjects.find((s) => s.id === scan.sub)!;
  populateSelect(sessionSelect, info.sessions, scan.ses);
  await populateTasks(scan.sub, scan.ses, scan.task);
  await populateRuns(scan.sub, scan.ses, scan.task, scan.run);
  loadPhysio(scan.sub, scan.ses, scan.task, scan.run);
}

async function stepScan(delta: number) {
  const curIdx = allScans.findIndex(
    (s) =>
      s.sub === subjectSelect.value &&
      s.ses === sessionSelect.value &&
      s.task === taskSelect.value &&
      s.run === (runSelect.value ?? ''),
  );
  const next = allScans[(curIdx + delta + allScans.length) % allScans.length];
  await goToScan(next);
}

prevBtn.addEventListener('click', () => stepScan(-1));
nextBtn.addEventListener('click', () => stepScan(1));

searchInput.addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  const q = searchInput.value.trim();
  if (!q) return;

  // Strip "sub-" or "ses-" prefix if present, keep raw value too
  const subId = q.startsWith('sub-') ? q.slice(4) : q;
  const sesId = q.startsWith('ses-') ? q.slice(4) : q;

  // Try matching a subject — jump to its first scan
  const subMatch = allScans.find((s) => s.sub === subId);
  if (subMatch) {
    await goToScan(subMatch);
    searchInput.value = '';
    return;
  }

  // Try as session within current subject
  const sesMatchCur = allScans.find(
    (s) => s.sub === subjectSelect.value && s.ses === sesId,
  );
  if (sesMatchCur) {
    await goToScan(sesMatchCur);
    searchInput.value = '';
    return;
  }

  // Try as session across all subjects
  const sesMatchAny = allScans.find((s) => s.ses === sesId);
  if (sesMatchAny) {
    await goToScan(sesMatchAny);
    searchInput.value = '';
    return;
  }

  setLoading(`No match for "${q}"`);
});

// ── Init ────────────────────────────────────────────────
(async () => {
  setLoading('Loading subjects...');
  [subjects, allScans] = await Promise.all([fetchSubjects(), fetchScans()]);

  populateSelect(subjectSelect, subjects.map((s) => s.id));
  const first = allScans[0];
  const firstInfo = subjects.find((s) => s.id === first.sub)!;
  populateSelect(sessionSelect, firstInfo.sessions, first.ses);
  await populateTasks(first.sub, first.ses, first.task);
  await populateRuns(first.sub, first.ses, first.task, first.run);

  await loadPhysio(first.sub, first.ses, first.task, first.run);
})();
