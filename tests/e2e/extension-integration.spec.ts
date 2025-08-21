import { test, expect } from '@playwright/test';
import { waitForExtensionReady, injectTestAddress, getOZBadgeCount } from '../helpers/test-utils';

test('extension integration with address detection', async ({ page }) => {
  // Navigate to a simple test page
  await page.goto('data:text/html,<html><body><h1>Test Page</h1></body></html>');
  
  // Load extension manually
  await waitForExtensionReady(page);
  console.log('[DEBUG] Extension loaded successfully');
  
  // Inject a test address
  const testAddress = '123 Main St, New York, NY 10001';
  await injectTestAddress(page, testAddress);
  console.log('[DEBUG] Test address injected');
  
  // Verify address element exists
  const addressElements = await page.$$('.test-address-element');
  expect(addressElements.length).toBe(1);
  
  // Check initial badge count
  const initialBadges = await getOZBadgeCount(page);
  console.log('[DEBUG] Initial badge count:', initialBadges);
  
  // Verify ozDebug is available
  const ozDebugLogs = await page.evaluate(() => {
    return typeof window.ozDebug !== 'undefined' ? window.ozDebug.getLogs().length : -1;
  });
  console.log('[DEBUG] ozDebug logs count:', ozDebugLogs);
  expect(ozDebugLogs).toBeGreaterThan(0);
  
  // Verify styles are injected
  const stylesExist = await page.evaluate(() => !!document.getElementById('oz-mcp-styles'));
  expect(stylesExist).toBe(true);
  
  console.log('[DEBUG] All basic extension functionality verified');
});