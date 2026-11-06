# Contributing

Developer notes for physAI-QA-interactive: how the code is laid out, how the server
and charts work, and what's planned. For installing and running the viewer,
see the [README](README.md).

## Commands

```bash
npm install
npm run dev        # Vite dev server with hot reload
npm test           # vitest run (all tests)
npm run test:watch # vitest in watch mode
npm run typecheck  # tsc --noEmit (strict, no output)
npm run build      # tsc + vite build (index.html and quality.html)

npx vite-node scripts/compute-quality-metrics.ts <dataset>  # dataset quality metrics -> data/quality/<dataset>/
npx tsc -p scripts                                           # typecheck scripts/ (outside the root tsconfig)
npx vite-node scripts/update-bids-rules.ts [x.y.z ...]       # BIDS rules for new releases -> server/schema-rules/
```

### Tests

Tests run against two tiny synthetic BIDS datasets in `test/fixtures/` (sessions/runs with fMRIPrep-style derivatives, and a session-less layout), so they need no downloaded data. They cover every timing badge, sidecar fallbacks, confounds (fMRIPrep and MRIQC names), task events and their inheritance, the trial peaks, downloaded-file counts, annotations and path safety, and the dataset quality metrics pipeline (including the run log) (TSV round trip, identical output on reruns, physio channel dictionary, participant axes and the PDF writer). Regenerate the fixtures after changing them with:

```bash
python3 test/fixtures/make_fixtures.py
```

The dataset-agnostic suite in `server/__tests__/bids-layout.test.ts` also runs on any real datasets present under `data/`, and skips them when they aren't downloaded. CI (`.github/workflows/ci.yml`) runs `typecheck` and `test` on every push and pull request.

---

## Architecture

```
src/
├── core/
│   ├── createChart.ts      # Factory function (the main entry point)
│   ├── types.ts            # All TypeScript interfaces
│   ├── scales.ts           # Scale creation helpers
│   ├── axes.ts             # Axis + grid rendering
│   ├── clipPath.ts         # Clip path setup
│   ├── resize.ts           # ResizeObserver logic
│   ├── tooltip.ts          # Tooltip module
│   ├── zoom.ts             # Composable zoom/pan module
│   ├── brush.ts            # Composable brush module
│   ├── viewportCulling.ts  # cullToViewport + downsample
│   └── index.ts            # Barrel export
├── data/
│   ├── bids-physio-reader.ts  # Client-side BIDS physio data fetcher
│   └── sqi-metrics.ts         # Per-channel signal quality metrics
├── viewer/                    # Interactive physio viewer (only main.ts touches the page)
│   ├── main.ts                # Entry: init, data loading, event wiring
│   ├── dom.ts                 # Element lookup from index.html
│   ├── state.ts               # The single ViewerState object
│   ├── annotations.ts         # Annotation model <-> stored JSON (pure)
│   ├── annotation-panel.ts    # Annotation list rendering, HTML escaping
│   ├── sqi-table.ts           # Metric labels, groups and number format (used by the scatter plot, Stats and the PDF)
│   ├── info.ts                # Dataset info line, On disk data summary, timing/quality badges
│   ├── controls.ts            # Dropdowns, stacked-channel checkboxes
│   ├── navigation.ts          # Prev/next stepping, search resolution (pure)
│   ├── persistence.ts         # Last-viewed scan in localStorage
│   ├── events.ts              # Events columns: rest check, categories, counters, default column (pure)
│   ├── peaks-trial.ts         # TRIAL: match physprep peaks to the picked channel (pure)
│   └── charts/
│       ├── shared.ts          # Line drawing, y-fit, onset marker, hover readout
│       ├── focus-context.ts   # Focus + overview charts, brush-to-zoom, annotation boxes, overlay layer
│       ├── confounds.ts       # Confound chart, FD severity coloring
│       ├── events.ts          # Events chart: one lane per category, blocks from onset to onset + duration
│       ├── peaks-trial.ts     # TRIAL: peak dots drawn on the focus chart's overlay
│       └── stack.ts           # Stacked channel charts
├── quality/                   # Quality metrics: the Stats tab (quality.html; only main.ts touches that page) and the scatter plot in Explore and Annotate
│   ├── main.ts                # Stats entry: #scan?… link, dataset loading, builds and saves the PDF report once
│   ├── individual-tab.ts      # Stats: one scan's header, waveforms, per-channel metric tables and histograms
│   ├── scatter-panel.ts       # Scatter plot for Explore and Annotate (X: metric or participant; Y: metric; viewed scan highlighted)
│   ├── report.ts              # PDF report: lays out pages on a canvas, rasterises the charts
│   ├── pdf.ts                 # Minimal PDF writer (one JPEG per page, pure)
│   ├── charts.ts              # Scatter, histogram and static waveform charts (createChart)
│   ├── model.ts               # Labels, summaries, axis choices, scatter data (pure)
│   ├── metrics-tsv.ts         # TSV/JSON formats shared with the script (pure)
│   ├── channels.ts            # Physio channel dictionary (pure)
│   ├── envelope.ts            # Min/max downsampling for waveforms (pure)
│   ├── stats.ts               # Histogram bins, percentiles (pure)
│   ├── route.ts               # /quality.html#scan?sub=… links (pure)
│   ├── metric-picker.ts       # "Metrics shown" sidebar list: show/hide each metric
│   ├── linked-scan.ts         # Shares the open scan with Explore and Annotate (via its localStorage entry)
│   ├── run-log.ts             # quality_runs.tsv: one line per metrics run, and its sentence (pure; also used by the script)
│   └── data.ts                # Fetches the served dataset's data/quality/ files
├── shell/
│   └── tabs.css               # Page shell shared by index.html and quality.html: font (IBM Plex Sans), text tokens, titles, folder tabs, dataset header, .btn, "Now viewing" line
├── utils/
│   ├── uid.ts              # Unique ID generator
│   ├── margin.ts           # Margin defaults/merge
│   ├── dom.ts              # Container resolution
│   └── index.ts            # Barrel export
└── main.ts                 # Entry point (loads viewer/main)

server/
├── bids-layout.ts          # Pure BIDS filesystem logic (testable, no Vite dependency)
├── bids-physio-plugin.ts   # Thin Vite plugin wrapper importing from bids-layout (reads the dataset once the dev server listens)
├── availability.ts         # Physio files listed vs downloaded (git annex find, else the file's content)
├── quality-run-log.ts      # Appends a run's line to data/quality/<dataset>/quality_runs.tsv
└── quality-metrics.ts      # Dataset-wide quality metrics: computes and writes data/quality/<dataset>/

scripts/
└── compute-quality-metrics.ts  # Command-line wrapper around server/quality-metrics.ts
```

