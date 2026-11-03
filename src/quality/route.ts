import type { ScanKeyLike } from './metrics-tsv';

// Hash routes for the quality page (the dataset is whatever the dev server serves):
//   #group
//   #subject?sub=01&ses=01&task=rest&run=01

export type Route = { tab: 'group' } | { tab: 'subject'; scan: ScanKeyLike | null };

export function parseRoute(hash: string): Route {
  const h = hash.replace(/^#/, '');
  const q = h.indexOf('?');
  const name = q === -1 ? h : h.slice(0, q);
  const params = new URLSearchParams(q === -1 ? '' : h.slice(q + 1));

  if (name === 'subject') {
    const sub = params.get('sub');
    const task = params.get('task');
    const scan =
      sub && task
        ? { sub, ses: params.get('ses') ?? '', task, run: params.get('run') ?? '' }
        : null;
    return { tab: 'subject', scan };
  }
  return { tab: 'group' };
}

export function routeHash(route: Route): string {
  const params = new URLSearchParams();
  if (route.tab === 'subject' && route.scan) {
    params.set('sub', route.scan.sub);
    if (route.scan.ses) params.set('ses', route.scan.ses);
    params.set('task', route.scan.task);
    if (route.scan.run) params.set('run', route.scan.run);
  }
  const qs = params.toString();
  return `#${route.tab}${qs ? `?${qs}` : ''}`;
}
