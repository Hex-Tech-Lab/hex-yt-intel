#!/usr/bin/env node

/**
 * Bundle Size Enforcement Circuit Breaker
 * Fails CI/CD pipeline if client JS bundle exceeds performance budget
 *
 * Budget: 400 kB for Next.js App Router framework + custom application code
 * (344 kB baseline + 15% growth buffer = 396 kB ≈ 400 kB ceiling)
 * Measured from manifest.rootMainFiles + app-build-manifest.json entrypoints
 * This enforces strict performance constraints at build time
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const buildManifestPath = path.join(projectRoot, '.next', 'build-manifest.json');
const appBuildManifestPath = path.join(projectRoot, '.next', 'app-build-manifest.json');
const nextArtifactsPath = path.join(projectRoot, '.next');

// Performance budget in bytes (400 kB = 409600 bytes)
// Baseline: 344 kB + 15% growth buffer = disciplined performance ceiling
const BUNDLE_BUDGET_BYTES = 409600;
const BUNDLE_BUDGET_KB = Math.round(BUNDLE_BUDGET_BYTES / 1024);

/**
 * Color utilities for CLI output
 */
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function colorize(text, color) {
  return `${color}${text}${colors.reset}`;
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Get file size in bytes
 */
function getFileSize(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.size;
  } catch (error) {
    console.error(colorize(`✗ FATAL: Could not stat file ${filePath}: ${error.message}`, colors.red));
    console.error('This may indicate a corrupted or incomplete build output.');
    process.exit(1);
  }
}

/**
 * Extract JavaScript files for a specific route from build manifest
 * Validates both build-manifest.json and app-build-manifest.json across App Router entrypoints
 */
function getRouteJavaScriptAssets() {
  // Try primary manifest first, then fall back to app-build manifest
  let manifestPath = buildManifestPath;
  let manifest;

  // Attempt to load build manifest
  if (fs.existsSync(buildManifestPath)) {
    try {
      const manifestContent = fs.readFileSync(buildManifestPath, 'utf-8');
      manifest = JSON.parse(manifestContent);
    } catch (error) {
      console.error(colorize(`✗ FATAL: Failed to parse build manifest: ${error.message}`, colors.red));
      process.exit(1);
    }
  } else if (fs.existsSync(appBuildManifestPath)) {
    // Fall back to app-build-manifest if primary is missing
    try {
      const manifestContent = fs.readFileSync(appBuildManifestPath, 'utf-8');
      manifest = JSON.parse(manifestContent);
      manifestPath = appBuildManifestPath;
    } catch (error) {
      console.error(colorize(`✗ FATAL: Failed to parse app-build manifest: ${error.message}`, colors.red));
      process.exit(1);
    }
  } else {
    console.error(colorize(`✗ FATAL: Neither build manifest nor app-build manifest found`, colors.red));
    console.error(`Checked paths: ${buildManifestPath}, ${appBuildManifestPath}`);
    console.error('This script must run AFTER Next.js build completes.');
    process.exit(1);
  }

  // Calculate total size of initial JS chunks required for page load
  // Supports both Next.js Pages Router (manifest.pages) and App Router (rootMainFiles)
  const pageJsFiles = (manifest.pages?.['/'] || []).filter((f) => f.endsWith('.js'));
  const rootMainJsFiles = (manifest.rootMainFiles || []).filter((f) => f.endsWith('.js'));
  const jsFiles = pageJsFiles.length > 0 ? pageJsFiles : rootMainJsFiles;

  // Inform the operator which asset pool was used for sizing
  const sourceLabel = pageJsFiles.length > 0
    ? 'manifest.pages[\'/\'] (Pages Router entry)'
    : 'manifest.rootMainFiles (App Router shared entry — tracking all entrypoints)';

  if (jsFiles.length === 0) {
    console.warn(colorize(`⚠ Warning: No JavaScript files found for root route in ${path.basename(manifestPath)}`, colors.yellow));
    console.error(`\nCommon causes:`);
    console.error(`  1. Build manifest is for the wrong working directory`);
    console.error(`  2. rootMainFiles['/'] is empty or the route key is incorrect`);
    console.error(`  3. .next output directory was cleaned before this script ran`);
    console.error(`  4. The root route was deleted or renamed since the last build`);
    console.error(`  Manifest path: ${buildManifestPath}`);
    console.error(`  Pages in manifest: ${Object.keys(manifest.pages || {}).join(', ') || '(empty)'}`);
    console.error(`  rootMainFiles count: ${rootMainJsFiles.length}`);
    process.exit(1);
  }

  console.log(colorize(`  Asset pool: ${sourceLabel}`, colors.blue));

  return {
    files: jsFiles,
    totalBytes: jsFiles.reduce((sum, file) => {
      const filePath = path.join(nextArtifactsPath, file);
      return sum + getFileSize(filePath);
    }, 0),
  };
}

