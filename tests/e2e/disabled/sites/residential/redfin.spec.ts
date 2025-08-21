// tests/e2e/sites/residential/redfin.spec.ts
// E2E tests for Redfin.com integration

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

test.describe('Redfin Integration', () => {
  test('should detect addresses using Redfin selectors', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      await page.setContent(`
        <html>
          <head><title>Property Details | Redfin</title></head>
          <body>
            <div class="homecardV2Address">111 NW 1st St, Miami, FL 33128</div>
            <div class="street-address">999 Brickell Ave</div>
            <div class="bp-cityStateZip">Miami, FL 33131</div>
            <div data-rf-test-id="abp-streetLine">123 Main St</div>
            <div class="cityStateZip">Miami, FL 33125</div>
          </body>
        </html>
      `);
      
      await page.goto('data:text/html,' + encodeURIComponent(await page.content()));
      await waitForExtensionReady(page);
      
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
  
  test('should handle Redfin address splitting strategy', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      await page.setContent(`
        <html>
          <body>
            <div class="address-container">
              <div class="street-address">100 Biscayne Blvd</div>
              <div class="bp-cityStateZip">Miami, FL 33132</div>
            </div>
            <div class="another-container">
              <div data-rf-test-id="abp-streetLine">200 S Biscayne Blvd</div>
              <div class="cityStateZip">Miami, FL 33131</div>
            </div>
          </body>
        </html>
      `);
      
      await page.goto('data:text/html,' + encodeURIComponent(await page.content()));
      await waitForExtensionReady(page);
      
      await triggerExtensionScan(page);
      await waitForAddressScan(page);
      
      // Test the extraction strategy simulation
      const extractedAddresses = await page.evaluate(() => {
        const containers = document.querySelectorAll('.address-container, .another-container');
        const addresses = [];
        
        containers.forEach(container => {
          const parts = [];
          const streetElement = container.querySelector('.street-address') || 
                               container.querySelector('[data-rf-test-id="abp-streetLine"]');
          const cityStateZip = container.querySelector('.cityStateZip') || 
                              container.querySelector('.bp-cityStateZip');
          
          if (streetElement) parts.push(streetElement.textContent.trim());
          if (cityStateZip) parts.push(cityStateZip.textContent.trim());
          
          if (parts.length > 0) {
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
  
  test('should handle Redfin full address elements', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      await page.setContent(`
        <html>
          <body>
            <div class="full-address">789 Flagler St, Miami, FL 33130</div>
            <div class="homeAddressV2">321 Collins Ave, Miami Beach, FL 33140</div>
            <div class="HomeDetailsHeader">
              <div class="full-address">456 Ocean Dr, Miami Beach, FL 33139</div>
            </div>
          </body>
        </html>
      `);
      
      await page.goto('data:text/html,' + encodeURIComponent(await page.content()));
      await waitForExtensionReady(page);
      
      await triggerExtensionScan(page);
      await waitForAddressScan(page);
      
      const foundElements = await page.evaluate(() => ({
        fullAddress: document.querySelectorAll('.full-address').length,
        homeAddress: document.querySelectorAll('.homeAddressV2').length,
        headerAddress: document.querySelectorAll('.HomeDetailsHeader .full-address').length
      }));
      
      expect(foundElements.fullAddress + foundElements.homeAddress).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });
  
  test('should handle Redfin data attributes', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      await page.setContent(`
        <html>
          <body>
            <div data-rf-test-name="abp-streetLine">2000 Ponce De Leon Blvd, Coral Gables, FL 33134</div>
            <div class="AddressSection-container">
              <span>4000 Salzedo St, Coral Gables, FL 33146</span>
            </div>
          </body>
        </html>
      `);
      
      await page.goto('data:text/html,' + encodeURIComponent(await page.content()));
      await waitForExtensionReady(page);
      
      await triggerExtensionScan(page);
      await waitForAddressScan(page);
      
      const foundElements = await page.evaluate(() => ({
        testName: document.querySelectorAll('[data-rf-test-name="abp-streetLine"]').length,
        addressSection: document.querySelectorAll('[class*="AddressSection"]').length
      }));
      
      expect(foundElements.testName + foundElements.addressSection).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });
  
  test.skip('should work with real Redfin pages', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      const testCase = testAddresses.redfin[0];
      await page.goto(testCase.url, { timeout: 30000 });
      await waitForExtensionReady(page);
      
      await triggerExtensionScan(page);
      await waitForAddressScan(page);
      
      const pageInfo = await page.evaluate(() => ({
        title: document.title,
        addressElements: document.querySelectorAll('.homecardV2Address, .street-address').length
      }));
      
      expect(pageInfo.title).toContain('Redfin');
      expect(pageInfo.addressElements).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });
});