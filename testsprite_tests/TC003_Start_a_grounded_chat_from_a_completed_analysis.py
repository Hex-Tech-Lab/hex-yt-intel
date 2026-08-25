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
        
        # -> Click the 'Sign in' link in the header to open the sign-in page
        # Sign in link
        elem = page.get_by_role('link', name='Sign in', exact=True)
        await elem.click(timeout=10000)
        
        # -> Fill 'testsprite@getvintel.com' into the Email field, fill 'D4Q8FfRkEB82SMNKyCKT3ZMn' into the Password field, then click the 'Sign in with test account' button.
        # email email field
        elem = page.get_by_label('Email', exact=True)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("testsprite@getvintel.com")
        
        # -> Fill 'testsprite@getvintel.com' into the Email field, fill 'D4Q8FfRkEB82SMNKyCKT3ZMn' into the Password field, then click the 'Sign in with test account' button.
        # password password field
        elem = page.get_by_label('Password', exact=True)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("D4Q8FfRkEB82SMNKyCKT3ZMn")
        
        # -> Fill 'testsprite@getvintel.com' into the Email field, fill 'D4Q8FfRkEB82SMNKyCKT3ZMn' into the Password field, then click the 'Sign in with test account' button.
        # Sign in with test account button
        elem = page.get_by_role('button', name='Sign in with test account', exact=True)
        await elem.click(timeout=10000)
        
        # -> Enter a YouTube URL into the 'https://youtube.com/watch?v=...' field and click the 'Analyze' button.
        # YouTube video URL text field
        elem = page.get_by_label('YouTube video URL', exact=True)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        
        # -> Enter a YouTube URL into the 'https://youtube.com/watch?v=...' field and click the 'Analyze' button.
        # Analyze button
        elem = page.get_by_role('button', name='Analyze', exact=True)
        await elem.click(timeout=10000)
        
        # -> Open the 'Synthesis Chat' panel by clicking the 'Synthesis Chat' button to reveal the chat input and messages.
        # Synthesis Chat · ask about “Rick Astley - Never... button
        elem = page.get_by_role('button', name='Open chat', exact=True)
        await elem.click(timeout=10000)
        
        # -> Type a question into the chat message box: "What is the title of the song in this video?" and click the 'Send' button.
        # Message input
        elem = page.locator('xpath=/html/body/div[2]/div/div/main/div[2]/div[3]/div/div/div/div/div[2]')
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("What is the title of the song in this video?")
        
        # -> Type a question into the chat message box: "What is the title of the song in this video?" and click the 'Send' button.
        # Send button
        elem = page.get_by_role('button', name='Send', exact=True)
        await elem.click(timeout=10000)
        
        # --> Assertions to verify final state
        
        # --> The assistant replied that it could not answer because the video's analysis lacked a transcript/captions.
        await page.locator("xpath=/html/body/div[2]/div[1]/div/main/div[2]/div[2]/div/article[2]/div/div/div[3]/button[2]").nth(0).scroll_into_view_if_needed()
        # Assert-outcome: passed
        # Assert: A follow-up suggestion button is visible, indicating the assistant's reply was rendered.
        await expect(page.locator("xpath=/html/body/div[2]/div[1]/div/main/div[2]/div[2]/div/article[2]/div/div/div[3]/button[2]").nth(0)).to_be_visible(timeout=15000), "A follow-up suggestion button is visible, indicating the assistant's reply was rendered."
        
        # --> The conversation history includes the user question "What is the title of the song in this video?".
        # Assert-outcome: passed
        # Assert: The conversation area contains the new user question.
        await expect(page.locator("xpath=/html/body/div[2]/div[1]/div/main/div[2]/div[3]/div/div/div[1]/div/div[2]").nth(0)).to_contain_text("What is the title of the song in this video?", timeout=15000), "The conversation area contains the new user question."
        await asyncio.sleep(5)

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
    