/**
 * Enforce bundle size budget
 */
function enforceBundle() {
  console.log(colorize('\n═══════════════════════════════════════════', colors.blue));
  console.log(colorize('   Bundle Size Enforcement Circuit Breaker', colors.blue));
  console.log(colorize('═══════════════════════════════════════════\n', colors.blue));

  const { files, totalBytes } = getRouteJavaScriptAssets();

  console.log(`${colorize('Route:', colors.blue)} /`);
  console.log(`${colorize('Files:', colors.blue)} ${files.length} JavaScript chunks`);
  console.log(`${colorize('Files:', colors.blue)}`);
  files.forEach((file) => {
    const filePath = path.join(nextArtifactsPath, file);
    const fileSize = getFileSize(filePath);
    console.log(`  • ${file} (${formatBytes(fileSize)})`);
  });

  console.log();
  console.log(`${colorize('Total Initial JS:', colors.blue)} ${colorize(formatBytes(totalBytes), colors.blue)}`);
  console.log(`${colorize('Budget Limit:', colors.blue)} ${colorize(formatBytes(BUNDLE_BUDGET_BYTES), colors.blue)} (${BUNDLE_BUDGET_KB} KB)`);

  const percentUsed = ((totalBytes / BUNDLE_BUDGET_BYTES) * 100).toFixed(1);
  const percentRemaining = (100 - percentUsed).toFixed(1);

  console.log(`${colorize('Budget Used:', colors.blue)} ${percentUsed}%`);
  console.log(`${colorize('Budget Remaining:', colors.blue)} ${percentRemaining}%`);

  console.log();

  if (totalBytes > BUNDLE_BUDGET_BYTES) {
    const overage = totalBytes - BUNDLE_BUDGET_BYTES;
    const overagePercent = ((overage / BUNDLE_BUDGET_BYTES) * 100).toFixed(1);
    console.log(
      colorize(
        `✗ BUDGET EXCEEDED by ${formatBytes(overage)} (${overagePercent}% over limit)`,
        colors.red
      )
    );
    console.log(colorize('═══════════════════════════════════════════\n', colors.blue));
    console.error(
      colorize(
        'FATAL: Client bundle size exceeds performance budget.\n' +
        'This is a hard CI/CD failure to enforce production performance constraints.',
        colors.red
      )
    );
    console.error(
      colorize(
        '\nTo fix:\n' +
        '1. Identify newly added dependencies that increased bundle size\n' +
        '2. Consider code-splitting, lazy loading, or dynamic imports\n' +
        '3. Profile the bundle with: pnpm analyze\n' +
        '4. Remove unused dependencies',
        colors.yellow
      )
    );
    process.exit(1);
  }

  const remaining = BUNDLE_BUDGET_BYTES - totalBytes;
  console.log(
    colorize(
      `✓ BUDGET OK: ${formatBytes(remaining)} budget remaining`,
      colors.green
    )
  );
  console.log(colorize('═══════════════════════════════════════════\n', colors.blue));

  process.exit(0);
}

// Execute enforcement
enforceBundle();
