// Site detection and configuration tests
import { test, expect } from '@playwright/test';
import { waitForExtensionReady } from '../../helpers/test-utils';

test.describe('Site Detection', () => {
  test('should detect Zillow.com correctly', async ({ page }) => {
    // Use route interception to simulate being on zillow.com
    await page.route('**/*', (route) => {
      if (route.request().url().includes('zillow.com')) {
        route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<html><head><title>Test | Zillow</title></head><body><h1>Zillow Test</h1></body></html>'
        });
      } else {
        route.continue();
      }
    });
    
    await page.goto('https://zillow.com/test-page');
    await waitForExtensionReady(page);
    
    // Check site detection via oz logs
    const pageInfo = await page.evaluate(() => {
      const logs = window.ozDebug.getLogs();
      return logs.find(log => log.message === 'Page info')?.data;
    });
    
    expect(pageInfo).toBeTruthy();
    expect(pageInfo.domain).toBe('zillow.com');
    expect(pageInfo.siteName).toBe('zillow.com');
    expect(pageInfo.supportedSite).toBe(true);
  });

  test('should detect Realtor.com correctly', async ({ page }) => {
    await page.route('**/*', (route) => {
      if (route.request().url().includes('realtor.com')) {
        route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<html><head><title>Test | Realtor</title></head><body><h1>Realtor Test</h1></body></html>'
        });
      } else {
        route.continue();
      }
    });
    
    await page.goto('https://realtor.com/test-page');
    await waitForExtensionReady(page);
    
    const pageInfo = await page.evaluate(() => {
      const logs = window.ozDebug.getLogs();
      return logs.find(log => log.message === 'Page info')?.data;
    });
    
    expect(pageInfo.domain).toBe('realtor.com');
    expect(pageInfo.siteName).toBe('realtor.com');
    expect(pageInfo.supportedSite).toBe(true);
  });

  test('should handle generic sites', async ({ page }) => {
    await page.goto('https://example.com');
    await waitForExtensionReady(page);
    
    const pageInfo = await page.evaluate(() => {
      const logs = window.ozDebug.getLogs();
      return logs.find(log => log.message === 'Page info')?.data;
    });
    
    expect(pageInfo.domain).toBe('example.com');
    expect(pageInfo.siteName).toBe('generic');
    expect(pageInfo.supportedSite).toBe(false);
  });
});