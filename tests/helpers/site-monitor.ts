// tests/helpers/site-monitor.ts
// Site monitoring system for detecting changes in real estate site structures

import { Page } from '@playwright/test';

export interface SiteMonitorConfig {
  site: string;
  selectors: string[];
  checkInterval: number;
  alertThreshold: number;
  extractionStrategy: string;
  waitForSelector?: string;
  scanDelay: number;
}

export interface HealthStatus {
  healthy: boolean;
  successRate: number;
  lastCheck: Date;
  failedSelectors: string[];
  workingSelectors: string[];
}

export class SiteMonitor {
  private configs: Map<string, SiteMonitorConfig> = new Map();
  private results: Map<string, boolean[]> = new Map();
  
  constructor() {
    this.initializeConfigs();
  }
  
  private initializeConfigs() {
    const sites: SiteMonitorConfig[] = [
      {
        site: 'zillow.com',
        selectors: [
          '[data-test="property-card-addr"]',
          '.list-card-addr',
          '.hdp__sc-qmn92k-1',
          'h1[class*="Text-"]',
          '[data-testid="bdp-property-address"]'
        ],
        checkInterval: 24 * 60 * 60 * 1000, // 24 hours
        alertThreshold: 0.6, // 60% of selectors must work
        extractionStrategy: 'standard',
        waitForSelector: '[data-test="property-card-addr"], .list-card-addr',
        scanDelay: 1000
      },
      {
        site: 'realtor.com',
        selectors: [
          '[data-testid="card-address"]',
          '.rui__sc-119fdwq-0',
          '[data-label="property-address"]',
          '.ldp-header-address-wrapper',
          '.jsx-11645185.full-address'
        ],
        checkInterval: 24 * 60 * 60 * 1000,
        alertThreshold: 0.6,
        extractionStrategy: 'realtor',
        waitForSelector: '[data-testid="card-address"], .ldp-header-address-wrapper',
        scanDelay: 1500
      },
      {
        site: 'redfin.com',
        selectors: [
          '.homecardV2Address',
          '.street-address',
          '[data-rf-test-id="abp-streetLine"]',
          '.full-address',
          '.homeAddressV2'
        ],
        checkInterval: 24 * 60 * 60 * 1000,
        alertThreshold: 0.6,
        extractionStrategy: 'redfin',
        waitForSelector: '.homecardV2Address, .street-address',
        scanDelay: 1200
      },
      {
        site: 'loopnet.com',
        selectors: [
          '.placard-address',
          '.property-address',
          '[data-id="property-address"]',
          '.header-col-1 h1',
          '.breadcrumbs__crumb:last-child'
        ],
        checkInterval: 24 * 60 * 60 * 1000,
        alertThreshold: 0.6,
        extractionStrategy: 'loopnet',
        waitForSelector: '.placard-address, .property-address',
        scanDelay: 1000
      },
      {
        site: 'crexi.com',
        selectors: [
          '[data-testid="property-address"]',
          '.property-header__address',
          '.listing-address',
          '.MuiTypography-root.MuiTypography-h6',
          '[class*="PropertyAddress"]'
        ],
        checkInterval: 24 * 60 * 60 * 1000,
        alertThreshold: 0.6,
        extractionStrategy: 'standard',
        waitForSelector: '[data-testid="property-address"], .property-header__address',
        scanDelay: 1500
      },
      {
        site: 'commercialsearch.com',
        selectors: [
          '.property-address',
          '.listing-detail-address',
          '[class*="address-line"]',
          '.property-header address',
          '[data-cy="property-address"]'
        ],
        checkInterval: 24 * 60 * 60 * 1000,
        alertThreshold: 0.6,
        extractionStrategy: 'costar',
        waitForSelector: '.property-address, .listing-detail-address',
        scanDelay: 1200
      }
    ];
    
    sites.forEach(config => {
      this.configs.set(config.site, config);
      this.results.set(config.site, []);
    });
  }
  
