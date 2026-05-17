import { chromium, devices } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL            = 'https://hex-yt-intel.vercel.app';
const STREAM_WAIT_MS      = 15_000;
const VERCEL_LOG_FILTERS  = ['[analyses]', '[callOpenRouter]', '[worker]'];

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
        return typeof msg === 'string' && VERCEL_LOG_FILTERS.some((f) => msg.includes(f));
      })
    : [];
}

async function runTelemetry() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // 1. Navigate to production target
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForFunction('document.title.includes("Hex-YT-Intel")', { timeout: 10_000 });

    // 2. Authenticate (cookie-based or interactive sign-in)
    const signInBtn = page.locator('a:has-text("Sign In"), button:has-text("Sign In"), text=Sign In').first();
    if (await signInBtn.isVisible({ timeout: 5_000 })) {
      await signInBtn.click();
      const emailInput = page.locator('input[type="email"], input[name="email"], input#email').first();
      if (await emailInput.isVisible({ timeout: 3_000 })) {
        await emailInput.fill(process.env.TEST_USER_EMAIL ?? '');
        const passInput = page.locator('input[type="password"], input[name="password"], input#password').first();
        await passInput.fill(process.env.TEST_USER_PASSWORD ?? '');
        await page.locator('button[type="submit"]:has-text("Sign in"), button:has-text("Continue")').first().click();
      }
    }

    // 3. Pump a YouTube URL and trigger the synthesis pipeline
    const videoUrl = 'https://www.youtube.com/watch?v=HO2a_BTx12k';
    await page.fill('input[placeholder*="YouTube"]', videoUrl);
    await page.click('button[type="submit"], button:has-text("Analyze"), button:has-text("Create")');

    // 4. Progressive stream wait — give the backend time to flush first chunks
    await page.waitForTimeout(STREAM_WAIT_MS);

    // 5. Assertion: at least one markdown heading must surface in the output pane
    const outputPane = page.locator('.prose, [class*="prose"], article, div.whitespace-pre-wrap').first();
    const hasMarkdown = await outputPane.locator('h1, h2, h3, h4, strong, **').first().isVisible({ timeout: 30_000 }).catch(() => false);
    if (!hasMarkdown) {
      throw new Error('No markdown output detected after stream wait');
    }

    console.log('[telemetry] ✅ E2E test passed: markdown output detected');
  } catch (error) {
    console.error('[telemetry] ❌ E2E test failed:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

async function main() {
  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID;
  if (!deploymentId) {
    console.error('[telemetry] VERCEL_DEPLOYMENT_ID not set — cannot fetch Vercel logs');
    process.exit(1);
  }

  try {
    // Run the E2E test first
    await runTelemetry();

    // Then fetch Vercel logs
    const vercelLogs = await fetchVercelLogs(deploymentId);

    // Write diagnostic bundle
    const bundle = {
      meta: {
        generatedAt       : new Date().toISOString(),
        browser           : 'chromium',
        vercelDeploymentId: deploymentId,
        logFilters        : VERCEL_LOG_FILTERS,
      },
      vercelLogs,
    };

    const outputPath = path.join(__dirname, 'live_run_diagnostic_bundle.json');
    fs.writeFileSync(outputPath, JSON.stringify(bundle, null, 2), 'utf-8');
    console.log(`[telemetry] ✅ Diagnostic bundle written to ${outputPath}`);
    console.log(`[telemetry] Vercel matched log lines: ${vercelLogs.length}`);
  } catch (error) {
    console.error('[telemetry] Test run failed:', error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[telemetry] Fatal error:', err);
  process.exit(1);
});
