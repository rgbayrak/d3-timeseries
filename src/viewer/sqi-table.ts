import type { SQIResults, ChannelMetrics } from '@/data/sqi-metrics';

export interface ColDef {
  label: string;
  key: keyof ChannelMetrics;
  decimals: number;
  description?: string;
  /** 'always' columns can't be hidden; the others toggle per group or individually */
  group: string;
}

export const SQI_COLUMNS: ColDef[] = [
  { label: 'Channel', key: 'channelName', decimals: 0, group: 'always' },
  { label: 'Mean', key: 'mean', decimals: 4, group: 'Basic' },
  { label: 'Std Dev', key: 'stdDev', decimals: 4, description: 'Standard deviation (spread of values around the mean). Range: [0, +∞)', group: 'Basic' },
  { label: 'SNR', key: 'snr', decimals: 3, description: 'Signal-to-noise ratio (mean / std dev). Higher is cleaner.', group: 'Distribution' },
  { label: 'Kurtosis', key: 'kurtosis', decimals: 3, description: 'Excess kurtosis — tailedness of the distribution. 0 = normal, >0 = heavy tails, <0 = light tails.', group: 'Distribution' },
  { label: 'Skewness', key: 'skewness', decimals: 3, description: 'Asymmetry of the distribution. 0 = symmetric, >0 = right-skewed, <0 = left-skewed.', group: 'Distribution' },
  { label: 'ZCR (Hz)', key: 'zeroCrossingRate', decimals: 2, description: 'Zero-crossing rate — number of sign changes per second. Higher values indicate higher-frequency content.', group: 'Distribution' },
  { label: 'sVRI', key: 'svri', decimals: 3, description: 'Stress-induced Vascular Response Index — ratio of mean post- to pre-systolic amplitude, averaged across beats (PaPaGei).', group: 'PaPaGei' },
  { label: 'IPA', key: 'ipa', decimals: 3, description: 'Inflection Point Area ratio — systolic area / diastolic area split at dicrotic notch, averaged across beats (PaPaGei).', group: 'PaPaGei' },
  { label: 'SQI', key: 'sqi', decimals: 3, description: 'Signal Quality Index — mean skewness over 5-second windows (PaPaGei). Range: (-∞, +∞)', group: 'PaPaGei' },
  { label: 'Kurt (win)', key: 'kurtosisWindowed', decimals: 3, description: 'Mean excess kurtosis over 60 s windows (Elgendi 2016).', group: 'PhysioQC' },
  { label: 'ApEn', key: 'approxEntropy', decimals: 4, description: 'Approximate entropy — signal regularity (Elgendi 2016, m=2, r=0.2×SD). Lower = more regular.', group: 'PhysioQC' },
  { label: 'Beat Corr', key: 'beatCorrelation', decimals: 3, description: 'Mean Pearson correlation of each beat/breath vs average waveform (Romano 2023).', group: 'PhysioQC' },
];

export const SQI_GROUPS = ['Basic', 'Distribution', 'PaPaGei', 'PhysioQC'];

/** Channel plus the Basic group are shown by default */
export function defaultVisibleColumns(): Set<string> {
  return new Set(SQI_COLUMNS.filter((c) => c.group === 'always' || c.group === 'Basic').map((c) => c.key));
}

export function formatMetricValue(val: number, decimals: number): string {
  if (val === Infinity) return 'Inf';
  if (val === -Infinity) return '-Inf';
  if (Number.isNaN(val)) return 'N/A';
  return val.toFixed(decimals);
}

function groupKeys(group: string): string[] {
  return SQI_COLUMNS.filter((c) => c.group === group).map((c) => c.key);
}

/** Table HTML for the visible columns; one row per channel */
export function sqiTableHtml(results: SQIResults, visible: Set<string>): string {
  const active = SQI_COLUMNS.filter((c) => c.group === 'always' || visible.has(c.key));

  let html = '<table><thead><tr>';
  for (const c of active) {
    const tip = c.description ? ` data-tip="${c.description}"` : '';
    html += `<th${tip}>${c.label}</th>`;
  }
  html += '</tr></thead><tbody>';

  for (const m of results.metrics) {
    html += '<tr>';
    for (const c of active) {
      const val = m[c.key];
      html += typeof val === 'string' ? `<td>${val}</td>` : `<td>${formatMetricValue(val, c.decimals)}</td>`;
    }
    html += '</tr>';
  }

  return html + '</tbody></table>';
}

export interface SqiTableElements {
  section: HTMLElement;
  container: HTMLElement;
  controls: HTMLElement;
}

export interface SqiTable {
  /** Render results and reveal the section */
  show: (results: SQIResults) => void;
  hide: () => void;
  /** Hide and drop the rendered table (new scan loaded) */
  clear: () => void;
}

/** SQI table with group buttons and per-column checkboxes; column choices persist across scans */
export function createSqiTable(els: SqiTableElements): SqiTable {
  const visible = defaultVisibleColumns();
  let lastResults: SQIResults | null = null;

  function renderBody() {
    if (lastResults) els.container.innerHTML = sqiTableHtml(lastResults, visible);
  }

  function syncCheckboxes() {
    els.controls.querySelectorAll<HTMLInputElement>('.sqi-checkboxes input').forEach((cb) => {
      cb.checked = visible.has(cb.dataset.col!);
    });
  }

  function syncGroupButtons() {
    els.controls.querySelectorAll<HTMLButtonElement>('.sqi-groups button').forEach((btn) => {
      btn.classList.toggle('active', groupKeys(btn.dataset.group!).every((k) => visible.has(k)));
    });
  }

  function buildControls() {
    let html = '<div class="sqi-groups">';
    for (const g of SQI_GROUPS) {
      const active = groupKeys(g).every((k) => visible.has(k)) ? 'active' : '';
      html += `<button type="button" class="${active}" data-group="${g}">${g}</button>`;
    }
    html += '</div><div class="sqi-checkboxes">';
    for (const c of SQI_COLUMNS) {
      if (c.group === 'always') continue;
      const checked = visible.has(c.key) ? ' checked' : '';
      html += `<label><input type="checkbox" data-col="${c.key}"${checked}>${c.label}</label>`;
    }
    html += '</div>';
    els.controls.innerHTML = html;

    // A group button shows the whole group, or hides it if it is already fully shown
    els.controls.querySelectorAll<HTMLButtonElement>('.sqi-groups button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const keys = groupKeys(btn.dataset.group!);
        const allVisible = keys.every((k) => visible.has(k));
        for (const k of keys) {
          if (allVisible) visible.delete(k);
          else visible.add(k);
        }
        btn.classList.toggle('active', !allVisible);
        syncCheckboxes();
        renderBody();
      });
    });

    els.controls.querySelectorAll<HTMLInputElement>('.sqi-checkboxes input').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) visible.add(cb.dataset.col!);
        else visible.delete(cb.dataset.col!);
        syncGroupButtons();
        renderBody();
      });
    });
  }

  return {
    show(results) {
      lastResults = results;
      buildControls();
      renderBody();
      els.section.style.display = '';
    },
    hide() {
      els.section.style.display = 'none';
    },
    clear() {
      els.section.style.display = 'none';
      els.container.innerHTML = '';
    },
  };
}
