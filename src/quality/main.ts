import { fetchServedDataset, fetchDatasetQuality } from './data';
import type { LoadedDataset, ServedDataset } from './data';
import { shareScanWithViewer, viewerScan } from './linked-scan';
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
// loaded dataset (the one the dev server serves); the tab modules do the rendering.

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing from quality.html`);
  return el as T;
}

const els = {
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
  if (route.tab === 'subject') applyRoute();
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

/** The dataset the dev server serves (same as Explore and Annotate) and its loaded metrics */
let served: ServedDataset | null = null;
let data: LoadedDataset | null = null;
let route: Route = parseRoute(location.hash);
/** Whether the Group tab has been drawn, so returning to it keeps the user's plot settings */
let groupShown = false;

function openScan(scan: ScanKeyLike) {
  location.hash = routeHash({ tab: 'subject', scan });
}

function setStatus(html: string) {
  els.status.innerHTML = html;
  els.status.style.display = html ? '' : 'none';
}

function showTab(tab: Route['tab']) {
  els.groupSection.style.display = tab === 'group' ? '' : 'none';
  els.subjectSection.style.display = tab === 'subject' ? '' : 'none';
  els.tabGroup.classList.toggle('active', tab === 'group');
  els.tabSubject.classList.toggle('active', tab === 'subject');
}

function applyRoute(): void {
  route = parseRoute(location.hash);
  showTab(route.tab);
  if (!served || !data) return;

  if (route.tab === 'group') {
    if (!groupShown) {
      groupTab.show(data);
      groupShown = true;
    }
  } else {
    // No scan in the link: open the one last shown in Explore and Annotate
    const wanted = route.scan ?? viewerScan(served.name);
    const shown = individualTab.show(served.id, data, wanted);
    // ...and make Explore and Annotate open the scan shown here
    if (shown) shareScanWithViewer(served.name, shown);
    window.scrollTo(0, 0);
  }
}

els.tabGroup.addEventListener('click', () => {
  location.hash = routeHash({ tab: 'group' });
});
els.tabSubject.addEventListener('click', () => {
  // Without a scan in the link, Stats Individual opens the scan last shown in either tab
  location.hash = routeHash({ tab: 'subject', scan: null });
});

window.addEventListener('hashchange', applyRoute);

// PDF: build every visual for the dataset (not just what is on screen) and download it
const pdfLabel = els.pdfBtn.textContent ?? 'Download PDF';
els.pdfBtn.addEventListener('click', async () => {
  if (!served || !data) return;
  const dataset = served.id;
  // The scatter axes come from the Group tab; make sure it has been set up
  if (!groupShown) {
    groupTab.show(data);
    groupShown = true;
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
  els.pdfBtn.disabled = true;
  served = await fetchServedDataset().catch(() => null);
  if (!served) {
    showTab(route.tab);
    setStatus('Could not ask the dev server which dataset it serves. Start it with <code>npm run dev</code>.');
    return;
  }
  setStatus(`Loading ${esc(served.id)}…`);
  data = await fetchDatasetQuality(served.id).catch(() => null);
  if (!data) {
    showTab(route.tab);
    setStatus(
      `No quality metrics for <strong>${esc(served.id)}</strong> yet. Compute them with ` +
        `<code>npx vite-node scripts/compute-quality-metrics.ts ${esc(served.id)}</code> and reload.`,
    );
    return;
  }
  setStatus('');
  els.pdfBtn.disabled = false;
  applyRoute();
}

void init();
