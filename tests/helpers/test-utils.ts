// tests/helpers/test-utils.ts
// Utility functions for tests

import { Page } from '@playwright/test';
import path from 'path';

export async function loadExtensionManually(page: Page, mockSite?: string): Promise<void> {
  const extensionPath = path.resolve(__dirname, '../../');
  
  // Mock chrome APIs for testing
  await page.addInitScript((siteName) => {
    // Create shared message listeners array that persists across function calls
    if (!window._chromeMessageListeners) {
      window._chromeMessageListeners = [];
    }
    
    // Mock minimal chrome APIs
    if (typeof window.chrome === 'undefined') {
      const chrome = {
        runtime: {
          sendMessage: (message, callback) => {
            console.log('[MOCK] chrome.runtime.sendMessage called with:', message);
            console.log('[MOCK] Available listeners:', window._chromeMessageListeners.length);
            
            // Simulate message passing to content script using global listeners
            let callbackInvoked = false;
            window._chromeMessageListeners.forEach((listener, index) => {
              try {
                console.log('[MOCK] Calling listener', index);
                const result = listener(message, { tab: { id: 1 } }, (response) => {
                  if (callback && !callbackInvoked) {
                    callbackInvoked = true;
                    callback(response);
                  }
                });
                // Handle synchronous return
                if (result && callback && !callbackInvoked) {
                  callbackInvoked = true;
                  callback(result);
                }
              } catch (e) {
                console.log('[MOCK] Error in message listener:', e.message);
              }
            });
            
            if (callback && !callbackInvoked) {
              setTimeout(() => callback({ success: true, mockResponse: true }), 100);
            }
          },
          onMessage: {
            addListener: (listener) => {
              console.log('[MOCK] chrome.runtime.onMessage.addListener called');
              window._chromeMessageListeners.push(listener);
              console.log('[MOCK] Total listeners now:', window._chromeMessageListeners.length);
            }
          }
        },
        storage: {
          local: {
            get: (keys, callback) => {
              console.log('[MOCK] chrome.storage.local.get called');
              if (callback) callback({});
            },
            set: (data, callback) => {
              console.log('[MOCK] chrome.storage.local.set called');
              if (callback) callback();
            }
          }
        }
      };
      window.chrome = chrome;
      // Also make it available globally
      window.globalThis.chrome = chrome;
    }
    
    // Mock site configuration if specified
    if (siteName) {
      window._ozTestSite = siteName;
    }
  }, mockSite);

  // Load content script manually
  await page.addScriptTag({ path: path.join(extensionPath, 'content.js') });
}

export async function waitForExtensionReady(page: Page): Promise<void> {
  // First try to load extension manually as fallback
  await loadExtensionManually(page);
  
  // Wait for content script to initialize
  await page.waitForFunction(
    () => {
      return typeof window.ozDebug !== 'undefined' &&
             document.getElementById('oz-mcp-styles') !== null;
    },
    { timeout: 10000 }
  );
  
  // Additional wait to ensure everything is settled
  await page.waitForTimeout(500);
}

export async function injectTestAddress(page: Page, address: string): Promise<void> {
  await page.evaluate((addr) => {
    const div = document.createElement('div');
    div.className = 'test-address-element';
    div.textContent = addr;
    div.setAttribute('data-test', 'injected-address');
    document.body.appendChild(div);
  }, address);
}

export async function getOZBadgeCount(page: Page): Promise<number> {
  const badges = await page.$$('.oz-mcp-badge');
  return badges.length;
}

export async function getProcessedAddressCount(page: Page): Promise<number> {
  const processed = await page.$$('[data-oz-processed="true"]');
  return processed.length;
}

export async function triggerExtensionScan(page: Page): Promise<void> {
  await page.evaluate(() => {
    // Try the chrome.runtime approach first
    if (window.chrome?.runtime?.sendMessage) {
      console.log('[TEST] Using chrome.runtime.sendMessage');
      window.chrome.runtime.sendMessage({ type: 'OZ_MANUAL_SCAN' });
      return;
    }
    
    // Fallback: Directly call the content script function if available
    console.log('[TEST] Falling back to direct function call');
    if (window._chromeMessageListeners && window._chromeMessageListeners.length > 0) {
      console.log('[TEST] Calling message listeners directly');
      window._chromeMessageListeners.forEach(listener => {
        try {
          listener({ type: 'OZ_MANUAL_SCAN' }, { tab: { id: 1 } }, () => {});
        } catch (e) {
          console.log('[TEST] Error calling listener:', e.message);
        }
      });
    } else {
      console.warn('[TEST] No way to trigger scan - chrome APIs not available and no listeners registered');
    }
  });
}

export async function openSidePanel(page: Page): Promise<boolean> {
  try {
    // Try to click extension icon via context menu or action
    await page.mouse.click(50, 50, { button: 'right' });
    
    // Wait for context menu and click OZ option
    await page.waitForSelector('text=Check Opportunity Zone', { timeout: 3000 });
    await page.click('text=Check Opportunity Zone');
    
    return true;
  } catch {
    return false;
  }
}

export async function waitForAddressScan(page: Page): Promise<void> {
  // Wait for scan to complete by checking for loading indicators
  await page.waitForFunction(
    () => {
      const loadingToasts = document.querySelectorAll('.oz-mcp-toast.loading');
      const loadingBadges = document.querySelectorAll('.oz-mcp-badge.loading');
      return loadingToasts.length === 0 && loadingBadges.length === 0;
    },
    { timeout: 15000 }
  );
}

export async function mockAddressResponse(page: Page, address: string, response: any): Promise<void> {
  await page.evaluate(
    ({ addr, resp }) => {
      // Ensure chrome APIs exist first
      if (!window.chrome?.runtime?.sendMessage) {
        console.warn('[MOCK] chrome.runtime.sendMessage not available for mocking');
        return;
      }
      
      // Mock the Chrome runtime message passing
      const originalSendMessage = window.chrome.runtime.sendMessage;
      window.chrome.runtime.sendMessage = function(message, callback) {
        if (message.type === 'OZ_LOOKUP' && message.address === addr) {
          setTimeout(() => callback && callback(resp), 100);
        } else {
          originalSendMessage.call(this, message, callback);
        }
      };
    },
    { addr: address, resp: response }
  );
}