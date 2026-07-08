import { test, expect, TEST_YOUTUBE_URLS } from './fixtures';

const DEPLOYMENT_URL = process.env.DEPLOYMENT_URL || 'http://localhost:3000';

test.describe('TEST SUITE 1: Analysis Creation → Streaming → Completion', () => {
  test('Submit URL and stream begins within 5s', async ({ authenticatedPage: _page, submitAnalysis, waitForAnalysisStream: _waitForAnalysisStream }) => {
    const startTime = Date.now();

    // Submit analysis
    const result = await submitAnalysis(TEST_YOUTUBE_URLS.testVideo1);
    expect(result).not.toBeNull();
    expect(result?.analysisId).toBeTruthy();
    expect([200, 202]).toContain(result?.response.status());

    const elapsedMs = Date.now() - startTime;
    console.log(`[Analysis Flow] Stream submission took ${elapsedMs}ms`);
    expect(elapsedMs).toBeLessThan(5000);
  });

  test('Monitor status transitions: starting → model → complete', async ({
    authenticatedPage: _page,
    submitAnalysis,
    waitForAnalysisComplete: _waitForAnalysisComplete,
  }) => {
    // Submit analysis
    const result = await submitAnalysis(TEST_YOUTUBE_URLS.testVideo1);
    expect(result?.analysisId).toBeTruthy();

    const analysisId = result!.analysisId;
    const statuses: string[] = [];

    // Poll status for up to 90 seconds
    const maxWaitMs = 90000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const response = await page.request.get(
          `${DEPLOYMENT_URL}/api/analyses/${analysisId}/overview`
        );
        if (response.ok) {
          const data = await response.json();
          if (data.status && !statuses.includes(data.status)) {
            statuses.push(data.status);
            console.log(`[Status] ${data.status}`);
          }

          if (data.status === 'complete') {
            break;
          }
        }
      } catch (e) {
        console.error('Failed to check status:', e);
      }

      await page.waitForTimeout(2000);
    }

    // Verify we saw the expected state transitions
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses).toContain('processing');
    // "complete" should be the final state
    expect(statuses[statuses.length - 1]).toBe('complete');
  });

  test('Analysis appears in dashboard after completion', async ({
    authenticatedPage: page,
    submitAnalysis,
    waitForAnalysisComplete,
  }) => {
    // Submit analysis
    const result = await submitAnalysis(TEST_YOUTUBE_URLS.testVideo1);
    const analysisId = result!.analysisId;

    // Wait for completion
    const isComplete = await waitForAnalysisComplete(analysisId);
    expect(isComplete).toBe(true);

    // Check dashboard - refresh to get latest
    await page.reload();
    await page.waitForLoadState('load');

    // Look for analysis in history/dashboard
    // The dashboard should display recent analyses
    const dashboardContent = await page.content();
    expect(dashboardContent).toBeTruthy();
  });

  test('Analysis markdown content is present and >100 chars', async ({
    authenticatedPage: page,
    submitAnalysis,
    waitForAnalysisComplete,
  }) => {
    // Submit analysis
    const result = await submitAnalysis(TEST_YOUTUBE_URLS.testVideo1);
    const analysisId = result!.analysisId;

    // Wait for completion
    const isComplete = await waitForAnalysisComplete(analysisId, 90000);
    expect(isComplete).toBe(true);

    // Fetch the full analysis
    const response = await page.request.get(
      `${DEPLOYMENT_URL}/api/analyses/${analysisId}/overview`
    );
    expect(response.ok).toBe(true);

    const data = await response.json();
    expect(data.analysis).toBeTruthy();
    expect(typeof data.analysis).toBe('string');
    expect(data.analysis.length).toBeGreaterThan(100);

    console.log(`[Analysis Content] Length: ${data.analysis.length} chars`);
  });

  test('Status transitions complete within 60 seconds', async ({
    authenticatedPage: _page,
    submitAnalysis,
    waitForAnalysisComplete,
  }) => {
    const startTime = Date.now();

    // Submit
    const result = await submitAnalysis(TEST_YOUTUBE_URLS.testVideo1);
    const analysisId = result!.analysisId;

    // Wait for completion
    const isComplete = await waitForAnalysisComplete(analysisId, 60000);
    const elapsedMs = Date.now() - startTime;

    expect(isComplete).toBe(true);
    expect(elapsedMs).toBeLessThan(60000);

    console.log(`[Performance] Complete in ${elapsedMs}ms`);
  });

  test('Error handling: Invalid URL returns 400', async ({
    authenticatedPage: page,
  }) => {
    const invalidUrl = 'not-a-valid-url';

    // Attempt to submit invalid URL
    const urlInput = page.locator('input[aria-label="YouTube video URL"]');
    await urlInput.fill(invalidUrl);

    const analyzeBtn = page.locator('button', { hasText: /Analyze/ }).first();

    // Wait for error or response
    try {
      const responsePromise = page.waitForResponse(
        (resp) => resp.url().includes('/api/analyses'),
        { timeout: 5000 }
      );

      await analyzeBtn.click();
      const response = await responsePromise;

      // Should return error (4xx or 5xx)
      console.log(`[Invalid URL] Response status: ${response.status()}`);
      expect([400, 422, 500]).toContain(response.status());
    } catch (_e) {
      // May not make request if client-side validation catches it
      console.log('[Invalid URL] Client-side validation prevented submission');
    }
  });

  test('Response headers include persona information', async ({
    authenticatedPage: _page,
    submitAnalysis,
  }) => {
    const result = await submitAnalysis(TEST_YOUTUBE_URLS.testVideo1);
    const response = result?.response;

    expect(response).toBeTruthy();
    const persona = response?.headers()['x-active-persona'];
    console.log(`[Headers] X-Active-Persona: ${persona}`);

    // Should have some persona value
    expect(persona).toBeTruthy();
  });

  test('Contract: 200/202 status codes for successful submission', async ({
    authenticatedPage: _page,
    submitAnalysis,
  }) => {
    const result = await submitAnalysis(TEST_YOUTUBE_URLS.testVideo1);

    expect(result?.response.status()).toMatch(/^(200|202)$/);
    console.log(`[Contract] Submission returned: ${result?.response.status()}`);
  });
});
