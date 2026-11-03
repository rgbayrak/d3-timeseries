import {
  fetchSubjects,
  fetchScans,
  fetchDatasetInfo,
  fetchPhysioRaw,
  fetchConfounds,
  fetchAnnotations,
  fetchAnnotationProgress,
  saveAnnotations,
  getViewExtent,
} from '@/data/bids-physio-reader';
import type { ScanEntry, PhysioRaw, ConfoundsRaw } from '@/data/bids-physio-reader';
import { getElements } from './dom';
import { createState, sameScan } from './state';
import {
  createAnnotation,
  toAnnotationsFile,
  fromAnnotationsFile,
  waveformAssessmentFromFile,
  NO_ASSESSMENT,
  WAVEFORM_QUALITIES,
} from './annotations';
import type { WaveformQuality } from '@/data/bids-physio-reader';
import { renderAnnotationList } from './annotation-panel';
import { renderDatasetInfo, renderQualityBadges } from './info';
import {
  populateSelect,
  populateTasks,
  populateRuns,
  renderStackControls,
  validStacked,
  toggleStacked,
} from './controls';
import { stepScan, resolveSearch, isScanStepKey } from './navigation';
import { DEFAULT_LAST_VIEWED_KEY, lastViewedKey, saveLastViewed, readLastViewed, resumeFrom } from './persistence';
import { buildFocusContext } from './charts/focus-context';
import type { FocusContextHandle } from './charts/focus-context';
import { buildConfoundsChart } from './charts/confounds';
import type { ConfoundsChartHandle } from './charts/confounds';
import { buildStackCharts } from './charts/stack';
import type { StackChartsHandle } from './charts/stack';

// Entry point: owns the DOM, the state object and the live charts, and wires
// user events to the modules that do the work.

const els = getElements();
const state = createState();

let focusContext: FocusContextHandle | null = null;
let confoundsChart: ConfoundsChartHandle | null = null;
let stackCharts: StackChartsHandle | null = null;
let storageKey = DEFAULT_LAST_VIEWED_KEY;

function setLoading(msg: string) {
  els.loading.textContent = msg;
}

/** Scan currently chosen in the dropdowns (run is '' for run-less scans) */
function selectedScan(): ScanEntry {
  return {
    sub: els.subjectSelect.value,
    ses: els.sessionSelect.value,
    task: els.taskSelect.value,
    run: els.runSelect.value ?? '',
  };
}

function rememberLastViewed() {
  if (!state.current) return;
  saveLastViewed(storageKey, {
    ...state.current,
    channel: els.channelSelect.value,
    confound: els.confoundSelect.value,
    stacked: state.stackedChannels,
  });
}

// ── Annotations ─────────────────────────────────────────

function renderAnnotations() {
  renderAnnotationList(els.annotationList, state.annotations, removeAnnotation);
}

/** Show the full-recording signal quality and notes held in state */
function renderWaveformAssessment() {
  els.waveformQuality.querySelectorAll<HTMLButtonElement>('button[data-quality]').forEach((btn) => {
    const on = btn.dataset.quality === state.waveform.quality;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  });
  if (els.waveformComment.value !== state.waveform.comment) els.waveformComment.value = state.waveform.comment;
}

function persistAnnotations() {
  if (!state.current) return;
  const file = toAnnotationsFile(
    state.annotations,
    state.current,
    els.channelSelect.value,
    state.raw?.samplingFrequency ?? 0,
    state.waveform,
  );
  saveAnnotations(file)
    .then(refreshAnnotationProgress)
    .catch((err) => {
      console.error('Failed to save annotations', err);
      setLoading('Failed to save annotation');
    });
}

/** "(24/80 ch:cardiac signals are annotated)": scans with anything saved for the channel shown */
async function refreshAnnotationProgress() {
  const channel = els.channelSelect.value;
  if (!channel) return;
  const progress = await fetchAnnotationProgress(channel).catch(() => null);
  if (channel !== els.channelSelect.value) return; // channel changed while waiting
  els.annotationProgress.textContent = progress
    ? `(${progress.annotated}/${progress.total} ch:${channel} signals are annotated)`
    : '';
}

