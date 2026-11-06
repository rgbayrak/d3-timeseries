import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { RUN_LOG_HEADER, RUN_LOG_NAME, runLogLine } from '../src/quality/run-log';
import type { QualityRun } from '../src/quality/run-log';

/**
 * Append one run to <outDir>/quality_runs.tsv, writing the header first when
 * the file is new (or empty). Earlier runs are kept as history.
 */
export function appendQualityRun(outDir: string, run: QualityRun): string {
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, RUN_LOG_NAME);
  const isNew = !existsSync(path) || readFileSync(path, 'utf-8').trim() === '';
  appendFileSync(path, (isNew ? RUN_LOG_HEADER.join('\t') + '\n' : '') + runLogLine(run) + '\n');
  return path;
}
