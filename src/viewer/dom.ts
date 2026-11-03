/** Every element the viewer uses from index.html */
export interface ViewerElements {
  subjectSelect: HTMLSelectElement;
  sessionSelect: HTMLSelectElement;
  taskSelect: HTMLSelectElement;
  runSelect: HTMLSelectElement;
  runLabel: HTMLLabelElement;
  channelSelect: HTMLSelectElement;
  confoundSelect: HTMLSelectElement;
  confoundLabel: HTMLLabelElement;
  prevBtn: HTMLButtonElement;
  nextBtn: HTMLButtonElement;
  searchInput: HTMLInputElement;
  datasetInfo: HTMLElement;
  filename: HTMLElement;
  /** "(24/80 ch:cardiac signals are annotated)" next to the file name */
  annotationProgress: HTMLElement;
  qualityBadges: HTMLElement;
  loading: HTMLElement;
  confoundsSection: HTMLElement;
  confoundsLabel: HTMLElement;
  annotateModeBtn: HTMLButtonElement;
  annotationList: HTMLElement;
  /** Holds the Good / Bad / Fixable / Unknown buttons (data-quality) */
  waveformQuality: HTMLElement;
  waveformComment: HTMLTextAreaElement;
  stackRow: HTMLElement;
  stackChannels: HTMLElement;
  stackSection: HTMLElement;
  /** Wraps the stack and confounds sections under the "Auxiliary" label */
  auxiliarySection: HTMLElement;
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Viewer: #${id} is missing from index.html`);
  return el as T;
}

/** Look up all viewer elements once; throws naming the first one that is missing */
export function getElements(): ViewerElements {
  return {
    subjectSelect: byId('subject-select'),
    sessionSelect: byId('session-select'),
    taskSelect: byId('task-select'),
    runSelect: byId('run-select'),
    runLabel: byId('run-label'),
    channelSelect: byId('channel-select'),
    confoundSelect: byId('confound-select'),
    confoundLabel: byId('confound-label'),
    prevBtn: byId('prev-btn'),
    nextBtn: byId('next-btn'),
    searchInput: byId('search-input'),
    datasetInfo: byId('dataset-info'),
    filename: byId('filename'),
    annotationProgress: byId('annotation-progress'),
    qualityBadges: byId('quality-badges'),
    loading: byId('loading'),
    confoundsSection: byId('confounds-section'),
    confoundsLabel: byId('confounds-label'),
    annotateModeBtn: byId('annotate-mode-btn'),
    annotationList: byId('annotation-list'),
    waveformQuality: byId('waveform-quality'),
    waveformComment: byId('waveform-comment'),
    stackRow: byId('stack-row'),
    stackChannels: byId('stack-channels'),
    stackSection: byId('stack-section'),
    auxiliarySection: byId('auxiliary-section'),
  };
}
