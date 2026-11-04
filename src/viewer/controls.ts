import { fetchTasks, fetchRuns } from '@/data/bids-physio-reader';
import { isPhysioChannel } from '@/quality/channels';

/**
 * Columns of a physio file to offer as channels: only physiological signals,
 * matched against the same dictionary the quality metrics script uses
 * (src/quality/channels.ts), so trigger and other non-physio columns are left
 * out. If none match, every column is offered so the viewer still shows something.
 */
export function physioColumns(columns: string[]): string[] {
  const physio = columns.filter(isPhysioChannel);
  return physio.length > 0 ? physio : columns;
}

export function populateSelect(el: HTMLSelectElement, values: string[], selected?: string): void {
  el.innerHTML = '';
  for (const v of values) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    if (v === selected) opt.selected = true;
    el.appendChild(opt);
  }
}

export async function populateTasks(
  taskSelect: HTMLSelectElement,
  sub: string,
  ses: string,
  selected?: string,
): Promise<void> {
  const tasks = await fetchTasks(sub, ses);
  populateSelect(taskSelect, tasks, selected ?? tasks[0]);
}

/** Fill the Run dropdown, or hide it for run-less scans */
export async function populateRuns(
  els: { runSelect: HTMLSelectElement; runLabel: HTMLElement },
  sub: string,
  ses: string,
  task: string,
  selected?: string,
): Promise<string[]> {
  const runs = await fetchRuns(sub, ses, task);
  if (runs.length > 0) {
    populateSelect(els.runSelect, runs, selected ?? runs[0]);
    els.runLabel.style.display = '';
  } else {
    els.runSelect.innerHTML = '';
    els.runLabel.style.display = 'none';
  }
  return runs;
}

/** Stacked channels that remain valid for a scan: present in it, and not the main channel */
export function validStacked(stacked: string[], columns: string[], mainChannel: string): string[] {
  return stacked.filter((c) => c !== mainChannel && columns.includes(c));
}

/** Toggle one channel in the stack, keeping column order regardless of click order */
export function toggleStacked(stacked: string[], columns: string[], channel: string, checked: boolean): string[] {
  const set = new Set(stacked);
  if (checked) set.add(channel);
  else set.delete(channel);
  return columns.filter((c) => set.has(c));
}

/**
 * One checkbox per channel except the main one. The row is hidden when there
 * is nothing to stack. onToggle receives the channel and its new checked state.
 */
export function renderStackControls(
  els: { stackRow: HTMLElement; stackChannels: HTMLElement },
  columns: string[],
  mainChannel: string,
  stacked: string[],
  onToggle: (channel: string, checked: boolean) => void,
): void {
  els.stackChannels.innerHTML = '';
  const options = columns.filter((c) => c !== mainChannel);
  els.stackRow.style.display = options.length > 0 ? '' : 'none';

  for (const ch of options) {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = stacked.includes(ch);
    cb.addEventListener('change', () => onToggle(ch, cb.checked));
    const name = document.createElement('span');
    name.className = 'channel-name'; // channel names look like code, as file names do
    name.textContent = ch;
    label.append(cb, name);
    els.stackChannels.appendChild(label);
  }
}
