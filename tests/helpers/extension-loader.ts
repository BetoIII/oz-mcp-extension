// tests/helpers/extension-loader.ts
// Helper to load the Chrome extension in Playwright (using manual workaround)

import { chromium, BrowserContext } from '@playwright/test';
import path from 'path';

export async function loadExtension(headless = false): Promise<BrowserContext> {
  // Use regular browser launch since extension loading via args doesn't work
  const browser = await chromium.launch({
    headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
    ]
  });
  
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  
  // Extension will be loaded manually via loadExtensionManually in test-utils
  // when waitForExtensionReady is called
  
  return context;
}

export async function getExtensionId(context: BrowserContext): Promise<string> {
  // Get the extension page to find the extension ID
  const extensionPages = context.pages().filter(page => 
    page.url().startsWith('chrome-extension://')
  );
  
  if (extensionPages.length > 0) {
    const url = new URL(extensionPages[0].url());
    return url.hostname;
  }
  
  throw new Error('Extension not found');
}