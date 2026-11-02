import type { SubjectInfo, ScanEntry, PhysioRaw, ConfoundsRaw } from '@/data/bids-physio-reader';
import type { SQIResults } from '@/data/sqi-metrics';
import type { Annotation } from './annotations';

/** Channel, confound and stack restored from the last session, consumed by the first scan load */
export interface RestoredSelection {
  channel: string;
  confound: string;
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
  sqi: SQIResults | null;
  /** Extra channels drawn as compact figures below the focus chart, in column order */
  stackedChannels: string[];
  annotateMode: boolean;
  /** Annotations for the current scan and main channel */
  annotations: Annotation[];
  restoredSelection: RestoredSelection | null;
}

export function createState(): ViewerState {
  return {
    subjects: [],
    scans: [],
    current: null,
    raw: null,
    confounds: null,
    sqi: null,
    stackedChannels: [],
    annotateMode: false,
    annotations: [],
    restoredSelection: null,
  };
}

export function sameScan(a: ScanEntry | null, b: ScanEntry): boolean {
  return a !== null && a.sub === b.sub && a.ses === b.ses && a.task === b.task && a.run === b.run;
}
