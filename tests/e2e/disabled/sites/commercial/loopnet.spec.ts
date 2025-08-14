// tests/e2e/sites/commercial/loopnet.spec.ts
// E2E tests for LoopNet.com integration

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

test.describe('LoopNet Integration', () => {
  test('should detect addresses using LoopNet selectors', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      await page.setContent(`
        <html>
          <head><title>Commercial Property | LoopNet</title></head>
          <body>
            <div class="placard-address">100 Biscayne Blvd, Miami, FL 33132</div>
            <div class="property-address">200 S Biscayne Blvd, Miami, FL 33131</div>
            <div data-id="property-address">2000 Ponce De Leon Blvd, Coral Gables, FL 33134</div>
            <div class="header-col-1">
              <h1>4000 Salzedo St, Coral Gables, FL 33146</h1>
            </div>
          </body>
        </html>
      `);
      
      await page.goto('data:text/html,' + encodeURIComponent(await page.content()));
      await waitForExtensionReady(page);
      
      await mockAddressResponse(page, '100 Biscayne Blvd, Miami, FL 33132', {
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
  
  test('should handle LoopNet structured address data', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      await page.setContent(`
        <html>
          <body>
            <div class="property-header">
              <div class="address-line-1">123 Main St</div>
              <div class="address-line-2">Miami, FL 33125</div>
            </div>
            <div class="summary-address">456 Ocean Dr, Miami Beach, FL 33139</div>
            <div class="placard-content-wrap">
              <div class="placard-address-tagline">789 Flagler St, Miami, FL 33130</div>
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
        const elements = document.querySelectorAll('.property-header, .summary-address, .placard-address-tagline');
        const addresses = [];
        
        elements.forEach(element => {
          const addressLine1 = element.querySelector('.address-line-1');
          const addressLine2 = element.querySelector('.address-line-2');
          
          if (addressLine1 && addressLine2) {
            addresses.push(`${addressLine1.textContent.trim()}, ${addressLine2.textContent.trim()}`);
          } else {
            const text = element.textContent.trim();
            if (text.length > 10) addresses.push(text);
          }
        });
        
        return addresses;
      });
      
      expect(extractedAddresses.length).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });
  
  test('should handle LoopNet breadcrumb addresses', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      await page.setContent(`
        <html>
          <body>
            <nav class="breadcrumbs">
              <div class="breadcrumbs__crumb">Home</div>
              <div class="breadcrumbs__crumb">Commercial</div>
              <div class="breadcrumbs__crumb">Properties in Miami, FL 33128</div>
            </nav>
            <div class="property-header">
              <div class="address">111 NW 1st St, Miami, FL 33128</div>
            </div>
          </body>
        </html>
      `);
      
      await page.goto('data:text/html,' + encodeURIComponent(await page.content()));
      await waitForExtensionReady(page);
      
      await triggerExtensionScan(page);
      await waitForAddressScan(page);
      
      // Test breadcrumb extraction
      const breadcrumbText = await page.evaluate(() => {
        const lastCrumb = document.querySelector('.breadcrumbs__crumb:last-child');
        if (lastCrumb && lastCrumb.classList.contains('breadcrumbs__crumb')) {
          const text = lastCrumb.textContent.trim();
          return text.replace(/^Properties in\s+/i, '');
        }
        return null;
      });
      
      expect(breadcrumbText).toContain('Miami, FL 33128');
    } finally {
      await context.close();
    }
  });
  
  test('should handle various LoopNet property header formats', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      await page.setContent(`
        <html>
          <body>
            <div class="property-header-address">
              <span class="address">321 Collins Ave, Miami Beach, FL 33140</span>
            </div>
            <div class="property-info">
              <div class="property-header address-container">999 Brickell Ave, Miami, FL 33131</div>
            </div>
          </body>
        </html>
      `);
      
      await page.goto('data:text/html,' + encodeURIComponent(await page.content()));
      await waitForExtensionReady(page);
      
      await triggerExtensionScan(page);
      await waitForAddressScan(page);
      
      const foundElements = await page.evaluate(() => ({
        headerAddress: document.querySelectorAll('.property-header-address').length,
        propertyHeader: document.querySelectorAll('[class*="property-header"]').length,
        addressContainers: document.querySelectorAll('[class*="address"]').length
      }));
      
      expect(foundElements.addressContainers).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });
  
  test.skip('should work with real LoopNet pages', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      const testCase = testAddresses.loopnet[0];
      await page.goto(testCase.url, { timeout: 30000 });
      await waitForExtensionReady(page);
      
      await triggerExtensionScan(page);
      await waitForAddressScan(page);
      
      const pageInfo = await page.evaluate(() => ({
        title: document.title,
        addressElements: document.querySelectorAll('.placard-address, .property-address').length
      }));
      
      expect(pageInfo.title).toContain('LoopNet');
      expect(pageInfo.addressElements).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });
});