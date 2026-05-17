// =============================================================================
// VISIBLE PRODUCTION TELEMETRY — Headed E2E + Vercel Log Extraction
// Target   : https://yt-intel.getmytestdrive.com
// Framework: Playwright >= 1.60 | Auth: Supabase (AUTH_PROVIDER=supabase)
// Output   : docs/testing/live_run_diagnostic_bundle.json
//
// Prereqs:
//  - Vercel env: OPENROUTER_API_KEY, SUPABASE_*, VERCEL_DEPLOYMENT_ID
//  - cookies.json in docs/testing/ (capture via browser storageState)
//  - Vercel REST token in VERCEL_API_TOKEN env var
// =============================================================================

import { test, expect, request as playwrightRequest } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname   = path.dirname(__filename);

// =============================================================================
// CONSTANTS
// =============================================================================
const BASE_URL            = 'https://hex-yt-intel.vercel.app';
const COOKIE_JAR          = path.join(__dirname, 'cookies.json');
const DIAGNOSTIC_BUNDLE   = path.join(__dirname, 'live_run_diagnostic_bundle.json');
const STREAM_WAIT_MS      = 15_000;          // Time to allow first chunks to surface
const VERCEL_EVENTS_URL   = (deploymentId: string) =>
  `https://api.vercel.com/v2/deployments/${deploymentId}/events`;
const VERCEL_LOG_FILTERS  = ['[analyses]', '[callOpenRouter]', '[worker]'];

// =============================================================================
// HELPERS
// =============================================================================

/** Load cookies from disk; return empty array when jar is absent (dev mode skip). */
function loadCookies(): Array<{ name: string; value: string }> {
  if (!fs.existsSync(COOKIE_JAR)) return [];
  try {
    return JSON.parse(fs.readFileSync(COOKIE_JAR, 'utf-8'));
  } catch {
    return [];
  }
}

/** Write diagnostic bundle (merged Vercel traces + browser outcomes). */
function writeDiagnosticBundle(bundle: Record<string, unknown>) {
  fs.writeFileSync(DIAGNOSTIC_BUNDLE, JSON.stringify(bundle, null, 2), 'utf-8');
}

/** Fetch Vercel deployment events, filtered by our log-signature tokens. */
async function fetchVercelLogs(deploymentId: string): Promise<unknown[]> {
  const token = process.env.VERCEL_API_TOKEN;
  if (!token || !deploymentId) {
    console.warn('[vercel-logs] VERCEL_API_TOKEN or VERCEL_DEPLOYMENT_ID not set — skipping log extraction');
    return [];
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };

  try {
    const res = await playwrightRequest.newContext().then(async (ctx) => {
      const r = await ctx.fetch(VERCEL_EVENTS_URL(deploymentId), { headers });
      return r;
    });

    if (!res.ok()) {
      console.warn(`[vercel-logs] HTTP ${res.status()} from Vercel events endpoint`);
      return [];
    }

    const body: unknown = await res.json();
    const events = Array.isArray(body) ? body : [];
    return events.filter((ev: unknown) => {
      if (typeof ev !== 'object' || ev === null) return false;
      const msg = (ev as Record<string, unknown>).message;
      return typeof msg === 'string' && VERCEL_LOG_FILTERS.some((f) => msg.includes(f));
    });
  } catch (err) {
    console.warn('[vercel-logs] fetch failed:', err);
    return [];
  }
}

// =============================================================================
// TEST SUITE
// =============================================================================

test.describe('Headed Production E2E — Visible Stream + Vercel Telemetry', () => {

  test.beforeEach(async ({ context }) => {
    // Inject stored session cookies so we land authenticated
    const cookies = loadCookies();
    if (cookies.length > 0) {
      await context.addCookies(cookies.map(({ name, value }) => ({ name, value, domain: 'hex-yt-intel.vercel.app', path: '/' })));
    }
  });

  test('Headed Production E2E Stream and Vercel Log Extraction Pass', async ({ page }) => {
    // ---------------------------------------------------------------------------
    // 1. Navigate to production target in a visible browser window
    // ---------------------------------------------------------------------------
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await expect(page).toHaveTitle(/.+Hex[-_]YT[-_]Intel.+/i);

    // ---------------------------------------------------------------------------
    // 2. Authenticate (cookie-based or interactive sign-in)
    // ---------------------------------------------------------------------------
    const signInBtn = page.locator('a:has-text("Sign In"), button:has-text("Sign In"), text=Sign In').first();
    if (await signInBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await signInBtn.click();
      // If cookies were loaded the user is already authenticated — skip form fill
      // Otherwise fill-and-submit using test credentials from env
      const emailInput  = page.locator('input[type="email"], input[name="email"], input#email').first();
      const passInput   = page.locator('input[type="password"], input[name="password"], input#password').first();
      if (await emailInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await emailInput.fill(process.env.TEST_USER_EMAIL ?? '');
        await passInput.fill(process.env.TEST_USER_PASSWORD ?? '');
        await page.locator('button[type="submit"]:has-text("Sign in"), button[type="submit"]:has-text("Continue")').first().click();
      }
    }

    // ---------------------------------------------------------------------------
    // 3. Pump a YouTube URL and trigger the synthesis pipeline
    // ---------------------------------------------------------------------------
    const videoUrl = 'https://www.youtube.com/watch?v=HO2a_BTx12k';
    await page.fill('input[placeholder*="YouTube"]', videoUrl);
    await page.click('button[type="submit"], button:has-text("Analyze"), button:has-text("Create")');

    // ---------------------------------------------------------------------------
    // 4. Progressive stream wait — give the backend time to flush first chunks
    // ---------------------------------------------------------------------------
    await page.waitForTimeout(STREAM_WAIT_MS);

    // ---------------------------------------------------------------------------
    // 5. Assertion: at least one markdown heading must surface in the output pane
    // ---------------------------------------------------------------------------
    const outputPane = page.locator('.prose, [class*="prose"], article, div.whitespace-pre-wrap').first();
    const hasMarkdown = await outputPane.locator('h1, h2, h3, h4, strong, **').first().isVisible({ timeout: 30_000 }).catch(() => false);
    expect(hasMarkdown).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // 6. Vercel telemetry extraction — runs after every test in this suite
  // ---------------------------------------------------------------------------
  test.afterEach(async () => {
    const deploymentId = process.env.VERCEL_DEPLOYMENT_ID;
    const timestamp     = new Date().toISOString();
    const browserName   = process.env.PLAYWRIGHT_BROWSER || 'chromium';

    const vercelLogs = await fetchVercelLogs(deploymentId ?? '');

    const bundle = {
      meta: {
        generatedAt       : timestamp,
        browser           : browserName,
        vercelDeploymentId: deploymentId ?? '<unset>',
        logFilters        : VERCEL_LOG_FILTERS,
      },
      vercelLogs,
    };

    writeDiagnosticBundle(bundle);
    console.log(`[telemetry] Diagnostic bundle written → ${DIAGNOSTIC_BUNDLE}`);
    console.log(`[telemetry] Vercel matched log lines: ${vercelLogs.length}`);
  });

});
