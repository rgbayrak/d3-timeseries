import { createChart, createZoom, createBrush, cullToViewport, downsample } from '@/core';
import type { ChartInstance, ZoomHandle, BrushHandle } from '@/core';
import { line } from 'd3-shape';
import { pointer } from 'd3-selection';
import type { ScaleLinear } from 'd3-scale';
import {
  fetchSubjects,
  fetchScans,
  fetchDatasetInfo,
  fetchTasks,
  fetchRuns,
  fetchPhysioRaw,
  fetchConfounds,
  fetchAnnotations,
  saveAnnotations,
  toDataPoints,
  toConfoundPoints,
  getViewExtent,
  getValueExtent,
} from '@/data/bids-physio-reader';
import type { SubjectInfo, ScanEntry, PhysioRaw, ConfoundsRaw, DataPoint, AnnotationsFile, DatasetInfo } from '@/data/bids-physio-reader';
import { computeSQI } from '@/data/sqi-metrics';
import type { SQIResults, ChannelMetrics } from '@/data/sqi-metrics';

// ── DOM refs ────────────────────────────────────────────
const subjectSelect = document.getElementById('subject-select') as HTMLSelectElement;
const sessionSelect = document.getElementById('session-select') as HTMLSelectElement;
const taskSelect = document.getElementById('task-select') as HTMLSelectElement;
const runSelect = document.getElementById('run-select') as HTMLSelectElement;
const runLabel = document.getElementById('run-label') as HTMLLabelElement;
const channelSelect = document.getElementById('channel-select') as HTMLSelectElement;
const confoundSelect = document.getElementById('confound-select') as HTMLSelectElement;
const confoundLabel = document.getElementById('confound-label') as HTMLLabelElement;
const prevBtn = document.getElementById('prev-btn') as HTMLButtonElement;
const nextBtn = document.getElementById('next-btn') as HTMLButtonElement;
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const datasetInfoEl = document.getElementById('dataset-info')!;
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
const annotateModeBtn = document.getElementById('annotate-mode-btn') as HTMLButtonElement;
const annotationListEl = document.getElementById('annotation-list')!;
const stackRowEl = document.getElementById('stack-row')!;
const stackChannelsEl = document.getElementById('stack-channels')!;
const stackSectionEl = document.getElementById('stack-section')!;

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

/** Extra channels drawn as compact figures below the main focus chart */
let stackedChannels: string[] = [];
let stackCharts: ChartInstance[] = [];

// ── Annotations ─────────────────────────────────────────
interface Annotation {
  id: string;
  start: number;
  end: number;
  label: string;
}

let annotateMode = false;
let annotations: Annotation[] = [];
let annotationIdCounter = 0;

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderAnnotationList() {
  if (annotations.length === 0) {
    annotationListEl.innerHTML = '<div class="annotation-empty">No annotations yet — enable Annotate mode and drag on the focus chart.</div>';
    return;
  }

  let html = '';
  for (const a of annotations) {
    html += `<div class="annotation-item" data-id="${a.id}">
      <span class="annotation-range">${a.start.toFixed(2)}s – ${a.end.toFixed(2)}s</span>
      <span class="annotation-text">${escapeHtml(a.label)}</span>
      <button type="button" class="annotation-remove" data-id="${a.id}">&times;</button>
    </div>`;
  }
  annotationListEl.innerHTML = html;

  annotationListEl.querySelectorAll<HTMLButtonElement>('.annotation-remove').forEach((btn) => {
    btn.addEventListener('click', () => removeAnnotation(btn.dataset.id!));
  });
}

// Set by buildCharts to reposition annotation boxes when the x-domain changes
let drawAnnotations: () => void = () => {};

function buildAnnotationsPayload(): AnnotationsFile {
  const fs = cachedRaw?.samplingFrequency ?? 0;
  return {
    sub: currentSub,
    ses: currentSes,
    task: currentTask,
    run: currentRun,
    channel: channelSelect.value,
    sampling_rate: fs,
    annotations: annotations.map((a) => ({
      id: a.id,
      onset_s: a.start,
      duration_s: a.end - a.start,
      trial_type: a.label,
      start_sample: Math.round(a.start * fs),
      end_sample: Math.round(a.end * fs),
    })),
  };
}

function persistAnnotations() {
  saveAnnotations(buildAnnotationsPayload()).catch((err) => {
    console.error('Failed to save annotations', err);
    setLoading('Failed to save annotation');
  });
}

