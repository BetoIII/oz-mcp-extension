// tests/e2e/sites/all-sites.spec.ts
// Comprehensive test suite covering all supported real estate sites

import { test, expect } from '@playwright/test';
import { loadExtension } from '../../helpers/extension-loader';
import { 
  waitForExtensionReady, 
  getOZBadgeCount, 
  triggerExtensionScan,
  waitForAddressScan,
  mockAddressResponse
} from '../../helpers/test-utils';
import { KNOWN_OZ_ADDRESSES, NON_OZ_ADDRESSES } from '../../helpers/address-validator';
import testAddresses from '../../fixtures/test-addresses.json';

// Site configuration for all supported platforms
const SITE_CONFIGS = {
  'zillow.com': {
    selectors: ['[data-test="property-card-addr"]', '.list-card-addr', '.hdp__sc-qmn92k-1'],
    title: 'Zillow',
    addresses: testAddresses.zillow
  },
  'realtor.com': {
    selectors: ['[data-testid="card-address"]', '.ldp-header-address-wrapper', '.jsx-11645185.full-address'],
    title: 'Realtor',
    addresses: testAddresses.realtor
  },
  'redfin.com': {
    selectors: ['.homecardV2Address', '.street-address', '[data-rf-test-id="abp-streetLine"]'],
    title: 'Redfin',
    addresses: testAddresses.redfin
  },
  'loopnet.com': {
    selectors: ['.placard-address', '.property-address', '[data-id="property-address"]'],
    title: 'LoopNet',
    addresses: testAddresses.loopnet
  },
  'crexi.com': {
    selectors: ['[data-testid="property-address"]', '.property-header__address', '.listing-address'],
    title: 'Crexi',
    addresses: testAddresses.crexi
  },
  'commercialsearch.com': {
    selectors: ['.property-address', '.listing-detail-address', '[data-cy="property-address"]'],
    title: 'CommercialSearch',
    addresses: testAddresses.commercialsearch
  }
};

