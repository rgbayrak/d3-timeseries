import { readdirSync, readFileSync, existsSync, accessSync, constants } from 'fs';
import { gunzipSync } from 'zlib';
import { join } from 'path';
import type { Plugin } from 'vite';

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

/** Matches physio .tsv.gz files (both _physio.tsv.gz and _desc-preproc_physio.tsv.gz) */
const PHYSIO_GZ_RE = /_physio\.tsv\.gz$/;

interface SubjectInfo {
  id: string;
  sessions: string[];
}

interface PhysioSidecar {
  SamplingFrequency: number;
  StartTime: number;
  Columns: string[];
}

/** Check if a path is actually readable (resolves symlinks, not a broken annex pointer) */
function isReadable(filePath: string): boolean {
  try {
    accessSync(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * List physio .tsv.gz filenames in a func dir that are actually readable.
 * Filters out broken symlinks (e.g. unlocked DataLad/git-annex files).
 */
function listReadablePhysio(funcDir: string): string[] {
  if (!existsSync(funcDir)) return [];
  return readdirSync(funcDir).filter(
    (f) => PHYSIO_GZ_RE.test(f) && isReadable(join(funcDir, f)),
  );
}

function getSubjects(): SubjectInfo[] {
  const entries = readdirSync(BIDS_ROOT, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && e.name.startsWith('sub-'))
    .map((e) => {
      const subId = e.name.replace('sub-', '');
      const subDir = join(BIDS_ROOT, e.name);
      const sessions = readdirSync(subDir, { withFileTypes: true })
        .filter((s) => s.isDirectory() && s.name.startsWith('ses-'))
        .map((s) => s.name.replace('ses-', ''))
        .filter((ses) => {
          const funcDir = join(BIDS_ROOT, `sub-${subId}`, `ses-${ses}`, 'func');
          return listReadablePhysio(funcDir).length > 0;
        })
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      return { id: subId, sessions };
    })
    .filter((s) => s.sessions.length > 0)
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

function getTasks(sub: string, ses: string): string[] {
  const funcDir = join(BIDS_ROOT, `sub-${sub}`, `ses-${ses}`, 'func');
  const readable = listReadablePhysio(funcDir);
  const taskSet = new Set<string>();
  for (const f of readable) {
    const m = f.match(/task-([^_]+)/);
    if (m) taskSet.add(m[1]);
  }
  return [...taskSet].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function findPhysioFiles(sub: string, ses: string, task: string) {
  const funcDir = join(BIDS_ROOT, `sub-${sub}`, `ses-${ses}`, 'func');
  const readable = listReadablePhysio(funcDir);

  const prefix = `sub-${sub}_ses-${ses}_task-${task}`;
  const tsvGzName = readable.find((f) => f.startsWith(prefix));
  if (!tsvGzName) return null;
  const tsvGzPath = join(funcDir, tsvGzName);

  // Try per-file JSON sidecar first, then top-level fallbacks
  const perFileJson = join(funcDir, tsvGzName.replace('.tsv.gz', '.json'));
  let sidecarPath: string | null = null;
  if (isReadable(perFileJson)) {
    sidecarPath = perFileJson;
  } else {
    for (const candidate of ['preproc_physio.json', 'physio.json']) {
      const p = join(BIDS_ROOT, candidate);
      if (isReadable(p)) {
        sidecarPath = p;
        break;
      }
    }
  }

  // Look for quality sidecar: *_desc-quality.json
  const qualityName = `${prefix}_desc-quality.json`;
  const qualityPath = join(funcDir, qualityName);
  const qualityJsonPath = isReadable(qualityPath) ? qualityPath : null;

  return { tsvGzPath, tsvGzName, sidecarPath, qualityJsonPath };
}

function readPhysio(sub: string, ses: string, task: string) {
  const found = findPhysioFiles(sub, ses, task);
  if (!found || !found.sidecarPath) return null;

  const sidecar: PhysioSidecar = JSON.parse(readFileSync(found.sidecarPath, 'utf-8'));
  const tsvBuf = gunzipSync(readFileSync(found.tsvGzPath));
  const tsvText = tsvBuf.toString('utf-8');

  const numCols = sidecar.Columns.length;
  const columns: number[][] = Array.from({ length: numCols }, () => []);

  const lines = tsvText.split('\n');
  for (const line of lines) {
    if (line.length === 0) continue;
    // Skip header row if present
    if (Number.isNaN(Number(line.split('\t')[0]))) continue;
    const parts = line.split('\t');
    for (let c = 0; c < numCols; c++) {
      columns[c].push(Number(parts[c]));
    }
  }

  // Read quality sidecar if available
  let quality: Record<string, { assessment: string; percentValid: number }> | null = null;
  if (found.qualityJsonPath) {
    try {
      const qRaw = JSON.parse(readFileSync(found.qualityJsonPath, 'utf-8'));
      quality = {};
      for (const key of Object.keys(qRaw)) {
        if (key === 'Description') continue;
        const entry = qRaw[key];
        if (entry && typeof entry.QualityAssessment === 'string') {
          quality[key] = {
            assessment: entry.QualityAssessment,
            percentValid: entry.PercentageValid ?? null,
          };
        }
      }
    } catch {
      // ignore malformed quality files
    }
  }

  return {
    filename: found.tsvGzName,
    samplingFrequency: sidecar.SamplingFrequency,
    startTime: sidecar.StartTime,
    columns: sidecar.Columns,
    data: columns,
    numSamples: columns[0].length,
    quality,
  };
}

/** Matches confounds TSV files from fmriprep */
const CONFOUNDS_RE = /_desc-confounds_timeseries\.tsv$/;

function readConfounds(sub: string, ses: string, task: string) {
  const funcDir = join(BIDSDER_ROOT, `sub-${sub}`, `ses-${ses}`, 'func');
  if (!existsSync(funcDir)) return null;

  const prefix = `sub-${sub}_ses-${ses}_task-${task}`;
  const files = readdirSync(funcDir).filter(
    (f) => f.startsWith(prefix) && CONFOUNDS_RE.test(f),
  );
  if (files.length === 0) return null;

  const filename = files[0];
  const filePath = join(funcDir, filename);
  if (!isReadable(filePath)) return null;

  const text = readFileSync(filePath, 'utf-8');
  const lines = text.split('\n').filter((l) => l.length > 0);
  if (lines.length < 2) return null;

  const headers = lines[0].split('\t');
  const fdIdx = headers.indexOf('framewise_displacement');
  if (fdIdx === -1) return null;

  const fd: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const val = lines[i].split('\t')[fdIdx];
    fd.push(val === 'n/a' ? NaN : Number(val));
  }

  return {
    filename,
    numVolumes: fd.length,
    framewise_displacement: fd,
  };
}

function buildScans(subjects: SubjectInfo[]): { sub: string; ses: string; task: string }[] {
  const scans: { sub: string; ses: string; task: string }[] = [];
  for (const subj of subjects) {
    for (const ses of subj.sessions) {
      for (const task of getTasks(subj.id, ses)) {
        scans.push({ sub: subj.id, ses, task });
      }
    }
  }
  return scans;
}

export function bidsPhysioPlugin(): Plugin {
  // Cache subjects + scans at server start (filesystem scan is expensive)
  let cachedSubjectsJson: string;
  let cachedScansJson: string;

  return {
    name: 'bids-physio',
    configureServer(server) {
      const subjects = getSubjects();
      cachedSubjectsJson = JSON.stringify({ subjects });
      cachedScansJson = JSON.stringify({ scans: buildScans(subjects) });
      console.log(
        `[bids-physio] Cached ${subjects.length} subjects, ${JSON.parse(cachedScansJson).scans.length} scans from ${BIDS_ROOT}`,
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
          const ses = url.searchParams.get('ses');
          if (!sub || !ses) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Missing sub or ses parameter' }));
            return;
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ tasks: getTasks(sub, ses) }));
          return;
        }

        if (req.url?.startsWith('/api/bids/physio')) {
          const url = new URL(req.url, 'http://localhost');
          const sub = url.searchParams.get('sub');
          const ses = url.searchParams.get('ses');
          const task = url.searchParams.get('task');

          if (!sub || !ses || !task) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Missing sub, ses, or task parameter' }));
            return;
          }

          const result = readPhysio(sub, ses, task);
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
          const ses = url.searchParams.get('ses');
          const task = url.searchParams.get('task');

          if (!sub || !ses || !task) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Missing sub, ses, or task parameter' }));
            return;
          }

          const result = readConfounds(sub, ses, task);
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
