// Compute quality metrics for every scan of a dataset and write them to
// data/quality/<dataset>/ (quality_metrics.tsv, dataset.json, waveforms/). The
// PDF report (quality_report.pdf) is saved there by the Stats tab when it next opens.
//
//   npx vite-node scripts/compute-quality-metrics.ts -- <dataset> [options]
//
//   <dataset>              folder name under data/ (e.g. ds006644, friends)
//   --bids-root <path>     main BIDS folder (default: data/<dataset>)
//   --physio-root <path>   folder holding the physio files, when stored outside the main folder
//                          (default: the main folder, or the folder inside it that has *_physio.tsv.gz)
//   --deriv-root <path>    derivatives folder with the confounds, when stored outside <bids-root>/derivatives/
//                          (default: the folder inside <bids-root>/derivatives/ that has confounds files)
//   --out <path>           output root (default: data/quality)

import { join, resolve } from 'path';
import { runQualityMetrics, resolveDatasetPaths } from '../server/quality-metrics';
import { countPhysioFiles } from '../server/availability';
import { appendQualityRun } from '../server/quality-run-log';
import { localTimestamp, notDownloaded } from '../src/quality/run-log';

const USAGE =
  'Usage: compute-quality-metrics <dataset> [--bids-root <path>] [--physio-root <path>] [--deriv-root <path>] [--out <path>]';

function parseArgs(argv: string[]) {
  const opts: { dataset?: string; bidsRoot?: string; physioRoot?: string; derivRoot?: string; out?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (!v) throw new Error(`${a} needs a value\n${USAGE}`);
      return resolve(v);
    };
    if (a === '--help' || a === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (a === '--bids-root') opts.bidsRoot = value();
    else if (a === '--physio-root') opts.physioRoot = value();
    else if (a === '--deriv-root') opts.derivRoot = value();
    else if (a === '--out') opts.out = value();
    else if (a.startsWith('-')) throw new Error(`Unknown option ${a}\n${USAGE}`);
    else if (!opts.dataset) opts.dataset = a;
    else throw new Error(`Unexpected argument ${a}\n${USAGE}`);
  }
  if (!opts.dataset) throw new Error(USAGE);
  return opts as typeof opts & { dataset: string };
}

try {
  const args = parseArgs(process.argv.slice(2).filter((a) => a !== '--'));
  const started = Date.now();
  const runDate = localTimestamp();
  const dataDir = join(process.cwd(), 'data');
  const result = runQualityMetrics({
    dataDir,
    dataset: args.dataset,
    outRoot: args.out,
    bidsRoot: args.bidsRoot,
    physioRoot: args.physioRoot,
    derivRoot: args.derivRoot,
    log: (msg) => console.log(msg),
  });
  const { nScans, nSubjects, failedScans } = result.summary;
  console.log(
    `Done in ${((Date.now() - started) / 1000).toFixed(1)} s: ${nScans} scans, ${nSubjects} subjects` +
      (failedScans.length ? `, ${failedScans.length} failed (listed in dataset.json)` : ''),
  );

  // Run log: one line per run in quality_runs.tsv, next to the metrics (read by the Stats tab)
  const { physioRoot } = resolveDatasetPaths(dataDir, args.dataset, {
    bidsRoot: args.bidsRoot,
    physioRoot: args.physioRoot,
    derivRoot: args.derivRoot,
  });
  const available = countPhysioFiles(physioRoot);
  const run = {
    runDate,
    scansComputed: nScans,
    scansAvailable: available.onDisk,
    scansFailed: failedScans.length,
    countSource: available.source,
  };
  const logPath = appendQualityRun(result.outDir, run);
  console.log(
    `Coverage: ${nScans} of ${available.onDisk} scans (${notDownloaded(run)} not downloaded, ` +
      `${failedScans.length} failed; counted with ${available.source}). Logged in ${logPath}`,
  );
  console.log(
    'The PDF report (quality_report.pdf) is built and saved next to these files the next time the Stats tab opens (npm run dev).',
  );
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
