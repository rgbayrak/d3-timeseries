# d3-ts-library

A reusable, composable chart library built on [D3](https://d3js.org/) and TypeScript. It provides a `createChart` factory function that sets up the full SVG scaffold — margins, scales, axes, grid, clip path, tooltip, resize handling, and an event system — so chart types can plug into it and focus solely on rendering data marks.

Includes built-in **zoom/pan** (`d3-zoom`), **brush selection** (`d3-brush`), **viewport culling** for performance, and a **focus+context** two-chart layout for exploring dense time-series signals.

## Quick start

```bash
npm install
npm run dev        # Vite dev server with hot reload
```

### Getting the data

```bash
brew install git-annex
uv tool install datalad
datalad install -s https://github.com/OpenNeuroDatasets/ds006644.git data/ds006644
cd data/ds006644
datalad get sub-*/ses-*/func/*_physio.*
datalad get derivatives/fmriprep/sub-*/ses-*/func/*_desc-confounds_timeseries.*
```

Optional: `git annex adjust --unlock` checks files out as regular files instead of symlinks. The viewer doesn't need it, but it helps with tools that don't follow symlinks.

Open the URL Vite prints (usually `http://localhost:5173`). The app loads a BIDS physiology dataset and presents an interactive viewer with:

- **Controls** — three rows: Subject, Session, Task, Run (when present), Channel and Confound (when derivatives exist) dropdowns; Prev/Next buttons (or ←/→ keys) to step through scans in hierarchy order plus a search bar accepting `sub-03` or `ses-012` style input; Compute SQI and Annotate buttons
- **Dataset info** — name, authors, BIDS version, license, DOI link and derivatives pipeline/version, read from the dataset's own `dataset_description.json` (raw and derivatives); fields that are missing are skipped
- **Filename display** — shows the exact `.tsv.gz` file being viewed
- **Badges** — a timing badge (see [Timing alignment](#timing-alignment)) and per-channel pass/fail quality indicators when a `_desc-quality.json` sidecar is present (run-level, e.g. `*_run-01_desc-quality.json`, or run-less)
- **Focus chart** (top) — drag to brush-select a time window (zooms on release), double-click to reset, auto-fits Y-axis to visible data; hover for data readout
- **Context chart** (bottom) — drag the brush to navigate; handles resize the viewport
- **Confounds chart** — pick a motion confound from the Confound dropdown (shown only when fMRIPrep derivatives exist); FD is color-coded by severity (green/amber/red) with 0.2 mm and 0.5 mm reference lines
- **Channel persistence** — selected channel is preserved when stepping through scans with Prev/Next
- **SQI table** — on-demand per-channel signal quality metrics (mean, std dev, SNR, kurtosis, skewness, zero-crossing rate, etc.)
- **Annotations** — toggle Annotate mode, drag on the focus chart to mark and label a time window; annotations persist to disk per `{sub, ses, task, run, channel}` and reload automatically when you return to that scan

### Other commands

```bash
npm test           # vitest run (all tests)
npm run test:watch # vitest in watch mode
npm run typecheck  # tsc --noEmit (strict, no output)
npm run build      # tsc + vite build
```

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
├── demos/
│   └── bids-physio-viewer.ts  # Interactive physio signal viewer
├── utils/
│   ├── uid.ts              # Unique ID generator
│   ├── margin.ts           # Margin defaults/merge
│   ├── dom.ts              # Container resolution
│   └── index.ts            # Barrel export
└── main.ts                 # Entry point (loads bids-physio-viewer)

server/
├── bids-layout.ts          # Pure BIDS filesystem logic (testable, no Vite dependency)
└── bids-physio-plugin.ts   # Thin Vite plugin wrapper importing from bids-layout
```

### Data pipeline

```
BIDS dataset on disk
  ↓  server/bids-physio-plugin.ts (Node.js, runs inside Vite dev server)
  ↓  Reads .json sidecar + decompresses .tsv.gz
  ↓  Returns compact column-array JSON via /api/bids/* endpoints
  ↓
Browser (src/data/bids-physio-reader.ts)
  ↓  fetchDatasetInfo(), fetchSubjects(), fetchScans(), fetchTasks(), fetchRuns(), fetchPhysioRaw(), fetchConfounds()
  ↓  toDataPoints() / toConfoundPoints() materialize {time, value}[] arrays
  ↓
SQI (src/data/sqi-metrics.ts)
  ↓  computeSQI() — per-channel stats (mean, std, SNR, kurtosis, skewness, ZCR)
  ↓
Viewer (src/demos/bids-physio-viewer.ts)
  ↓  Builds focus+context+confounds charts, wires zoom/brush/hover
```

### Server API endpoints

| Endpoint | Description |
|---|---|
| `GET /api/bids/subjects` | All subjects with their sessions (only those with readable physio files) |
| `GET /api/bids/dataset` | Dataset metadata from `dataset_description.json` (raw + derivatives `GeneratedBy`) |
| `GET /api/bids/scans` | Flat list of every readable `{sub, ses, task, run}` in hierarchy order |
| `GET /api/bids/tasks?sub=&ses=` | Tasks available for a given subject/session |
| `GET /api/bids/runs?sub=&ses=&task=` | Runs available for a given subject/session/task |
| `GET /api/bids/physio?sub=&ses=&task=&run=` | Physio data as compact column arrays, plus the timing check result (`timing`) |
| `GET /api/bids/confounds?sub=&ses=&task=&run=` | Motion confounds (FD, RMSD, DVARS, trans/rot) from fMRIPrep confounds TSV |
| `GET /api/bids/annotations?sub=&ses=&task=&run=&channel=` | Stored annotations for a scan/channel, if any |
| `POST /api/bids/annotations` | Saves (overwrites) annotations for a scan/channel |

The server skips broken symlinks (e.g. DataLad/git-annex files that haven't been fetched) using `accessSync(R_OK)`.

Confounds are read from the derivatives root (`BIDSDER_ROOT` env var, default `$BIDS_ROOT/derivatives/fmriprep`). The server looks for `*_desc-confounds_timeseries.tsv[.gz]` and extracts the motion columns (`framewise_displacement`, `rmsd`, `dvars`, `std_dvars`, `trans_*`, `rot_*`); the **Confound** dropdown picks which one to plot and only appears when a confounds file is found.

### Timing alignment

All charts share one time axis: **t = 0 is scan onset**, the start of acquisition of the first BOLD volume. All charts start at t = 0, and their x-axis reads "Time from scan onset (s)". Physio recorded before the scan (negative times) is out of view. A dashed purple **scan onset (t = 0)** marker marks the start.

- **Physio.** The physio sidecar's `StartTime` is the reference. Per BIDS, it is the time of the first physio sample relative to the first volume, so sample *i* sits at `StartTime + i / SamplingFrequency`. It is often negative because recording starts before the scan.
- **Confounds.** fMRIPrep writes one confounds row per volume. Volume *i* sits at `VolumeTiming[i]`, or `i × RepetitionTime` if there is no `VolumeTiming`. The server looks for these in the raw BOLD sidecar (scan-level, then top-level `task-<task>_bold.json`), then in the derivatives' BOLD sidecars. If none of them has timing, volumes are spread evenly across the physio recording. That fallback is only approximate.
- **Trigger check.** If the physio file has a `trigger` channel, the server detects its pulses (rising edges at the midpoint of the channel's range) and checks them against the sidecar timing. Triggers are a cross-check, not the reference: the first pulse is not assumed to be the first volume, because dummy scans, dropped pulses or recording delays can break that.

The **Timing** badge above the chart shows the result. Hover over it to see the details.

| Badge | Condition | What the viewer does |
|---|---|---|
| trigger-verified (green) | Every pulse interval is within 5% of TR, pulse count equals volume count, and the first pulse lands at t = 0 (within 5% of TR) | Uses `StartTime` as-is |
| corrected from triggers (amber) | Pulses are clean (spacing and count match) but the first pulse is off from t = 0 | Shifts the physio axis so the first pulse is at t = 0 |
| triggers disagree (red) | Some intervals differ from TR, or the pulse count doesn't match the volume count | Uses `StartTime` as-is and flags the scan for review |
| sidecar only (amber) | No trigger channel or pulses, or no BOLD TR to check against | Uses `StartTime` as-is, unverified |

In ds006644, 79 of 80 scans are trigger-verified. sub-18 ses-02 is flagged red: 21 of its pulse intervals differ from TR, the first being 0.704 s against 1.8 s.

Annotations are written as JSON files under `ANNOTATIONS_ROOT` (env var, default `data/annotations/` in the project root), one file per `{sub, ses, task, run, channel}`, mirroring the `sub-XX/ses-XX/` BIDS directory structure.

### Switching datasets

`BIDS_ROOT` defaults to `data/ds006644` in the project root; set it to use another dataset. The server auto-discovers subjects, sessions, tasks, and runs from the directory structure.

```bash
BIDS_ROOT=/path/to/your/dataset BIDSDER_ROOT=/path/to/derivatives npm run dev
```

Requirements:

- Standard BIDS layout: `sub-XX/ses-XX/func/*_physio.tsv.gz` or session-less `sub-XX/func/*_physio.tsv.gz`
- JSON sidecar with `SamplingFrequency`, `StartTime`, `Columns` (per-file or top-level)
- TSV can have a header row (auto-detected and skipped)
- For confound timing: a BOLD sidecar with `VolumeTiming` or `RepetitionTime` (raw scan-level, top-level `task-<task>_bold.json`, or derivatives)
- Run labels are compared as numbers between raw and derivatives, so `run-01` matches `run-1`

### Design principles

- **Composition over inheritance** — chart types call `createChart()`, hook events, draw into `layers.content`, and return an extended instance.
- **Base does NOT set domains from data** — chart types compute their own domains.
- **Individual D3 modules** — `d3-scale`, `d3-axis`, `d3-selection`, etc. for tree-shaking. No monolithic `d3` import.
- **Functional factory pattern** — no classes, composable, idiomatic D3.
- **No component framework (Vue/React)** — vanilla D3+TS holds up as long as state stays centralized (a single object for current scan/selection/annotations) and render functions stay pure/redraw-from-state. Revisit only if hand-rolled DOM diff/patch logic becomes unavoidable, not because of codebase size alone.

---

## Usage

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

---

## TODO / Improvements

### Annotations (Tab 1)

- [ ] Port the annotation UI into the FastAPI + tabbed-shell architecture below once it lands (currently lives directly in the vanilla viewer, ahead of that work)
- [ ] Wire `trial_type == "fix"` annotations to export compact mask run-length intervals for the Artifact Correction tab: `{ channel, sampling_rate, n_samples, mask_intervals: [[start_sample, end_sample], ...] }`

### Planned: FastAPI backend + 3-tab shell

- [ ] Scaffold FastAPI backend service (shared backend for tabs 2 & 3)
- [ ] Add tabbed navigation shell: Visualization & Annotation / Summary Statistics / Artifact Correction
- [ ] Tab 2 — Summary Statistics: new (non-SQI) computation + API contract, generation endpoint, interactive scatter/bar plots
- [ ] Tab 3 — Artifact Correction: wrap the existing correction model in an endpoint; brush a window → request fix → visualize before/after signal
- [ ] Tests for tabs 2 & 3

### Performance & data pipeline

- [ ] Downsample focus-chart line rendering — currently draws every raw sample in the visible domain (1M+ points at full zoom-out for 1000–5000 Hz recordings); only the context chart is downsampled today. Needs a min/max-per-bucket downsampler (a naive stride, like `viewportCulling.ts` uses now, would clip cardiac spikes), targeting ~2-4k rendered points at any zoom level
- [ ] Cache parsed physio/confounds reads server-side — `server/bids-physio-plugin.ts` re-parses (sync gunzip + full TSV parse) on every request, even when revisiting a scan just seen; add an in-memory cache keyed by sub/ses/task/run
- [ ] Support custom signals those computations by convolving physiological response functions (Birn et al. 2006/2008 respiration-BOLD, Chang & Glover 2009 cardiac/respiratory response functions)
- [ ] Production build — the server plugin only works in Vite dev mode; the FastAPI backend planned above should supersede this, otherwise would need an Express/Fastify server for production

### Viewer UX

- [ ] Persist last-viewed scan in localStorage so reloads resume where you left off
- [ ] Enable channel selection to visualize selected channels in a vertical stack as new figures

### SQI metrics

- [ ] Export SQI metric calculations as TSV