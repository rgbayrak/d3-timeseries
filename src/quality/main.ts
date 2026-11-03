import { fetchQualityIndex, fetchDatasetQuality } from './data';
import type { LoadedDataset } from './data';
import { parseRoute, routeHash } from './route';
import type { Route } from './route';
import type { ScanKeyLike } from './metrics-tsv';
import { createGroupTab } from './group-tab';
import { createIndividualTab } from './individual-tab';
import { buildQualityReport } from './report';
import { createMetricPicker } from './metric-picker';
import { esc, parseVisibleMetrics, serializeVisibleMetrics } from './model';
import type { VisibleMetrics } from './model';

// Entry for quality.html: owns the page elements, the hash route and the
// loaded datasets; the tab modules do the rendering.

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing from quality.html`);
  return el as T;
}

const els = {
  datasetSelect: byId<HTMLSelectElement>('dataset-select'),
  tabGroup: byId<HTMLButtonElement>('tab-group'),
  tabSubject: byId<HTMLButtonElement>('tab-subject'),
  pdfBtn: byId<HTMLButtonElement>('pdf-btn'),
  pdfScans: byId<HTMLInputElement>('pdf-scans'),
  status: byId<HTMLElement>('status'),
  groupSection: byId<HTMLElement>('group-tab'),
  subjectSection: byId<HTMLElement>('subject-tab'),
};

// Metrics picker: which metrics the Stats tabs and the PDF show; remembered in this browser only
const VISIBLE_METRICS_KEY = 'physai-quality-visible-metrics';

function readVisibleMetrics(): VisibleMetrics {
  try {
    return parseVisibleMetrics(localStorage.getItem(VISIBLE_METRICS_KEY));
  } catch {
    return parseVisibleMetrics(null);
  }
}

function saveVisibleMetrics(visible: VisibleMetrics) {
  try {
    localStorage.setItem(VISIBLE_METRICS_KEY, serializeVisibleMetrics(visible));
  } catch {
    // storage unavailable (private window); the choice just won't be remembered
  }
}

const metricPicker = createMetricPicker(byId<HTMLDetailsElement>('metric-picker'), readVisibleMetrics(), (visible) => {
  saveVisibleMetrics(visible);
  groupTab.setVisibleMetrics(visible);
  if (route.tab === 'subject') void applyRoute();
});

const groupTab = createGroupTab(
  {
    datasetInfo: byId('group-dataset-info'),
    summary: byId('group-summary'),
    channelSelect: byId('channel-select'),
    xSelect: byId('x-select'),
    ySelect: byId('y-select'),
    colorSelect: byId('color-select'),
    scatter: byId('scatter-chart'),
    legend: byId('scatter-legend'),
    note: byId('scatter-note'),
    histTitle: byId('group-hist-title'),
    histograms: byId('group-histograms'),
  },
  openScan,
  metricPicker.visible(),
);

const individualTab = createIndividualTab(
  {
    scanSelect: byId('scan-select'),
    prevBtn: byId('scan-prev'),
    nextBtn: byId('scan-next'),
    filename: byId('subject-filename'),
    datasetInfo: byId('subject-dataset-info'),
    participant: byId('subject-participant'),
    scanDetails: byId('subject-scan'),
    waveforms: byId('subject-waveforms'),
    metricsTable: byId('subject-metrics-table'),
    histograms: byId('subject-histograms'),
  },
  openScan,
  () => metricPicker.visible(),
);

let datasets: string[] = [];
const loaded = new Map<string, LoadedDataset | null>();
let route: Route = parseRoute(location.hash);
/** Dataset currently drawn in the Group tab, so returning to it keeps the user's plot settings */
let groupShown: string | null = null;
/** Last scan opened in the Individual tab, restored when the tab button is clicked */
let lastScan: ScanKeyLike | null = null;

function currentDataset(): string | null {
  return route.dataset ?? datasets[0] ?? null;
}

function openScan(scan: ScanKeyLike) {
  location.hash = routeHash({ tab: 'subject', dataset: currentDataset(), scan });
}

function setStatus(html: string) {
  els.status.innerHTML = html;
  els.status.style.display = html ? '' : 'none';
}

async function load(dataset: string): Promise<LoadedDataset | null> {
  if (!loaded.has(dataset)) {
    setStatus(`Loading ${esc(dataset)}…`);
    loaded.set(dataset, await fetchDatasetQuality(dataset).catch(() => null));
  }
  return loaded.get(dataset) ?? null;
}

function showTab(tab: Route['tab']) {
  els.groupSection.style.display = tab === 'group' ? '' : 'none';
  els.subjectSection.style.display = tab === 'subject' ? '' : 'none';
  els.tabGroup.classList.toggle('active', tab === 'group');
  els.tabSubject.classList.toggle('active', tab === 'subject');
}

async function applyRoute(): Promise<void> {
  route = parseRoute(location.hash);
  if (route.tab === 'subject' && route.scan) lastScan = route.scan;
  const dataset = currentDataset();
  if (!dataset) {
    showTab(route.tab);
    setStatus(
      'No quality metrics found under <code>data/quality/</code>. Compute them first, e.g. ' +
        '<code>npx vite-node scripts/compute-quality-metrics.ts ds006644</code>',
    );
    return;
  }
  els.datasetSelect.value = dataset;

  const data = await load(dataset);
  if (!data) {
    showTab(route.tab);
    setStatus(
      `Could not load quality metrics for <strong>${esc(dataset)}</strong>. Run ` +
        `<code>npx vite-node scripts/compute-quality-metrics.ts ${esc(dataset)}</code>`,
    );
    return;
  }
  setStatus('');
  showTab(route.tab);

  if (route.tab === 'group') {
    if (groupShown !== dataset) {
      groupTab.show(data);
      groupShown = dataset;
    }
  } else {
    individualTab.show(dataset, data, route.scan);
    window.scrollTo(0, 0);
  }
}

els.tabGroup.addEventListener('click', () => {
  location.hash = routeHash({ tab: 'group', dataset: currentDataset() });
});
els.tabSubject.addEventListener('click', () => {
  // Reopen the last scan shown in the Stats Individual tab, if any
  location.hash = routeHash({ tab: 'subject', dataset: currentDataset(), scan: lastScan });
});
els.datasetSelect.addEventListener('change', () => {
  location.hash = routeHash(
    route.tab === 'group'
      ? { tab: 'group', dataset: els.datasetSelect.value }
      : { tab: 'subject', dataset: els.datasetSelect.value, scan: null },
  );
});

window.addEventListener('hashchange', () => {
  void applyRoute();
});

// PDF: build every visual for the dataset (not just what is on screen) and download it
const pdfLabel = els.pdfBtn.textContent ?? 'Download PDF';
els.pdfBtn.addEventListener('click', async () => {
  const dataset = currentDataset();
  if (!dataset) return;
  const data = await load(dataset);
  if (!data) return;
  // The scatter axes come from the Group tab; make sure it has been set up for this dataset
  if (groupShown !== dataset) {
    groupTab.show(data);
    groupShown = dataset;
  }

  els.pdfBtn.disabled = true;
  try {
    const blob = await buildQualityReport({
      dataset,
      data,
      selection: groupTab.selection(),
      includeScans: els.pdfScans.checked,
      visible: metricPicker.visible(),
      onProgress: (msg) => {
        els.pdfBtn.textContent = `Building PDF: ${msg}…`;
      },
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${dataset}_quality-metrics.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (err) {
    console.error(err);
    setStatus(`Could not build the PDF: ${esc(err instanceof Error ? err.message : String(err))}`);
  } finally {
    els.pdfBtn.textContent = pdfLabel;
    els.pdfBtn.disabled = false;
  }
});

async function init() {
  datasets = await fetchQualityIndex().catch(() => []);
  els.datasetSelect.innerHTML = datasets.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('');
  els.pdfBtn.disabled = datasets.length === 0;
  await applyRoute();
}

void init();
