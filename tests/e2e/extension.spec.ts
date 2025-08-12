import { test, expect } from '@playwright/test';
import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';

const extensionPath = path.resolve(__dirname, '../../');

test('loads extension background and content script injects on a page', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-ext-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false, // content scripts require a full browser context
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  let page;
  try {
    // MV3 service workers are lazy; don't fail if not immediately present.
    // Do a best-effort wait for a service worker to appear, but continue regardless.
    await Promise.race([
      context.waitForEvent('serviceworker').catch(() => null),
      new Promise((r) => setTimeout(r, 2000)),
    ]);

    page = await context.newPage();
    // Surface console errors for easier debugging on failures
    page.on('console', (msg) => {
      // eslint-disable-next-line no-console
      console.log(`[page console] ${msg.type()}: ${msg.text()}`);
    });

    // Navigate with a bounded timeout to avoid long hangs on flaky networks
    await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 20_000 });

    // Verify our content script created the style tag or reacts to mutation observers eventually
    // The content script calls ensureStyles() on load which injects #oz-mcp-styles
    await page.waitForFunction(() => !!document.getElementById('oz-mcp-styles'), {
      timeout: 15_000,
    });
    const hasStyles = await page.evaluate(() => !!document.getElementById('oz-mcp-styles'));
    expect(hasStyles).toBe(true);
  } finally {
    try { if (page) await page.close(); } catch {}
    await context.close();
  }
});


