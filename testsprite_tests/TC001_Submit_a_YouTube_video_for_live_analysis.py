import asyncio
import re
from playwright import async_api
from playwright.async_api import expect
import os

def _require_env(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(
            "Missing required environment variable %r "
            "(see testsprite_tests/.env.example and export it in your shell first)" % name
        )
    return value

TEST_EMAIL = _require_env("TESTSPRITE_TEST_ACCOUNT_EMAIL")
TEST_PASSWORD = _require_env("TESTSPRITE_TEST_ACCOUNT_PASSWORD")


async def run_test():
    pw = None
    browser = None
    context = None

    try:
        # Start a Playwright session in asynchronous mode
        pw = await async_api.async_playwright().start()

        # Launch a Chromium browser in headless mode with custom arguments
        browser = await pw.chromium.launch(
            headless=True,
            args=[
                "--window-size=1280,720",
                "--disable-dev-shm-usage",
                "--ipc=host",
                "--single-process"
            ],
        )

        # Create a new browser context (like an incognito window)
        context = await browser.new_context()
        # Wider default timeout to match the agent's DOM-stability budget;
        # auto-waiting Playwright APIs (expect, locator.wait_for) inherit this.
        context.set_default_timeout(15000)

        # Open a new page in the browser context
        page = await context.new_page()

        # Interact with the page elements to simulate user flow
        # -> navigate
        await page.goto("http://localhost:3000")
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        
        # -> Click the 'Sign in' button in the top-right to open the sign-in page.
        # Sign in link
        elem = page.get_by_role('link', name='Sign in', exact=True)
        await elem.click(timeout=10000)
        
        # -> Fill the 'Email' field with <test-account email from TESTSPRITE_TEST_ACCOUNT_EMAIL>, fill the 'Password' field with <test-account password from TESTSPRITE_TEST_ACCOUNT_PASSWORD>, then click the 'Sign in with test account' button.
        # email email field
        elem = page.get_by_label('Email', exact=True)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill(TEST_EMAIL)
        
        # -> Fill the 'Email' field with <test-account email from TESTSPRITE_TEST_ACCOUNT_EMAIL>, fill the 'Password' field with <test-account password from TESTSPRITE_TEST_ACCOUNT_PASSWORD>, then click the 'Sign in with test account' button.
        # password password field
        elem = page.get_by_label('Password', exact=True)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill(TEST_PASSWORD)
        
        # -> Fill the 'Email' field with <test-account email from TESTSPRITE_TEST_ACCOUNT_EMAIL>, fill the 'Password' field with <test-account password from TESTSPRITE_TEST_ACCOUNT_PASSWORD>, then click the 'Sign in with test account' button.
        # Sign in with test account button
        elem = page.get_by_role('button', name='Sign in with test account', exact=True)
        await elem.click(timeout=10000)
        
        # -> Paste a valid YouTube URL into the 'https://youtube.com/watch?v=...' input and click the 'Analyze' button to start the synthesis.
        # YouTube video URL text field
        elem = page.get_by_label('YouTube video URL', exact=True)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        
        # -> Paste a valid YouTube URL into the 'https://youtube.com/watch?v=...' input and click the 'Analyze' button to start the synthesis.
        # Analyze button
        elem = page.get_by_role('button', name='Analyze', exact=True)
        await elem.click(timeout=10000)
        
        # --> Assertions to verify final state
        
        # --> Completed analysis results were not displayed because the synthesis pipeline failed with a critical stream error.
        # Assert-outcome: failed
        # Assert: Expected the synthesis to complete and show analysis results.
        await expect(page.locator("xpath=/html/body/div[2]/div[1]/div/aside[1]/div/div[2]/div/div[3]").nth(0)).to_contain_text("Critical stream failure: [Bundle 4] edge server stream 4 failed (400): {\"error\":\"Invalid appUrl callback destination\"}", timeout=15000), "Expected the synthesis to complete and show analysis results."
        
        # --> The executive digest and entity-exploration outputs were not produced (word cloud shows a no-data state).
        # Assert-outcome: failed
        # Assert: Expected the executive digest and entity exploration outputs to be displayed.
        await expect(page.locator("xpath=/html/body/div[2]/div[1]/div/aside[2]/div/div/div[4]/div[2]/div/canvas").nth(0)).to_have_attribute("aria-label", "Word cloud: no data available for this analysis", timeout=15000), "Expected the executive digest and entity exploration outputs to be displayed."
        await asyncio.sleep(5)

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
    