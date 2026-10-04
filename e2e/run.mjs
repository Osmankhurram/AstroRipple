// Runs every browser suite in sequence; exits non-zero if any check fails.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const suites = ['lab', 'assistant', 'satellites', 'layout'];
let failed = 0;
for (const s of suites) {
  const file = fileURLToPath(new URL(`./${s}.mjs`, import.meta.url));
  const r = spawnSync(process.execPath, [file], { stdio: 'inherit', env: process.env });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} suite(s) failed.` : '\nAll browser suites passed.');
process.exit(failed ? 1 : 0);
