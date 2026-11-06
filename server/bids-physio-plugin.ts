import { basename, join, relative, sep } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import type { Plugin } from 'vite';
import { METRICS_TSV_NAME, REPORT_PDF_NAME } from '../src/quality/metrics-tsv';
import {
  getSubjects,
  getTasks,
  getRuns,
  readPhysio,
  readConfounds,
  readEvents,
  readPeaks,
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
import { countPhysioFiles } from './availability';
import { checkStructure } from './bids-structure';
import { descriptionNoticeLines, noticeText } from '../src/data/dataset-notice';
import { structureLine, structureText } from '../src/data/bids-structure';
import type { ServerResponse } from 'http';

/** Reply 400 and return true if any identifier is unsafe to put in a file path */
function rejectInvalid(res: ServerResponse, key: ScanKey): boolean {
  const error = validateScanKey(key);
  if (!error) return false;
  res.statusCode = 400;
  res.end(JSON.stringify({ error }));
  return true;
}

// BIDS_ROOT is always the main BIDS folder (dataset_description.json,
// participants.tsv, events, BOLD sidecars). Physio files normally live there
// too; when they are stored elsewhere, BIDSPHYS_ROOT points at them, and
// BIDSDER_ROOT at derivatives outside BIDS_ROOT/derivatives/. Without them,
// both are found inside BIDS_ROOT by their files (see resolveBidsRoots).
const {
  bidsRoot: BIDS_ROOT,
  physioRoot: BIDSPHYS_ROOT,
  derivRoot: BIDSDER_ROOT,
  notes: ROOT_NOTES,
} = resolveBidsRoots(process.env.BIDS_ROOT ?? join(process.cwd(), 'data', 'ds006644'), {
  physioRoot: process.env.BIDSPHYS_ROOT,
  derivRoot: process.env.BIDSDER_ROOT,
});

const DATA_DIR = join(process.cwd(), 'data');

// Dataset name = first folder under data/ (data/friends/friends → friends,
// data/ds006644 → ds006644); outside data/, fall back to BIDS_ROOT's basename.
function datasetName(): string {
  if (process.env.DATASET_NAME) return process.env.DATASET_NAME;
  const rel = relative(DATA_DIR, BIDS_ROOT);
  if (rel && !rel.startsWith('..')) return rel.split(sep)[0];
  return basename(BIDS_ROOT);
}

// Quality metrics written by scripts/compute-quality-metrics.ts (default output root)
const QUALITY_ROOT = join(DATA_DIR, 'quality');
/** Largest PDF report the server accepts (one page per scan; JPEG pages) */
const MAX_REPORT_BYTES = 500 * 1024 * 1024;

// Annotations are grouped per dataset: <annotations>/<dataset>/sub-XX/[ses-YY/]func/
const ANNOTATIONS_ROOT = join(
  process.env.ANNOTATIONS_ROOT ?? join(DATA_DIR, 'annotations'),
  datasetName(),
);

export function bidsPhysioPlugin(): Plugin {
  let cachedSubjectsJson: string;
  let cachedScansJson: string;
  let cachedDatasetJson: string;
  let scans: ReturnType<typeof buildScans> = [];

  /** Subjects, scans (from the physio root) and dataset info (from BIDS_ROOT), read once and logged */
  function cacheDataset() {
      const subjects = getSubjects(BIDSPHYS_ROOT);
      cachedSubjectsJson = JSON.stringify({ subjects });
      scans = buildScans(BIDSPHYS_ROOT, subjects);
      cachedScansJson = JSON.stringify({ scans });
      console.log(`[bids-physio] BIDS root: ${BIDS_ROOT}`);
      console.log(`[bids-physio] Physio root: ${BIDSPHYS_ROOT}`);
      console.log(`[bids-physio] Derivatives root: ${BIDSDER_ROOT}`);
      for (const note of ROOT_NOTES) console.log(`[bids-physio]   ${note}`);
      console.log(`[bids-physio] Cached ${subjects.length} subjects, ${scans.length} scans`);
      if (scans.length === 0) {
        const check = process.env.BIDSPHYS_ROOT
          ? 'BIDSPHYS_ROOT'
          : 'that BIDS_ROOT is the main BIDS folder (set BIDSPHYS_ROOT if the physio is stored elsewhere)';
        console.warn(
          `[bids-physio] No readable physio files under ${BIDSPHYS_ROOT}. Check ${check}, ` +
            'and that the *_physio.tsv.gz files have been downloaded (datalad get).',
        );
      }
      // `id` is the folder name under data/ (e.g. ds006644); the Stats tabs use it to find data/quality/<id>/
      // Downloaded vs listed physio files, counted once (git-annex when it can answer)
      const physioFiles = countPhysioFiles(BIDSPHYS_ROOT);
      console.log(
        `[bids-physio] Physio files: ${physioFiles.downloaded} of ${physioFiles.onDisk} downloaded (${physioFiles.source})`,
      );
      const info = readDatasetInfo(BIDS_ROOT, BIDSDER_ROOT, BIDSPHYS_ROOT);
      for (const line of descriptionNoticeLines(info.description)) console.warn(`[bids-physio] ${noticeText(line)}`);
      // File and folder names against the rules of the declared BIDSVersion (names only, nothing downloaded)
      const structure = checkStructure(BIDS_ROOT, info.bidsVersion);
      const structureMsg = structureLine(structure);
      if (structureMsg) console.log(`[bids-physio] ${structureText(structureMsg)}`);
      cachedDatasetJson = JSON.stringify({
        ...info,
        id: datasetName(),
        physioFiles,
        structure,
      });
    }

  return {
    name: 'bids-physio',
    configureServer(server) {
      // Scan the dataset only when the dev server starts listening. Scripts run
      // with vite-node (e.g. scripts/compute-quality-metrics.ts) also load this
      // plugin but never listen, so they skip this scan of the default BIDS_ROOT
      // and its log lines. The work is synchronous, so it finishes before the
      // first request is handled. No HTTP server (middleware mode): scan now.
      if (server.httpServer) server.httpServer.once('listening', cacheDataset);
      else cacheDataset();

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
          res.end(JSON.stringify({ tasks: getTasks(BIDSPHYS_ROOT, sub, ses) }));
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
          res.end(JSON.stringify({ runs: getRuns(BIDSPHYS_ROOT, sub, ses, task) }));
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

          const result = readPhysio(BIDSPHYS_ROOT, sub, ses, task, run, BIDSDER_ROOT, BIDS_ROOT);
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

          // Many scans have no fMRIPrep confounds: that is not an error, so
          // reply null (200) rather than 404, which the browser logs as a failure
          const result = readConfounds(BIDS_ROOT, BIDSDER_ROOT, sub, ses, task, run);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result ?? null));
          return;
        }

        if (req.url?.startsWith('/api/bids/events')) {
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

          // Events sit with the imaging data in BIDS_ROOT, not in a separate physio folder.
          // No events file (e.g. rest) is not an error: reply null (200), not 404
          const result = readEvents(BIDS_ROOT, sub, ses, task, run);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result ?? null));
          return;
        }

        // TRIAL: detected/corrected peaks from the events file in the physio
        // folder itself (e.g. physprep/), not the imaging folders. null if none.
        if (req.url?.startsWith('/api/bids/peaks')) {
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

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(readPeaks(BIDSPHYS_ROOT, sub, ses, task, run) ?? null));
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

        // PDF report of the served dataset's quality metrics, saved next to them.
        // GET: is it there? POST: the Stats tab sends the PDF it built. Only the
        // served dataset, at a fixed file name: nothing from the request picks the path.
        if (req.url?.startsWith('/api/quality-report')) {
          const dataset = datasetName();
          const dir = join(QUALITY_ROOT, dataset);
          const file = join(dir, REPORT_PDF_NAME);
          const url = `/data/quality/${encodeURIComponent(dataset)}/${REPORT_PDF_NAME}`;
          res.setHeader('Content-Type', 'application/json');

          if (req.method === 'GET') {
            res.end(JSON.stringify({ exists: existsSync(file), url }));
            return;
          }

          if (req.method === 'POST') {
            if (!existsSync(join(dir, METRICS_TSV_NAME))) {
              res.statusCode = 409;
              res.end(JSON.stringify({ error: 'No quality metrics computed for this dataset' }));
              return;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            let tooLarge = false;
            req.on('data', (chunk: Buffer) => {
              size += chunk.length;
              if (size > MAX_REPORT_BYTES) tooLarge = true;
              else chunks.push(chunk);
            });
            req.on('end', () => {
              const body = Buffer.concat(chunks);
              if (tooLarge || body.subarray(0, 5).toString('latin1') !== '%PDF-') {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: tooLarge ? 'PDF too large' : 'Not a PDF' }));
                return;
              }
              mkdirSync(dir, { recursive: true });
              writeFileSync(file, body);
              res.end(JSON.stringify({ exists: true, url }));
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
