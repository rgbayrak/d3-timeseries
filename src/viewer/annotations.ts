import type { AnnotationsFile, ScanEntry, WaveformQuality } from '@/data/bids-physio-reader';

/** Ratings for the whole waveform, in button order */
export const WAVEFORM_QUALITIES: readonly WaveformQuality[] = ['good', 'bad', 'fixable', 'unknown'];

/** Rating and free-text quality analysis comment for the whole waveform of one scan and channel */
export interface WaveformAssessment {
  /** null until a rating button is chosen */
  quality: WaveformQuality | null;
  comment: string;
}

export const NO_ASSESSMENT: WaveformAssessment = { quality: null, comment: '' };

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
 * Stored form: the whole-waveform rating and comment first (top of the file),
 * then the scan, then the time windows with times plus sample indices at the
 * recording's sampling rate, so they can be used directly as masks for
 * artifact correction.
 */
export function toAnnotationsFile(
  annotations: Annotation[],
  scan: ScanEntry,
  channel: string,
  samplingRate: number,
  waveform: WaveformAssessment = NO_ASSESSMENT,
): AnnotationsFile {
  return {
    waveform_quality: waveform.quality,
    waveform_comment: waveform.comment,
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

/** Whole-waveform rating and comment from a stored file; files saved before these existed have neither */
export function waveformAssessmentFromFile(file: AnnotationsFile): WaveformAssessment {
  const q = file.waveform_quality;
  return {
    quality: q != null && WAVEFORM_QUALITIES.includes(q) ? q : null,
    comment: typeof file.waveform_comment === 'string' ? file.waveform_comment : '',
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
