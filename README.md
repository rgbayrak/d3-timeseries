# d3-ts-library

A reusable, composable chart library built on [D3](https://d3js.org/) and TypeScript. It provides a `createChart` factory function that sets up the full SVG scaffold — margins, scales, axes, grid, clip path, tooltip, resize handling, and an event system — so chart types can plug into it and focus solely on rendering data marks.

Includes built-in **zoom/pan** (`d3-zoom`), **brush selection** (`d3-brush`), **viewport culling** for performance, and a **focus+context** two-chart layout for exploring dense time-series signals.

## Quick start

```bash
npm install
npm run dev        # Vite dev server with hot reload
```

Open the URL Vite prints (usually `http://localhost:5173`). The app loads a BIDS physiology dataset and presents an interactive viewer with:

- **Controls** — Subject, Session, Task, and Channel dropdowns; Prev/Next buttons to step through scans in hierarchy order; search bar accepting `sub-03` or `ses-012` style input
- **Filename display** — shows the exact `.tsv.gz` file being viewed
- **Quality badges** — per-channel pass/fail indicators when a `_desc-quality.json` sidecar is present
- **Focus chart** (top) — zoom with scroll wheel, pan with click-drag, hover for data readout
- **Context chart** (bottom) — drag the brush to navigate; handles resize the viewport
- **Confounds chart** — framewise displacement (FD) from fMRIPrep, color-coded by severity (green/amber/red) with 0.2 mm and 0.5 mm reference lines
- **Z-Score toggle** — normalize the displayed channel to zero-mean / unit-variance
- **SQI table** — on-demand per-channel signal quality metrics (mean, std dev, SNR, kurtosis, skewness, zero-crossing rate, etc.)

### Other commands

```bash
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
└── bids-physio-plugin.ts   # Vite dev server plugin (BIDS file reader API)
```

### Data pipeline

```
BIDS dataset on disk
  ↓  server/bids-physio-plugin.ts (Node.js, runs inside Vite dev server)
  ↓  Reads .json sidecar + decompresses .tsv.gz
  ↓  Returns compact column-array JSON via /api/bids/* endpoints
  ↓
Browser (src/data/bids-physio-reader.ts)
  ↓  fetchSubjects(), fetchScans(), fetchTasks(), fetchPhysioRaw(), fetchConfounds()
  ↓  toDataPoints() / toFDPoints() materialize {time, value}[] arrays
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
| `GET /api/bids/scans` | Flat list of every readable `{sub, ses, task}` in hierarchy order |
| `GET /api/bids/tasks?sub=&ses=` | Tasks available for a given subject/session |
| `GET /api/bids/physio?sub=&ses=&task=` | Physio data as compact column arrays |
| `GET /api/bids/confounds?sub=&ses=&task=` | Framewise displacement from fMRIPrep confounds TSV |

The server skips broken symlinks (e.g. DataLad/git-annex files that haven't been fetched) using `accessSync(R_OK)`.

Confounds are read from the derivatives root (`BIDSDER_ROOT` env var or the fallback path in the plugin). The server looks for `*_desc-confounds_timeseries.tsv` and extracts the `framewise_displacement` column.

### Switching datasets

Set the `BIDS_ROOT` environment variable, or change the fallback path in `server/bids-physio-plugin.ts`. The server auto-discovers subjects, sessions, and tasks from the directory structure.

```bash
BIDS_ROOT=/path/to/your/dataset BIDSDER_ROOT=/path/to/derivatives npm run dev
```

Requirements:

- Standard BIDS layout: `sub-XX/ses-XX/func/*_physio.tsv.gz`
- JSON sidecar with `SamplingFrequency`, `StartTime`, `Columns` (per-file or top-level)
- TSV can have a header row (auto-detected and skipped)

### Design principles

- **Composition over inheritance** — chart types call `createChart()`, hook events, draw into `layers.content`, and return an extended instance.
- **Base does NOT set domains from data** — chart types compute their own domains.
- **Individual D3 modules** — `d3-scale`, `d3-axis`, `d3-selection`, etc. for tree-shaking. No monolithic `d3` import.
- **Functional factory pattern** — no classes, composable, idiomatic D3.

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

- [ ] Add LTTB (Largest Triangle Three Buckets) downsampling as alternative to stride-based
- [ ] Keyboard shortcuts for Prev/Next navigation (arrow keys)
- [ ] Support `run-` entity in filenames for datasets with repeated tasks
- [ ] Production build — the server plugin only works in Vite dev mode; would need an Express/Fastify server for production
- [ ] Add unit tests for `bids-physio-reader.ts` extent/conversion functions
- [ ] Persist last-viewed scan in localStorage so reloads resume where you left off
- [ ] Implement physiological response functions: Birn et al. 2006/2008 (respiration effects on BOLD), Chang & Glover 2009 (cardiac/respiratory response functions)
- [ ] Export SQI metric calculations as TSV
- [ ] Add metrics from physioqc ([PR #44](https://github.com/physiopy/physioqc/pull/44)): Elgendi 2016 windowed kurtosis + approximate entropy (cardiac/PPG), Romano 2023 per-beat/breath correlation SQI (cardiac + respiratory)
- [ ] enable channel selection and when certain ones selected, visuzalize them in a vertical stack as new figures
- [ ] make zooming interaction happen on the main figures (both channel views and FD)
- [ ] create a new tab add interactive summary scatter plots for summary sqi-metric (e.g. all sqi is shown for ppg in one color, rsp in another) 
- ALWAYS 
  - clean up spurious code, update readme
  - explain the whole structure and walk me through each function