### Data pipeline

```
BIDS dataset on disk
  ↓  server/bids-physio-plugin.ts (Node.js, runs inside Vite dev server)
  ↓  Reads .json sidecar + decompresses .tsv.gz
  ↓  Returns compact column-array JSON via /api/bids/* endpoints
  ↓
Browser (src/data/bids-physio-reader.ts)
  ↓  fetchDatasetInfo(), fetchSubjects(), fetchScans(), fetchTasks(), fetchRuns(), fetchPhysioRaw(), fetchConfounds(), fetchEvents(), fetchPeaks() (trial)
  ↓  toDataPoints() / toConfoundPoints() materialize {time, value}[] arrays
  ↓
SQI (src/data/sqi-metrics.ts)
  ↓  computeSQI() — 12 per-channel metrics: mean, std dev, SNR, kurtosis, skewness, ZCR,
  ↓  PaPaGei morphology (sVRI, IPA, SQI) and PhysioQC (windowed kurtosis, ApEn, beat correlation);
  ↓  definitions and sources in REVIEW.md
  ↓
Viewer (src/viewer/)
  ↓  main.ts holds the state and wires events; charts/ builds focus+context,
  ↓  stacked, events and confounds charts and keeps them on one time window
```

Dataset quality metrics run offline and are served as static files, not through the API:

```
BIDS dataset on disk
  ↓  scripts/compute-quality-metrics.ts → server/quality-metrics.ts
  ↓  readPhysio() for every scan, keep physiological columns (src/quality/channels.ts), computeSQI()
  ↓  writes data/quality/<dataset>/quality_metrics.tsv, dataset.json, waveforms/*.json,
  ↓  and appends one line to quality_runs.tsv (scans computed / listed / failed)
  ↓
Browser (src/quality/)
  ↓  asks /api/bids/dataset which dataset the server serves (its `id`), then
  ↓  fetches /data/quality/<id>/… directly (served by Vite from the project root)
  ↓  scatter plot in Explore and Annotate (index.html), Stats tab and PDF report (quality.html)
```

