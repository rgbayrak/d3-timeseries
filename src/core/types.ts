import type { Selection } from 'd3-selection';
import type { ScaleTime, ScaleLinear, ScaleBand, ScaleOrdinal, ScaleLogarithmic, ScalePower } from 'd3-scale';
import type { ZoomTransform } from 'd3-zoom';

// ── Geometry ──────────────────────────────────────────────

export interface Margin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Dimensions {
  outerWidth: number;
  outerHeight: number;
  innerWidth: number;
  innerHeight: number;
  margin: Margin;
}

// ── Scales ────────────────────────────────────────────────

export type ScaleType = 'time' | 'linear' | 'band' | 'ordinal' | 'log' | 'sqrt';

export interface ScaleConfig {
  type: ScaleType;
  domain?: unknown[];
  nice?: boolean;
  clamp?: boolean;
  padding?: number; // for band scales
}

export type AnyScale =
  | ScaleTime<number, number>
  | ScaleLinear<number, number>
  | ScaleBand<string>
  | ScaleOrdinal<string, number>
  | ScaleLogarithmic<number, number>
  | ScalePower<number, number>;

// ── Axes ──────────────────────────────────────────────────

export type AxisPosition = 'top' | 'right' | 'bottom' | 'left';

export interface AxisConfig {
  position: AxisPosition;
  tickCount?: number;
  tickFormat?: (d: unknown) => string;
  label?: string;
  hide?: boolean;
}

// ── Grid ──────────────────────────────────────────────────

export interface GridLineStyle {
  strokeColor?: string;
  opacity?: number;
  dasharray?: string;
}

export interface GridConfig {
  x?: boolean | GridLineStyle;
  y?: boolean | GridLineStyle;
}

// ── Tooltip ───────────────────────────────────────────────

export interface TooltipConfig {
  enabled?: boolean;
  className?: string;
  offset?: { x: number; y: number };
  render?: (data: unknown) => string;
}

export interface TooltipInstance {
  show: (content: string, x: number, y: number) => void;
  hide: () => void;
  move: (x: number, y: number) => void;
  destroy: () => void;
}

// ── Resize ────────────────────────────────────────────────

export interface ResizeConfig {
  enabled?: boolean;
  debounceMs?: number;
  minWidth?: number;
  minHeight?: number;
}

export interface ResizeHandle {
  observe: () => void;
  disconnect: () => void;
}

// ── Zoom ─────────────────────────────────────────────────

export interface ZoomConfig {
  scaleExtent?: [number, number];   // default [1, 100]
  constrainToData?: boolean;        // default true — can't pan beyond data
  doubleClickReset?: boolean;       // default true
  resetDuration?: number;           // animation ms, default 300
  onZoom?: (xDomain: [number, number], transform: ZoomTransform) => void;
}

export interface ZoomHandle {
  zoomToDomain: (domain: [number, number], animate?: boolean) => void;
  reset: (animate?: boolean) => void;
  getTransform: () => ZoomTransform;
  getZoomRect: () => Selection<SVGRectElement, unknown, null, undefined>;
  destroy: () => void;
}

// ── Brush ────────────────────────────────────────────────

export interface BrushConfig {
  selectionFill?: string;  // default 'rgba(0,119,190,0.15)'
  onBrush?: (selection: [number, number] | null) => void;
}

export interface BrushHandle {
  moveTo: (domain: [number, number]) => void;
  clear: () => void;
  getSelection: () => [number, number] | null;
  destroy: () => void;
}

// ── Event system ──────────────────────────────────────────

export type ChartEvent = 'beforeUpdate' | 'afterUpdate' | 'resize' | 'destroy' | 'zoom' | 'brushStart' | 'brush' | 'brushEnd';

export type ChartEventCallback = (data?: unknown) => void;

// ── SVG Layers ────────────────────────────────────────────

type SVGGSelection = Selection<SVGGElement, unknown, null, undefined>;
type SVGSVGSelection = Selection<SVGSVGElement, unknown, null, undefined>;

export interface ChartLayers {
  svg: SVGSVGSelection;
  root: SVGGSelection;
  defs: Selection<SVGDefsElement, unknown, null, undefined>;
  xGrid: SVGGSelection;
  yGrid: SVGGSelection;
  xAxis: SVGGSelection;
  yAxis: SVGGSelection;
  content: SVGGSelection;
  overlay: SVGGSelection;
}

// ── Chart config ──────────────────────────────────────────

export interface ChartConfig {
  container: string | HTMLElement;
  width?: number;
  height?: number;
  margin?: Partial<Margin>;
  xScale: ScaleConfig;
  yScale: ScaleConfig;
  xAxis?: AxisConfig;
  yAxis?: AxisConfig;
  grid?: GridConfig;
  tooltip?: TooltipConfig;
  resize?: ResizeConfig;
}

// ── Chart instance ────────────────────────────────────────

export interface ChartInstance {
  update: (params?: { data?: unknown; config?: Partial<ChartConfig> }) => void;
  resize: (width?: number, height?: number) => void;
  destroy: () => void;
  renderAxesAndGrid: () => void;
  getDimensions: () => Dimensions;
  getScales: () => { x: AnyScale; y: AnyScale };
  getLayers: () => ChartLayers;
  getClipId: () => string;
  getTooltip: () => TooltipInstance | null;
  on: (event: ChartEvent, callback: ChartEventCallback) => void;
  off: (event: ChartEvent, callback: ChartEventCallback) => void;
}
