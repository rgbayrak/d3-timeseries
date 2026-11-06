// Writes server/schema-rules/v<x.y.z>.json for each released BIDS version in
// github.com/bids-standard/bids-schema that has a compiled schema.json
// (1.8.0 and later) and no rules file yet. Run weekly by
// .github/workflows/bids-rules.yml, which opens a pull request with new files.
//
//   npx vite-node scripts/update-bids-rules.ts            # every missing version
//   npx vite-node scripts/update-bids-rules.ts 1.9.0 ...  # these versions (rewritten)

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { RULES_DIR, compactRules, parseVersion } from '../server/bids-rules';

const REPO = 'bids-standard/bids-schema';
const headers = { 'User-Agent': 'physai-qa-interactive bids-rules' };

async function releasedVersions(): Promise<string[]> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/versions`, { headers });
  if (!res.ok) throw new Error(`Listing ${REPO}/versions failed: HTTP ${res.status}`);
  const entries = (await res.json()) as { name: string; type: string }[];
  return entries.filter((e) => e.type === 'dir' && parseVersion(e.name)).map((e) => e.name);
}

async function main() {
  const asked = process.argv.slice(2);
  const versions = asked.length > 0 ? asked : await releasedVersions();
  mkdirSync(RULES_DIR, { recursive: true });
  for (const version of versions) {
    const out = join(RULES_DIR, `v${version}.json`);
    if (asked.length === 0 && existsSync(out)) continue;
    const url = `https://raw.githubusercontent.com/${REPO}/main/versions/${version}/schema.json`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.log(`${version}: no compiled schema.json (HTTP ${res.status}), skipped`);
      continue;
    }
    const rules = compactRules(await res.json(), url);
    writeFileSync(out, JSON.stringify(rules, null, 1) + '\n');
    console.log(`${version}: ${rules.entities.length} entities, ${rules.files.length} file rules, ${rules.topLevel.length} top-level files -> ${out}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
