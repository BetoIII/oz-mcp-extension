// Address selector detection tests - tests DOM queries without requiring badge creation
import { test, expect } from '@playwright/test';
import { waitForExtensionReady } from '../../helpers/test-utils';

test.describe('Address Selector Detection', () => {
  test('should find Zillow address selectors', async ({ page }) => {
    await page.route('**/*', (route) => {
      if (route.request().url().includes('zillow.com')) {
        route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: `
            <html>
              <head><title>Property | Zillow</title></head>
              <body>
                <div data-test="property-card-addr">123 Main St, Miami, FL 33125</div>
                <div class="list-card-addr">456 Ocean Dr, Miami Beach, FL 33139</div>
                <h1 class="hdp__sc-qmn92k-1">789 Flagler St, Miami, FL 33130</h1>
                <div data-testid="bdp-property-address">101 Park Ave, Miami, FL 33131</div>
              </body>
            </html>
          `
        });
      } else {
        route.continue();
      }
    });
    
    await page.goto('https://zillow.com/property/123');
    await waitForExtensionReady(page);
    
    // Test that Zillow selectors find address elements
    const zillowSelectors = [
      '[data-test="property-card-addr"]',
      '.list-card-addr', 
      '.hdp__sc-qmn92k-1',
      '[data-testid="bdp-property-address"]'
    ];
    
    for (const selector of zillowSelectors) {
      const elements = await page.$$(selector);
      expect(elements.length).toBeGreaterThan(0);
      
      const text = await page.textContent(selector);
      expect(text).toMatch(/\d+.*St|Ave|Dr.*FL|NY|CA/); // Basic address pattern
    }
  });

  test('should find Realtor address selectors', async ({ page }) => {
    await page.route('**/*', (route) => {
      if (route.request().url().includes('realtor.com')) {
        route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: `
            <html>
              <head><title>Property | Realtor</title></head>
              <body>
                <div data-testid="card-address">123 Main St, Miami, FL 33125</div>
                <div class="rui__sc-119fdwq-0">456 Ocean Dr, Miami Beach, FL 33139</div>
                <div data-label="property-address">789 Flagler St, Miami, FL 33130</div>
                <div class="jsx-11645185 full-address">101 Park Ave, Miami, FL 33131</div>
              </body>
            </html>
          `
        });
      } else {
        route.continue();
      }
    });
    
    await page.goto('https://realtor.com/property/123');
    await waitForExtensionReady(page);
    
    const realtorSelectors = [
      '[data-testid="card-address"]',
      '.rui__sc-119fdwq-0',
      '[data-label="property-address"]',
      '.jsx-11645185.full-address'
    ];
    
    for (const selector of realtorSelectors) {
      const elements = await page.$$(selector);
      expect(elements.length).toBeGreaterThan(0);
      
      const text = await page.textContent(selector);
      expect(text).toMatch(/\d+.*St|Ave|Dr.*FL|NY|CA/);
    }
  });

  test('should find LoopNet commercial address selectors', async ({ page }) => {
    await page.route('**/*', (route) => {
      if (route.request().url().includes('loopnet.com')) {
        route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: `
            <html>
              <head><title>Commercial Property | LoopNet</title></head>
              <body>
                <div class="placard-address">123 Business Blvd, Miami, FL 33125</div>
                <div class="property-address">456 Commerce Dr, Miami, FL 33139</div>
                <div data-id="property-address">789 Industrial Way, Miami, FL 33130</div>
                <h1 class="header-col-1">101 Office Plaza, Miami, FL 33131</h1>
              </body>
            </html>
          `
        });
      } else {
        route.continue();
      }
    });
    
    await page.goto('https://loopnet.com/property/123');
    await waitForExtensionReady(page);
    
    const loopnetSelectors = [
      '.placard-address',
      '.property-address',
      '[data-id="property-address"]',
      '.header-col-1'
    ];
    
    for (const selector of loopnetSelectors) {
      const elements = await page.$$(selector);
      expect(elements.length).toBeGreaterThan(0);
      
      const text = await page.textContent(selector);
      expect(text).toMatch(/\d+.*Blvd|Dr|Way|Plaza.*FL|NY|CA/);
    }
  });

  test('should handle pages with no address elements', async ({ page }) => {
    await page.route('**/*', (route) => {
      if (route.request().url().includes('zillow.com')) {
        route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: `
            <html>
              <head><title>Search | Zillow</title></head>
              <body>
                <h1>Search Results</h1>
                <p>No properties found</p>
              </body>
            </html>
          `
        });
      } else {
        route.continue();
      }
    });
    
    await page.goto('https://zillow.com/search');
    await waitForExtensionReady(page);
    
    // Should not find any address elements
    const addressElements = await page.$$('[data-test="property-card-addr"], .list-card-addr');
    expect(addressElements.length).toBe(0);
    
    // But extension should still load and detect the site
    const pageInfo = await page.evaluate(() => {
      const logs = window.ozDebug.getLogs();
      return logs.find(log => log.message === 'Page info')?.data;
    });
    
    expect(pageInfo.siteName).toBe('zillow.com');
    expect(pageInfo.supportedSite).toBe(true);
  });
});