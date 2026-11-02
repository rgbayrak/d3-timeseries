import type { AnnotationsFile, ScanEntry } from '@/data/bids-physio-reader';

/** An annotation as held in the viewer: a labelled time window in seconds */
export interface Annotation {
  id: string;
  start: number;
  end: number;
  label: string;
}

let idCounter = 0;

/** New annotation from a brushed window; an empty label becomes "(untitled)" */
export function createAnnotation(domain: [number, number], label: string): Annotation {
  return {
    id: `ann-${Date.now()}-${idCounter++}`,
    start: domain[0],
    end: domain[1],
    label: label.trim() || '(untitled)',
  };
}

/**
 * Stored form: times plus sample indices at the recording's sampling rate,
 * so annotations can be used directly as masks for artifact correction.
 */
export function toAnnotationsFile(
  annotations: Annotation[],
  scan: ScanEntry,
  channel: string,
  samplingRate: number,
): AnnotationsFile {
  return {
    sub: scan.sub,
    ses: scan.ses,
    task: scan.task,
    run: scan.run,
    channel,
    sampling_rate: samplingRate,
    annotations: annotations.map((a) => ({
      id: a.id,
      onset_s: a.start,
      duration_s: a.end - a.start,
      trial_type: a.label,
      start_sample: Math.round(a.start * samplingRate),
      end_sample: Math.round(a.end * samplingRate),
    })),
  };
}

export function fromAnnotationsFile(file: AnnotationsFile): Annotation[] {
  return file.annotations.map((a) => ({
    id: a.id,
    start: a.onset_s,
    end: a.onset_s + a.duration_s,
    label: a.trial_type,
  }));
}
