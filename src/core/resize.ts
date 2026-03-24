import type { ResizeConfig, ResizeHandle } from './types';

export function createResizeObserver(
  container: HTMLElement,
  config: ResizeConfig | undefined,
  onResize: (width: number) => void,
): ResizeHandle {
  const enabled = config?.enabled ?? true;
  const debounceMs = config?.debounceMs ?? 150;
  const minWidth = config?.minWidth ?? 100;

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastWidth = 0;

  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const w = Math.max(minWidth, entry.contentRect.width);

      // Only fire if width actually changed — avoids feedback loops
      // from the SVG's own height affecting container height
      if (w === lastWidth) continue;
      lastWidth = w;

      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => onResize(w), debounceMs);
    }
  });

  return {
    observe() {
      if (enabled) observer.observe(container);
    },
    disconnect() {
      if (timeoutId) clearTimeout(timeoutId);
      observer.disconnect();
    },
  };
}
