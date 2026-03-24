import { join } from 'path';
import type { Plugin } from 'vite';
import {
  getSubjects,
  getTasks,
  getRuns,
  readPhysio,
  readConfounds,
  buildScans,
} from './bids-layout';

const BIDS_ROOT =
  process.env.BIDS_ROOT ??
  join(
    process.env.HOME ?? '',
    'Documents/internal/data-label-modules/friends.physprep',
  );

const BIDSDER_ROOT =
  process.env.BIDSDER_ROOT ??
  join(
    process.env.HOME ?? '',
    'Documents/internal/data-label-modules/friends.fmriprep',
  );

export function bidsPhysioPlugin(): Plugin {
  let cachedSubjectsJson: string;
  let cachedScansJson: string;

  return {
    name: 'bids-physio',
    configureServer(server) {
      const subjects = getSubjects(BIDS_ROOT);
      cachedSubjectsJson = JSON.stringify({ subjects });
      const scans = buildScans(BIDS_ROOT, subjects);
      cachedScansJson = JSON.stringify({ scans });
      console.log(
        `[bids-physio] Cached ${subjects.length} subjects, ${scans.length} scans from ${BIDS_ROOT}`,
      );
      console.log(`[bids-physio] Derivatives root: ${BIDSDER_ROOT}`);

      server.middlewares.use((req, res, next) => {
        if (req.url === '/api/bids/subjects') {
          res.setHeader('Content-Type', 'application/json');
          res.end(cachedSubjectsJson);
          return;
        }

        if (req.url === '/api/bids/scans') {
          res.setHeader('Content-Type', 'application/json');
          res.end(cachedScansJson);
          return;
        }

        if (req.url?.startsWith('/api/bids/tasks')) {
          const url = new URL(req.url, 'http://localhost');
          const sub = url.searchParams.get('sub');
          const ses = url.searchParams.get('ses') ?? '';
          if (!sub) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Missing sub parameter' }));
            return;
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ tasks: getTasks(BIDS_ROOT, sub, ses) }));
          return;
        }

        if (req.url?.startsWith('/api/bids/runs')) {
          const url = new URL(req.url, 'http://localhost');
          const sub = url.searchParams.get('sub');
          const ses = url.searchParams.get('ses') ?? '';
          const task = url.searchParams.get('task');
          if (!sub || !task) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Missing sub or task parameter' }));
            return;
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ runs: getRuns(BIDS_ROOT, sub, ses, task) }));
          return;
        }

        if (req.url?.startsWith('/api/bids/physio')) {
          const url = new URL(req.url, 'http://localhost');
          const sub = url.searchParams.get('sub');
          const ses = url.searchParams.get('ses') ?? '';
          const task = url.searchParams.get('task');
          const run = url.searchParams.get('run') ?? '';

          if (!sub || !task) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Missing sub or task parameter' }));
            return;
          }

          const result = readPhysio(BIDS_ROOT, sub, ses, task, run);
          if (!result) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Physio file not found' }));
            return;
          }

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
          return;
        }

        if (req.url?.startsWith('/api/bids/confounds')) {
          const url = new URL(req.url, 'http://localhost');
          const sub = url.searchParams.get('sub');
          const ses = url.searchParams.get('ses') ?? '';
          const task = url.searchParams.get('task');
          const run = url.searchParams.get('run') ?? '';

          if (!sub || !task) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Missing sub or task parameter' }));
            return;
          }

          const result = readConfounds(BIDSDER_ROOT, sub, ses, task, run);
          if (!result) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Confounds file not found' }));
            return;
          }

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
          return;
        }

        next();
      });
    },
  };
}
