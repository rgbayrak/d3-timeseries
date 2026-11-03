import type { MetricKey } from './metrics-tsv';
import { ALL_METRICS, METRIC_DEFS, METRIC_GROUPS, esc, groupKeys } from './model';
import type { VisibleMetrics } from './model';

// "Metrics shown" list in the sidebar: the metric groups (Basic, Distribution,
// PaPaGei, PhysioQC) as fixed headings, one row per metric with a checkmark on
// the right, plus Show all / Hide all. Receives its element and reports
// changes; main.ts decides what to redraw.

export interface MetricPicker {
  visible: () => VisibleMetrics;
}

export function createMetricPicker(
  el: HTMLElement,
  initial: VisibleMetrics,
  onChange: (visible: VisibleMetrics) => void,
): MetricPicker {
  let visible: Set<MetricKey> = new Set(initial);

  const body = () => {
    let html = `<div class="metric-picker-actions">
        <button type="button" class="btn" data-action="all">Show all</button>
        <button type="button" class="btn" data-action="none">Hide all</button>
      </div>
      <div class="metric-count muted"></div>`;
    for (const group of METRIC_GROUPS) {
      html += `<div class="metric-group"><div class="metric-group-name">${esc(group)}</div>`;
      for (const key of groupKeys(group)) {
        const def = METRIC_DEFS.find((m) => m.key === key)!;
        const tip = def.description ? ` title="${esc(def.description)}"` : '';
        html += `<label class="metric-row"${tip}><span>${esc(def.label)}</span><input type="checkbox" class="metric-check" data-key="${key}"></label>`;
      }
      html += '</div>';
    }
    return html;
  };

  /** Bring the checkmarks and the count in line with `visible` */
  function sync() {
    el.querySelectorAll<HTMLInputElement>('input[data-key]').forEach((cb) => {
      cb.checked = visible.has(cb.dataset.key as MetricKey);
    });
    el.querySelector('.metric-count')!.textContent = `${visible.size} of ${ALL_METRICS.length} shown`;
  }

  function set(next: Set<MetricKey>) {
    visible = next;
    sync();
    onChange(visible);
  }

  el.classList.add('metric-picker');
  el.innerHTML = body();
  sync();

  el.addEventListener('change', (event) => {
    const cb = event.target as HTMLInputElement;
    if (!cb.dataset.key) return;
    const next = new Set(visible);
    if (cb.checked) next.add(cb.dataset.key as MetricKey);
    else next.delete(cb.dataset.key as MetricKey);
    set(next);
  });
  el.addEventListener('click', (event) => {
    const action = (event.target as HTMLElement).dataset?.action;
    if (action === 'all') set(new Set(ALL_METRICS));
    else if (action === 'none') set(new Set());
  });

  return { visible: () => visible };
}
