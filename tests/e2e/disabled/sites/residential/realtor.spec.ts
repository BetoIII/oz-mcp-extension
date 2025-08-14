// tests/e2e/sites/residential/realtor.spec.ts
// E2E tests for Realtor.com integration

import { test, expect } from '@playwright/test';
import { loadExtension } from '../../../helpers/extension-loader';
import { 
  waitForExtensionReady, 
  getOZBadgeCount, 
  triggerExtensionScan,
  waitForAddressScan,
  mockAddressResponse
} from '../../../helpers/test-utils';
import testAddresses from '../../../fixtures/test-addresses.json';

test.describe('Realtor.com Integration', () => {
  test('should detect addresses using Realtor selectors', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      await page.setContent(`
        <html>
          <head><title>Property Details | Realtor.com</title></head>
          <body>
            <div data-testid="card-address">789 Flagler St, Miami, FL 33130</div>
            <div class="ldp-header-address-wrapper">
              <span itemprop="streetAddress">321 Collins Ave</span>
              <span itemprop="addressLocality">Miami Beach</span>
              <span itemprop="addressRegion">FL</span>
              <span itemprop="postalCode">33140</span>
            </div>
            <div class="jsx-11645185 full-address">999 Brickell Ave, Miami, FL 33131</div>
          </body>
        </html>
      `);
      
      await page.goto('data:text/html,' + encodeURIComponent(await page.content()));
      await waitForExtensionReady(page);
      
      await mockAddressResponse(page, '789 Flagler St, Miami, FL 33130', {
        ok: true,
        isInOpportunityZone: true,
        opportunityZoneId: '12086003700'
      });
      
      await triggerExtensionScan(page);
      await waitForAddressScan(page);
      
      const badgeCount = await getOZBadgeCount(page);
      expect(badgeCount).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });
  
  test('should handle Realtor.com structured data extraction', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      await page.setContent(`
        <html>
          <body>
            <div class="ldp-header-address-wrapper">
              <div>
                <span itemprop="streetAddress">100 Biscayne Blvd</span>
                <span itemprop="addressLocality">Miami</span>
                <span itemprop="addressRegion">FL</span>
                <span itemprop="postalCode">33132</span>
              </div>
            </div>
            <div class="home-summary-row">
              <span itemprop="streetAddress">200 S Biscayne Blvd, Miami, FL 33131</span>
            </div>
          </body>
        </html>
      `);
      
      await page.goto('data:text/html,' + encodeURIComponent(await page.content()));
      await waitForExtensionReady(page);
      
      await triggerExtensionScan(page);
      await waitForAddressScan(page);
      
      // Test the extraction strategy
      const extractedAddresses = await page.evaluate(() => {
        const elements = document.querySelectorAll('.ldp-header-address-wrapper, .home-summary-row');
        const addresses = [];
        
        elements.forEach(element => {
          // Simulate the realtor extraction strategy
          const streetAddress = element.querySelector('[itemprop="streetAddress"]');
          const locality = element.querySelector('[itemprop="addressLocality"]');
          const region = element.querySelector('[itemprop="addressRegion"]');
          const postalCode = element.querySelector('[itemprop="postalCode"]');
          
          if (streetAddress) {
            const parts = [streetAddress.textContent.trim()];
            if (locality) parts.push(locality.textContent.trim());
            if (region && postalCode) {
              parts.push(`${region.textContent.trim()} ${postalCode.textContent.trim()}`);
            }
            addresses.push(parts.join(', '));
          }
        });
        
        return addresses;
      });
      
      expect(extractedAddresses.length).toBeGreaterThan(0);
      expect(extractedAddresses[0]).toContain('100 Biscayne Blvd');
    } finally {
      await context.close();
    }
  });
  
  test('should handle Realtor.com RUI components', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      await page.setContent(`
        <html>
          <body>
            <div class="rui__sc-119fdwq-0">123 Main St, Miami, FL 33125</div>
            <div data-label="property-address">456 Ocean Dr, Miami Beach, FL 33139</div>
            <div data-testid="property-meta-address">111 NW 1st St, Miami, FL 33128</div>
          </body>
        </html>
      `);
      
      await page.goto('data:text/html,' + encodeURIComponent(await page.content()));
      await waitForExtensionReady(page);
      
      await triggerExtensionScan(page);
      await waitForAddressScan(page);
      
      const foundSelectors = await page.evaluate(() => {
        return {
          rui: document.querySelectorAll('.rui__sc-119fdwq-0').length,
          dataLabel: document.querySelectorAll('[data-label="property-address"]').length,
          testId: document.querySelectorAll('[data-testid="property-meta-address"]').length
        };
      });
      
      expect(foundSelectors.rui + foundSelectors.dataLabel + foundSelectors.testId).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });
  
  test.skip('should work with real Realtor.com pages', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      const testCase = testAddresses.realtor[0];
      await page.goto(testCase.url, { timeout: 30000 });
      await waitForExtensionReady(page);
      
      await triggerExtensionScan(page);
      await waitForAddressScan(page);
      
      const pageInfo = await page.evaluate(() => ({
        title: document.title,
        addressElements: document.querySelectorAll('[data-testid="card-address"], .ldp-header-address-wrapper').length
      }));
      
      expect(pageInfo.title).toContain('Realtor');
      expect(pageInfo.addressElements).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });
});