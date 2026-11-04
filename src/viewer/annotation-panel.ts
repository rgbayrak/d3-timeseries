import type { Annotation } from './annotations';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape user-entered text (annotation labels) before putting it in HTML */
export function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** Annotation progress bar colours: yellow at the start, green halfway, blue when done */
export const PROGRESS_STOPS: readonly [number, number, number][] = [
  [0xe3, 0xb5, 0x05], // yellow
  [0x2f, 0xa3, 0x6b], // green
  [0x3b, 0x6f, 0xd8], // blue
];

/** Bar colour for a fraction annotated (0..1, clamped), blended smoothly between the stops */
export function progressColor(fraction: number): string {
  const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  const pos = f * (PROGRESS_STOPS.length - 1);
  const i = Math.min(PROGRESS_STOPS.length - 2, Math.floor(pos));
  const t = pos - i;
  const [a, b] = [PROGRESS_STOPS[i], PROGRESS_STOPS[i + 1]];
  const hex = (k: number) => Math.round(a[k] + (b[k] - a[k]) * t).toString(16).padStart(2, '0');
  return `#${hex(0)}${hex(1)}${hex(2)}`;
}

export const EMPTY_ANNOTATIONS_HTML =
  '<div class="annotation-empty">No time windows yet. Turn Annotate on and drag on the top chart.</div>';

export function annotationListHtml(annotations: Annotation[]): string {
  if (annotations.length === 0) return EMPTY_ANNOTATIONS_HTML;
  return annotations
    .map(
      (a) => `<div class="annotation-item" data-id="${escapeHtml(a.id)}">
      <span class="annotation-range">${a.start.toFixed(2)}s – ${a.end.toFixed(2)}s</span>
      <span class="annotation-text">${escapeHtml(a.label)}</span>
      <button type="button" class="annotation-remove" data-id="${escapeHtml(a.id)}">&times;</button>
    </div>`,
    )
    .join('');
}

/** Render the annotation list below the charts; × buttons call onRemove with the annotation id */
export function renderAnnotationList(
  listEl: HTMLElement,
  annotations: Annotation[],
  onRemove: (id: string) => void,
): void {
  listEl.innerHTML = annotationListHtml(annotations);
  listEl.querySelectorAll<HTMLButtonElement>('.annotation-remove').forEach((btn) => {
    btn.addEventListener('click', () => onRemove(btn.dataset.id!));
  });
}
