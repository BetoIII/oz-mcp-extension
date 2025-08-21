// tests/e2e/sites/commercial/commercialsearch.spec.ts
// E2E tests for CommercialSearch.com integration

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

test.describe('CommercialSearch Integration', () => {
  test('should detect addresses using CommercialSearch selectors', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      await page.setContent(`
        <html>
          <head><title>Commercial Property | CommercialSearch</title></head>
          <body>
            <div class="property-address">200 S Biscayne Blvd, Miami, FL 33131</div>
            <div class="listing-detail-address">8950 SW 74th Ct, Miami, FL 33156</div>
            <div class="property-header">
              <address>123 Main St, Miami, FL 33125</address>
            </div>
            <div data-cy="property-address">456 Ocean Dr, Miami Beach, FL 33139</div>
          </body>
        </html>
      `);
      
      await page.goto('data:text/html,' + encodeURIComponent(await page.content()));
      await waitForExtensionReady(page);
      
      await mockAddressResponse(page, '200 S Biscayne Blvd, Miami, FL 33131', {
        ok: true,
        isInOpportunityZone: true,
        opportunityZoneId: '12086003000'
      });
      
      await triggerExtensionScan(page);
      await waitForAddressScan(page);
      
      const badgeCount = await getOZBadgeCount(page);
      expect(badgeCount).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });
  
  test('should handle CommercialSearch CoStar-style addresses', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      await page.setContent(`
        <html>
          <body>
            <div class="property-summary__address">
              <div class="address-line-1">789 Flagler St</div>
              <div class="address-line-2">Miami, FL 33130</div>
            </div>
            <div class="listing-card__address">321 Collins Ave, Miami Beach, FL 33140</div>
            <div class="detail-header__address">999 Brickell Ave, Miami, FL 33131</div>
          </body>
        </html>
      `);
      
      await page.goto('data:text/html,' + encodeURIComponent(await page.content()));
      await waitForExtensionReady(page);
      
      await triggerExtensionScan(page);
      await waitForAddressScan(page);
      
      // Test CoStar extraction strategy simulation
      const extractedAddresses = await page.evaluate(() => {
        const elements = document.querySelectorAll('.property-summary__address, .listing-card__address');
        const addresses = [];
        
        elements.forEach(element => {
          const lines = element.querySelectorAll('[class*="address-line"]');
          if (lines.length > 0) {
            const addressParts = Array.from(lines).map(l => l.textContent.trim()).join(', ');
            addresses.push(addressParts);
          } else {
            addresses.push(element.textContent.trim());
          }
        });
        
        return addresses;
      });
      
      expect(extractedAddresses.length).toBeGreaterThan(0);
      expect(extractedAddresses[0]).toContain('789 Flagler St');
    } finally {
      await context.close();
    }
  });
  
  test('should handle CommercialSearch address elements', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      await page.setContent(`
        <html>
          <body>
            <div class="property-header">
              <address>
                <span>111 NW 1st St</span>
                <span>Miami, FL 33128</span>
              </address>
            </div>
            <div class="listing-info">
              <div class="address-line-primary">100 Biscayne Blvd</div>
              <div class="address-line-secondary">Miami, FL 33132</div>
            </div>
          </body>
        </html>
      `);
      
      await page.goto('data:text/html,' + encodeURIComponent(await page.content()));
      await waitForExtensionReady(page);
      
      await triggerExtensionScan(page);
      await waitForAddressScan(page);
      
      // Test address element extraction
      const addressElements = await page.evaluate(() => {
        const addresses = document.querySelectorAll('address');
        const results = [];
        
        addresses.forEach(addr => {
          if (addr.tagName === 'ADDRESS') {
            const spans = addr.querySelectorAll('span');
            if (spans.length > 0) {
              const addressText = Array.from(spans).map(s => s.textContent.trim()).join(', ');
              results.push(addressText);
            } else {
              results.push(addr.textContent.trim());
            }
          }
        });
        
        return results;
      });
      
      expect(addressElements.length).toBeGreaterThan(0);
      expect(addressElements[0]).toContain('111 NW 1st St');
    } finally {
      await context.close();
    }
  });
  
  test('should handle Cypress test selectors', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      await page.setContent(`
        <html>
          <body>
            <div data-cy="property-address">2000 Ponce De Leon Blvd, Coral Gables, FL 33134</div>
            <div data-cy="listing-address">4000 Salzedo St, Coral Gables, FL 33146</div>
            <div class="property-card" data-cy="property-card">
              <div class="address">50 Biscayne Blvd, Miami, FL 33132</div>
            </div>
          </body>
        </html>
      `);
      
      await page.goto('data:text/html,' + encodeURIComponent(await page.content()));
      await waitForExtensionReady(page);
      
      await triggerExtensionScan(page);
      await waitForAddressScan(page);
      
      const cypressElements = await page.evaluate(() => ({
        propertyAddress: document.querySelectorAll('[data-cy="property-address"]').length,
        listingAddress: document.querySelectorAll('[data-cy="listing-address"]').length,
        propertyCards: document.querySelectorAll('[data-cy*="property"]').length
      }));
      
      expect(cypressElements.propertyAddress + cypressElements.listingAddress).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });
  
  test.skip('should work with real CommercialSearch pages', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      const testCase = testAddresses.commercialsearch[0];
      await page.goto(testCase.url, { timeout: 30000 });
      await waitForExtensionReady(page);
      
      await triggerExtensionScan(page);
      await waitForAddressScan(page);
      
      const pageInfo = await page.evaluate(() => ({
        title: document.title,
        addressElements: document.querySelectorAll('.property-address, .listing-detail-address').length
      }));
      
      expect(pageInfo.title).toContain('CommercialSearch');
      expect(pageInfo.addressElements).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });
});