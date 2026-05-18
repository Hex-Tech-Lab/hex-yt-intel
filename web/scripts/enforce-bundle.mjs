#!/usr/bin/env node

/**
 * Bundle Size Enforcement Circuit Breaker
 * Fails CI/CD pipeline if client JS bundle exceeds performance budget
 *
 * Budget: 100 kB for Next.js framework + custom application code
 * This enforces strict performance constraints at build time
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const buildManifestPath = path.join(projectRoot, '.next', 'build-manifest.json');
const nextArtifactsPath = path.join(projectRoot, '.next');

// Performance budget in bytes (100 kB = 102400 bytes)
const BUNDLE_BUDGET_BYTES = 102400;
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
    console.warn(`Warning: Could not stat file ${filePath}: ${error.message}`);
    return 0;
  }
}

/**
 * Extract JavaScript files for a specific route from build manifest
 */
function getRouteJavaScriptAssets() {
  if (!fs.existsSync(buildManifestPath)) {
    console.error(colorize(`✗ FATAL: Build manifest not found at ${buildManifestPath}`, colors.red));
    console.error('This script must run AFTER Next.js build completes.');
    process.exit(1);
  }

  let manifest;
  try {
    const manifestContent = fs.readFileSync(buildManifestPath, 'utf-8');
    manifest = JSON.parse(manifestContent);
  } catch (error) {
    console.error(colorize(`✗ FATAL: Failed to parse build manifest: ${error.message}`, colors.red));
    process.exit(1);
  }

  // Calculate total size of initial JS chunks required for page load
  // Includes: framework chunks, page-specific chunks, and shared dependencies
  const files = manifest.pages?.['/'] || [];
  const jsFiles = files.filter((f) => f.endsWith('.js'));

  if (jsFiles.length === 0) {
    console.warn(colorize('⚠ Warning: No JavaScript files found for root route in manifest', colors.yellow));
    return { files: [], totalBytes: 0 };
  }

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
