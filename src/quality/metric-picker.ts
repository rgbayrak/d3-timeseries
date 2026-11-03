import type { MetricKey } from './metrics-tsv';
import { ALL_METRICS, METRIC_DEFS, METRIC_GROUPS, esc, groupKeys, groupState, toggleGroup } from './model';
import type { VisibleMetrics } from './model';
import { METRIC_GROUP_COLORS } from './charts';

// "Metrics" drop-down in the toolbar: one checkbox per metric, grouped like
// the viewer's SQI table, plus a checkbox per group and Show all / Hide all.
// Receives its element and reports changes; main.ts decides what to redraw.

export interface MetricPicker {
  visible: () => VisibleMetrics;
}

export function createMetricPicker(
  el: HTMLDetailsElement,
  initial: VisibleMetrics,
  onChange: (visible: VisibleMetrics) => void,
): MetricPicker {
  let visible: Set<MetricKey> = new Set(initial);

  const body = () => {
    let html = `<summary></summary><div class="metric-picker-panel">
      <div class="metric-picker-actions">
        <button type="button" data-action="all">Show all</button>
        <button type="button" data-action="none">Hide all</button>
      </div>`;
    for (const group of METRIC_GROUPS) {
      const dot = `<span class="metric-dot" style="background:${METRIC_GROUP_COLORS[group] ?? '#bbb'}"></span>`;
      html += `<fieldset><legend><label><input type="checkbox" data-group="${esc(group)}"> ${dot}${esc(group)}</label></legend>`;
      for (const key of groupKeys(group)) {
        const def = METRIC_DEFS.find((m) => m.key === key)!;
        const tip = def.description ? ` title="${esc(def.description)}"` : '';
        html += `<label${tip}><input type="checkbox" data-key="${key}"> ${esc(def.label)}</label>`;
      }
      html += '</fieldset>';
    }
    return html + '</div>';
  };

  /** Bring checkboxes and the summary text in line with `visible` */
  function sync() {
    el.querySelectorAll<HTMLInputElement>('input[data-key]').forEach((cb) => {
      cb.checked = visible.has(cb.dataset.key as MetricKey);
    });
    el.querySelectorAll<HTMLInputElement>('input[data-group]').forEach((cb) => {
      const state = groupState(visible, cb.dataset.group!);
      cb.checked = state === 'all';
      cb.indeterminate = state === 'some';
    });
    el.querySelector('summary')!.textContent = `Metrics: ${visible.size} of ${ALL_METRICS.length} shown`;
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
    if (cb.dataset.group) {
      set(toggleGroup(visible, cb.dataset.group));
    } else if (cb.dataset.key) {
      const next = new Set(visible);
      if (cb.checked) next.add(cb.dataset.key as MetricKey);
      else next.delete(cb.dataset.key as MetricKey);
      set(next);
    }
  });
  el.addEventListener('click', (event) => {
    const action = (event.target as HTMLElement).dataset?.action;
    if (action === 'all') set(new Set(ALL_METRICS));
    else if (action === 'none') set(new Set());
  });
  // Close when clicking elsewhere on the page
  document.addEventListener('click', (event) => {
    if (el.open && !el.contains(event.target as Node)) el.open = false;
  });

  return { visible: () => visible };
}
