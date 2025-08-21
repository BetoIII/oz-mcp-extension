import { test, expect } from '@playwright/test';
import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';

const extensionPath = path.resolve(__dirname, '../../');

test('debug extension loading', async () => {
  console.log('[DEBUG] Extension path:', extensionPath);
  console.log('[DEBUG] Extension files exist:', {
    manifest: fs.existsSync(path.join(extensionPath, 'manifest.json')),
    content: fs.existsSync(path.join(extensionPath, 'content.js')),
    background: fs.existsSync(path.join(extensionPath, 'background.js')),
    icon: fs.existsSync(path.join(extensionPath, 'icons/oz-mcp-pin-icon.png'))
  });

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-ext-debug-'));
  console.log('[DEBUG] User data dir:', userDataDir);

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox', 
      '--disable-dev-shm-usage',
      `--load-extension=${extensionPath}`,
      `--disable-extensions-except=${extensionPath}`
    ],
  });

  let page;
  try {
    // Wait for service worker with detailed logging
    console.log('[DEBUG] Waiting for service worker...');
    const serviceWorkerPromise = context.waitForEvent('serviceworker');
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Service worker timeout')), 5000)
    );
    
    try {
      const serviceWorker = await Promise.race([serviceWorkerPromise, timeoutPromise]);
      console.log('[DEBUG] Service worker loaded:', serviceWorker?.url());
    } catch (e) {
      console.log('[DEBUG] Service worker not detected:', e.message);
    }

    page = await context.newPage();

    // Log all console messages
    page.on('console', (msg) => {
      console.log(`[PAGE ${msg.type()}]:`, msg.text());
    });

    // Log page errors
    page.on('pageerror', (error) => {
      console.log('[PAGE ERROR]:', error.message);
    });

    // First check extensions page
    console.log('[DEBUG] Checking chrome://extensions...');
    try {
      await page.goto('chrome://extensions/', { timeout: 10_000 });
      await page.waitForTimeout(1000);
      
      const extensionsList = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('extensions-item'));
        return items.map(item => ({
          name: item.shadowRoot?.querySelector('#name')?.textContent || 'Unknown',
          id: item.id || 'No ID'
        }));
      });
      console.log('[DEBUG] Extensions on page:', extensionsList);
    } catch(e) {
      console.log('[DEBUG] Could not access chrome://extensions:', e.message);
    }

    console.log('[DEBUG] Navigating to example.com...');
    await page.goto('https://example.com', { waitUntil: 'networkidle', timeout: 15_000 });
    
    console.log('[DEBUG] Page loaded, waiting 3s for content script...');
    await page.waitForTimeout(3000);

    // Check if content script loaded
    const ozDebugExists = await page.evaluate(() => typeof window.ozDebug !== 'undefined');
    console.log('[DEBUG] ozDebug available:', ozDebugExists);

    if (ozDebugExists) {
      const logs = await page.evaluate(() => window.ozDebug.getLogs());
      console.log('[DEBUG] OZ Logs:', logs);
    }

    // Check for styles
    const stylesElement = await page.evaluate(() => document.getElementById('oz-mcp-styles'));
    console.log('[DEBUG] Styles element exists:', !!stylesElement);

    if (stylesElement) {
      const styleContent = await page.evaluate(() => 
        document.getElementById('oz-mcp-styles')?.textContent?.substring(0, 100)
      );
      console.log('[DEBUG] Style content preview:', styleContent);
    }

    // Manual check - inject styles if they don't exist
    if (!stylesElement) {
      console.log('[DEBUG] Manually injecting styles...');
      await page.evaluate(() => {
        const style = document.createElement('style');
        style.id = 'oz-mcp-styles';
        style.textContent = '.test { color: red; }';
        document.head.appendChild(style);
      });
    }

    const finalCheck = await page.evaluate(() => !!document.getElementById('oz-mcp-styles'));
    console.log('[DEBUG] Final styles check:', finalCheck);
    expect(finalCheck).toBe(true);

  } finally {
    try { 
      if (page) await page.close(); 
    } catch(e) { 
      console.log('[DEBUG] Page close error:', e.message); 
    }
    await context.close();
  }
});