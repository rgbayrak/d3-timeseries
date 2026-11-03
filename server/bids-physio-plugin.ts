import { basename, join, relative, sep } from 'path';
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
  resolveBidsRoots,
  validateScanKey,
  validateChannel,
  annotationProgress,
} from './bids-layout';
import type { AnnotationsFile, ScanKey } from './bids-layout';
import type { ServerResponse } from 'http';

/** Reply 400 and return true if any identifier is unsafe to put in a file path */
function rejectInvalid(res: ServerResponse, key: ScanKey): boolean {
  const error = validateScanKey(key);
  if (!error) return false;
  res.statusCode = 400;
  res.end(JSON.stringify({ error }));
  return true;
}

// BIDS_ROOT may be the dataset folder or its physprep/ (data/shinobi and
// data/shinobi/physprep both work); derivatives default to derivatives/fmriprep,
// or fmriprep/ next to physprep/. BIDSDER_ROOT overrides.
const { bidsRoot: BIDS_ROOT, derivRoot: BIDSDER_ROOT } = resolveBidsRoots(
  process.env.BIDS_ROOT ?? join(process.cwd(), 'data', 'ds006644'),
  process.env.BIDSDER_ROOT,
);

const DATA_DIR = join(process.cwd(), 'data');

// Dataset name = first folder under data/ (data/shinobi/physprep → shinobi,
// data/ds006644 → ds006644); outside data/, fall back to BIDS_ROOT's basename.
function datasetName(): string {
  if (process.env.DATASET_NAME) return process.env.DATASET_NAME;
  const rel = relative(DATA_DIR, BIDS_ROOT);
  if (rel && !rel.startsWith('..')) return rel.split(sep)[0];
  return basename(BIDS_ROOT);
}

// Annotations are grouped per dataset: <annotations>/<dataset>/sub-XX/[ses-YY/]func/
const ANNOTATIONS_ROOT = join(
  process.env.ANNOTATIONS_ROOT ?? join(DATA_DIR, 'annotations'),
  datasetName(),
);

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
      if (scans.length === 0) {
        console.warn(
          `[bids-physio] No readable physio files under ${BIDS_ROOT}. Check BIDS_ROOT, ` +
            'and that the *_physio.tsv.gz files have been downloaded (datalad get).',
        );
      }
      // `id` is the folder name under data/ (e.g. ds006644); the Stats tabs use it to find data/quality/<id>/
      cachedDatasetJson = JSON.stringify({ ...readDatasetInfo(BIDS_ROOT, BIDSDER_ROOT), id: datasetName() });

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
          if (rejectInvalid(res, { sub, ses })) return;
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
          if (rejectInvalid(res, { sub, ses, task })) return;
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
          if (rejectInvalid(res, { sub, ses, task, run })) return;

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
          if (rejectInvalid(res, { sub, ses, task, run })) return;

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

        // How many scans are annotated for one channel, e.g. { annotated: 24, total: 80 }
        if (req.url?.startsWith('/api/bids/annotation-progress')) {
          const url = new URL(req.url, 'http://localhost');
          const channel = url.searchParams.get('channel');
          const error = channel ? validateChannel(channel) : 'Missing channel parameter';
          if (error || !channel) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error }));
            return;
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(annotationProgress(ANNOTATIONS_ROOT, scans, channel)));
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
            if (rejectInvalid(res, { sub, ses, task, run, channel })) return;

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
                const { sub, ses, task, run, channel } = payload;
                if (rejectInvalid(res, { sub, ses: ses ?? '', task, run: run ?? '', channel })) return;
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