async function loadSavedAnnotations(sub: string, ses: string, task: string, run: string, channel: string) {
  const stored = await fetchAnnotations(sub, ses, task, run, channel).catch(() => null);
  if (!stored) return;

  // Discard if the scan/channel changed while this request was in flight
  if (sub !== currentSub || ses !== currentSes || task !== currentTask || run !== currentRun || channel !== channelSelect.value) {
    return;
  }

  annotations = stored.annotations.map((a) => ({
    id: a.id,
    start: a.onset_s,
    end: a.onset_s + a.duration_s,
    label: a.trial_type,
  }));
  drawAnnotations();
  renderAnnotationList();
}

function removeAnnotation(id: string) {
  annotations = annotations.filter((a) => a.id !== id);
  drawAnnotations();
  renderAnnotationList();
  persistAnnotations();
}

annotateModeBtn.addEventListener('click', () => {
  annotateMode = !annotateMode;
  annotateModeBtn.classList.toggle('active', annotateMode);
  annotateModeBtn.textContent = annotateMode ? 'Annotate: On' : 'Annotate: Off';
});

// ── Helpers ─────────────────────────────────────────────
function setLoading(msg: string) {
  loadingEl.textContent = msg;
}

/** Dataset name + metadata line, all taken from dataset_description.json */
function renderDatasetInfo(info: DatasetInfo | null) {
  datasetInfoEl.innerHTML = '';
  if (!info || (!info.name && info.authors.length === 0 && !info.doi)) return;

  const nameEl = document.createElement('div');
  nameEl.className = 'dataset-name';
  nameEl.textContent = info.name ?? '(unnamed dataset)';
  datasetInfoEl.appendChild(nameEl);

  const meta = document.createElement('div');
  meta.className = 'dataset-meta';
  const parts: (string | Node)[] = [];
  if (info.authors.length) parts.push(info.authors.join(', '));
  if (info.bidsVersion) parts.push(`BIDS ${info.bidsVersion}`);
  if (info.license) parts.push(`License: ${info.license}`);
  if (info.doi) {
    // DatasetDOI is usually "doi:10.xxx/..."; link it via doi.org
    const bare = info.doi.replace(/^doi:/i, '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
    const a = document.createElement('a');
    a.href = `https://doi.org/${bare}`;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = `doi:${bare}`;
    parts.push(a);
  }
  for (const d of info.derivatives) {
    parts.push(`Derivatives: ${d.name}${d.version ? ` ${d.version}` : ''}`);
  }
  parts.forEach((p, i) => {
    if (i > 0) meta.append(' · ');
    meta.append(p);
  });
  datasetInfoEl.appendChild(meta);
}

const TIMING_LABELS: Record<PhysioRaw['timing']['status'], string> = {
  verified: 'Timing: trigger-verified',
  corrected: 'Timing: corrected from triggers',
  mismatch: 'Timing: triggers disagree',
  unverified: 'Timing: sidecar only',
};

function renderQualityBadges(raw: PhysioRaw) {
  qualityBadgesEl.innerHTML = '';

  // Timing badge: how t = 0 (scan onset) was established; hover for details
  const timingBadge = document.createElement('span');
  timingBadge.className = `quality-badge timing-${raw.timing.status}`;
  timingBadge.textContent = TIMING_LABELS[raw.timing.status];
  timingBadge.title = raw.timing.detail;
  qualityBadgesEl.appendChild(timingBadge);

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
  destroyStackCharts();
}

// Callback for confounds zoom sync — set by buildConfoundsChart
let syncConfoundsXDomain: ((domain: [number, number]) => void) | null = null;
// Callback for stacked-channel zoom sync — set by buildStackCharts
let syncStackXDomain: ((domain: [number, number]) => void) | null = null;

/** Push the focus chart's x window to every chart that follows it */
function syncLinkedXDomain(domain: [number, number]) {
  syncConfoundsXDomain?.(domain);
  syncStackXDomain?.(domain);
}

/** Fit a chart's y domain to the visible samples (5% padding) */
function fitYToVisible(chart: ChartInstance, visible: DataPoint[]) {
  if (visible.length === 0) return;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (let i = 0; i < visible.length; i++) {
    const v = visible[i].value;
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
  }
  const pad = (vMax - vMin) * 0.05 || 0.1;
  (chart.getScales().y as ScaleLinear<number, number>).domain([vMin - pad, vMax + pad]);
  chart.renderAxesAndGrid();
}

// ── Build charts ────────────────────────────────────────
/**
 * Dashed vertical line at scan onset (t = 0, first BOLD volume), the shared
 * reference for physio and confounds. Hidden when 0 is outside the x domain.
 */
function drawOnsetMarker(
  chart: ChartInstance,
  group: ReturnType<ChartInstance['getLayers']>['content'],
  withLabel: boolean,
) {
  const xScale = chart.getScales().x as ScaleLinear<number, number>;
  const [d0, d1] = xScale.domain();
  const height = chart.getDimensions().innerHeight;
  const visible = d0 <= 0 && 0 <= d1;
  const x0 = xScale(0);

  group.selectAll('*').remove();
  if (!visible) return;
  group
    .append('line')
    .attr('x1', x0)
    .attr('x2', x0)
    .attr('y1', 0)
    .attr('y2', height)
    .attr('stroke', '#7b3fa0')
    .attr('stroke-width', 1.5)
    .attr('stroke-dasharray', '5 3')
    .attr('pointer-events', 'none');
  if (withLabel) {
    group
      .append('text')
      .attr('x', x0 + 4)
      .attr('y', 12)
      .attr('fill', '#7b3fa0')
      .attr('font-size', 11)
      .attr('pointer-events', 'none')
      .text('scan onset (t = 0)');
  }
}

function buildCharts(raw: PhysioRaw, channel: string) {
  destroyCharts();
  syncConfoundsXDomain = null;
  annotations = [];
  drawAnnotations = () => {};
  renderAnnotationList();

  const data = toDataPoints(raw, channel);
  const timeExtent = getViewExtent(raw);
  const valueExtent = getValueExtent(raw, channel);

  // Focus chart
  focusChart = createChart({
    container: '#focus-chart',
    width: 960,
    height: 350,
    margin: { top: 20, right: 20, bottom: 40, left: 60 },
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

  const contextData = downsample(data, 2000);

  const focusOnsetGroup = focusLayers.content.append('g').attr('class', 'onset-marker');
  const contextOnsetGroup = contextLayers.content.append('g').attr('class', 'onset-marker');

  function drawFocusLine() {
    const { x, y } = focusChart!.getScales();
    const xDomain = (x as ScaleLinear<number, number>).domain() as [number, number];
    const visible = cullToViewport(data, xDomain, (d: DataPoint) => d.time);

    // Auto-fit Y to visible data
    fitYToVisible(focusChart!, visible);

    const lineGen = line<DataPoint>()
      .x((d) => (x as ScaleLinear<number, number>)(d.time))
      .y((d) => (y as ScaleLinear<number, number>)(d.value));

    focusLinePath.datum(visible).attr('d', lineGen);
    drawOnsetMarker(focusChart!, focusOnsetGroup, true);
  }

  function drawAnnotationBoxes() {
    const { x } = focusChart!.getScales();
    const xScale = x as ScaleLinear<number, number>;
    const height = focusChart!.getDimensions().innerHeight;

    const sel = annotationsGroup
      .selectAll<SVGGElement, Annotation>('g.annotation')
      .data(annotations, (d) => d.id);

    sel.exit().remove();

    const entered = sel
      .enter()
      .append('g')
      .attr('class', 'annotation');

    entered
      .append('rect')
      .attr('fill', 'rgba(230,126,34,0.12)')
      .attr('stroke', 'rgba(230,126,34,0.6)')
      .attr('stroke-width', 1)
      .attr('pointer-events', 'none');

    entered
      .append('text')
      .attr('fill', '#b5651d')
      .attr('font-size', 11)
      .attr('y', 12)
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
  drawAnnotations = drawAnnotationBoxes;

  function addAnnotation(domain: [number, number]) {
    const label = window.prompt('Annotation label (e.g. "fix" to mark for reconstruction):', '');
    if (label === null) return; // user cancelled — discard selection
    annotations.push({
      id: `ann-${Date.now()}-${annotationIdCounter++}`,
      start: domain[0],
      end: domain[1],
      label: label.trim() || '(untitled)',
    });
    drawAnnotationBoxes();
    renderAnnotationList();
    persistAnnotations();
  }

  function drawContextLine() {
    const { x, y } = contextChart!.getScales();

    const lineGen = line<DataPoint>()
      .x((d) => (x as ScaleLinear<number, number>)(d.time))
      .y((d) => (y as ScaleLinear<number, number>)(d.value));

    contextLinePath.datum(contextData).attr('d', lineGen);
    drawOnsetMarker(contextChart!, contextOnsetGroup, false);
  }

  drawFocusLine();
  drawAnnotationBoxes();
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
      drawAnnotationBoxes();
      brushHandle!.moveTo(xDomain);
      syncLinkedXDomain(xDomain);
    },
  });

  // Brush
  brushHandle = createBrush(contextChart, {
    onBrush(selection) {
      if (!selection) return;
      zoomHandle!.zoomToDomain(selection);
      drawFocusLine();
      drawAnnotationBoxes();
      syncLinkedXDomain(selection);
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
        .attr('fill', annotateMode ? 'rgba(230,126,34,0.15)' : 'rgba(0,119,190,0.15)')
        .attr('stroke', annotateMode ? 'rgba(230,126,34,0.5)' : 'rgba(0,119,190,0.4)')
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

      if (annotateMode) {
        addAnnotation(domain);
        return;
      }

      zoomHandle!.zoomToDomain(domain);
      drawFocusLine();
      drawAnnotationBoxes();
      brushHandle!.moveTo(domain);
      syncLinkedXDomain(domain);
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
    drawAnnotationBoxes();
  });

  loadSavedAnnotations(currentSub, currentSes, currentTask, currentRun, channel);
}

// ── Build confounds chart ───────────────────────────────
/** Axis label and tooltip unit for each confound column */
const CONFOUND_UNITS: Record<string, { label: string; unit: string }> = {
  framewise_displacement: { label: 'FD (mm)', unit: 'mm' },
  rmsd: { label: 'RMSD (mm)', unit: 'mm' },
  dvars: { label: 'DVARS', unit: '' },
  std_dvars: { label: 'Std DVARS', unit: '' },
  trans_x: { label: 'trans_x (mm)', unit: 'mm' },
  trans_y: { label: 'trans_y (mm)', unit: 'mm' },
  trans_z: { label: 'trans_z (mm)', unit: 'mm' },
  rot_x: { label: 'rot_x (rad)', unit: 'rad' },
  rot_y: { label: 'rot_y (rad)', unit: 'rad' },
  rot_z: { label: 'rot_z (rad)', unit: 'rad' },
};

function buildConfoundsChart(confounds: ConfoundsRaw, raw: PhysioRaw) {
  confoundsChart?.destroy();
  confoundsChart = null;
  syncConfoundsXDomain = null;

  const column = confoundSelect.value;
  const isFD = column === 'framewise_displacement';
  const { label: yLabel, unit } = CONFOUND_UNITS[column] ?? { label: column, unit: '' };

  const points = toConfoundPoints(confounds, column, raw);
  if (points.length === 0) {
    confoundsSectionEl.style.display = 'none';
    return;
  }

  confoundsSectionEl.style.display = '';
  confoundsLabelEl.textContent = confounds.filename;

  const timeExtent = getViewExtent(raw);

  // Compute y extent. FD is non-negative and anchored at 0; other
  // confounds (e.g. translations) can be signed, so fit both ends.
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const d of points) {
    if (d.value < vMin) vMin = d.value;
    if (d.value > vMax) vMax = d.value;
  }
  let yDomain: [number, number];
  if (isFD) {
    yDomain = [0, vMax * 1.1 || 0.1]; // 10% headroom, fallback if all zeros
  } else {
    const pad = (vMax - vMin) * 0.1 || Math.abs(vMax) * 0.1 || 0.1;
    yDomain = [vMin - pad, vMax + pad];
  }
  const yMax = yDomain[1];

  confoundsChart = createChart({
    container: '#confounds-chart',
    width: 960,
    height: 170,
    margin: { top: 10, right: 20, bottom: 40, left: 60 },
    xScale: { type: 'linear', domain: timeExtent },
    yScale: { type: 'linear', domain: yDomain, nice: true },
    xAxis: { position: 'bottom', label: 'Time from scan onset (s)' },
    yAxis: { position: 'left', label: yLabel },
    grid: {
      y: { strokeColor: '#e0e0e0', opacity: 0.5 },
    },
    tooltip: { enabled: true },
    resize: { enabled: true, debounceMs: 100 },
  });

  const layers = confoundsChart.getLayers();

  const dims = confoundsChart.getDimensions();

  // FD-only reference lines for motion severity ranges
  const { y: yScale } = confoundsChart.getScales();

  // 0.2mm reference line (upper bound of "good" range)
  if (isFD && yMax >= 0.2) {
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
  if (isFD && yMax >= 0.5) {
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

  // Container for line segments (colored by severity for FD)
  const segmentsGroup = layers.content.append('g').attr('class', 'confound-segments');
  const confoundsOnsetGroup = layers.content.append('g').attr('class', 'onset-marker');

  function drawConfoundLine() {
    const { x, y } = confoundsChart!.getScales();

    // Clear previous segments
    segmentsGroup.selectAll('path').remove();

    // Split the line into runs of the same color and draw each
    const segments: { data: DataPoint[]; color: string }[] = [];
    let currentSegment: DataPoint[] = [];
    let currentColor = '';

    // Severity colors only apply to FD; other confounds draw in one color
    const colorFor = (v: number): string => {
      if (!isFD) return '#3b6ea5';
      if (v <= 0.2) return '#66c2a5'; // green - excellent
      if (v <= 0.5) return '#fdae61'; // amber - acceptable
      return '#d73027'; // red - excessive
    };

    for (let i = 0; i < points.length; i++) {
      const color = colorFor(points[i].value);

      if (color !== currentColor) {
        if (currentSegment.length > 0) {
          // Add previous point to maintain continuity
          if (i > 0) currentSegment.push(points[i]);
          segments.push({ data: [...currentSegment], color: currentColor });
        }
        currentSegment = i > 0 ? [points[i - 1], points[i]] : [points[i]];
        currentColor = color;
      } else {
        currentSegment.push(points[i]);
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
      segmentsGroup
        .append('path')
        .datum(seg.data)
        .attr('d', lineGen)
        .attr('fill', 'none')
        .attr('stroke', seg.color)
        .attr('stroke-width', 2);
    });

    drawOnsetMarker(confoundsChart!, confoundsOnsetGroup, false);
  }

  drawConfoundLine();

  // Sync callback: update x domain when physio zooms
  syncConfoundsXDomain = (domain: [number, number]) => {
    if (!confoundsChart) return;
    const { x } = confoundsChart.getScales();
    (x as ScaleLinear<number, number>).domain(domain);
    confoundsChart.renderAxesAndGrid();
    drawConfoundLine();

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

      // Find nearest confound point
      let lo = 0;
      let hi = points.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (points[mid].time < hoveredTime) lo = mid;
        else hi = mid;
      }
      const nearest =
        Math.abs(points[lo].time - hoveredTime) < Math.abs(points[hi].time - hoveredTime)
          ? points[lo]
          : points[hi];

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
        `<div><strong>${nearest.time.toFixed(2)} s</strong></div><div>${column}: ${nearest.value.toFixed(4)}${unit ? ` ${unit}` : ''}</div>`,
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
  confoundsChart.on('resize', drawConfoundLine);
}

// ── Stacked channels ────────────────────────────────────
function destroyStackCharts() {
  for (const c of stackCharts) c.destroy();
  stackCharts = [];
  syncStackXDomain = null;
  stackSectionEl.innerHTML = '';
  stackSectionEl.style.display = 'none';
}

/** One checkbox per channel except the main one shown in the focus chart */
function renderStackControls(columns: string[]) {
  const mainChannel = channelSelect.value;
  stackedChannels = stackedChannels.filter((c) => c !== mainChannel && columns.includes(c));

  stackChannelsEl.innerHTML = '';
  const options = columns.filter((c) => c !== mainChannel);
  stackRowEl.style.display = options.length > 0 ? '' : 'none';

  for (const ch of options) {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = stackedChannels.includes(ch);
    cb.addEventListener('change', () => {
      // Keep the stack in column order regardless of click order
      const checked = new Set(stackedChannels);
      if (cb.checked) checked.add(ch);
      else checked.delete(ch);
      stackedChannels = columns.filter((c) => checked.has(c));
      if (cachedRaw) buildStackCharts(cachedRaw);
      saveLastViewed();
    });
    label.append(cb, ch);
    stackChannelsEl.appendChild(label);
  }
}

/**
 * Compact figure per stacked channel. Each follows the focus chart's x window
 * (via syncLinkedXDomain) and auto-fits its y-axis to the visible samples.
 */
function buildStackCharts(raw: PhysioRaw) {
  destroyStackCharts();
  if (stackedChannels.length === 0) return;
  stackSectionEl.style.display = '';

  // Start at the focus chart's current window so the stack lines up with it
  const xDomain = focusChart
    ? ((focusChart.getScales().x as ScaleLinear<number, number>).domain() as [number, number])
    : getViewExtent(raw);

  const redrawers: (() => void)[] = [];

  for (const channel of stackedChannels) {
    const data = toDataPoints(raw, channel);
    if (data.length === 0) continue;

    const el = document.createElement('div');
    el.className = 'stack-chart';
    stackSectionEl.appendChild(el);

    const chart = createChart({
      container: el,
      width: 960,
      height: 140,
      // Same left/right margins as the focus chart so the time axes line up
      margin: { top: 10, right: 20, bottom: 30, left: 60 },
      xScale: { type: 'linear', domain: xDomain },
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
    stackCharts.push(chart);

    const layers = chart.getLayers();
    const linePath = layers.content
      .append('path')
      .attr('fill', 'none')
      .attr('stroke', '#2d8a8e')
      .attr('stroke-width', 1.2);
    const onsetGroup = layers.content.append('g').attr('class', 'onset-marker');

    function draw() {
      const { x, y } = chart.getScales();
      const domain = (x as ScaleLinear<number, number>).domain() as [number, number];
      const visible = cullToViewport(data, domain, (d: DataPoint) => d.time);
      fitYToVisible(chart, visible);

      const lineGen = line<DataPoint>()
        .x((d) => (x as ScaleLinear<number, number>)(d.time))
        .y((d) => (y as ScaleLinear<number, number>)(d.value));
      linePath.datum(visible).attr('d', lineGen);
      drawOnsetMarker(chart, onsetGroup, false);
    }

    draw();
    redrawers.push(draw);

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
      .attr('fill', '#2d8a8e')
      .attr('stroke', 'white')
      .attr('stroke-width', 1.5)
      .attr('pointer-events', 'none')
      .style('opacity', 0);

    const dims = chart.getDimensions();
    const overlayRect = layers.overlay
      .append('rect')
      .attr('width', dims.innerWidth)
      .attr('height', dims.innerHeight)
      .attr('fill', 'transparent')
      .attr('cursor', 'crosshair');

    overlayRect
      .on('mousemove', (event: MouseEvent) => {
        const { x, y } = chart.getScales();
        const d = chart.getDimensions();
        const [mx] = pointer(event, overlayRect.node()!);
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

        chart.getTooltip()?.show(
          `<div><strong>${nearest.time.toFixed(3)} s</strong></div><div>${channel}: ${nearest.value.toFixed(2)}</div>`,
          event.pageX,
          event.pageY,
        );
      })
      .on('mouseleave', () => {
        hoverLine.style('opacity', 0);
        hoverCircle.style('opacity', 0);
        chart.getTooltip()?.hide();
      });

    chart.on('resize', () => {
      const d = chart.getDimensions();
      overlayRect.attr('width', d.innerWidth).attr('height', d.innerHeight);
      draw();
    });
  }

  syncStackXDomain = (domain: [number, number]) => {
    stackCharts.forEach((chart, i) => {
      (chart.getScales().x as ScaleLinear<number, number>).domain(domain);
      redrawers[i]();
    });
  };
}

// ── Data loading ────────────────────────────────────────
async function loadPhysio(sub: string, ses: string, task: string, run: string) {
  if (sub === currentSub && ses === currentSes && task === currentTask && run === currentRun && cachedRaw) {
    buildCharts(cachedRaw, channelSelect.value);
    buildStackCharts(cachedRaw);
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
    // Keep the current channel/confound when the new scan has it; on the first
    // load after a reload, prefer the one restored from localStorage
    const columns = cachedRaw.columns;
    const preferredChannel =
      [restoredSelection?.channel, channelSelect.value].find((c) => c && columns.includes(c)) ??
      columns[0];
    populateSelect(channelSelect, columns, preferredChannel);
    // Stacked channels carry over the same way; renderStackControls drops
    // any the new scan lacks
    if (restoredSelection) stackedChannels = restoredSelection.stacked;
    renderStackControls(columns);
    buildCharts(cachedRaw, channelSelect.value);
    buildStackCharts(cachedRaw);

    if (cachedConfounds) {
      const confoundCols = Object.keys(cachedConfounds.columns);
      const preferredConfound =
        [restoredSelection?.confound, confoundSelect.value].find((c) => c && confoundCols.includes(c)) ??
        confoundCols[0];
      populateSelect(confoundSelect, confoundCols, preferredConfound);
      confoundLabel.style.display = '';
      buildConfoundsChart(cachedConfounds, cachedRaw);
    } else {
      // No derivatives for this scan (or no BIDSDER_ROOT): hide the picker
      confoundLabel.style.display = 'none';
      confoundsSectionEl.style.display = 'none';
    }

    restoredSelection = null;
    saveLastViewed();
    setLoading('');
  } catch (err) {
    setLoading(`Error: ${err}`);
  }
}

// ── Last-viewed scan (localStorage) ─────────────────────
// Per-browser convenience only: storage can be unavailable (private mode,
// blocked site data), so every access is wrapped and failures are ignored.
interface LastViewed extends ScanEntry {
  channel: string;
  confound: string;
  /** Absent in entries saved before stacked channels existed */
  stacked?: string[];
}

/** Storage key; scoped per dataset (by name) once dataset info has loaded */
let lastViewedKey = 'bids-physio-viewer:last-viewed';
/** Channel/confound/stack restored on reload, consumed by the first loadPhysio */
let restoredSelection: { channel: string; confound: string; stacked: string[] } | null = null;

function saveLastViewed() {
  if (!currentSub) return;
  const value: LastViewed = {
    sub: currentSub,
    ses: currentSes,
    task: currentTask,
    run: currentRun,
    channel: channelSelect.value,
    confound: confoundSelect.value,
    stacked: stackedChannels,
  };
  try {
    localStorage.setItem(lastViewedKey, JSON.stringify(value));
  } catch {
    // ignore: storage unavailable
  }
}

function readLastViewed(): LastViewed | null {
  try {
    const raw = localStorage.getItem(lastViewedKey);
    return raw ? (JSON.parse(raw) as LastViewed) : null;
  } catch {
    return null;
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
    // The new main channel leaves the stack options (and the stack, if checked)
    renderStackControls(cachedRaw.columns);
    buildCharts(cachedRaw, channelSelect.value);
    buildStackCharts(cachedRaw);
    if (cachedConfounds) buildConfoundsChart(cachedConfounds, cachedRaw);
  }
  saveLastViewed();
});

confoundSelect.addEventListener('change', () => {
  if (cachedRaw && cachedConfounds) buildConfoundsChart(cachedConfounds, cachedRaw);
  saveLastViewed();
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

// ←/→ step to the previous/next scan. Ignored while typing in the search box
// or using a dropdown (where arrow keys already have a meaning), and when a
// modifier is held so browser shortcuts (e.g. Alt+← for back) keep working.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest('input, select, textarea, [contenteditable="true"]')) return;
  e.preventDefault();
  stepScan(e.key === 'ArrowLeft' ? -1 : 1);
});

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
  const [subjectsRes, scansRes, datasetInfo] = await Promise.all([
    fetchSubjects(),
    fetchScans(),
    fetchDatasetInfo().catch(() => null),
  ]);
  subjects = subjectsRes;
  allScans = scansRes;
  renderDatasetInfo(datasetInfo);

  // Resume the last-viewed scan for this dataset if it still exists
  lastViewedKey = `bids-physio-viewer:last-viewed:${datasetInfo?.name ?? 'unnamed'}`;
  const saved = readLastViewed();
  const resumed = saved
    ? allScans.find(
        (s) => s.sub === saved.sub && s.ses === saved.ses && s.task === saved.task && s.run === saved.run,
      )
    : undefined;
  if (resumed && saved) {
    restoredSelection = {
      channel: saved.channel,
      confound: saved.confound,
      stacked: Array.isArray(saved.stacked) ? saved.stacked : [],
    };
  }

  const first = resumed ?? allScans[0];
  populateSelect(subjectSelect, subjects.map((s) => s.id), first.sub);
  const firstInfo = subjects.find((s) => s.id === first.sub)!;
  populateSelect(sessionSelect, firstInfo.sessions, first.ses);
  await populateTasks(first.sub, first.ses, first.task);
  await populateRuns(first.sub, first.ses, first.task, first.run);

  await loadPhysio(first.sub, first.ses, first.task, first.run);
})();