async function loadSavedAnnotations(scan: ScanEntry, channel: string) {
  const stored = await fetchAnnotations(scan.sub, scan.ses, scan.task, scan.run, channel).catch(() => null);
  if (!stored) return;
  // Discard if the scan or channel changed while the request was in flight
  if (!sameScan(state.current, scan) || channel !== els.channelSelect.value) return;
  state.annotations = fromAnnotationsFile(stored);
  state.waveform = waveformAssessmentFromFile(stored);
  focusContext?.redrawAnnotations();
  renderAnnotations();
  renderWaveformAssessment();
}

// Whole-waveform rating: clicking the chosen rating again clears it
els.waveformQuality.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-quality]');
  if (!btn || !state.current) return;
  const q = btn.dataset.quality as WaveformQuality;
  if (!WAVEFORM_QUALITIES.includes(q)) return;
  state.waveform = { ...state.waveform, quality: state.waveform.quality === q ? null : q };
  renderWaveformAssessment();
  persistAnnotations();
});

// Whole-waveform comment: saved a moment after typing stops, and at once when
// the box loses focus (which happens before any click that changes the scan)
let commentTimer: ReturnType<typeof setTimeout> | null = null;

function flushComment() {
  if (commentTimer) clearTimeout(commentTimer);
  commentTimer = null;
  if (!state.current || els.waveformComment.value === state.waveform.comment) return;
  state.waveform = { ...state.waveform, comment: els.waveformComment.value };
  persistAnnotations();
}

els.waveformComment.addEventListener('input', () => {
  if (commentTimer) clearTimeout(commentTimer);
  commentTimer = setTimeout(flushComment, 800);
});
els.waveformComment.addEventListener('blur', flushComment);
window.addEventListener('pagehide', flushComment);

function addAnnotation(domain: [number, number]) {
  const label = window.prompt('Annotation label (e.g. "fix" to mark for reconstruction):', '');
  if (label === null) return; // cancelled: discard the selection
  state.annotations.push(createAnnotation(domain, label));
  focusContext?.redrawAnnotations();
  renderAnnotations();
  persistAnnotations();
}

function removeAnnotation(id: string) {
  state.annotations = state.annotations.filter((a) => a.id !== id);
  focusContext?.redrawAnnotations();
  renderAnnotations();
  persistAnnotations();
}

// ── Charts ──────────────────────────────────────────────

/** Push the focus chart's time window to every chart that follows it */
function syncLinkedXDomain(domain: [number, number]) {
  confoundsChart?.setXDomain(domain);
  stackCharts?.setXDomain(domain);
}

function destroyCharts() {
  focusContext?.destroy();
  confoundsChart?.destroy();
  stackCharts?.destroy();
  focusContext = null;
  confoundsChart = null;
  stackCharts = null;
}

/** Rebuild the focus/overview charts for a channel; clears and reloads its annotations */
function buildMainCharts(raw: PhysioRaw, channel: string) {
  destroyCharts();
  // A typed comment was already saved when the box lost focus; never save it
  // here, as state.current may already be the new scan
  if (commentTimer) clearTimeout(commentTimer);
  commentTimer = null;
  state.annotations = [];
  state.waveform = { ...NO_ASSESSMENT };
  renderAnnotations();
  renderWaveformAssessment();
  focusContext = buildFocusContext({
    raw,
    channel,
    getAnnotations: () => state.annotations,
    isAnnotateMode: () => state.annotateMode,
    onAnnotate: addAnnotation,
    onXDomainChange: syncLinkedXDomain,
  });
  if (state.current) loadSavedAnnotations(state.current, channel);
  void refreshAnnotationProgress(); // the count is per channel
}

// "Auxiliary" label: shown while the stacked channels or the confound chart is.
// Those sections show and hide themselves from several places, so watch them.
function syncAuxiliarySection() {
  const shown = [els.stackSection, els.confoundsSection].some((el) => el.style.display !== 'none');
  els.auxiliarySection.style.display = shown ? '' : 'none';
}
const auxiliaryObserver = new MutationObserver(syncAuxiliarySection);
for (const el of [els.stackSection, els.confoundsSection]) {
  auxiliaryObserver.observe(el, { attributes: true, attributeFilter: ['style'] });
}