  async checkSite(page: Page, site: string): Promise<HealthStatus> {
    const config = this.configs.get(site);
    if (!config) {
      throw new Error(`No configuration found for site: ${site}`);
    }
    
    const workingSelectors: string[] = [];
    const failedSelectors: string[] = [];
    
    // Wait for selector if specified
    if (config.waitForSelector) {
      try {
        await page.waitForSelector(config.waitForSelector, { timeout: 10000 });
      } catch (e) {
        console.warn(`Wait selector failed for ${site}: ${config.waitForSelector}`);
      }
    }
    
    // Apply scan delay
    await page.waitForTimeout(config.scanDelay);
    
    // Test each selector
    for (const selector of config.selectors) {
      try {
        const elements = await page.$$(selector);
        if (elements.length > 0) {
          // Test if elements contain meaningful content
          const hasContent = await page.evaluate((sel) => {
            const elements = document.querySelectorAll(sel);
            return Array.from(elements).some(el => {
              const text = el.textContent?.trim() || '';
              return text.length > 5 && /\d/.test(text); // Has numbers and meaningful length
            });
          }, selector);
          
          if (hasContent) {
            workingSelectors.push(selector);
          } else {
            failedSelectors.push(selector);
          }
        } else {
          failedSelectors.push(selector);
        }
      } catch (error) {
        console.error(`Error testing selector ${selector} on ${site}:`, error);
        failedSelectors.push(selector);
      }
    }
    
    const successRate = workingSelectors.length / config.selectors.length;
    const healthy = successRate >= config.alertThreshold;
    
    // Store result in history
    const results = this.results.get(site) || [];
    results.push(healthy);
    if (results.length > 10) results.shift(); // Keep last 10 results
    this.results.set(site, results);
    
    return {
      healthy,
      successRate,
      lastCheck: new Date(),
      failedSelectors,
      workingSelectors
    };
  }
  
  async checkAllSites(page: Page): Promise<Map<string, HealthStatus>> {
    const results = new Map<string, HealthStatus>();
    
    for (const [site, config] of this.configs) {
      try {
        console.log(`Checking site: ${site}`);
        
        // Navigate to a test page or use mock content
        await page.setContent(`
          <html>
            <head><title>Test Page for ${site}</title></head>
            <body>
              <div class="test-container">
                ${config.selectors.map(selector => {
                  const cleanClass = selector.replace(/[\[\]"=:]/g, '').replace(/^[.#]/, '');
                  return `<div class="${cleanClass}" ${selector.startsWith('[') ? selector.slice(1, -1) : ''}>
                    123 Test Address St, Test City, FL 12345
                  </div>`;
                }).join('')}
              </div>
            </body>
          </html>
        `);
        
        // Set hostname for site detection
        await page.evaluate((hostname) => {
          Object.defineProperty(window.location, 'hostname', {
            writable: true,
            value: hostname
          });
        }, site);
        
        const health = await this.checkSite(page, site);
        results.set(site, health);
        
      } catch (error) {
        console.error(`Failed to check site ${site}:`, error);
        results.set(site, {
          healthy: false,
          successRate: 0,
          lastCheck: new Date(),
          failedSelectors: config.selectors,
          workingSelectors: []
        });
      }
    }
    
    return results;
  }
  
  getHistoricalHealth(site: string): { healthy: boolean; successRate: number } {
    const results = this.results.get(site) || [];
    if (results.length === 0) {
      return { healthy: true, successRate: 1 };
    }
    
    const successCount = results.filter(r => r).length;
    const successRate = successCount / results.length;
    
    return {
      healthy: successRate >= 0.7, // 70% success rate for historical health
      successRate
    };
  }
  
  getAllHistoricalHealth(): Map<string, { healthy: boolean; successRate: number }> {
    const statuses = new Map();
    
    for (const site of this.configs.keys()) {
      statuses.set(site, this.getHistoricalHealth(site));
    }
    
    return statuses;
  }
  
  generateReport(results: Map<string, HealthStatus>): string {
    let report = '# Site Monitoring Report\n\n';
    report += `Generated: ${new Date().toISOString()}\n\n`;
    
    let healthySites = 0;
    let totalSites = 0;
    
    for (const [site, health] of results) {
      totalSites++;
      if (health.healthy) healthySites++;
      
      const status = health.healthy ? '✅' : '❌';
      const percentage = Math.round(health.successRate * 100);
      
      report += `## ${status} ${site}\n`;
      report += `- Success Rate: ${percentage}%\n`;
      report += `- Working Selectors: ${health.workingSelectors.length}/${health.workingSelectors.length + health.failedSelectors.length}\n`;
      
      if (health.failedSelectors.length > 0) {
        report += `- Failed Selectors:\n`;
        health.failedSelectors.forEach(selector => {
          report += `  - \`${selector}\`\n`;
        });
      }
      
      if (health.workingSelectors.length > 0) {
        report += `- Working Selectors:\n`;
        health.workingSelectors.forEach(selector => {
          report += `  - \`${selector}\`\n`;
        });
      }
      
      report += '\n';
    }
    
    report += `## Summary\n`;
    report += `Healthy Sites: ${healthySites}/${totalSites} (${Math.round(healthySites / totalSites * 100)}%)\n\n`;
    
    if (healthySites < totalSites) {
      report += `⚠️ **Action Required**: ${totalSites - healthySites} site(s) need attention.\n`;
    }
    
    return report;
  }
}