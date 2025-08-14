import { test, expect, chromium } from '@playwright/test';
import path from 'path';

const extensionPath = path.resolve(__dirname, '../../');

test('test extension loading with BrowserContext', async () => {
  console.log('[DEBUG] Extension path:', extensionPath);
  
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });

  // Create context with extension path
  const context = await browser.newContext();
  
  // Add extension manually
  const extensionId = await context.addInitScript(`
    console.log('Extension init script running...');
  `);
  
  const page = await context.newPage();
  
  page.on('console', (msg) => {
    console.log(`[PAGE ${msg.type()}]:`, msg.text());
  });

  console.log('[DEBUG] Navigating to test page...');
  await page.goto('data:text/html,<html><body>Test page</body></html>');
  
  // Try to manually load the extension files
  await page.addScriptTag({ path: path.join(extensionPath, 'content.js') });
  
  await page.waitForTimeout(2000);
  
  const ozDebugExists = await page.evaluate(() => typeof window.ozDebug !== 'undefined');
  console.log('[DEBUG] ozDebug available after manual load:', ozDebugExists);
  
  const stylesElement = await page.evaluate(() => document.getElementById('oz-mcp-styles'));
  console.log('[DEBUG] Styles element exists:', !!stylesElement);
  
  await browser.close();
  
  // This test will pass if we can manually load the content script
  expect(ozDebugExists).toBe(true);
});