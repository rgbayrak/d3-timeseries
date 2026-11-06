import type { SubjectInfo, ScanEntry, PhysioRaw, ConfoundsRaw, EventsRaw } from '@/data/bids-physio-reader';
import type { Annotation, WaveformAssessment } from './annotations';
import { NO_ASSESSMENT } from './annotations';

/** Channel, confound, events column and stack restored from the last session, consumed by the first scan load */
export interface RestoredSelection {
  channel: string;
  confound: string;
  /** Events column ('' when none was saved) */
  event: string;
  stacked: string[];
}

/**
 * All mutable viewer state lives in this one object. Modules receive what they
 * need from it as arguments; only main.ts writes to it.
 */
export interface ViewerState {
  subjects: SubjectInfo[];
  /** Every readable scan in hierarchy order, for prev/next and search */
  scans: ScanEntry[];
  /** Scan whose data is loaded in `raw`; null until the first load succeeds */
  current: ScanEntry | null;
  raw: PhysioRaw | null;
  confounds: ConfoundsRaw | null;
  /** Task events of the loaded scan; null for rest tasks or when there is no events file */
  events: EventsRaw | null;
  /** Extra channels drawn as compact figures below the focus chart, in column order */
  stackedChannels: string[];
  annotateMode: boolean;
  /** Annotations for the current scan and main channel */
  annotations: Annotation[];
  /** Rating and comment for the whole waveform of the current scan and main channel */
  waveform: WaveformAssessment;
  restoredSelection: RestoredSelection | null;
}

export function createState(): ViewerState {
  return {
    subjects: [],
    scans: [],
    current: null,
    raw: null,
    confounds: null,
    events: null,
    stackedChannels: [],
    annotateMode: false,
    annotations: [],
    waveform: { ...NO_ASSESSMENT },
    restoredSelection: null,
  };
}

export function sameScan(a: ScanEntry | null, b: ScanEntry): boolean {
  return a !== null && a.sub === b.sub && a.ses === b.ses && a.task === b.task && a.run === b.run;
}
