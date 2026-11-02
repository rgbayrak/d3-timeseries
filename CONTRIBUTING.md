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
npm run build      # tsc + vite build
```

### Tests

Tests run against two tiny synthetic BIDS datasets in `test/fixtures/` (sessions/runs with fMRIPrep-style derivatives, and a session-less layout), so they need no downloaded data. They cover every timing badge, sidecar fallbacks, confounds, annotations and path safety. Regenerate the fixtures after changing them with:

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

Annotations are written as JSON files under `ANNOTATIONS_ROOT` (env var, default `data/annotations/` in the project root), one file per `{sub, ses, task, run, channel}`, mirroring the `sub-XX/ses-XX/` BIDS directory structure.

How the server and viewer line up physio, confounds and triggers in time is described in the README under [Timing alignment](README.md#timing-alignment).

### Design principles

- **Composition over inheritance** — chart types call `createChart()`, hook events, draw into `layers.content`, and return an extended instance.
- **Base does NOT set domains from data** — chart types compute their own domains.
- **Individual D3 modules** — `d3-scale`, `d3-axis`, `d3-selection`, etc. for tree-shaking. No monolithic `d3` import.
- **Functional factory pattern** — no classes, composable, idiomatic D3.
- **No component framework (Vue/React)** — vanilla D3+TS holds up as long as state stays centralized (a single object for current scan/selection/annotations) and render functions stay pure/redraw-from-state. Revisit only if hand-rolled DOM diff/patch logic becomes unavoidable, not because of codebase size alone.

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
- [x] Block unsafe file paths in the annotations endpoint — `validateScanKey` in `server/bids-layout.ts` rejects non-alphanumeric BIDS labels and channel names with path characters; every endpoint returns 400, and `annotationsFilePath` refuses them too
- [ ] Stop annotation saves from overwriting each other — every add/remove POSTs the whole file (`persistAnnotations`) with no queueing or debounce, so two fast edits can land out of order and the older one wins
- [ ] Edit existing annotations — rename the label and drag the edges to adjust the range (currently add/delete only)
- [ ] Fixed label list — replace the free-text `window.prompt` with a set vocabulary (`fix`, `motion`, `noise`, …) so labels stay consistent across annotators
- [ ] Annotation progress — track which scans each annotator has marked done (ties into the annotator table above)

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
- [ ] Production build, the server plugin only works in Vite dev mode; the FastAPI backend planned above should supersede this, otherwise would need an Express/Fastify server for production

### Viewer UX

- [ ] Improve the y-axis by reducing the number of ticks when it gets crowded

### SQI metrics

- [ ] Export SQI metric calculations as TSV

### Testing

- [ ] Add a test suite that runs against every existing dataset under `data/` (`ds000210`, `ds006644`, `movie10`, `shinobi`): subject/session/task/run discovery, physio + confounds reads, scan-onset timing, dataset info, and annotation path resolution (dataset name, `func/` layout). Skip a dataset gracefully when its files aren't downloaded
