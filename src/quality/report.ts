import type { ChartInstance } from '@/core';
import { TIMING_LABELS, bareDoi } from '@/viewer/info';
import type { TimingStatus } from '@/data/bids-physio-reader';
import { drawScatter, drawHistogram, drawWaveform, metricColor, PALETTE, THEME } from './charts';
import { buildPdf, A4_LANDSCAPE } from './pdf';
import type { PdfPageImage } from './pdf';
import { fetchWaveforms } from './data';
import type { LoadedDataset } from './data';
import { scanId } from './metrics-tsv';
import type { DatasetInfoLike, ParticipantsTable } from './metrics-tsv';
import type { GroupSelection } from './group-tab';
import type { VisibleMetrics } from './model';
import {
  ALL_METRICS,
  COLOR_BY_OPTIONS,
  availableMetrics,
  categoryLabel,
  colorGroups,
  colorKey,
  datasetSummaryText,
  defaultMetricPair,
  formatMetric,
  formatSeconds,
  metricAxisChoices,
  metricDef,
  metricAxisLabel,
  ordinal,
  participantValue,
  rowsForChannel,
  rowsForScan,
  scatterData,
  summaryTable,
  uniqueScans,
  xAxisChoices,
  yAxisChoices,
} from './model';
import { percentileRank } from './stats';

// Builds the dataset PDF report in the browser: pages are laid out on an
// A4-landscape canvas, charts are drawn off-screen with the same builders as
// the page and rasterised from SVG, and every page becomes one JPEG in the PDF.

const SCALE = 2; // canvas pixels per PDF point
const PAGE_W = A4_LANDSCAPE.width;
const PAGE_H = A4_LANDSCAPE.height;
const MARGIN = 36;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const BOTTOM = PAGE_H - MARGIN;
const FONT = 'Helvetica, Arial, sans-serif';
const MONO = 'Menlo, Consolas, monospace';

/** Styles the charts get from quality.html, inlined so the standalone SVG looks the same */
const EXPORT_CSS =
  'text{font-family:Helvetica,Arial,sans-serif}' +
  `.axis path,.axis line{stroke:${THEME.axis}}` +
  '.grid path{display:none}' +
  '.axis-label{font-size:13px;font-weight:600}';

// ── SVG / canvas helpers ─────────────────────────────────

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not render chart image'));
    img.src = src;
  });
}

