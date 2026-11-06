import { readdirSync, openSync, readSync, closeSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { isReadable } from './bids-layout';

// How many physio files a dataset lists, and how many of them are downloaded.
// DataLad datasets list every file, but a file that was never fetched
// (datalad get) is a dangling symlink, or in "unlocked" mode a small pointer
// file. git-annex knows which is which; without it, the file itself is checked.

const PHYSIO_GZ_RE = /_physio\.tsv\.gz$/;

export interface PhysioFileCount {
  /** Physio files listed in the dataset, downloaded or not */
  onDisk: number;
  /** Of those, the ones whose content is here */
  downloaded: number;
  /** How "downloaded" was decided */
  source: 'git-annex' | 'files on disk';
}

/** Physio files in every sub-XX/func and sub-XX/ses-YY/func folder, as paths relative to root (with '/') */
export function listPhysioPaths(root: string): string[] {
  const paths: string[] = [];
  const funcFiles = (rel: string) => {
    const dir = join(root, rel);
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) if (PHYSIO_GZ_RE.test(f)) paths.push(`${rel}/${f}`);
  };
  if (!existsSync(root)) return paths;
  for (const sub of readdirSync(root, { withFileTypes: true })) {
    if (!sub.isDirectory() || !sub.name.startsWith('sub-')) continue;
    funcFiles(`${sub.name}/func`);
    for (const ses of readdirSync(join(root, sub.name), { withFileTypes: true })) {
      if (ses.isDirectory() && ses.name.startsWith('ses-')) funcFiles(`${sub.name}/${ses.name}/func`);
    }
  }
  return paths.sort();
}

/** Readable and gzip content (not a dangling symlink, nor an unlocked git-annex pointer file) */
export function hasGzipContent(path: string): boolean {
  if (!isReadable(path)) return false;
  let fd: number | null = null;
  try {
    fd = openSync(path, 'r');
    const buf = Buffer.alloc(2);
    return readSync(fd, buf, 0, 2, 0) === 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  } catch {
    return false;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/** Paths in `git annex find --not --in=here` output (one per line, relative to the folder it ran in) */
export function parseAnnexMissing(output: string): Set<string> {
  return new Set(
    output
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0),
  );
}

/**
 * Annexed files under root whose content is not here, or null when git-annex
 * can't answer (not installed, not an annex repository, or too slow).
 * Read-only and local: it never downloads anything.
 */
function annexMissing(root: string): Set<string> | null {
  try {
    const out = execFileSync('git', ['annex', 'find', '--not', '--in=here'], {
      cwd: root,
      encoding: 'utf-8',
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
    return parseAnnexMissing(out);
  } catch {
    return null;
  }
}

/**
 * Count physio files listed under root and those downloaded: with git-annex
 * when it can answer (physio files kept in plain git count as downloaded),
 * otherwise by checking each file's content.
 */
export function countPhysioFiles(root: string, useAnnex = true): PhysioFileCount {
  const paths = listPhysioPaths(root);
  const missing = useAnnex && paths.length > 0 ? annexMissing(root) : null;
  if (missing) {
    return { onDisk: paths.length, downloaded: paths.filter((p) => !missing.has(p)).length, source: 'git-annex' };
  }
  return {
    onDisk: paths.length,
    downloaded: paths.filter((p) => hasGzipContent(join(root, p))).length,
    source: 'files on disk',
  };
}
