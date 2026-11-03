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
