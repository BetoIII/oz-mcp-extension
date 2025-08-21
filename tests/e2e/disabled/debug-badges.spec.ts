import { test, expect } from '@playwright/test';
import { 
  waitForExtensionReady, 
  getOZBadgeCount, 
  triggerExtensionScan,
} from '../helpers/test-utils';

test('debug badge creation', async ({ page }) => {
  // Navigate to actual zillow.com but intercept to inject test content
  await page.route('**/*', (route) => {
    if (route.request().url().includes('zillow.com')) {
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `
          <html>
            <head><title>Test | Zillow</title></head>
            <body>
              <div data-test="property-card-addr">123 Main St, Miami, FL 33125</div>
              <div class="list-card-addr">456 Ocean Dr, Miami Beach, FL 33139</div>
            </body>
          </html>
        `
      });
    } else {
      route.continue();
    }
  });
  
  await page.goto('https://zillow.com/test-page');
  console.log('[DEBUG] Page content set via route interception');
  
  await waitForExtensionReady(page);
  console.log('[DEBUG] Extension ready');
  
  // Check if ozDebug is available
  const ozDebugAvailable = await page.evaluate(() => typeof window.ozDebug !== 'undefined');
  console.log('[DEBUG] ozDebug available:', ozDebugAvailable);
  
  // Check initial badge count
  let badgeCount = await getOZBadgeCount(page);
  console.log('[DEBUG] Initial badge count:', badgeCount);
  
  // Check chrome mock setup
  const chromeSetup = await page.evaluate(() => {
    return {
      chromeExists: typeof window.chrome !== 'undefined',
      sendMessageExists: typeof window.chrome?.runtime?.sendMessage === 'function',
      listenersArray: window._chromeMessageListeners?.length || 0
    };
  });
  console.log('[DEBUG] Chrome mock setup:', chromeSetup);

  // Trigger scan
  console.log('[DEBUG] Triggering extension scan...');
  await triggerExtensionScan(page);
  
  // Wait and check for scan activity
  console.log('[DEBUG] Waiting 3s for scan activity...');
  await page.waitForTimeout(3000);
  
  // Check if message was received
  const hasNewLogs = await page.evaluate(() => {
    if (window.ozDebug) {
      const logs = window.ozDebug.getLogs();
      return logs.some(log => log.message.includes('Content script received message'));
    }
    return false;
  });
  console.log('[DEBUG] Message received by content script:', hasNewLogs);
  
  // Check if any oz logs were created
  const logs = await page.evaluate(() => {
    if (window.ozDebug) {
      return window.ozDebug.getLogs();
    }
    return [];
  });
  console.log('[DEBUG] OZ logs after scan:', logs.length, logs.slice(-3));
  
  // Check final badge count
  badgeCount = await getOZBadgeCount(page);
  console.log('[DEBUG] Final badge count:', badgeCount);
  
  // Check if addresses were found
  const addressElements = await page.$$('[data-test="property-card-addr"], .list-card-addr');
  console.log('[DEBUG] Address elements found:', addressElements.length);
  
  // Look for any OZ-related elements
  const ozElements = await page.$$('[class*="oz-"]');
  console.log('[DEBUG] OZ elements found:', ozElements.length);
  
  // This test is for debugging, so we'll pass regardless
  expect(true).toBe(true);
});