/** Rasterise a chart SVG at 2x its size so it stays sharp on the page */
function svgImage(svg: SVGSVGElement): Promise<HTMLImageElement> {
  const w = Number(svg.getAttribute('width'));
  const h = Number(svg.getAttribute('height'));
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
  clone.setAttribute('width', String(w * SCALE));
  clone.setAttribute('height', String(h * SCALE));
  clone.removeAttribute('style');
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = EXPORT_CSS;
  clone.insertBefore(style, clone.firstChild);
  const xml = new XMLSerializer().serializeToString(clone);
  return loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`);
}

/** Draw a chart into a hidden container, rasterise it, and remove it again */
async function renderChart(
  host: HTMLElement,
  build: (el: HTMLElement) => ChartInstance | null,
): Promise<HTMLImageElement | null> {
  const el = document.createElement('div');
  host.appendChild(el);
  let chart: ChartInstance | null = null;
  try {
    chart = build(el);
    const svg = el.querySelector('svg');
    return chart && svg ? await svgImage(svg) : null;
  } finally {
    chart?.destroy();
    el.remove();
  }
}

/** Height of a chart image drawn at `width`, keeping its proportions */
function heightAt(img: HTMLImageElement, width: number): number {
  return img.naturalWidth > 0 ? (width * img.naturalHeight) / img.naturalWidth : width / 2;
}

async function canvasJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) throw new Error('Could not encode a PDF page');
  return new Uint8Array(await blob.arrayBuffer());
}

// ── Page layout ──────────────────────────────────────────

interface TextStyle {
  bold?: boolean;
  mono?: boolean;
  color?: string;
}

/** One histogram in the PDF grid (no title: the x-axis label names the metric) */
export interface HistCell {
  img: HTMLImageElement | null;
}

/** Top-to-bottom flow layout over A4-landscape pages; finished pages are encoded straight away */
function createLayout(footer: string) {
  const pages: PdfPageImage[] = [];
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let y = MARGIN;
  let pageNo = 0;

  function start(): CanvasRenderingContext2D {
    canvas = document.createElement('canvas');
    canvas.width = PAGE_W * SCALE;
    canvas.height = PAGE_H * SCALE;
    const c = canvas.getContext('2d');
    if (!c) throw new Error('Canvas is not available');
    c.scale(SCALE, SCALE);
    c.fillStyle = '#fff';
    c.fillRect(0, 0, PAGE_W, PAGE_H);
    // Purple-to-blue band across the top, like the active folder tab
    const band = c.createLinearGradient(0, 0, PAGE_W, 0);
    band.addColorStop(0, THEME.violet);
    band.addColorStop(1, THEME.blue);
    c.fillStyle = band;
    c.fillRect(0, 0, PAGE_W, 5);
    pageNo++;
    c.fillStyle = THEME.axis;
    c.font = `8px ${FONT}`;
    c.textAlign = 'left';
    c.fillText(footer, MARGIN, PAGE_H - 16);
    c.textAlign = 'right';
    c.fillText(`page ${pageNo}`, PAGE_W - MARGIN, PAGE_H - 16);
    c.textAlign = 'left';
    ctx = c;
    y = MARGIN;
    return c;
  }

  async function finish() {
    if (!canvas) return;
    pages.push({ jpeg: await canvasJpeg(canvas), width: canvas.width, height: canvas.height });
    canvas = null;
    ctx = null;
  }

  async function newPage(): Promise<CanvasRenderingContext2D> {
    await finish();
    return start();
  }

  /** Context with room for `h` points below the cursor, starting a new page if needed */
  async function room(h: number): Promise<CanvasRenderingContext2D> {
    if (!ctx) return start();
    if (y + h > BOTTOM && y > MARGIN) return newPage();
    return ctx;
  }

  const fontOf = (size: number, s: TextStyle) => `${s.bold ? 'bold ' : ''}${size}px ${s.mono ? MONO : FONT}`;

  function wrap(c: CanvasRenderingContext2D, text: string, width: number): string[] {
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && c.measureText(next).width > width) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  async function text(str: string, size = 10, style: TextStyle = {}) {
    const lh = size * 1.35;
    let c = await room(lh);
    c.font = fontOf(size, style);
    for (const line of wrap(c, str, CONTENT_W)) {
      c = await room(lh);
      c.font = fontOf(size, style);
      c.fillStyle = style.color ?? THEME.ink;
      c.fillText(line, MARGIN, y + size);
      y += lh;
    }
  }

  /** Heading kept together with at least `keepWith` points of what follows */
  async function heading(str: string, size = 14, keepWith = 120) {
    await room(size * 1.6 + keepWith);
    await text(str, size, { bold: true });
    y += 4;
  }

  async function image(img: HTMLImageElement, w: number, h: number) {
    const c = await room(h);
    c.drawImage(img, MARGIN, y, w, h);
    y += h + 4;
  }

  async function legend(items: { label: string; color: string }[]) {
    if (items.length === 0) return;
    let c = await room(14);
    c.font = `9px ${FONT}`;
    let x = MARGIN;
    for (const item of items) {
      const w = 12 + c.measureText(item.label).width + 14;
      if (x + w > MARGIN + CONTENT_W) {
        y += 13;
        x = MARGIN;
        c = await room(14);
        c.font = `9px ${FONT}`;
      }
      c.fillStyle = item.color;
      c.beginPath();
      c.arc(x + 4, y + 6, 4, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = THEME.ink;
      c.fillText(item.label, x + 12, y + 9);
      x += w;
    }
    y += 16;
  }

  async function histGrid(cells: HistCell[], columns = 4) {
    const gap = 14;
    const cw = (CONTENT_W - gap * (columns - 1)) / columns;
    for (let i = 0; i < cells.length; i += columns) {
      const row = cells.slice(i, i + columns);
      // Histograms with an axis label are a little taller; size the row to its tallest image
      const ih = Math.max(cw / 2, ...row.map((cell) => (cell.img ? heightAt(cell.img, cw) : 0)));
      const ch = ih + 10;
      const c = await room(ch);
      row.forEach((cell, j) => {
        const x = MARGIN + j * (cw + gap);
        if (cell.img) {
          c.drawImage(cell.img, x, y, cw, heightAt(cell.img, cw));
        } else {
          c.fillStyle = '#666';
          c.font = `8px ${FONT}`;
          c.fillText('No values', x, y + 18);
        }
      });
      y += ch;
    }
  }

  async function table(header: string[], rows: string[][], firstColWidth = 150) {
    const rh = 13;
    const rest = header.length > 1 ? (CONTENT_W - firstColWidth) / (header.length - 1) : 0;
    const colX = header.map((_, i) => MARGIN + (i === 0 ? 0 : firstColWidth + (i - 1) * rest));
    const drawRow = async (cells: string[], isHeader: boolean) => {
      const c = await room(rh);
      // Tables stay neutral: grey header and rules, no theme colours
      if (isHeader) {
        c.fillStyle = '#f5f5f5';
        c.fillRect(MARGIN, y, CONTENT_W, rh);
      }
      c.font = `${isHeader ? 'bold ' : ''}8.5px ${FONT}`;
      c.fillStyle = THEME.ink;
      cells.forEach((cell, i) => c.fillText(cell, colX[i] + 3, y + 9.5));
      c.strokeStyle = '#ddd';
      c.beginPath();
      c.moveTo(MARGIN, y + rh);
      c.lineTo(MARGIN + CONTENT_W, y + rh);
      c.stroke();
      y += rh;
    };
    await drawRow(header, true);
    for (const r of rows) await drawRow(r, false);
    y += 6;
  }

  return {
    pages,
    text,
    heading,
    image,
    legend,
    histGrid,
    table,
    newPage,
    finish,
    gap: (h: number) => {
      y += h;
    },
  };
}

// ── Report content ───────────────────────────────────────

function datasetInfoLines(info: DatasetInfoLike): string[] {
  const lines: string[] = [];
  if (info.name) lines.push(info.name);
  if (info.authors.length) lines.push(info.authors.join(', '));
  const meta: string[] = [];
  if (info.bidsVersion) meta.push(`BIDS ${info.bidsVersion}`);
  if (info.license) meta.push(`License: ${info.license}`);
  if (info.doi) meta.push(`doi:${bareDoi(info.doi)}`);
  for (const d of info.derivatives) meta.push(`Derivatives: ${d.name}${d.version ? ` ${d.version}` : ''}`);
  if (meta.length) lines.push(meta.join(' · '));
  return lines;
}

function participantLine(table: ParticipantsTable | null, sub: string): string {
  if (!table) return '';
  return table.columns
    .map((col) => {
      const v = participantValue(table, sub, col);
      if (v === null) return null;
      const label = categoryLabel(table, col, v);
      const units = table.meta[col]?.units;
      return `${col}: ${label !== v ? `${v} (${label})` : v}${units ? ` ${units}` : ''}`;
    })
    .filter(Boolean)
    .join(' · ');
}

export interface ReportOptions {
  dataset: string;
  data: LoadedDataset;
  /** Axes and colouring from the Group tab, applied to every channel's scatter */
  selection: GroupSelection;
  /** Add one page per scan (waveforms and metrics) */
  includeScans: boolean;
  /** Metrics chosen in the Metrics picker; hidden ones are left out of the report */
  visible: VisibleMetrics;
  onProgress?: (message: string) => void;
}

/** Build the whole-dataset PDF report */
export async function buildQualityReport(opts: ReportOptions): Promise<Blob> {
  const { dataset, data, selection, includeScans, visible } = opts;
  const progress = opts.onProgress ?? (() => {});
  const s = data.summary;
  const participants = s.participants;
  const L = createLayout(`${dataset} · quality metrics report`);

  const host = document.createElement('div');
  Object.assign(host.style, { position: 'fixed', left: '-20000px', top: '0', width: '1000px' });
  document.body.appendChild(host);

  try {
    // Cover
    progress('cover');
    await L.heading(`Quality metrics report: ${dataset}`, 18, 0);
    for (const line of datasetInfoLines(s.info)) await L.text(line, 10, { color: '#444' });
    L.gap(6);
    await L.text(datasetSummaryText(s, data.rows), 10);
    const st = summaryTable(data.rows, s.channels);
    if (st) {
      L.gap(4);
      await L.table(st.header, st.rows, 120);
    }
    if (s.failedScans.length > 0) {
      await L.text(
        `${s.failedScans.length} scans could not be computed: ${s.failedScans.map((f) => `${f.scan} (${f.reason})`).join('; ')}`,
        9,
        { color: '#a33' },
      );
    }
    L.gap(6);
    const colorLabel = COLOR_BY_OPTIONS.find((o) => o.key === selection.colorBy)?.label ?? selection.colorBy;
    await L.text(
      `Contents: one section per channel with a scatter plot (colour = ${colorLabel.toLowerCase()}) and the ` +
        `distribution of ${visible.size === ALL_METRICS.length ? 'every metric' : `the ${visible.size} selected metrics`}` +
        (includeScans ? ', then one page per scan with its waveforms and metrics (percentile among all recordings of the same channel).' : '.'),
      9,
      { color: '#444' },
    );
    await L.text(`Created ${new Date().toLocaleString()}.`, 8, { color: '#888' });

    // One section per channel
    for (const [ci, channel] of s.channels.entries()) {
      progress(`channel ${ci + 1} of ${s.channels.length}`);
      await L.newPage();
      await L.heading(`${channel}: quality across all recordings`, 15, 0);
      const rows = rowsForChannel(data.rows, channel);
      if (metricAxisChoices(rows, visible).length === 0) {
        await L.text('No metrics to show for this channel.', 10);
        continue;
      }
      // Same options as the Group tab; a choice this channel lacks falls back to the default pair
      const units = s.channelUnits;
      const xChoices = xAxisChoices(rows, participants, data.rows, visible, units);
      const yChoices = yAxisChoices(rows, visible, units);
      const [dx, dy] = defaultMetricPair(rows, visible);
      const xc = xChoices.find((c) => c.value === selection.xValue) ?? xChoices.find((c) => c.value === dx) ?? xChoices[0];
      const yc = yChoices.find((c) => c.value === selection.yValue) ?? yChoices.find((c) => c.value === dy) ?? yChoices[0];

      // Same colour per category in every channel's scatter, matching the Stats Group tab
      const allGroups = colorGroups(data.rows, selection.colorBy);
      const colorOf = (g: string) => PALETTE[allGroups.indexOf(g) % PALETTE.length];
      const groups = colorGroups(rows, selection.colorBy);
      const points = scatterData(rows, xc, yc, participants).map((d) => ({
        x: d.x,
        y: d.y,
        color: colorOf(colorKey(d.row, selection.colorBy)),
        datum: d.row,
      }));
      await L.text(`${yc.label} against ${xc.label}: ${points.length} of ${rows.length} scans plotted.`, 9, { color: '#444' });
      if (points.length > 0) {
        const img = await renderChart(host, (el) =>
          drawScatter({
            container: el,
            points,
            xLabel: xc.label,
            yLabel: yc.label,
            xCategories: xc.categories,
            width: 960,
            height: 420,
          }),
        );
        if (img) await L.image(img, CONTENT_W, heightAt(img, CONTENT_W));
        await L.legend(groups.map((g) => ({ label: g, color: colorOf(g) })));
      }

      await L.heading(`How each ${channel} metric is distributed`, 11, 140);
      await L.text('Dashed grey line: group mean.', 8, { color: '#666' });
      const cells: HistCell[] = [];
      for (const key of availableMetrics(rows, visible)) {
        const values = rows.map((r) => r.metrics[key]);
        const img = await renderChart(host, (el) =>
          drawHistogram({
            container: el,
            values,
            color: metricColor(key),
            xLabel: metricAxisLabel(key, channel, units),
          }),
        );
        cells.push({ img });
      }
      await L.histGrid(cells);
    }

    // One page per scan
    if (includeScans) {
      const scans = uniqueScans(data.rows);
      for (const [i, scan] of scans.entries()) {
        progress(`scan ${i + 1} of ${scans.length}`);
        await L.newPage();
        const scanRows = rowsForScan(data.rows, scan);
        const r0 = scanRows[0];
        await L.heading(scanId(scan), 14, 0);
        await L.text(r0.filename, 9, { mono: true, color: '#444' });
        const p = participantLine(participants, scan.sub);
        if (p) await L.text(`Participant: ${p}`, 9);
        const timing = TIMING_LABELS[r0.timingStatus as TimingStatus] ?? `Timing: ${r0.timingStatus || 'n/a'}`;
        const sidecar = scanRows
          .filter((r) => r.sidecarAssessment)
          .map((r) => `${r.channel}: ${r.sidecarAssessment}`)
          .join(', ');
        await L.text(
          `${r0.samplingFrequency} Hz · ${formatSeconds(r0.durationS)} · ${timing}${sidecar ? ` · Sidecar: ${sidecar}` : ''}`,
          9,
        );
        L.gap(4);

        const wf = await fetchWaveforms(dataset, scan);
        if (wf) {
          for (const [ci, ch] of wf.channels.entries()) {
            const img = await renderChart(host, (el) =>
              drawWaveform({
                container: el,
                channel: ch.channel,
                times: wf.times,
                min: ch.min,
                max: ch.max,
                units: s.channelUnits?.[ch.channel],
                timeLabel: ci === wf.channels.length - 1,
                height: 110,
              }),
            );
            if (img) await L.image(img, CONTENT_W, heightAt(img, CONTENT_W));
          }
          await L.text('Dashed line: scan onset (t = 0). Bands show the min and max of the signal per time bin.', 8, {
            color: '#666',
          });
        } else {
          await L.text('No waveform file for this scan.', 9, { color: '#a33' });
        }

        const keys = availableMetrics(scanRows, visible);
        if (keys.length > 0) {
          L.gap(4);
          const header = ['Metric', ...scanRows.map((r) => r.channel)];
          const body = keys.map((k) => [
            metricDef(k).label,
            ...scanRows.map((r) => {
              const v = r.metrics[k];
              const pr = percentileRank(rowsForChannel(data.rows, r.channel).map((g) => g.metrics[k]), v);
              return Number.isFinite(pr) ? `${formatMetric(v, k)}  (${ordinal(pr)} pct)` : formatMetric(v, k);
            }),
          ]);
          await L.table(header, body);
        }
      }
    }

    progress('saving');
    await L.finish();
    const bytes = buildPdf(L.pages);
    return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  } finally {
    host.remove();
  }
}