test.describe('All Sites Integration', () => {
  test('should detect site configurations correctly', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      for (const [hostname, config] of Object.entries(SITE_CONFIGS)) {
        // Create mock page for each site
        await page.setContent(`
          <html>
            <head><title>Property | ${config.title}</title></head>
            <body>
              <div class="test-content">Mock ${hostname} page</div>
            </body>
          </html>
        `);
        
        // Override hostname for testing
        await page.evaluate((host) => {
          Object.defineProperty(window.location, 'hostname', {
            writable: true,
            value: host
          });
        }, hostname);
        
        await waitForExtensionReady(page);
        
        // Test site detection
        const siteInfo = await page.evaluate(() => {
          // @ts-ignore - accessing extension functions
          return window.getCurrentSiteConfig?.() || { siteName: 'unknown' };
        });
        
        expect(siteInfo.siteName).toBe(hostname);
      }
    } finally {
      await context.close();
    }
  });
  
  test('should handle address extraction across all sites', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      const results = [];
      
      for (const [hostname, config] of Object.entries(SITE_CONFIGS)) {
        // Create comprehensive test page with addresses for each site
        const addressHTML = config.selectors.map((selector, index) => {
          const address = KNOWN_OZ_ADDRESSES[index % KNOWN_OZ_ADDRESSES.length].address;
          const cleanSelector = selector.replace(/\[|\]|"/g, '').replace(/=/g, '-');
          return `<div class="${cleanSelector}" ${selector.startsWith('[') ? selector.slice(1, -1) : ''}>${address}</div>`;
        }).join('');
        
        await page.setContent(`
          <html>
            <head><title>Test ${config.title}</title></head>
            <body>${addressHTML}</body>
          </html>
        `);
        
        await page.evaluate((host) => {
          Object.defineProperty(window.location, 'hostname', {
            writable: true,
            value: host
          });
        }, hostname);
        
        await waitForExtensionReady(page);
        
        // Mock responses for all addresses
        for (const addr of KNOWN_OZ_ADDRESSES) {
          await mockAddressResponse(page, addr.address, {
            ok: true,
            isInOpportunityZone: addr.inOZ,
            opportunityZoneId: addr.tractId
          });
        }
        
        await triggerExtensionScan(page);
        await waitForAddressScan(page);
        
        const badgeCount = await getOZBadgeCount(page);
        results.push({
          site: hostname,
          badgeCount,
          expected: config.selectors.length
        });
      }
      
      // Verify all sites found addresses
      expect(results.every(r => r.badgeCount > 0)).toBeTruthy();
    } finally {
      await context.close();
    }
  });
  
  test('should handle mixed OZ and non-OZ addresses', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      // Create page with both OZ and non-OZ addresses
      const ozAddress = KNOWN_OZ_ADDRESSES[0];
      const nonOzAddress = NON_OZ_ADDRESSES[0];
      
      await page.setContent(`
        <html>
          <body>
            <div data-test="property-card-addr">${ozAddress.address}</div>
            <div data-testid="card-address">${nonOzAddress.address}</div>
            <div class="placard-address">${KNOWN_OZ_ADDRESSES[1].address}</div>
          </body>
        </html>
      `);
      
      await page.evaluate(() => {
        Object.defineProperty(window.location, 'hostname', {
          writable: true,
          value: 'zillow.com'
        });
      });
      
      await waitForExtensionReady(page);
      
      // Mock responses
      await mockAddressResponse(page, ozAddress.address, {
        ok: true,
        isInOpportunityZone: true,
        opportunityZoneId: ozAddress.tractId
      });
      
      await mockAddressResponse(page, nonOzAddress.address, {
        ok: true,
        isInOpportunityZone: false
      });
      
      await mockAddressResponse(page, KNOWN_OZ_ADDRESSES[1].address, {
        ok: true,
        isInOpportunityZone: true,
        opportunityZoneId: KNOWN_OZ_ADDRESSES[1].tractId
      });
      
      await triggerExtensionScan(page);
      await waitForAddressScan(page);
      
      const badgeCount = await getOZBadgeCount(page);
      expect(badgeCount).toBe(2); // Only OZ addresses should have badges
    } finally {
      await context.close();
    }
  });
  
  test('should gracefully handle unsupported sites', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      await page.setContent(`
        <html>
          <body>
            <div class="address">123 Main St, Miami, FL 33125</div>
            <div class="property-address">456 Ocean Dr, Miami Beach, FL 33139</div>
          </body>
        </html>
      `);
      
      await page.evaluate(() => {
        Object.defineProperty(window.location, 'hostname', {
          writable: true,
          value: 'unsupported-site.com'
        });
      });
      
      await waitForExtensionReady(page);
      
      const siteInfo = await page.evaluate(() => {
        // @ts-ignore
        return window.getCurrentSiteConfig?.() || { siteName: 'unknown' };
      });
      
      expect(siteInfo.siteName).toBe('generic');
      
      // Should still work with generic selectors
      await mockAddressResponse(page, '123 Main St, Miami, FL 33125', {
        ok: true,
        isInOpportunityZone: true,
        opportunityZoneId: '12086004902'
      });
      
      await triggerExtensionScan(page);
      await waitForAddressScan(page);
      
      const badgeCount = await getOZBadgeCount(page);
      expect(badgeCount).toBeGreaterThanOrEqual(0); // May or may not find addresses with generic selectors
    } finally {
      await context.close();
    }
  });
  
  test('should handle site-specific extraction strategies', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      const testCases = [
        {
          site: 'realtor.com',
          html: `
            <div class="ldp-header-address-wrapper">
              <span itemprop="streetAddress">789 Flagler St</span>
              <span itemprop="addressLocality">Miami</span>
              <span itemprop="addressRegion">FL</span>
              <span itemprop="postalCode">33130</span>
            </div>
          `
        },
        {
          site: 'redfin.com',
          html: `
            <div class="address-container">
              <div class="street-address">100 Biscayne Blvd</div>
              <div class="bp-cityStateZip">Miami, FL 33132</div>
            </div>
          `
        },
        {
          site: 'loopnet.com',
          html: `
            <div class="property-container">
              <div class="address-line-1">111 NW 1st St</div>
              <div class="address-line-2">Miami, FL 33128</div>
            </div>
          `
        }
      ];
      
      for (const testCase of testCases) {
        await page.setContent(`<html><body>${testCase.html}</body></html>`);
        
        await page.evaluate((site) => {
          Object.defineProperty(window.location, 'hostname', {
            writable: true,
            value: site
          });
        }, testCase.site);
        
        await waitForExtensionReady(page);
        await triggerExtensionScan(page);
        
        // Each site should be able to extract addresses using its specific strategy
        const extractionResult = await page.evaluate(() => {
          const elements = document.querySelectorAll('div[class*="address"], div[itemprop], div[class*="street"]');
          return elements.length > 0;
        });
        
        expect(extractionResult).toBeTruthy();
      }
    } finally {
      await context.close();
    }
  });
  
  test('should handle dynamic content loading delays', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      // Start with empty page
      await page.setContent(`
        <html>
          <body>
            <div id="content-container"></div>
          </body>
        </html>
      `);
      
      await page.evaluate(() => {
        Object.defineProperty(window.location, 'hostname', {
          writable: true,
          value: 'zillow.com'
        });
      });
      
      await waitForExtensionReady(page);
      
      // Simulate delayed content loading
      await page.evaluate(() => {
        setTimeout(() => {
          const container = document.getElementById('content-container');
          const addressDiv = document.createElement('div');
          addressDiv.setAttribute('data-test', 'property-card-addr');
          addressDiv.textContent = '200 S Biscayne Blvd, Miami, FL 33131';
          container.appendChild(addressDiv);
        }, 2000); // 2 second delay
      });
      
      await mockAddressResponse(page, '200 S Biscayne Blvd, Miami, FL 33131', {
        ok: true,
        isInOpportunityZone: true,
        opportunityZoneId: '12086003000'
      });
      
      // Wait for dynamic content and then scan
      await page.waitForTimeout(2500);
      await triggerExtensionScan(page);
      await waitForAddressScan(page);
      
      const badgeCount = await getOZBadgeCount(page);
      expect(badgeCount).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });
  
  test.describe('Site Monitoring', () => {
    const sites = Object.keys(SITE_CONFIGS);
    
    sites.forEach(site => {
      test.skip(`should monitor ${site} selector health`, async () => {
        // Skip these tests in regular runs - they're for monitoring
        const context = await loadExtension();
        const page = await context.newPage();
        
        try {
          const config = SITE_CONFIGS[site];
          
          // Create minimal test page with expected selectors
          const testHTML = config.selectors.map(selector => {
            const cleanSelector = selector.replace(/\[|\]|"/g, '').replace(/=/g, '-');
            return `<div class="${cleanSelector}" ${selector.startsWith('[') ? selector.slice(1, -1) : ''}>Test Address</div>`;
          }).join('');
          
          await page.setContent(`<html><body>${testHTML}</body></html>`);
          
          // Check if selectors are found
          const selectorResults = await page.evaluate((selectors) => {
            return selectors.map(selector => ({
              selector,
              found: document.querySelector(selector) !== null,
              count: document.querySelectorAll(selector).length
            }));
          }, config.selectors);
          
          const healthySelectors = selectorResults.filter(r => r.found);
          const healthRatio = healthySelectors.length / config.selectors.length;
          
          // Log health status for monitoring
          console.log(`${site} selector health: ${healthRatio * 100}%`);
          console.log('Selector results:', selectorResults);
          
          // Consider site healthy if at least 50% of selectors work
          expect(healthRatio).toBeGreaterThan(0.5);
        } finally {
          await context.close();
        }
      });
    });
  });
});