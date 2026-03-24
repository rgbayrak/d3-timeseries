let count = 0;

export function uid(prefix = 'uid'): string {
  return `${prefix}-${++count}-${Math.random().toString(36).slice(2, 8)}`;
}
