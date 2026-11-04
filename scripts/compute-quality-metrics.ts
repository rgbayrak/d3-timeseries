// Compute quality metrics for every scan of a dataset and write them to
// data/quality/<dataset>/ (quality_metrics.tsv, dataset.json, waveforms/). The
// PDF report (quality_report.pdf) is saved there by the Stats tab when it next opens.
//
//   npx vite-node scripts/compute-quality-metrics.ts -- <dataset> [options]
//
//   <dataset>              folder name under data/ (e.g. ds006644, shinobi)
//   --bids-root <path>     raw BIDS folder (default: data/<dataset>, or data/<dataset>/physprep)
//   --deriv-root <path>    fMRIPrep derivatives (default: <bids-root>/derivatives/fmriprep or data/<dataset>/fmriprep)
//   --out <path>           output root (default: data/quality)

import { join, resolve } from 'path';
import { runQualityMetrics } from '../server/quality-metrics';

const USAGE = 'Usage: compute-quality-metrics <dataset> [--bids-root <path>] [--deriv-root <path>] [--out <path>]';

function parseArgs(argv: string[]) {
  const opts: { dataset?: string; bidsRoot?: string; derivRoot?: string; out?: string } = {};
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
  const result = runQualityMetrics({
    dataDir: join(process.cwd(), 'data'),
    dataset: args.dataset,
    outRoot: args.out,
    bidsRoot: args.bidsRoot,
    derivRoot: args.derivRoot,
    log: (msg) => console.log(msg),
  });
  const { nScans, nSubjects, failedScans } = result.summary;
  console.log(
    `Done in ${((Date.now() - started) / 1000).toFixed(1)} s: ${nScans} scans, ${nSubjects} subjects` +
      (failedScans.length ? `, ${failedScans.length} failed (listed in dataset.json)` : ''),
  );
  console.log(
    'The PDF report (quality_report.pdf) is built and saved next to these files the next time the Stats tab opens (npm run dev).',
  );
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
