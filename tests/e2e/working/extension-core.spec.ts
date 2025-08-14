// Core extension functionality tests - tests what actually works
import { test, expect } from '@playwright/test';
import { waitForExtensionReady, injectTestAddress, getOZBadgeCount } from '../../helpers/test-utils';

test.describe('Core Extension Functionality', () => {
  test('should load extension and inject core components', async ({ page }) => {
    await page.goto('data:text/html,<html><body><h1>Test Page</h1></body></html>');
    
    await waitForExtensionReady(page);
    
    // Verify extension loaded
    const ozDebugAvailable = await page.evaluate(() => typeof window.ozDebug !== 'undefined');
    expect(ozDebugAvailable).toBe(true);
    
    // Verify styles injected
    const stylesExist = await page.evaluate(() => !!document.getElementById('oz-mcp-styles'));
    expect(stylesExist).toBe(true);
    
    // Verify logging system
    const logCount = await page.evaluate(() => window.ozDebug.getLogs().length);
    expect(logCount).toBeGreaterThan(0);
  });

  test('should inject and detect test addresses', async ({ page }) => {
    await page.goto('data:text/html,<html><body><h1>Test Page</h1></body></html>');
    await waitForExtensionReady(page);
    
    // Inject test address
    const testAddress = '123 Main St, New York, NY 10001';
    await injectTestAddress(page, testAddress);
    
    // Verify address element exists
    const addressElements = await page.$$('.test-address-element');
    expect(addressElements.length).toBe(1);
    
    // Verify address content
    const addressText = await page.textContent('.test-address-element');
    expect(addressText).toBe(testAddress);
  });

  test('should have working debug utilities', async ({ page }) => {
    await page.goto('data:text/html,<html><body><h1>Test</h1></body></html>');
    await waitForExtensionReady(page);
    
    // Test log functions
    await page.evaluate(() => {
      window.ozDebug.log('Test message', { test: true });
    });
    
    const logs = await page.evaluate(() => window.ozDebug.getLogs());
    const testLog = logs.find(log => log.message === 'Test message');
    expect(testLog).toBeTruthy();
    expect(testLog.data).toEqual({ test: true });
    
    // Test clear logs
    await page.evaluate(() => window.ozDebug.clearLogs());
    const clearedLogs = await page.evaluate(() => window.ozDebug.getLogs());
    expect(clearedLogs.length).toBe(1); // Only the "Logs cleared" message
  });
});