function rebuildStack(raw: PhysioRaw) {
  stackCharts?.destroy();
  stackCharts = buildStackCharts({
    sectionEl: els.stackSection,
    raw,
    channels: state.stackedChannels,
    xDomain: focusContext ? focusContext.getXDomain() : getViewExtent(raw),
  });
}

function rebuildConfounds(confounds: ConfoundsRaw, raw: PhysioRaw) {
  confoundsChart?.destroy();
  confoundsChart = buildConfoundsChart({
    sectionEl: els.confoundsSection,
    labelEl: els.confoundsLabel,
    confounds,
    raw,
    column: els.confoundSelect.value,
  });
}

function renderStack(columns: string[]) {
  state.stackedChannels = validStacked(state.stackedChannels, columns, els.channelSelect.value);
  renderStackControls(els, columns, els.channelSelect.value, state.stackedChannels, (channel, checked) => {
    state.stackedChannels = toggleStacked(state.stackedChannels, columns, channel, checked);
    if (state.raw) rebuildStack(state.raw);
    rememberLastViewed();
  });
}

// ── Data loading ────────────────────────────────────────

/** First option among the preferred ones that the scan has, else its first option */
function pickPreferred(options: string[], preferred: (string | undefined)[]): string {
  return preferred.find((c): c is string => !!c && options.includes(c)) ?? options[0];
}

async function loadPhysio(scan: ScanEntry) {
  // Same scan already loaded (e.g. dropdown re-selected): rebuild from cache
  if (sameScan(state.current, scan) && state.raw) {
    buildMainCharts(state.raw, els.channelSelect.value);
    rebuildStack(state.raw);
    if (state.confounds) rebuildConfounds(state.confounds, state.raw);
    else els.confoundsSection.style.display = 'none';
    return;
  }

  setLoading('Loading...');
  try {
    const [raw, confounds] = await Promise.all([
      fetchPhysioRaw(scan.sub, scan.ses, scan.task, scan.run),
      fetchConfounds(scan.sub, scan.ses, scan.task, scan.run),
    ]);
    state.raw = raw;
    state.confounds = confounds;
    state.current = { ...scan };

    els.filename.textContent = raw.filename;
    renderQualityBadges(els.qualityBadges, raw);

    // Keep the current channel/confound when the new scan has it; on the first
    // load after a reload, prefer the one restored from localStorage
    const restored = state.restoredSelection;
    populateSelect(els.channelSelect, raw.columns, pickPreferred(raw.columns, [restored?.channel, els.channelSelect.value]));
    if (restored) state.stackedChannels = restored.stacked;
    renderStack(raw.columns);
    buildMainCharts(raw, els.channelSelect.value);
    rebuildStack(raw);

    if (confounds) {
      const columns = Object.keys(confounds.columns);
      populateSelect(els.confoundSelect, columns, pickPreferred(columns, [restored?.confound, els.confoundSelect.value]));
      els.confoundLabel.style.display = '';
      rebuildConfounds(confounds, raw);
    } else {
      // No derivatives for this scan (or no BIDSDER_ROOT): hide the picker
      els.confoundLabel.style.display = 'none';
      els.confoundsSection.style.display = 'none';
    }

    state.restoredSelection = null;
    rememberLastViewed();
    setLoading('');
  } catch (err) {
    setLoading(`Error: ${err}`);
  }
}

async function goToScan(scan: ScanEntry) {
  els.subjectSelect.value = scan.sub;
  const info = state.subjects.find((s) => s.id === scan.sub)!;
  populateSelect(els.sessionSelect, info.sessions, scan.ses);
  await populateTasks(els.taskSelect, scan.sub, scan.ses, scan.task);
  await populateRuns(els, scan.sub, scan.ses, scan.task, scan.run);
  loadPhysio(scan);
}