### Server API endpoints

| Endpoint | Description |
|---|---|
| `GET /api/bids/subjects` | All subjects with their sessions (only those with readable physio files) |
| `GET /api/bids/dataset` | Dataset metadata from `dataset_description.json` (raw + derivatives `GeneratedBy`), plus `id`: the dataset's folder name under `data/`, and `physioFiles`: `{ onDisk, downloaded, source }`, physio files listed vs downloaded, counted once at startup, and `structure`: file and folder names checked against the rules of the declared `BIDSVersion` (`server/bids-structure.ts`) |
| `GET /api/bids/scans` | Flat list of every readable `{sub, ses, task, run}` in hierarchy order |
| `GET /api/bids/tasks?sub=&ses=` | Tasks available for a given subject/session |
| `GET /api/bids/runs?sub=&ses=&task=` | Runs available for a given subject/session/task |
| `GET /api/bids/physio?sub=&ses=&task=&run=` | Physio data as compact column arrays, plus the timing check result (`timing`) |
| `GET /api/bids/confounds?sub=&ses=&task=&run=` | Motion confounds (FD, RMSD, DVARS, trans/rot) from the fMRIPrep or MRIQC confounds TSV; `null` (200) when the scan has none |
| `GET /api/bids/events?sub=&ses=&task=&run=` | Task events `{ filename, onset, duration, columns }` from the imaging folders (BIDS inheritance: run, run-less, top-level); `null` (200) when there are none |
| `GET /api/bids/peaks?sub=&ses=&task=&run=` | TRIAL: detected and corrected peaks `{ filename, time, channel, corrected }` from a physprep-style events file next to the physio; `null` when there are none |
| `GET /api/bids/annotations?sub=&ses=&task=&run=&channel=` | Stored annotations for a scan/channel, if any |
| `POST /api/bids/annotations` | Saves (overwrites) annotations for a scan/channel |
| `GET /api/quality-report` | `{ exists, url }`: whether the served dataset's `data/quality/<dataset>/quality_report.pdf` is saved |
| `POST /api/quality-report` | Saves the PDF report the Stats tab built (body: the PDF; only for the served dataset, only once its metrics exist) |
| `GET /api/bids/annotation-progress?channel=` | `{ annotated, total, firstUnannotated }`: scans with a Signal Quality rating, Notes or a time window saved for that channel, and the earliest scan (hierarchy order) without any, or `null` |

