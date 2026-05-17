// =============================================================================
// VISIBLE PRODUCTION TELEMETRY — Headed E2E + Vercel Log Extraction
// Target   : https://hex-yt-intel.vercel.app
// Framework: Playwright >= 1.60 | Auth bypass: session token injection
// Output   : docs/testing/live_run_diagnostic_bundle.json
// Run with : pnpm playwright test docs/testing/visible_production_telemetry.spec.ts --headed
// =============================================================================

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = 'https://hex-yt-intel.vercel.app';
const STREAM_WAIT_MS = 15_000;

async function fetchVercelLogs(deploymentId: string): Promise<unknown[]> {
  const token = process.env.VERCEL_API_TOKEN;
  if (!token || !deploymentId) {
    console.warn('[vercel-logs] VERCEL_API_TOKEN or VERCEL_DEPLOYMENT_ID not set — skipping log extraction');
    return [];
  }

  const url = `https://api.vercel.com/v2/deployments/${deploymentId}/events`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    console.warn(`[vercel-logs] HTTP ${response.status} from Vercel events endpoint`);
    return [];
  }

  const events = await response.json();
  return Array.isArray(events)
    ? events.filter((ev: unknown) => {
        const msg = (ev as Record<string, unknown>).message;
        return typeof msg === 'string' && ['[analyses]', '[callOpenRouter]', '[worker]'].some((f) => msg.includes(f));
      })
    : [];
}

test.describe('Headed Production E2E — Visible Stream + Vercel Telemetry', () => {

  test.beforeEach(async ({ page }) => {
    // Inject secure test validation header on all HTTP requests
    await page.setExtraHTTPHeaders({
      'X-Hex-Test-Secret': 'hex_secure_local_wsl_validation_token_string',
    });
  });

  test('Stream Output Detection + Vercel Log Extraction', async ({ page, context }) => {
    // Navigate to /search to avoid homepage 500 crash
    await page.goto(`${BASE_URL}/search`, { waitUntil: 'networkidle', timeout: 30_000 });
    console.log('[telemetry] Navigated to /search');

    // Fill YouTube URL input
    const inputSelector = 'input[placeholder*="YouTube"]';
    await page.waitForSelector(inputSelector, { timeout: 5000 });
    await page.fill(inputSelector, 'https://www.youtube.com/watch?v=HO2a_BTx12k');
    console.log('[telemetry] YouTube URL filled');

    // Click submit button
    await page.click('button[type="submit"], button:has-text("Analyze"), button:has-text("Search")');
    console.log('[telemetry] Submit button clicked');

    // Wait for stream output
    await page.waitForTimeout(STREAM_WAIT_MS);

    // Check for markdown output
    const outputPane = page.locator('.prose, [class*="prose"], article, div.whitespace-pre-wrap').first();
    const hasMarkdown = await outputPane.locator('h1, h2, h3, h4, strong').first().isVisible({ timeout: 5000 }).catch(() => false);

    console.log('[telemetry] Markdown output detected:', hasMarkdown);
    expect(hasMarkdown).toBeTruthy();
  });

  test.afterEach(async () => {
    const deploymentId = process.env.VERCEL_DEPLOYMENT_ID;
    const timestamp = new Date().toISOString();
    const browserName = process.env.PLAYWRIGHT_BROWSER || 'chromium';

    const vercelLogs = await fetchVercelLogs(deploymentId ?? '');
    const bundle = {
      meta: {
        generatedAt: timestamp,
        browser: browserName,
        vercelDeploymentId: deploymentId ?? '<unset>',
        logFilters: ['[analyses]', '[callOpenRouter]', '[worker]'],
      },
      vercelLogs,
    };

    const outputPath = path.join(__dirname, 'live_run_diagnostic_bundle.json');
    fs.writeFileSync(outputPath, JSON.stringify(bundle, null, 2), 'utf-8');
    console.log(`[telemetry] ✅ Diagnostic bundle written → ${outputPath}`);
    console.log(`[telemetry] Vercel matched log lines: ${vercelLogs.length}`);
  });

});