function step(delta: number) {
  return goToScan(stepScan(state.scans, selectedScan(), delta));
}

// ── Event wiring ────────────────────────────────────────

els.subjectSelect.addEventListener('change', async () => {
  const sub = els.subjectSelect.value;
  const info = state.subjects.find((s) => s.id === sub);
  if (!info) return;
  populateSelect(els.sessionSelect, info.sessions);
  await populateTasks(els.taskSelect, sub, els.sessionSelect.value);
  await populateRuns(els, sub, els.sessionSelect.value, els.taskSelect.value);
  loadPhysio(selectedScan());
});

els.sessionSelect.addEventListener('change', async () => {
  await populateTasks(els.taskSelect, els.subjectSelect.value, els.sessionSelect.value);
  await populateRuns(els, els.subjectSelect.value, els.sessionSelect.value, els.taskSelect.value);
  loadPhysio(selectedScan());
});

els.taskSelect.addEventListener('change', async () => {
  await populateRuns(els, els.subjectSelect.value, els.sessionSelect.value, els.taskSelect.value);
  loadPhysio(selectedScan());
});

els.runSelect.addEventListener('change', () => loadPhysio(selectedScan()));

els.channelSelect.addEventListener('change', () => {
  if (state.raw) {
    // The new main channel leaves the stack options (and the stack, if checked)
    renderStack(state.raw.columns);
    buildMainCharts(state.raw, els.channelSelect.value);
    rebuildStack(state.raw);
    if (state.confounds) rebuildConfounds(state.confounds, state.raw);
  }
  rememberLastViewed();
});

els.confoundSelect.addEventListener('change', () => {
  if (state.raw && state.confounds) rebuildConfounds(state.confounds, state.raw);
  rememberLastViewed();
});

els.prevBtn.addEventListener('click', () => step(-1));
els.nextBtn.addEventListener('click', () => step(1));

// ←/→ step to the previous/next scan, except while typing or in a dropdown
// (where arrow keys already have a meaning)
document.addEventListener('keydown', (e) => {
  if (!isScanStepKey(e)) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest('input, select, textarea, [contenteditable="true"]')) return;
  e.preventDefault();
  step(e.key === 'ArrowLeft' ? -1 : 1);
});

els.searchInput.addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  const q = els.searchInput.value.trim();
  if (!q) return;
  const match = resolveSearch(q, state.scans, els.subjectSelect.value);
  if (!match) {
    setLoading(`No match for "${q}"`);
    return;
  }
  await goToScan(match);
  els.searchInput.value = '';
});

els.annotateModeBtn.addEventListener('click', () => {
  state.annotateMode = !state.annotateMode;
  els.annotateModeBtn.classList.toggle('active', state.annotateMode);
  els.annotateModeBtn.textContent = state.annotateMode ? 'Annotate: On' : 'Annotate: Off';
});

// ── Init ────────────────────────────────────────────────

async function init() {
  setLoading('Loading subjects...');
  const [subjects, scans, datasetInfo] = await Promise.all([
    fetchSubjects(),
    fetchScans(),
    fetchDatasetInfo().catch(() => null),
  ]);
  state.subjects = subjects;
  state.scans = scans;
  renderDatasetInfo(els.datasetInfo, datasetInfo);

  // Resume the last-viewed scan for this dataset if it still exists
  storageKey = lastViewedKey(datasetInfo?.name);
  const resumed = resumeFrom(readLastViewed(storageKey), scans);
  if (resumed) state.restoredSelection = resumed.selection;

  const first = resumed?.scan ?? scans[0];
  populateSelect(els.subjectSelect, subjects.map((s) => s.id), first.sub);
  const firstInfo = subjects.find((s) => s.id === first.sub)!;
  populateSelect(els.sessionSelect, firstInfo.sessions, first.ses);
  await populateTasks(els.taskSelect, first.sub, first.ses, first.task);
  await populateRuns(els, first.sub, first.ses, first.task, first.run);
  await loadPhysio(first);
}

init().catch((err) => setLoading(`Error: ${err}`));