The server skips broken symlinks (e.g. DataLad/git-annex files that haven't been fetched) using `accessSync(R_OK)`.

Confounds are read from the derivatives root: `BIDSDER_ROOT` when set, else the folder inside `$BIDS_ROOT/derivatives/` that has confounds files, preferring fMRIPrep's over MRIQC's (`resolveBidsRoots`). The server looks for, in order, fMRIPrep's `*_desc-confounds_timeseries.tsv[.gz]`, the older `*_desc-confounds_regressors.tsv` and `*_bold_confounds.tsv`, then MRIQC's `*_timeseries.tsv` (lowest echo for multi-echo runs), and extracts the motion columns (`framewise_displacement`, `rmsd`, `dvars`, `std_dvars`, `trans_*`, `rot_*`); the **Confound** dropdown picks which one to plot and only appears when a confounds file is found.

Annotations are written as JSON files under `ANNOTATIONS_ROOT` (env var, default `data/annotations/` in the project root), one file per `{sub, ses, task, run, channel}`, mirroring the `sub-XX/ses-XX/` BIDS directory structure. Each file starts with the full-recording `waveform_quality` (`good`, `bad`, `fixable`, `unknown` or `null`) and `waveform_comment` (Notes), followed by the scan, `sampling_rate` and the time windows in `annotations`. Files saved before these two fields existed still load.

How the server and viewer line up physio, confounds and triggers in time is described in the README under [Timing alignment](README.md#timing-alignment).

### Design principles

- **Composition over inheritance** — chart types call `createChart()`, hook events, draw into `layers.content`, and return an extended instance.
- **Base does NOT set domains from data** — chart types compute their own domains.
- **Individual D3 modules** — `d3-scale`, `d3-axis`, `d3-selection`, etc. for tree-shaking. No monolithic `d3` import.
- **Functional factory pattern** — no classes, composable, idiomatic D3.
- **No component framework (Vue/React)** — vanilla D3+TS holds up as long as state stays centralized (a single object for current scan/selection/annotations) and render functions stay pure/redraw-from-state. Revisit only if hand-rolled DOM diff/patch logic becomes unavoidable, not because of codebase size alone.
- **Viewer modules don't reach into the page** — only `src/viewer/main.ts` looks up elements and owns the `ViewerState`; every other viewer module receives elements and data as arguments and has no import-time DOM access, so its logic is unit-tested in Node (`src/viewer/__tests__/`). The quality page follows the same rule: only `src/quality/main.ts` touches `quality.html`, and the pure modules are tested in `src/quality/__tests__/`.
- **One text style everywhere** — every change keeps text font, size and colour matched across pages. Use only the shared tokens in `src/shell/tabs.css` (`--fs-dataset`, `--fs-title`, `--fs-xl` … `--fs-xs`, `--text`, `--text-2`, `--text-3`, `--font`, `--mono`), never a page-specific font size, family or text colour. Titles (`h2`, `h3`, `.section-label`) share one style, and sub-titles (`h4`, `.subsection-label`) one a step smaller, both in `--text-2`. Within a section, text under its heading (description, labels, dropdowns, legend, notes) is one size and one colour. File and channel names use the shared code style (`.now-viewing-file`, `.channel-name`).

---

## Quality metrics: adding or removing a metric

A metric is computed in one place and listed in three:

1. **Compute it** in `computeChannelMetrics()` (`src/data/sqi-metrics.ts`) and add the field to the `ChannelMetrics` interface. Return `NaN` when it does not apply to a channel.
2. **Label it** in `SQI_COLUMNS` (`src/viewer/sqi-table.ts`): label, decimals, description and group. The scatter plot, the Stats tab and the PDF use these labels.
3. **Give it a TSV column** in `METRIC_COLUMNS` (`src/quality/metrics-tsv.ts`), in snake_case. The column order there is the TSV column order.
4. **Document it** in [REVIEW.md](REVIEW.md): what it computes, which channels it applies to, and its citation.
5. **Test it** in `src/data/__tests__/sqi-metrics.test.ts` with a synthetic signal of known value.
6. **Rerun the script** for every dataset. `parseQualityTsv` refuses a TSV that lacks a column listed in `METRIC_COLUMNS`, so old outputs stop loading until they are recomputed.

To remove a metric, delete it from the same places. The scatter plot and the Stats tab build their axes, tables and histograms from the metrics that have values in the TSV for each channel, so no plot code changes are needed either way.

To accept a new physio column name (e.g. a vendor-specific label), add it to `PHYSIO_CHANNELS` in `src/quality/channels.ts` with its signal type. Names are matched without case, separators or a trailing number. Columns that are not physiological belong in `NON_PHYSIO_CHANNELS`.

---

## Chart library usage

### Minimal example

```ts
import { createChart } from '@/core';

const chart = createChart({
  container: '#chart',           // CSS selector or HTMLElement
  xScale: { type: 'linear' },
  yScale: { type: 'linear' },
});
```

This creates an SVG with axes, margins, and resize handling. No data is rendered yet — that's the job of chart types that build on top.

### Focus+context with zoom, pan, and brush

```ts
import { createChart, createZoom, createBrush, cullToViewport, downsample } from '@/core';
import { line } from 'd3-shape';
import type { ScaleLinear } from 'd3-scale';

// Create focus chart (zoomable)
const focus = createChart({
  container: '#focus-chart',
  xScale: { type: 'linear', domain: [0, 10] },
  yScale: { type: 'linear', domain: [0, 1], nice: true },
  xAxis: { position: 'bottom', label: 'Time (s)' },
  yAxis: { position: 'left' },
  grid: { x: true, y: true },
  tooltip: { enabled: true },
  resize: { enabled: true },
});

// Create context chart (overview with brush)
const context = createChart({
  container: '#context-chart',
  height: 80,
  xScale: { type: 'linear', domain: [0, 10] },
  yScale: { type: 'linear', domain: [0, 1] },
  xAxis: { position: 'bottom', tickCount: 5 },
  yAxis: { position: 'left', hide: true },
  resize: { enabled: true },
});

// Draw line with viewport culling for performance
function drawFocusLine() {
  const { x, y } = focus.getScales();
  const xDomain = (x as ScaleLinear<number, number>).domain() as [number, number];
  const visible = cullToViewport(data, xDomain, (d) => d.time);
  // ... render visible slice
}

// Zoom on focus chart
const zoomHandle = createZoom(focus, {
  scaleExtent: [1, 100],
  onZoom(xDomain) {
    drawFocusLine();
    brushHandle.moveTo(xDomain);   // sync brush
  },
});

// Brush on context chart
const brushHandle = createBrush(context, {
  onBrush(selection) {
    if (!selection) return;
    zoomHandle.zoomToDomain(selection);  // sync zoom
    drawFocusLine();
  },
});
```

---

## API Reference

### `createChart(config)`

Creates and returns a `ChartInstance`.

#### `ChartConfig`

| Property | Type | Default | Description |
|---|---|---|---|
| `container` | `string \| HTMLElement` | — | **Required.** CSS selector or DOM element. |
| `width` | `number` | container width or `600` | Outer SVG width. |
| `height` | `number` | container height or `400` | Outer SVG height. |
| `margin` | `Partial<Margin>` | `{top:20, right:20, bottom:40, left:50}` | Merged with defaults. |
| `xScale` | `ScaleConfig` | — | **Required.** X-axis scale configuration. |
| `yScale` | `ScaleConfig` | — | **Required.** Y-axis scale configuration. |
| `xAxis` | `AxisConfig` | `undefined` | X-axis appearance. |
| `yAxis` | `AxisConfig` | `undefined` | Y-axis appearance. |
| `grid` | `GridConfig` | `undefined` | Grid line configuration. |
| `tooltip` | `TooltipConfig` | `undefined` | Tooltip configuration. |
| `resize` | `ResizeConfig` | `{ enabled: true }` | Responsive resize behavior. |

---

### `ChartInstance` (returned object)

| Method | Signature | Description |
|---|---|---|
| `update` | `(params?) => void` | Triggers the update pipeline. |
| `resize` | `(width?, height?) => void` | Recalculates dimensions, updates scales/axes/clip path. |
| `destroy` | `() => void` | Removes SVG, tooltip, disconnects observer, clears listeners. |
| `renderAxesAndGrid` | `() => void` | Re-renders axes and grid with current scale domains. |
| `getDimensions` | `() => Dimensions` | Returns current dimensions. |
| `getScales` | `() => { x, y }` | Returns current D3 scale objects. |
| `getLayers` | `() => ChartLayers` | Returns D3 selections for all SVG layer groups. |
| `getClipId` | `() => string` | Returns the clip path ID. |
| `getTooltip` | `() => TooltipInstance \| null` | Returns the tooltip controller. |
| `on` / `off` | `(event, callback) => void` | Subscribe/unsubscribe to chart events. |

---

### `createZoom(chart, config?)`

Attaches zoom/pan behavior. Returns a `ZoomHandle`.

| Config | Type | Default | Description |
|---|---|---|---|
| `scaleExtent` | `[number, number]` | `[1, 100]` | Min/max zoom scale. |
| `constrainToData` | `boolean` | `true` | Prevent panning beyond data bounds. |
| `doubleClickReset` | `boolean` | `true` | Double-click resets to full view. |
| `resetDuration` | `number` | `300` | Reset animation duration (ms). |
| `onZoom` | `(xDomain, transform) => void` | — | Called on every zoom/pan event. |

### `createBrush(chart, config?)`

Attaches a horizontal brush. Returns a `BrushHandle`.

| Config | Type | Default | Description |
|---|---|---|---|
| `selectionFill` | `string` | `'rgba(0,119,190,0.15)'` | Brush fill color. |
| `onBrush` | `(selection) => void` | — | Called when selection changes. |

### `cullToViewport(data, xDomain, accessor, buffer?)`

Binary-search slice of sorted data to the visible x-domain. O(log n).

### `downsample(data, maxPoints)`

Uniform stride downsampling. Keeps first and last points.

---

## SVG layer structure

```
<svg>
  <defs>
    <clipPath id="clip-..."><rect /></clipPath>
  </defs>
  <g transform="translate(margin.left, margin.top)">   <- root
    <g class="grid grid-x" />    <- xGrid
    <g class="grid grid-y" />    <- yGrid
    <g class="axis axis-x" />    <- xAxis
    <g class="axis axis-y" />    <- yAxis
    <g class="content"           <- content (clipped)
       clip-path="url(#clip-...)"/>
    <g class="overlay" />        <- overlay (zoom rect, brush, crosshairs)
  </g>
</svg>
```

---

## Event system

| Event | Fires when |
|---|---|
| `beforeUpdate` | `update()` called, before scales recalc |
| `afterUpdate` | After scales/axes/grid updated |
| `resize` | Container resized |
| `destroy` | `destroy()` called |
| `zoom` | Zoom/pan transform changes |
| `brushStart` / `brush` / `brushEnd` | Brush interaction lifecycle |

---

## Dependencies

Only individual D3 modules (no monolithic `d3` package):

`d3-selection`, `d3-scale`, `d3-axis`, `d3-shape`, `d3-array`, `d3-time`, `d3-time-format`, `d3-zoom`, `d3-brush`, `d3-transition`

Plus `@fontsource/ibm-plex-sans`, the page font, bundled so it works offline (imported in `src/shell/tabs.css`).

The BIDS version check (`server/bids-structure.ts`) needs no package: its rules are JSON files in `server/schema-rules/`, one per BIDS version, cut down from the official [BIDS schema](https://github.com/bids-standard/bids-schema) (`server/bids-rules.ts` describes the format). 1.8.0 and later are written by `scripts/update-bids-rules.ts` from each version's compiled `schema.json`; 1.6.0 and 1.7.0, which only have the schema's YAML sources, were converted once by hand into the same format, and older versions can be added the same way. `.github/workflows/bids-rules.yml` runs the script weekly and opens a pull request when a new BIDS release appears.

---

## TODO / Improvements

Research features and improvements. Publication readiness (license, packaging, docs, paper) is tracked separately in [docs/JOSS-TODO.md](docs/JOSS-TODO.md).

### Annotations (Tab 1)

- [ ] Port the annotation UI into the FastAPI + tabbed-shell architecture below once it lands (currently lives directly in the vanilla viewer, ahead of that work)
- [ ] Wire `trial_type == "fix"` annotations to export compact mask run-length intervals for the Artifact Correction tab: `{ channel, sampling_rate, n_samples, mask_intervals: [[start_sample, end_sample], ...] }`
- [ ] Handle different annotators so multiple people can annotate the same scan without overwriting each other:
  - Annotator registry in a PostgreSQL table (e.g. `annotators(id SERIAL, name TEXT UNIQUE, last_dataset, last_sub, last_ses, last_task, last_run, last_channel, updated_at)`); each annotator is assigned a number
  - Annotator enters their name on start → look up (or create) their row → viewer resumes at their last-viewed scan (replaces the current localStorage resume)
  - One annotation file per annotator, keyed by their number, e.g. `data/annotations/<dataset>/sub-XX/[ses-YY/]func/..._channel-C_annotator-NN_annotations.json`, with `annotator` stored in the JSON payload
- [ ] Stop annotation saves from overwriting each other — every change (time window added/removed, Signal Quality clicked, Notes typed) POSTs the whole file (`persistAnnotations`) with no queue, so two fast edits can land out of order and the older one wins. Notes are already debounced; ratings and windows are not
- [ ] Edit existing annotations — rename the label and drag the edges to adjust the range (currently add/delete only)
- [ ] Fixed label list — replace the free-text `window.prompt` with a set vocabulary (`fix`, `motion`, `noise`, …) so labels stay consistent across annotators
- [ ] Per-annotator progress — the dataset-wide count exists (`/api/bids/annotation-progress`, shown as "(n/N <channel> signals are annotated)"); split it per annotator once the annotator table above lands
- [ ] Show which channel the Signal Quality and Notes apply to inside the Annotations box (they are saved per channel; the box no longer names it, only the focus chart's y-axis and the progress line do)
- [ ] Use the full-recording Signal Quality ratings: a Colour by choice in the scatter plot, the rating on the Stats tab, and a column in the PDF
- [ ] Cache the annotation progress count — the endpoint reads every scan's annotation file on each request; fine for 80 scans, slow for thousands. Keep counts in memory and update them on each POST

### Planned: FastAPI backend + 3-tab shell

- [ ] Scaffold FastAPI backend service (shared backend for tabs 2 & 3)
- [ ] Add tabbed navigation shell: Visualization & Annotation / Summary Statistics / Artifact Correction
- [ ] Tab 2 — Summary Statistics: new (non-SQI) computation + API contract, generation endpoint, interactive scatter/bar plots. The dataset-wide SQI part now exists as `quality.html` (see Quality metrics below), served as static files without a backend; fold it into the tab shell when that lands
- [ ] Tab 3 — Artifact Correction: wrap the existing correction model in an endpoint; brush a window → request fix → visualize before/after signal
- [ ] Tests for tabs 2 & 3

### Performance & data pipeline

- [ ] Downsample focus-chart line rendering — currently draws every raw sample in the visible domain (1M+ points at full zoom-out for 1000–5000 Hz recordings); only the context chart is downsampled today. Needs a min/max-per-bucket downsampler (a naive stride, like `viewportCulling.ts` uses now, would clip cardiac spikes), targeting ~2-4k rendered points at any zoom level. `minMaxEnvelope()` in `src/quality/envelope.ts` already does this for the quality page's waveforms
- [ ] Cache parsed physio/confounds reads server-side — `server/bids-physio-plugin.ts` re-parses (sync gunzip + full TSV parse) on every request, even when revisiting a scan just seen; add an in-memory cache keyed by sub/ses/task/run. Also prefetch the next scan while the current one is viewed, so Next is served from memory
- [ ] Moving to the next file is slow (unacceptable latency). Not timed yet: first check `/api/bids/physio` in the browser Network tab (Waiting (TTFB) = server time, Size / Content download = JSON cost) and the Performance tab for the chart drawing. Suggested fixes, biggest effect first:
  - Send physio samples as binary (`Float32Array`, about 4 bytes per value, no parsing) instead of JSON number arrays, which are likely tens of MB per scan at 1000–5000 Hz and parsed in full by the browser (`fetchPhysioRaw`)
  - Keep columns as typed arrays in the viewer instead of one `{time, value}` object per sample, built again for each stacked channel (`toDataPoints`, `src/viewer/charts/stack.ts`)
  - Server cache and prefetch (item above) and focus-chart downsampling (first item in this section)
  - Read the confounds file once per scan: `readPhysio` reads and unzips it to count volumes when the BOLD sidecar has no `VolumeTiming` (`countConfoundVolumes`), then `readConfounds` reads it again (`server/bids-layout.ts`)
  - Start the data fetch without waiting for the tasks and runs requests in `goToScan` (`src/viewer/main.ts`), which are two round trips before it today
- [ ] Support custom signals those computations by convolving physiological response functions (Birn et al. 2006/2008 respiration-BOLD, Chang & Glover 2009 cardiac/respiratory response functions)
- [ ] Production build, the server plugin only works in Vite dev mode; the FastAPI backend planned above should supersede this, otherwise would need an Express/Fastify server for production. That server must also serve `data/quality/` for the quality page

### Stats, scatter plot and PDF

- [ ] Split the PDF's per-scan metrics table per channel (`src/quality/report.ts`, scan pages), as the Stats tab already does, so it has no empty cells for metrics that belong to another channel
- [ ] Move `src/viewer/sqi-table.ts` to `src/quality/` under a clearer name (e.g. `metric-columns.ts`): it now only holds the metric labels, groups and number format used by the scatter plot, the Stats tab and the PDF
- [ ] Optional group toggle in "Metrics shown": the group headings are fixed now, so Show all / Hide all are the only bulk controls

### Events, peaks and confounds

- [ ] Peaks (trial): decide whether it stays. If it does, check the timing on movie10 (the dots should sit on the peaks; if they are offset, the peaks file's onsets need the physio `StartTime`), drop the TRIAL labels, and test `drawPeaks`
- [ ] Events from `physprep/` are ignored for the events chart (only the imaging folders are read); decide whether physprep task events should be offered when the imaging folder has none
### On disk data summary and the run log

- [ ] The downloaded count is made once when the dev server starts, so files fetched with `datalad get` while it runs only show after a restart; recount on request (it is fast with git-annex) or add a refresh
- [ ] `scans_available` in `quality_runs.tsv` counts physio files; a dataset with more than one physio file per scan would show too many as "not downloaded"
- [ ] The Stats PDF report still uses Helvetica (`src/quality/report.ts`); embed IBM Plex Sans so it matches the pages
- [ ] BIDS version check: fix the two wrong expectations in `server/__tests__/bids-structure.test.ts` (`parseBidsName('sub-01_task')` is a valid name; the fixtures' `*_desc-quality.json` files are reported as "not a BIDS file name", not as a bad suffix)
- [ ] BIDS version check: run it on the real datasets and in the dev server; decide whether known non-BIDS files such as `*_desc-quality.json` should be skipped instead of reported
- [ ] BIDS version check: add hand-written rules for versions before 1.6.0 if a source for them is found (same format as `server/schema-rules/`)
- [ ] Run `.github/workflows/bids-rules.yml` once by hand (workflow_dispatch) to confirm it opens a pull request only when a new BIDS release exists

### Docs and user study

- [ ] Retake `docs/physviz.gif` (README) and the images in `user_facing/` and the paper for the current layout: On disk data summary under the Annotations box, the INTERACTIVE QUALITY ASSESSMENT TOOL title, the events chart, the scatter legend to the right and IBM Plex Sans
- [ ] Add user-study tasks for the events chart and the On disk data summary (`docs/user-study.md`)
### BIDS discovery (bottom-up)

- [ ] Find files bottom-up instead of assuming fixed paths under `BIDS_ROOT` (today: `<root>/sub-XX/[ses-YY/]func/` and sidecars at three fixed spots; `resolveBidsRoots` finds the physio folder inside `BIDS_ROOT` and the derivatives inside `BIDS_ROOT/derivatives/` by their files, and `BIDSPHYS_ROOT` / `BIDSDER_ROOT` cover folders stored elsewhere):
  - Walk the given folder once at server start (skip hidden folders like `.git`, `.datalad`) and index every `*_physio.tsv.gz` (readable only), `*physio.json`, `*_desc-quality.json`, `*_bold.json`, `*_desc-confounds_timeseries.tsv[.gz]` and `dataset_description.json`
  - Take sub/ses/task/run from each file's name, not its folder, so files are found wherever they sit (extra levels, no `func/`)
  - Sidecars by BIDS inheritance: a sidecar applies if it sits in the data file's folder or above and its entities are a subset of the file's; nearer/more specific wins, values merged
  - Confounds and BOLD timing matched on sub/ses/task/run (run numeric) anywhere in the index; `BIDSDER_ROOT` becomes optional and `resolveBidsRoots` goes away
  - Raw dataset info from the `dataset_description.json` nearest above the physio files, derivatives info from the one above the confounds
  - Same function signatures and API outputs, so the viewer, Stats tab and metrics script don't change
  - Defaults to confirm: same scan with raw and `desc-preproc` physio → prefer preprocessed; search only inside the given folder (no sibling folders)- [ ] Tests for it (`server/__tests__/bids-discovery.test.ts`, temp-folder datasets, never `data/`): CNeuroMod layout given by its parent folder; physio outside `func/` and extra nesting; sidecar inheritance (subject, session, run-less, top-level; most specific wins, merged); numeric run matching and mixed run/run-less; broken symlinks and hidden folders skipped; a root without physio returns no scans instead of crashing; existing fixture and real-dataset tests still pass

### Testing

- [ ] Page-level tests under jsdom for the wiring in `src/viewer/main.ts` and `src/quality/main.ts`: Signal Quality buttons toggle and save, Notes save on blur and never to another scan, the progress line updates after a save, Metrics shown redraws without moving the page, Colour by hides when the dataset has nothing to colour by, the Stats tab and scatter plot stay hidden without quality metrics, the viewed scan's point is highlighted (needs `jsdom`, same as the chart-core tests in docs/JOSS-TODO.md)
- [ ] Add a test suite that runs against every existing dataset under `data/` (`ds000210`, `ds004662`, `ds006644`, `movie10`, `friends`): subject/session/task/run discovery, physio + confounds reads, scan-onset timing, dataset info, and annotation path resolution (dataset name, `func/` layout). Skip a dataset gracefully when its files aren't downloaded. `server/__tests__/bids-layout.test.ts` already covers `ds006644` and `ds000210`; `movie10` and `friends` (raw data in `physprep/`) and `ds004662` (task events, MRIQC confounds via `BIDSDER_ROOT=data/ds004662/ds004662-mriqc`) are still missing
