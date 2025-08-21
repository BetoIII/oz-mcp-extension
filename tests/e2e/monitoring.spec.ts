// tests/e2e/monitoring.spec.ts
// Site monitoring tests for detecting changes in real estate site structures

import { test, expect } from '@playwright/test';
import { loadExtension } from '../helpers/extension-loader';
import { SiteMonitor } from '../helpers/site-monitor';
import { waitForExtensionReady } from '../helpers/test-utils';
import fs from 'fs';
import path from 'path';

test.describe('Site Monitoring', () => {
  let monitor: SiteMonitor;
  
  test.beforeAll(() => {
    monitor = new SiteMonitor();
  });
  
  test('should monitor all supported sites for selector health', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      await waitForExtensionReady(page);
      
      // Run comprehensive site monitoring
      const results = await monitor.checkAllSites(page);
      
      console.log('Site monitoring results:');
      
      let overallHealth = true;
      const detailedResults = [];
      
      for (const [site, health] of results) {
        const status = health.healthy ? '✅' : '❌';
        const percentage = Math.round(health.successRate * 100);
        
        console.log(`${status} ${site}: ${percentage}% (${health.workingSelectors.length}/${health.workingSelectors.length + health.failedSelectors.length} selectors)`);
        
        if (health.failedSelectors.length > 0) {
          console.log(`  Failed: ${health.failedSelectors.join(', ')}`);
        }
        
        detailedResults.push({
          site,
          healthy: health.healthy,
          successRate: health.successRate,
          workingSelectors: health.workingSelectors,
          failedSelectors: health.failedSelectors
        });
        
        if (!health.healthy) {
          overallHealth = false;
        }
      }
      
      // Generate monitoring report
      const report = monitor.generateReport(results);
      
      // Save report to test results
      const resultsDir = path.resolve(__dirname, '../..', 'test-results');
      if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir, { recursive: true });
      }
      
      fs.writeFileSync(
        path.join(resultsDir, 'monitoring-report.md'), 
        report
      );
      
      // Save detailed JSON results
      fs.writeFileSync(
        path.join(resultsDir, 'monitoring-results.json'),
        JSON.stringify({
          timestamp: new Date().toISOString(),
          overallHealth,
          results: detailedResults
        }, null, 2)
      );
      
      // Assert overall health - at least 80% of sites should be healthy
      const healthySites = detailedResults.filter(r => r.healthy).length;
      const healthPercentage = healthySites / detailedResults.length;
      
      expect(healthPercentage).toBeGreaterThan(0.8);
      
      if (!overallHealth) {
        console.warn('⚠️ Some sites are unhealthy - selectors may need updating');
      }
      
    } finally {
      await context.close();
    }
  });
  
  test('should detect critical selector failures', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      await waitForExtensionReady(page);
      
      const results = await monitor.checkAllSites(page);
      const criticalFailures = [];
      
      for (const [site, health] of results) {
        // Critical failure if less than 40% of selectors work
        if (health.successRate < 0.4) {
          criticalFailures.push({
            site,
            successRate: health.successRate,
            failedSelectors: health.failedSelectors
          });
        }
      }
      
      if (criticalFailures.length > 0) {
        console.error('🚨 Critical selector failures detected:');
        criticalFailures.forEach(failure => {
          console.error(`  ${failure.site}: ${Math.round(failure.successRate * 100)}% success rate`);
          console.error(`    Failed selectors: ${failure.failedSelectors.join(', ')}`);
        });
        
        // Save critical failures for immediate attention
        const resultsDir = path.resolve(__dirname, '../..', 'test-results');
        fs.writeFileSync(
          path.join(resultsDir, 'critical-failures.json'),
          JSON.stringify(criticalFailures, null, 2)
        );
      }
      
      // Critical failures should not exceed 1 site (allowing for temporary issues)
      expect(criticalFailures.length).toBeLessThanOrEqual(1);
      
    } finally {
      await context.close();
    }
  });
  
  test('should validate extension configuration matches monitoring config', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      await waitForExtensionReady(page);
      
      // Get extension's site configurations
      const extensionConfigs = await page.evaluate(() => {
        // @ts-ignore - access extension's SITE_CONFIGS
        return window.SITE_CONFIGS || {};
      });
      
      // Compare with monitoring configurations
      for (const [site, monitorConfig] of monitor['configs']) {
        const extensionConfig = extensionConfigs[site];
        
        if (!extensionConfig) {
          console.warn(`Extension missing config for monitored site: ${site}`);
          continue;
        }
        
        // Check if monitoring covers all extension selectors
        const monitoredSelectors = new Set(monitorConfig.selectors);
        const uncoveredSelectors = extensionConfig.addressSelectors?.filter((selector: string) => 
          !monitoredSelectors.has(selector)
        ) || [];
        
        if (uncoveredSelectors.length > 0) {
          console.warn(`Monitoring missing selectors for ${site}:`, uncoveredSelectors);
        }
        
        // Validate extraction strategy consistency
        expect(extensionConfig.extractionStrategy).toBe(monitorConfig.extractionStrategy);
      }
      
    } finally {
      await context.close();
    }
  });
  
  test('should generate actionable monitoring alerts', async () => {
    const context = await loadExtension();
    const page = await context.newPage();
    
    try {
      await waitForExtensionReady(page);
      
      const results = await monitor.checkAllSites(page);
      const alerts = [];
      
      for (const [site, health] of results) {
        if (!health.healthy) {
          // Generate specific remediation suggestions
          const suggestions = [];
          
          if (health.successRate < 0.3) {
            suggestions.push('Major site redesign detected - full selector audit needed');
          } else if (health.successRate < 0.6) {
            suggestions.push('Some selectors broken - targeted fixes needed');
          }
          
          if (health.failedSelectors.some(s => s.includes('data-test'))) {
            suggestions.push('Test attributes may have changed - check for new data-* attributes');
          }
          
          if (health.failedSelectors.some(s => s.includes('class'))) {
            suggestions.push('CSS class names may have been updated - inspect element structure');
          }
          
          alerts.push({
            site,
            severity: health.successRate < 0.3 ? 'critical' : 'warning',
            successRate: health.successRate,
            suggestions,
            failedSelectors: health.failedSelectors
          });
        }
      }
      
      if (alerts.length > 0) {
        const resultsDir = path.resolve(__dirname, '../..', 'test-results');
        fs.writeFileSync(
          path.join(resultsDir, 'monitoring-alerts.json'),
          JSON.stringify(alerts, null, 2)
        );
        
        console.log('🔍 Monitoring alerts generated for unhealthy sites');
      }
      
      // Test should not fail on alerts, but we track them for review
      expect(alerts).toBeDefined();
      
    } finally {
      await context.close();
    }
  });
});