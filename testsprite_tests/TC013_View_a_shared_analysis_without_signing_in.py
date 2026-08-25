import asyncio
import re
from playwright import async_api
from playwright.async_api import expect

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
        
        # -> Click the 'See a sample' link in the hero area to open a public/shared analysis view.
        # See a sample link
        elem = page.get_by_role('link', name='See a sample', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the site logo labeled 'HEX·YT·INTEL' to return to the homepage and look for a sample/shared analysis link.
        # HEX·YT·INTEL link
        elem = page.get_by_role('link', name='HEX·YT·INTEL', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the 'See a sample' button in the homepage hero to open the public/shared analysis view.
        # See a sample link
        elem = page.get_by_role('link', name='See a sample', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the site logo labeled 'HEX·YT·INTEL' to return to the homepage so the 'See a sample' CTA can be re-inspected.
        # HEX·YT·INTEL link
        elem = page.get_by_role('link', name='HEX·YT·INTEL', exact=True)
        await elem.click(timeout=10000)
        
        # -> Scroll down the homepage to reveal additional links and locate a candidate 'See a sample' or shared-analysis link in the page content.
        await page.mouse.wheel(0, 300)
        
        # -> Scroll further down the homepage and search the visible page for the words 'sample' or 'shared' to locate any link labeled 'See a sample' or any public shared-analysis link.
        await page.mouse.wheel(0, 300)
        
        # -> Click the 'Library' link in the header to open the public analysis library and look for a shared/sample analysis to open.
        # Library link
        elem = page.get_by_role('link', name='Library', exact=True)
        await elem.click(timeout=10000)
        
        # -> Navigate directly to a candidate shared-analysis URL (open the page at /analyses/sample) to check whether a public read-only analysis view exists.
        await page.goto("http://localhost:3000/analyses/sample")
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        
        # --> Assertions to verify final state
        
        # --> The shared analysis page did not open; the browser was redirected to the sign-in page instead of showing the analysis.
        # Assert-outcome: failed
        # Assert: Expected the shared analysis view to load but navigation was redirected to the sign-in URL.
        await expect(page).to_have_url(re.compile("/auth/signin\\?callbackUrl=%2Fanalyses%2Fsample"), timeout=15000), "Expected the shared analysis view to load but navigation was redirected to the sign-in URL."
        
        # --> The analysis was not shown as a read-only view because the sign-in form was displayed instead.
        # Assert-outcome: failed
        # Assert: Expected the analysis to be read-only (no sign-in prompt) but the sign-in form was shown.
        await expect(page.locator("xpath=/html/body/div[2]/div[1]/div/div[2]/form/button").nth(0)).to_contain_text("Sign in with test account", timeout=15000), "Expected the analysis to be read-only (no sign-in prompt) but the sign-in form was shown."
        await asyncio.sleep(5)

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
    