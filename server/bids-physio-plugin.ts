import { join } from 'path';
import type { Plugin } from 'vite';
import {
  getSubjects,
  getTasks,
  getRuns,
  readPhysio,
  readConfounds,
  readAnnotations,
  writeAnnotations,
  buildScans,
  readDatasetInfo,
} from './bids-layout';
import type { AnnotationsFile } from './bids-layout';

const BIDS_ROOT =
  process.env.BIDS_ROOT ?? join(process.cwd(), 'data', 'ds006644');

const BIDSDER_ROOT =
  process.env.BIDSDER_ROOT ?? join(BIDS_ROOT, 'derivatives', 'fmriprep');

const ANNOTATIONS_ROOT =
  process.env.ANNOTATIONS_ROOT ?? join(process.cwd(), 'data', 'annotations');

export function bidsPhysioPlugin(): Plugin {
  let cachedSubjectsJson: string;
  let cachedScansJson: string;
  let cachedDatasetJson: string;

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
      cachedDatasetJson = JSON.stringify(readDatasetInfo(BIDS_ROOT, BIDSDER_ROOT));

      server.middlewares.use((req, res, next) => {
        if (req.url === '/api/bids/subjects') {
          res.setHeader('Content-Type', 'application/json');
          res.end(cachedSubjectsJson);
          return;
        }

        if (req.url === '/api/bids/dataset') {
          res.setHeader('Content-Type', 'application/json');
          res.end(cachedDatasetJson);
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

          const result = readPhysio(BIDS_ROOT, sub, ses, task, run, BIDSDER_ROOT);
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

          const result = readConfounds(BIDS_ROOT, BIDSDER_ROOT, sub, ses, task, run);
          if (!result) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Confounds file not found' }));
            return;
          }

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
          return;
        }

        if (req.url?.startsWith('/api/bids/annotations')) {
          if (req.method === 'GET') {
            const url = new URL(req.url, 'http://localhost');
            const sub = url.searchParams.get('sub');
            const ses = url.searchParams.get('ses') ?? '';
            const task = url.searchParams.get('task');
            const run = url.searchParams.get('run') ?? '';
            const channel = url.searchParams.get('channel');

            if (!sub || !task || !channel) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Missing sub, task, or channel parameter' }));
              return;
            }

            const result = readAnnotations(ANNOTATIONS_ROOT, sub, ses, task, run, channel);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(result ?? { sub, ses, task, run, channel, sampling_rate: 0, annotations: [] }));
            return;
          }

          if (req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', () => {
              try {
                const payload = JSON.parse(body) as AnnotationsFile;
                if (!payload.sub || !payload.task || !payload.channel) {
                  res.statusCode = 400;
                  res.end(JSON.stringify({ error: 'Missing sub, task, or channel in payload' }));
                  return;
                }
                writeAnnotations(ANNOTATIONS_ROOT, payload);
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ ok: true }));
              } catch {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Invalid annotation payload' }));
              }
            });
            return;
          }

          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        next();
      });
    },
  };
}
