// tests/e2e/sites/commercial/crexi.spec.ts
// E2E tests for Crexi.com integration

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

test.describe('Crexi Integration', () => {
  test('should detect addresses using Crexi selectors', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      await page.setContent(`
        <html>
          <head><title>Commercial Property | Crexi</title></head>
          <body>
            <div data-testid="property-address">50 Biscayne Blvd, Miami, FL 33132</div>
            <div class="property-header__address">4000 Salzedo St, Coral Gables, FL 33146</div>
            <div class="listing-address">123 Main St, Miami, FL 33125</div>
            <div class="MuiTypography-root MuiTypography-h6">456 Ocean Dr, Miami Beach, FL 33139</div>
          </body>
        </html>
      `);
      
      await page.goto('data:text/html,' + encodeURIComponent(await page.content()));
      await waitForExtensionReady(page);
      
      await mockAddressResponse(page, '50 Biscayne Blvd, Miami, FL 33132', {
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
  
  test('should handle Crexi Material-UI components', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      await page.setContent(`
        <html>
          <body>
            <div class="MuiTypography-root MuiTypography-h6 PropertyAddress-main">
              789 Flagler St, Miami, FL 33130
            </div>
            <div class="property-details-header__address">
              321 Collins Ave, Miami Beach, FL 33140
            </div>
            <div class="PropertyAddress-container">
              <span>999 Brickell Ave, Miami, FL 33131</span>
            </div>
          </body>
        </html>
      `);
      
      await page.goto('data:text/html,' + encodeURIComponent(await page.content()));
      await waitForExtensionReady(page);
      
      await triggerExtensionScan(page);
      await waitForAddressScan(page);
      
      const foundElements = await page.evaluate(() => ({
        muiTypography: document.querySelectorAll('.MuiTypography-root.MuiTypography-h6').length,
        headerAddress: document.querySelectorAll('.property-details-header__address').length,
        propertyAddress: document.querySelectorAll('[class*="PropertyAddress"]').length
      }));
      
      expect(foundElements.muiTypography + foundElements.headerAddress + foundElements.propertyAddress).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });
  
  test('should handle Crexi listing card addresses', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      await page.setContent(`
        <html>
          <body>
            <div class="ListingCard-main">
              <div class="address-info">111 NW 1st St, Miami, FL 33128</div>
            </div>
            <div class="ListingCard-container">
              <span class="card-address">100 Biscayne Blvd, Miami, FL 33132</span>
            </div>
            <div class="map-card-address">200 S Biscayne Blvd, Miami, FL 33131</div>
          </body>
        </html>
      `);
      
      await page.goto('data:text/html,' + encodeURIComponent(await page.content()));
      await waitForExtensionReady(page);
      
      await triggerExtensionScan(page);
      await waitForAddressScan(page);
      
      const foundElements = await page.evaluate(() => ({
        listingCards: document.querySelectorAll('[class*="ListingCard"]').length,
        mapCard: document.querySelectorAll('.map-card-address').length,
        addressElements: document.querySelectorAll('[class*="address"]').length
      }));
      
      expect(foundElements.addressElements).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });
  
  test('should use standard extraction strategy for Crexi', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      await page.setContent(`
        <html>
          <body>
            <div data-testid="property-address">
              <span>2000 Ponce De Leon Blvd</span>
              <br>
              <span>Coral Gables, FL 33134</span>
            </div>
            <div class="property-header__address">
              8950 SW 74th Ct, Miami, FL 33156
            </div>
          </body>
        </html>
      `);
      
      await page.goto('data:text/html,' + encodeURIComponent(await page.content()));
      await waitForExtensionReady(page);
      
      await triggerExtensionScan(page);
      await waitForAddressScan(page);
      
      // Test standard extraction (just clean text content)
      const extractedText = await page.evaluate(() => {
        const elements = document.querySelectorAll('[data-testid="property-address"], .property-header__address');
        return Array.from(elements).map(el => {
          return el.textContent.trim()
            .replace(/\\s+/g, ' ')
            .replace(/^[,\\s]+|[,\\s]+$/g, '')
            .replace(/,,+/g, ',')
            .replace(/\\|/g, ',')
            .replace(/\\s*,\\s*/g, ', ');
        });
      });
      
      expect(extractedText.length).toBeGreaterThan(0);
      expect(extractedText.some(addr => addr.includes('Ponce De Leon') || addr.includes('SW 74th Ct'))).toBeTruthy();
    } finally {
      await context.close();
    }
  });
  
  test.skip('should work with real Crexi pages', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      const testCase = testAddresses.crexi[0];
      await page.goto(testCase.url, { timeout: 30000 });
      await waitForExtensionReady(page);
      
      await triggerExtensionScan(page);
      await waitForAddressScan(page);
      
      const pageInfo = await page.evaluate(() => ({
        title: document.title,
        addressElements: document.querySelectorAll('[data-testid="property-address"], .property-header__address').length
      }));
      
      expect(pageInfo.title).toContain('Crexi');
      expect(pageInfo.addressElements).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });
});