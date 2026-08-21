// Generates real pairwise test-input combinations from model.pict using
// Microsoft's actual PICT binary (via the pict-pairwise-testing npm
// wrapper). Run via `pnpm run gen-pairwise` from web/ -- see
// docs/testing/PICT_REAL_INTEGRATION_PLAN.md for the full contract.
//
// This is deliberately a real script, not a documented-but-nonexistent
// command: PR #265 review found the plan's own reproduction command didn't
// actually work (no package.json script, wrong path when run via
// `pnpm --filter`). Prints the generated cases as JSON to stdout so a
// future consumer (Playwright spec, smoke test) can pipe it directly.
import { pict } from 'pict-pairwise-testing';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const modelPath = join(__dirname, 'model.pict');

const result = pict(modelPath);
if (result.error) {
  console.error('PICT generation failed:', result.command, result.error);
  process.exit(1);
}

console.log(JSON.stringify(result.testCases, null, 2));
console.error(`Generated ${result.testCases.length} test cases from ${modelPath}`);
