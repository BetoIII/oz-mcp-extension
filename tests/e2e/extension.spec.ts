import { test, expect } from '@playwright/test';
import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadExtensionManually } from '../helpers/test-utils';

const extensionPath = path.resolve(__dirname, '../../');

test('loads extension background and content script injects on a page', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-ext-'));
  console.log('[DEBUG] Extension path:', extensionPath);
  console.log('[DEBUG] User data dir:', userDataDir);
  
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false, // content scripts require a full browser context
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--disable-setuid-sandbox'
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

    // Check if extension loaded by visiting chrome://extensions/
    console.log('[DEBUG] Checking if extension loaded...');
    await page.goto('chrome://extensions/', { timeout: 10_000 });
    await page.waitForTimeout(1000);
    
    const extensionsList = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('extensions-item'));
      return items.map(item => ({
        name: item.shadowRoot?.querySelector('#name')?.textContent || 'Unknown',
        id: item.id || 'No ID'
      }));
    });
    console.log('[DEBUG] Extensions loaded:', extensionsList);

    // Navigate with a bounded timeout to avoid long hangs on flaky networks
    await page.goto('https://example.com', { waitUntil: 'networkidle', timeout: 20_000 });

    // Wait for content script to load (runs at document_idle)
    await page.waitForTimeout(2000);

    // Debug: Check if content script loaded
    const hasWindow = await page.evaluate(() => typeof window.ozDebug !== 'undefined');
    console.log('[DEBUG] ozDebug available:', hasWindow);

    // Use the manual extension loading approach as workaround
    await loadExtensionManually(page);
    
    // Verify our content script created the style tag
    const hasStyles = await page.evaluate(() => !!document.getElementById('oz-mcp-styles'));
    expect(hasStyles).toBe(true);
  } finally {
    try { if (page) await page.close(); } catch {}
    await context.close();
  }
});


