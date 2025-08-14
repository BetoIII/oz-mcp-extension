// tests/setup/global-setup.ts
// Global setup for Playwright tests

import { chromium, FullConfig } from '@playwright/test';
import path from 'path';

async function globalSetup(config: FullConfig) {
  console.log('Setting up OZ Extension E2E tests...');
  
  // Verify extension files exist
  const extensionPath = path.resolve(__dirname, '../../');
  const requiredFiles = ['manifest.json', 'background.js', 'content.js'];
  
  for (const file of requiredFiles) {
    const fs = await import('fs');
    const filePath = path.join(extensionPath, file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Required extension file missing: ${filePath}`);
    }
  }
  
  console.log('✓ Extension files verified');
  
  // Test extension loading
  console.log('Testing extension loading...');
  const browser = await chromium.launch({
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });
  
  const context = await browser.newContext();
  const page = await context.newPage();
  
  // Verify extension is loaded
  await page.waitForTimeout(2000);
  const extensionLoaded = await page.evaluate(() => {
    return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
  });
  
  await browser.close();
  
  if (!extensionLoaded) {
    throw new Error('Extension failed to load during setup verification');
  }
  
  console.log('✓ Extension loading verified');
  console.log('Global setup complete');
}

export default globalSetup;