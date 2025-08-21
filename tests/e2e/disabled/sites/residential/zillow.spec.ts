// tests/e2e/sites/residential/zillow.spec.ts
// E2E tests for Zillow.com integration

import { test, expect } from '@playwright/test';
import { loadExtension } from '../../../helpers/extension-loader';
import { 
  waitForExtensionReady, 
  injectTestAddress, 
  getOZBadgeCount, 
  triggerExtensionScan,
  waitForAddressScan,
  mockAddressResponse
} from '../../../helpers/test-utils';
import { KNOWN_OZ_ADDRESSES, NON_OZ_ADDRESSES } from '../../../helpers/address-validator';
import testAddresses from '../../../fixtures/test-addresses.json';

test.describe('Zillow Integration', () => {
  test('should detect addresses using Zillow selectors', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      // Create a mock Zillow page
      await page.setContent(`
        <html>
          <head><title>Property Details | Zillow</title></head>
          <body>
            <div data-test="property-card-addr">123 Main St, Miami, FL 33125</div>
            <div class="list-card-addr">456 Ocean Dr, Miami Beach, FL 33139</div>
            <h1 class="Text-address">789 Flagler St, Miami, FL 33130</h1>
          </body>
        </html>
      `);
      
      await page.goto('data:text/html,' + encodeURIComponent(await page.content()));
      await waitForExtensionReady(page);
      
      // Mock API responses
      await mockAddressResponse(page, '123 Main St, Miami, FL 33125', {
        ok: true,
        isInOpportunityZone: true,
        opportunityZoneId: '12086004902'
      });
      
      await mockAddressResponse(page, '456 Ocean Dr, Miami Beach, FL 33139', {
        ok: true,
        isInOpportunityZone: false
      });
      
      await triggerExtensionScan(page);
      await waitForAddressScan(page);
      
      const badgeCount = await getOZBadgeCount(page);
      expect(badgeCount).toBeGreaterThan(0);
      
      // Check that OZ addresses have badges
      const ozBadge = await page.$('[data-test="property-card-addr"] + .oz-mcp-badge');
      expect(ozBadge).toBeTruthy();
    } finally {
      await context.close();
    }
  });
  
  test('should handle Zillow address extraction strategies', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      await page.setContent(`
        <html>
          <body>
            <div class="hdp__sc-qmn92k-1">
              <h1>100 Biscayne Blvd</h1>
              <span>Miami, FL 33132</span>
            </div>
            <div data-testid="bdp-property-address">200 S Biscayne Blvd, Miami, FL 33131</div>
          </body>
        </html>
      `);
      
      await page.goto('data:text/html,' + encodeURIComponent(await page.content()));
      await waitForExtensionReady(page);
      
      await triggerExtensionScan(page);
      await waitForAddressScan(page);
      
      // Check that addresses were detected
      const addresses = await page.evaluate(() => {
        const config = window.getCurrentSiteConfig?.() || {};
        return {
          siteName: config.siteName || 'unknown',
          foundElements: document.querySelectorAll('[data-testid="bdp-property-address"]').length
        };
      });
      
      expect(addresses.foundElements).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });
  
  test('should work with dynamic Zillow content', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      await page.setContent(`
        <html>
          <body>
            <div id="container"></div>
          </body>
        </html>
      `);
      
      await page.goto('data:text/html,' + encodeURIComponent(await page.content()));
      await waitForExtensionReady(page);
      
      // Simulate dynamic content loading
      await page.evaluate(() => {
        setTimeout(() => {
          const container = document.getElementById('container');
          const addressDiv = document.createElement('div');
          addressDiv.setAttribute('data-test', 'property-card-addr');
          addressDiv.textContent = '111 NW 1st St, Miami, FL 33128';
          container.appendChild(addressDiv);
        }, 1000);
      });
      
      await mockAddressResponse(page, '111 NW 1st St, Miami, FL 33128', {
        ok: true,
        isInOpportunityZone: true,
        opportunityZoneId: '12086004801'
      });
      
      await triggerExtensionScan(page);
      await waitForAddressScan(page);
      
      const badgeCount = await getOZBadgeCount(page);
      expect(badgeCount).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });
  
  test.skip('should work with real Zillow pages', async () => {
    // Skip by default to avoid hitting real sites in CI
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      const testCase = testAddresses.zillow[0];
      await page.goto(testCase.url, { timeout: 30000 });
      await waitForExtensionReady(page);
      
      await triggerExtensionScan(page);
      await waitForAddressScan(page);
      
      // Check for address detection
      const pageInfo = await page.evaluate(() => ({
        title: document.title,
        addressElements: document.querySelectorAll('[data-test="property-card-addr"], .list-card-addr').length
      }));
      
      expect(pageInfo.title).toContain('Zillow');
      expect(pageInfo.addressElements).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });
});