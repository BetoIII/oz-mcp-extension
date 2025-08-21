// tests/helpers/extension-loader.ts
// Helper to load the Chrome extension in Playwright

import { chromium, BrowserContext } from '@playwright/test';
import path from 'path';

export async function loadExtension(headless = false): Promise<BrowserContext> {
  const extensionPath = path.join(__dirname, '../../');
  
  const context = await chromium.launchPersistentContext('', {
    headless,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
    ],
    viewport: { width: 1920, height: 1080 }
  });
  
  // Wait for extension to initialize
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  return context;
}

export async function getExtensionId(context: BrowserContext): Promise<string> {
  // Get the extension page to find the extension ID
  const extensionPages = context.pages().filter(page => 
    page.url().startsWith('chrome-extension://')
  );
  
  if (extensionPages.length > 0) {
    const url = new URL(extensionPages[0].url());
    return url.hostname;
  }
  
  throw new Error('Extension not found');
}

// tests/helpers/address-validator.ts
// Helper to validate and mock addresses

export interface AddressData {
  address: string;
  inOZ: boolean;
  tractId?: string;
  county?: string;
  state?: string;
}

export const KNOWN_OZ_ADDRESSES: AddressData[] = [
  {
    address: '123 Main St, Miami, FL 33125',
    inOZ: true,
    tractId: '12086004902',
    county: 'Miami-Dade',
    state: 'FL'
  },
  {
    address: '789 Flagler St, Miami, FL 33130',
    inOZ: true,
    tractId: '12086003700',
    county: 'Miami-Dade',
    state: 'FL'
  },
  {
    address: '111 NW 1st St, Miami, FL 33128',
    inOZ: true,
    tractId: '12086004801',
    county: 'Miami-Dade',
    state: 'FL'
  },
  {
    address: '100 Biscayne Blvd, Miami, FL 33132',
    inOZ: true,
    tractId: '12086003000',
    county: 'Miami-Dade',
    state: 'FL'
  },
  {
    address: '50 Biscayne Blvd, Miami, FL 33132',
    inOZ: true,
    tractId: '12086003000',
    county: 'Miami-Dade',
    state: 'FL'
  },
  {
    address: '200 S Biscayne Blvd, Miami, FL 33131',
    inOZ: true,
    tractId: '12086003000',
    county: 'Miami-Dade',
    state: 'FL'
  }
];

export const NON_OZ_ADDRESSES: AddressData[] = [
  {
    address: '456 Ocean Dr, Miami Beach, FL 33139',
    inOZ: false
  },
  {
    address: '321 Collins Ave, Miami Beach, FL 33140',
    inOZ: false
  },
  {
    address: '999 Brickell Ave, Miami, FL 33131',
    inOZ: false
  },
  {
    address: '2000 Ponce De Leon Blvd, Coral Gables, FL 33134',
    inOZ: false
  },
  {
    address: '4000 Salzedo St, Coral Gables, FL 33146',
    inOZ: false
  },
  {
    address: '8950 SW 74th Ct, Miami, FL 33156',
    inOZ: false
  }
];

export function validateAddressFormat(address: string): boolean {
  // Basic address validation
  const addressPattern = /^\d+\s+[\w\s]+,\s+[\w\s]+,\s+[A-Z]{2}\s+\d{5}(-\d{4})?$/;
  return addressPattern.test(address.trim());
}

export function normalizeAddress(address: string): string {
  return address
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/,\s*/g, ', ')
    .toUpperCase();
}

// tests/helpers/test-utils.ts
// Utility functions for tests

import { Page } from '@playwright/test';

export async function waitForExtensionReady(page: Page): Promise<void> {
  // Wait for extension to be fully loaded
  await page.waitForFunction(
    () => {
      return typeof (window as any).chrome !== 'undefined' && 
             (window as any).chrome.runtime && 
             (window as any).chrome.runtime.sendMessage;
    },
    { timeout: 10000 }
  );
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
    (window as any).chrome.runtime.sendMessage({ type: 'OZ_MANUAL_SCAN' });
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
      // Mock the Chrome runtime message passing
      const originalSendMessage = (window as any).chrome.runtime.sendMessage;
      (window as any).chrome.runtime.sendMessage = function(message: any, callback?: any) {
        if (message.type === 'OZ_LOOKUP' && message.address === addr) {
          setTimeout(() => callback && callback(resp), 100);
        } else {
          originalSendMessage(message, callback);
        }
      };
    },
    { addr: address, resp: response }
  );
}