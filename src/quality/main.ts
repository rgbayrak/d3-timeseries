import { fetchServedDataset, fetchDatasetQuality } from './data';
import type { LoadedDataset, ServedDataset } from './data';
import { shareScanWithViewer, viewerScan } from './linked-scan';
import { parseRoute, routeHash } from './route';
import type { Route } from './route';
import type { ScanKeyLike } from './metrics-tsv';
import { sameScanKey } from './metrics-tsv';
import { createGroupTab } from './group-tab';
import { createIndividualTab } from './individual-tab';
import { buildQualityReport } from './report';
import { createMetricPicker } from './metric-picker';
import { esc, parseVisibleMetrics, serializeVisibleMetrics } from './model';
import { fetchDatasetInfo } from '@/data/bids-physio-reader';
import { renderDatasetInfo } from '@/viewer/info';
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
  datasetInfo: byId<HTMLElement>('dataset-info'),
  status: byId<HTMLElement>('status'),
  groupSection: byId<HTMLElement>('group-tab'),
  subjectSection: byId<HTMLElement>('subject-tab'),
  /** Sidebar blocks for Stats Individual only: participant and recording details */
  /** Sidebar block for Stats Group only */
  sideOverview: byId<HTMLElement>('side-overview'),
  sideSubject: byId<HTMLElement>('side-subject'),
  sideScan: byId<HTMLElement>('side-scan'),
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

const metricPicker = createMetricPicker(byId<HTMLElement>('metric-picker'), readVisibleMetrics(), (visible) => {
  saveVisibleMetrics(visible);
  // Keep the page exactly where it is: the redraw changes the graphs' height,
  // and the browser would otherwise shift or clamp the scroll position
  const y = window.scrollY;
  groupTab.setVisibleMetrics(visible);
  // Only the metric tables and histograms change: no full redraw
  if (route.tab === 'subject') individualTab.refreshMetrics();
  window.scrollTo(0, y);
});

const groupTab = createGroupTab(
  {
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
    prevBtn: byId('scan-prev'),
    nextBtn: byId('scan-next'),
    filename: byId('subject-filename'),
    participant: byId('subject-participant'),
    scanDetails: byId('subject-scan'),
    waveforms: byId('subject-waveforms'),
    metrics: byId('subject-metrics'),
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
  els.sideOverview.style.display = tab === 'group' ? '' : 'none';
  els.sideSubject.style.display = tab === 'subject' ? '' : 'none';
  els.sideScan.style.display = tab === 'subject' ? '' : 'none';
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
    // Back to the top only when a different scan opens (Prev/Next, a scatter double-click)
    const changed = !shown || !lastIndividualScan || !sameScanKey(shown, lastIndividualScan);
    if (changed) window.scrollTo(0, 0);
    lastIndividualScan = shown;
  }
}

/** Scan last drawn in Stats Individual, to tell a new scan from a redraw of the same one */
let lastIndividualScan: ScanKeyLike | null = null;

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
  const [servedDataset, datasetInfo] = await Promise.all([
    fetchServedDataset().catch(() => null),
    fetchDatasetInfo().catch(() => null),
  ]);
  served = servedDataset;
  // Dataset header under the tabs: drawn once, same for both Stats tabs and Explore and Annotate
  renderDatasetInfo(els.datasetInfo, datasetInfo);
  if (!els.datasetInfo.hasChildNodes() && served) els.datasetInfo.textContent = served.id;
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
