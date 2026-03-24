import type { TooltipConfig, TooltipInstance } from './types';

export function createTooltip(config?: TooltipConfig): TooltipInstance | null {
  if (config?.enabled === false) return null;

  const className = config?.className ?? 'chart-tooltip';
  const offset = config?.offset ?? { x: 12, y: -28 };

  const el = document.createElement('div');
  el.className = className;
  Object.assign(el.style, {
    position: 'absolute',
    pointerEvents: 'none',
    background: 'rgba(0, 0, 0, 0.8)',
    color: 'white',
    padding: '6px 8px',
    fontSize: '12px',
    borderRadius: '4px',
    lineHeight: '1.3',
    visibility: 'hidden',
    whiteSpace: 'nowrap',
    zIndex: '1000',
  } as CSSStyleDeclaration);
  document.body.appendChild(el);

  return {
    show(content: string, x: number, y: number) {
      el.innerHTML = content;
      el.style.visibility = 'visible';
      el.style.left = `${x + offset.x}px`;
      el.style.top = `${y + offset.y}px`;
    },
    hide() {
      el.style.visibility = 'hidden';
    },
    move(x: number, y: number) {
      el.style.left = `${x + offset.x}px`;
      el.style.top = `${y + offset.y}px`;
    },
    destroy() {
      el.remove();
    },
  };
}
