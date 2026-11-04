import { fetchServedDataset, fetchDatasetQuality, fetchReportStatus, saveReport } from './data';
import type { LoadedDataset, ServedDataset } from './data';
import { shareScanWithViewer, viewerScan } from './linked-scan';
import { parseScanHash, scanHash } from './route';
import type { ScanKeyLike } from './metrics-tsv';
import { sameScanKey } from './metrics-tsv';
import { createIndividualTab } from './individual-tab';
import { buildQualityReport } from './report';
import { createMetricPicker } from './metric-picker';
import { esc, parseVisibleMetrics, serializeVisibleMetrics } from './model';
import { fetchDatasetInfo } from '@/data/bids-physio-reader';
import { renderDatasetInfo } from '@/viewer/info';
import type { VisibleMetrics } from './model';

// Entry for quality.html (the Stats tab): owns the page elements, the hash
// (#scan?sub=…) and the loaded dataset (the one the dev server serves);
// individual-tab.ts does the rendering.

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing from quality.html`);
  return el as T;
}

const els = {
  reportStatus: byId<HTMLElement>('report-status'),
  datasetInfo: byId<HTMLElement>('dataset-info'),
  status: byId<HTMLElement>('status'),
  /** "Open this scan in Explore and Annotate" */
  openViewer: byId<HTMLAnchorElement>('open-viewer'),
};

// Metrics shown: which metrics the Stats tables and histograms show; remembered in this browser only
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
  // Only the metric tables and histograms change: no full redraw
  statsTab.refreshMetrics();
  window.scrollTo(0, y);
});

const statsTab = createIndividualTab(
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
/** Scan last drawn, to tell a new scan from a redraw of the same one */
let lastScan: ScanKeyLike | null = null;

function openScan(scan: ScanKeyLike) {
  location.hash = scanHash(scan);
}

function setStatus(html: string) {
  els.status.innerHTML = html;
  els.status.style.display = html ? '' : 'none';
}

function showScanFromHash(): void {
  if (!served || !data) return;
  // No scan in the link: open the one last shown in Explore and Annotate
  const wanted = parseScanHash(location.hash) ?? viewerScan(served.name);
  const shown = statsTab.show(served.id, data, wanted);
  // ...and make Explore and Annotate open the scan shown here: the link names it
  // (Explore otherwise opens the earliest scan not annotated yet)
  if (shown) {
    shareScanWithViewer(served.name, shown);
    els.openViewer.href = `/${scanHash(shown)}`;
  }
  // Back to the top only when a different scan opens (Prev/Next, a scatter double-click)
  if (!shown || !lastScan || !sameScanKey(shown, lastScan)) window.scrollTo(0, 0);
  lastScan = shown;
}

window.addEventListener('hashchange', showScanFromHash);

// PDF report: built once per computed dataset and saved by the dev server next
// to the metrics (data/quality/<dataset>/quality_report.pdf). The compute script
// deletes it, so a missing file means new metrics: build it in the background.
function showReportLink(url: string) {
  els.reportStatus.innerHTML =
    `Saved with the metrics. <a href="${esc(url)}" target="_blank" rel="noopener">Open the PDF report</a>`;
}

async function ensureReport() {
  if (!served || !data) return;
  const status = await fetchReportStatus();
  if (!status) {
    els.reportStatus.textContent = 'The dev server cannot save the PDF report.';
    return;
  }
  if (status.exists) {
    showReportLink(status.url);
    return;
  }
  try {
    const pdf = await buildQualityReport({
      dataset: served.id,
      data,
      onProgress: (msg) => {
        els.reportStatus.textContent = `Building the PDF report: ${msg}…`;
      },
    });
    els.reportStatus.textContent = 'Saving the PDF report…';
    showReportLink((await saveReport(pdf)).url);
  } catch (err) {
    console.error(err);
    els.reportStatus.textContent = `Could not build the PDF report: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function init() {
  const [servedDataset, datasetInfo] = await Promise.all([
    fetchServedDataset().catch(() => null),
    fetchDatasetInfo().catch(() => null),
  ]);
  served = servedDataset;
  // Dataset header under the tabs, same as Explore and Annotate
  renderDatasetInfo(els.datasetInfo, datasetInfo);
  if (!els.datasetInfo.hasChildNodes() && served) els.datasetInfo.textContent = served.id;
  if (!served) {
    setStatus('Could not ask the dev server which dataset it serves. Start it with <code>npm run dev</code>.');
    return;
  }
  setStatus(`Loading ${esc(served.id)}…`);
  data = await fetchDatasetQuality(served.id).catch(() => null);
  if (!data) {
    setStatus(
      `No quality metrics for <strong>${esc(served.id)}</strong> yet. Compute them with ` +
        `<code>npx vite-node scripts/compute-quality-metrics.ts ${esc(served.id)}</code> and reload.`,
    );
    return;
  }
  setStatus('');
  showScanFromHash();
  void ensureReport(); // after the scan is drawn, so the page is usable while it builds
}

void init();
