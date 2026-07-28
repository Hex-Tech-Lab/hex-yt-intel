#!/usr/bin/env node
/**
 * Generates a trimmed Iconify JSON collection containing only the "solar:*" icons
 * actually referenced in the codebase, so the app can bundle icon SVG data at
 * build time (via addCollection) instead of fetching from api.iconify.design at
 * runtime. Re-run this script (`node scripts/generate-icon-subset.mjs`) whenever
 * a new `solar:` icon name is introduced anywhere in web/.
 *
 * Output: web/lib/icons/solar-subset.json (checked in, consumed by
 * components/templates/_shared/primitives.tsx).
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = join(__dirname, '..');

// Find every "solar:<name>" token referenced anywhere under web/ (JSX icon="..."
// literals, `icon: 'solar:...'` data-table entries, ternaries, etc.)
const grepOutput = execSync(
  `grep -rhoE "solar:[a-zA-Z0-9_-]+" "${join(webRoot, 'components')}" "${join(webRoot, 'app')}" "${join(webRoot, 'lib')}" "${join(webRoot, 'hooks')}" 2>/dev/null || true`,
  { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
);

const names = [...new Set(grepOutput.split('\n').map((s) => s.trim()).filter(Boolean))]
  .map((full) => full.replace(/^solar:/, ''))
  .sort();

if (names.length === 0) {
  console.error('No solar:* icon usages found — refusing to write an empty subset.');
  process.exit(1);
}

const fullSet = JSON.parse(
  readFileSync(join(webRoot, 'node_modules/@iconify-json/solar/icons.json'), 'utf-8')
);

const icons = {};
const missing = [];

for (const name of names) {
  if (fullSet.icons[name]) {
    icons[name] = fullSet.icons[name];
  } else if (fullSet.aliases?.[name]) {
    // Resolve alias to its parent icon body, but keep the alias name as the key
    // so `icon="solar:<alias>"` call sites keep working unmodified.
    const alias = fullSet.aliases[name];
    const parent = fullSet.icons[alias.parent];
    if (parent) {
      icons[name] = { ...parent, ...alias };
      delete icons[name].parent;
    } else {
      missing.push(name);
    }
  } else {
    missing.push(name);
  }
}

if (missing.length > 0) {
  console.error(`Icon names not found in @iconify-json/solar: ${missing.join(', ')}`);
  process.exit(1);
}

const subset = {
  prefix: fullSet.prefix,
  width: fullSet.width,
  height: fullSet.height,
  icons,
};

const outDir = join(webRoot, 'lib/icons');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'solar-subset.json');
writeFileSync(outPath, JSON.stringify(subset));

console.log(`Wrote ${Object.keys(icons).length} icons (${names.length} names requested) to ${outPath}`);
