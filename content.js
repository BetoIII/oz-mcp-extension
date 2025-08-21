// OZ-MCP Content Script: scans pages for candidate addresses, injects badges, handles context menu toast

// Internal logging system - completely silent in production
const ozLogs = [];
const MAX_LOGS = 100;
const PRODUCTION_MODE = true; // Set to false for debugging

function ozLog(message, data = null) {
  const timestamp = new Date().toISOString();
  const logEntry = { timestamp, message, data };
  ozLogs.push(logEntry);
  if (ozLogs.length > MAX_LOGS) {
    ozLogs.shift(); // Remove oldest log
  }
  // Completely silent in production mode
}

function ozGetLogs() {
  return ozLogs.slice(); // Return copy
}

function ozClearLogs() {
  ozLogs.length = 0;
  ozLog('Logs cleared');
}

// Expose log functions globally for debugging
window.ozDebug = { getLogs: ozGetLogs, clearLogs: ozClearLogs, log: ozLog };

const MAX_CHECKS_PER_PAGE = 2; // reduced to minimize geocoding bursts
const SCAN_DEBOUNCE_MS = 1200; // increased debounce time
const BETWEEN_CHECK_DELAY_MS = 2000; // increased serialize delay to 2s
const RATE_LIMIT_BACKOFF_MS = 90 * 1000; // 90s pause on 429/GEOCODER_RATE_LIMITED
const REQUEST_DEBOUNCE_MS = 500; // debounce duplicate requests
// Site-specific configurations for major real estate platforms
const SITE_CONFIGS = {
  // Residential Sites
  'zillow.com': {
    addressSelectors: [
      '[data-test="property-card-addr"]',
      '.list-card-addr',
      '.hdp__sc-qmn92k-1',
      'h1[class*="Text-"]',
      '[data-testid="bdp-property-address"]',
      '.summary-address',
      '[class*="StyledPropertyCardDataArea"] a',
      '.property-address'
    ],
    extractionStrategy: 'standard',
    waitForSelector: '[data-test="property-card-addr"], .list-card-addr',
    scanDelay: 1000
  },
  
  'realtor.com': {
    addressSelectors: [
      '[data-testid="card-address"]',
      '.rui__sc-119fdwq-0',
      '[data-label="property-address"]',
      '.ldp-header-address-wrapper',
      '.jsx-11645185.full-address',
      '[class*="styles__AddressWrapper"]',
      '.home-summary-row span[itemprop="streetAddress"]',
      '[data-testid="property-meta-address"]'
    ],
    extractionStrategy: 'realtor',
    waitForSelector: '[data-testid="card-address"], .ldp-header-address-wrapper',
    scanDelay: 1500
  },
  
  'redfin.com': {
    addressSelectors: [
      '.homecardV2Address',
      '.street-address',
      '[data-rf-test-id="abp-streetLine"]',
      '.full-address',
      '.homeAddressV2',
      '[class*="AddressSection"]',
      '.bp-cityStateZip',
      '[data-rf-test-name="abp-streetLine"]',
      '.HomeDetailsHeader .full-address'
    ],
    extractionStrategy: 'redfin',
    waitForSelector: '.homecardV2Address, .street-address',
    scanDelay: 1200
  },
  
  // Commercial Sites
  'loopnet.com': {
    addressSelectors: [
      '.placard-address',
      '.property-address',
      '[data-id="property-address"]',
      '.header-col-1 h1',
      '.breadcrumbs__crumb:last-child',
      '[class*="property-header"] [class*="address"]',
      '.summary-address',
      '.placard-content-wrap .placard-address-tagline'
    ],
    extractionStrategy: 'loopnet',
    waitForSelector: '.placard-address, .property-address',
    scanDelay: 1000
  },
  
  'crexi.com': {
    addressSelectors: [
      '[data-testid="property-address"]',
      '.property-header__address',
      '.listing-address',
      '.MuiTypography-root.MuiTypography-h6',
      '[class*="PropertyAddress"]',
      '.property-details-header__address',
      '[class*="ListingCard"] [class*="address"]',
      '.map-card-address'
    ],
    extractionStrategy: 'standard',
    waitForSelector: '[data-testid="property-address"], .property-header__address',
    scanDelay: 1500
  },
  
  'commercialsearch.com': {
    addressSelectors: [
      '.property-address',
      '.listing-detail-address',
      '[class*="address-line"]',
      '.property-header address',
      '.property-summary__address',
      '[data-cy="property-address"]',
      '.listing-card__address',
      '.detail-header__address'
    ],
    extractionStrategy: 'costar',
    waitForSelector: '.property-address, .listing-detail-address',
    scanDelay: 1200
  }
};

// Extraction strategies for different sites
const EXTRACTION_STRATEGIES = {
  'standard': (element) => {
    return cleanAddressText(element.textContent.trim());
  },
  
  'realtor': (element) => {
    const addressParts = [];
    const streetAddress = element.querySelector('[itemprop="streetAddress"]');
    const locality = element.querySelector('[itemprop="addressLocality"]');
    const region = element.querySelector('[itemprop="addressRegion"]');
    const postalCode = element.querySelector('[itemprop="postalCode"]');
    
    if (streetAddress) {
      addressParts.push(streetAddress.textContent.trim());
      if (locality) addressParts.push(locality.textContent.trim());
      if (region && postalCode) {
        addressParts.push(`${region.textContent.trim()} ${postalCode.textContent.trim()}`);
      }
    } else {
      return cleanAddressText(element.textContent.trim());
    }
    
    return cleanAddressText(addressParts.join(', '));
  },
  
  'redfin': (element) => {
    const parts = [];
    const streetElement = element.querySelector('.street-address') || 
                         element.querySelector('[data-rf-test-id="abp-streetLine"]');
    const cityStateZip = element.querySelector('.cityStateZip') || 
                        element.querySelector('.bp-cityStateZip');
    
    if (streetElement) parts.push(streetElement.textContent.trim());
    if (cityStateZip) parts.push(cityStateZip.textContent.trim());
    
    if (parts.length === 0) {
      return cleanAddressText(element.textContent.trim());
    }
    
    return cleanAddressText(parts.join(', '));
  },
  
  'loopnet': (element) => {
    const addressLine1 = element.querySelector('.address-line-1');
    const addressLine2 = element.querySelector('.address-line-2');
    
    if (addressLine1 && addressLine2) {
      return cleanAddressText(`${addressLine1.textContent.trim()}, ${addressLine2.textContent.trim()}`);
    }
    
    if (element.classList.contains('breadcrumbs__crumb')) {
      const text = element.textContent.trim();
      return cleanAddressText(text.replace(/^Properties in\s+/i, ''));
    }
    
    return cleanAddressText(element.textContent.trim());
  },
  
  'costar': (element) => {
    const lines = element.querySelectorAll('[class*="address-line"]');
    if (lines.length > 0) {
      return cleanAddressText(Array.from(lines).map(l => l.textContent.trim()).join(', '));
    }
    
    if (element.tagName === 'ADDRESS') {
      const spans = element.querySelectorAll('span');
      if (spans.length > 0) {
        return cleanAddressText(Array.from(spans).map(s => s.textContent.trim()).join(', '));
      }
    }
    
    return cleanAddressText(element.textContent.trim());
  }
};

// Clean and normalize address text
function cleanAddressText(address) {
  return address
    .replace(/\s+/g, ' ')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .replace(/,,+/g, ',')
    .replace(/\|/g, ',')
    .replace(/\s*,\s*/g, ', ')
    .trim();
}

// Get current site configuration
function getCurrentSiteConfig() {
  const hostname = window.location.hostname.replace('www.', '');
  
  if (SITE_CONFIGS[hostname]) {
    return { ...SITE_CONFIGS[hostname], siteName: hostname };
  }
  
  for (const [site, config] of Object.entries(SITE_CONFIGS)) {
    if (hostname.endsWith(site)) {
      return { ...config, siteName: site };
    }
  }
  
  return {
    addressSelectors: ['.address', '.property-address', '[class*="address"]'],
    extractionStrategy: 'standard',
    waitForSelector: null,
    scanDelay: 1000,
    siteName: 'generic'
  };
}

// Helper function to wait for element
function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    const checkElement = () => {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
      } else if (Date.now() - startTime > timeout) {
        reject(new Error(`Timeout waiting for ${selector}`));
      } else {
        requestAnimationFrame(checkElement);
      }
    };
    
    checkElement();
  });
}

const scannedAddresses = new Set();
let checksUsed = 0;
let scanLoadingToast = null;
let pendingRequests = 0;
let pausedUntilTs = 0;
let queueProcessing = false;
let manualLookupInProgress = false;
const addressQueue = [];
// Simple request throttling - no need for complex pending tracking since backend handles deduplication

// Conservative US address regex (legacy - now using comprehensive extraction)
const ADDRESS_REGEX = /\b(\d{1,6})\s+([A-Za-z0-9'.\-]+(?:\s+[A-Za-z0-9'.\-]+)*)\s+(Ave|Avenue|St|Street|Rd|Road|Blvd|Boulevard|Ln|Lane|Dr|Drive|Ct|Court|Pl|Place|Ter|Terrace|Way|Pkwy|Parkway)\b[ ,]*([A-Za-z .'-]+)?[ ,]+([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/;

// Comprehensive address extraction logic (based on server-side implementation)
// Enhanced regex for better address matching
const ENHANCED_ADDRESS_REGEX = /\b(\d{1,6})\s+([A-Za-z0-9\s'.\-&]+?)\s+(Avenue|Ave|Street|St|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Circle|Cir|Place|Pl|Way|Terrace|Ter|Parkway|Pkwy|Highway|Hwy|Trail|Trl|Square|Sq|Loop|Plaza|Plz)\s*(?:,\s*)?(?:(?:Apt|Apartment|Unit|Ste|Suite|#)\s*[A-Za-z0-9\-]+)?\s*(?:,\s*)?([A-Za-z\s.'-]+?)\s*(?:,\s*)([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/gi;

// Address validation
function isValidAddress(address) {
  if (!address || typeof address !== 'string') return false;
  const parts = address.split(',').map(p => p.trim());
  if (parts.length < 3) return false;
  
  // Check for street number and name
  const streetMatch = parts[0].match(/^\d+\s+.+/);
  if (!streetMatch) return false;
  
  // Check for state and zip
  const lastPart = parts[parts.length - 1];
  const stateZipMatch = lastPart.match(/\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/);
  return !!stateZipMatch;
}

// 1. Extract address from URL
function tryExtractFromUrl(url) {
  ozLog('Trying URL extraction', { url });
  
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').concat(urlObj.search.split('&')).concat(urlObj.hash.split('#'));
    
    for (const part of pathParts) {
      const decoded = decodeURIComponent(part.replace(/[-_+]/g, ' '));
      ozLog('Processing URL part', { original: part, decoded });
      const matches = decoded.match(ENHANCED_ADDRESS_REGEX);
      if (matches && matches.length > 0) {
        ozLog('URL regex matches found', { matches });
        for (const match of matches) {
          if (isValidAddress(match)) {
            ozLog('Found valid address in URL', { address: match });
            return match.trim();
          }
        }
      }
    }
  } catch (e) {
    ozLog('ERROR: URL parsing failed', { error: e.message });
  }
  
  ozLog('No address found in URL');
  return null;
}

// 2. Extract address from JSON-LD structured data
function extractFromJsonLd() {
  ozLog('Trying JSON-LD extraction');
  
  const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
  ozLog('Found JSON-LD scripts', { count: jsonLdScripts.length });
  
  for (const script of jsonLdScripts) {
    try {
      const data = JSON.parse(script.textContent);
      const address = findPostalAddressInObject(data);
      if (address && isValidAddress(address)) {
        ozLog('Found address in JSON-LD', { address });
        return address;
      }
    } catch (e) {
      ozLog('JSON-LD parsing failed', { error: e.message });
    }
  }
  
  ozLog('No address found in JSON-LD');
  return null;
}

// Recursively search for postal address in nested objects
function findPostalAddressInObject(obj) {
  if (!obj || typeof obj !== 'object') return null;
  
  // Check if this object has postal address properties
  if (obj.streetAddress && obj.addressLocality && obj.addressRegion && obj.postalCode) {
    const address = `${obj.streetAddress}, ${obj.addressLocality}, ${obj.addressRegion} ${obj.postalCode}`;
    return address;
  }
  
  // Check for address property
  if (obj.address) {
    const found = findPostalAddressInObject(obj.address);
    if (found) return found;
  }
  
  // Recursively search all properties
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const value = obj[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          const found = findPostalAddressInObject(item);
          if (found) return found;
        }
      } else if (typeof value === 'object') {
        const found = findPostalAddressInObject(value);
        if (found) return found;
      }
    }
  }
  
  return null;
}

// 3. Extract address from meta tags
function extractFromMetaTags() {
  
  
  const addressProperties = [
    'og:street-address', 'og:locality', 'og:region', 'og:postal-code',
    'property:street_address', 'property:city', 'property:state_or_province', 'property:postal_code',
    'address', 'street-address', 'locality', 'region', 'postal-code'
  ];
  
  const addressParts = {};
  
  for (const prop of addressProperties) {
    const meta = document.querySelector(`meta[property="${prop}"], meta[name="${prop}"]`);
    if (meta) {
      const content = meta.getAttribute('content');
      if (content) {
        if (prop.includes('street') || prop === 'address') {
          addressParts.street = content;
        } else if (prop.includes('locality') || prop.includes('city')) {
          addressParts.city = content;
        } else if (prop.includes('region') || prop.includes('state')) {
          addressParts.state = content;
        } else if (prop.includes('postal')) {
          addressParts.zip = content;
        }
      }
    }
  }
  
  // Check if we have all required parts
  if (addressParts.street && addressParts.city && addressParts.state && addressParts.zip) {
    const address = `${addressParts.street}, ${addressParts.city}, ${addressParts.state} ${addressParts.zip}`;
    if (isValidAddress(address)) {
      
      return address;
    }
  }
  
  return null;
}

// 4. Extract address using enhanced regex on page text
function extractUsingRegex() {
  
  
  // Get page text, prioritizing main content areas
  const contentSelectors = [
    'main', '[role="main"]', '.content', '#content', 
    '.listing-detail', '.property-details', '.address',
    'h1', 'h2', '.title', '.property-title'
  ];
  
  const addresses = [];
  
  // First, try to find addresses in structured content areas
  for (const selector of contentSelectors) {
    const elements = document.querySelectorAll(selector);
    for (const element of elements) {
      if (isVisible(element)) {
        const text = element.textContent || '';
        const matches = text.match(ENHANCED_ADDRESS_REGEX);
        if (matches) {
          for (const match of matches) {
            if (isValidAddress(match)) {
              addresses.push(match.trim());
            }
          }
        }
      }
    }
  }
  
  // If no addresses found in structured content, fall back to full page scan
  if (addresses.length === 0) {
    const walker = document.createTreeWalker(
      document.body, 
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const text = (node.nodeValue || '').trim();
          if (!text || text.length > 300) return NodeFilter.FILTER_REJECT;
          
          const parent = node.parentElement;
          if (!parent || !isVisible(parent)) return NodeFilter.FILTER_SKIP;
          
          // Skip navigation, ads, and irrelevant areas
          const parentHtml = parent.outerHTML || '';
          if (parentHtml.includes('nav') || 
              parentHtml.includes('footer') || 
              parentHtml.includes('advertisement') ||
              parent.closest('[class*="nav"]') ||
              parent.closest('[class*="footer"]') ||
              parent.closest('[class*="ad"]') ||
              parent.closest('[class*="similar"]') ||
              parent.closest('[class*="nearby"]')) {
            return NodeFilter.FILTER_SKIP;
          }
          
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    
    while (walker.nextNode()) {
      const text = walker.currentNode.nodeValue;
      const matches = text.match(ENHANCED_ADDRESS_REGEX);
      if (matches) {
        for (const match of matches) {
          if (isValidAddress(match)) {
            addresses.push(match.trim());
          }
        }
      }
    }
  }
  
  // Dedupe and return top candidate
  const uniqueAddresses = [...new Set(addresses)];
  if (uniqueAddresses.length > 0) {
    
    return uniqueAddresses[0]; // Return the first (most likely) address
  }
  
  return null;
}

// 5. Main comprehensive address extraction function
function extractListingAddress() {
  ozLog('Starting comprehensive address extraction');
  
  // Strategy 1: Try URL extraction first (fastest)
  const urlAddress = tryExtractFromUrl(window.location.href);
  if (urlAddress) {
    ozLog('Comprehensive extraction SUCCESS via URL', { address: urlAddress });
    return urlAddress;
  }
  
  // Strategy 2: Try JSON-LD structured data (most reliable)
  const jsonLdAddress = extractFromJsonLd();
  if (jsonLdAddress) {
    ozLog('Comprehensive extraction SUCCESS via JSON-LD', { address: jsonLdAddress });
    return jsonLdAddress;
  }
  
  // Strategy 3: Try meta tags (reliable for some sites)
  const metaAddress = extractFromMetaTags();
  if (metaAddress) {
    ozLog('Comprehensive extraction SUCCESS via meta tags', { address: metaAddress });
    return metaAddress;
  }
  
  // Strategy 4: Fall back to regex text extraction
  const regexAddress = extractUsingRegex();
  if (regexAddress) {
    ozLog('Comprehensive extraction SUCCESS via regex', { address: regexAddress });
    return regexAddress;
  }
  
  ozLog('Comprehensive extraction FAILED - no address found');
  return null;
}

// Styles
function ensureStyles() {
  if (document.getElementById('oz-mcp-styles')) return;
        const style = document.createElement('style');
        style.id = 'oz-mcp-styles';
        style.textContent = `
/* OZ-MCP Badge - Modern Design System */
.oz-mcp-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: linear-gradient(135deg, #40E0D0 0%, #3b82f6 100%);
  color: #ffffff;
  border-radius: 4px;
  padding: 2px 6px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.25;
  text-transform: uppercase;
  letter-spacing: 0.025em;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.24);
  margin-left: 8px;
  vertical-align: baseline;
  cursor: help;
  transition: all 200ms ease;
}

.oz-mcp-badge:hover {
  transform: scale(1.05);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.16), 0 2px 4px rgba(0, 0, 0, 0.32);
}

.oz-mcp-badge:hover .oz-mcp-tooltip {
  opacity: 1;
  visibility: visible;
}

.oz-mcp-badge.loading {
  background: #3b82f6;
  animation: oz-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

/* Tooltip */
.oz-mcp-tooltip {
  position: absolute;
  transform: translateY(6px);
  background: #1f2937;
  color: #f9fafb;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15), 0 4px 6px rgba(0, 0, 0, 0.1);
  opacity: 0;
  visibility: hidden;
  transition: all 150ms ease;
  z-index: 2147483647;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

/* Toast Notifications */
.oz-mcp-toast {
  position: fixed;
  z-index: 2147483647;
  left: 50%;
  transform: translateX(-50%);
  bottom: 24px;
  max-width: 320px;
  background: #ffffff;
  color: #1f2937;
  padding: 12px 16px;
  border-radius: 8px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
  font-weight: 500;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1), 0 4px 6px rgba(0, 0, 0, 0.05);
  border: 1px solid #e5e7eb;
  animation: slideInUp 300ms ease;
}

.oz-mcp-toast.loading {
  background: #3b82f6;
  color: #ffffff;
  border-color: #2563eb;
}

.oz-mcp-toast.success {
  background: #10b981;
  color: #ffffff;
  border-color: #059669;
}

.oz-mcp-toast.error {
  background: #ef4444;
  color: #ffffff;
  border-color: #dc2626;
}

/* Confirm Dialog */
.oz-mcp-confirm {
  position: fixed;
  z-index: 2147483647;
  top: 20px;
  right: 20px;
  max-width: 320px;
  background: #ffffff;
  color: #1f2937;
  padding: 16px;
  border-radius: 12px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
  box-shadow: 0 20px 25px rgba(0, 0, 0, 0.15), 0 8px 10px rgba(0, 0, 0, 0.1);
  border: 1px solid #e5e7eb;
  animation: slideInDown 300ms ease;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.oz-mcp-confirm .addr {
  font-weight: 600;
  color: #374151;
}

.oz-mcp-confirm input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 12px;
  background: #f9fafb;
  transition: all 150ms ease;
  box-sizing: border-box;
}

.oz-mcp-confirm input:focus {
  outline: none;
  border-color: #3b82f6;
  background: #ffffff;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.oz-mcp-confirm .btn {
  padding: 6px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  margin-right: 8px;
  transition: all 150ms ease;
}

.oz-mcp-confirm .btn.ok {
  background: #3b82f6;
  color: #ffffff;
  border-color: #3b82f6;
}

.oz-mcp-confirm .btn.ok:hover {
  background: #2563eb;
  border-color: #2563eb;
}

.oz-mcp-confirm .btn.edit {
  background: #f9fafb;
  color: #6b7280;
}

.oz-mcp-confirm .btn.edit:hover {
  background: #f3f4f6;
  color: #4b5563;
}

.oz-mcp-confirm .tag {
  font-size: 10px;
  background: #f3f4f6;
  color: #6b7280;
  border-radius: 999px;
  padding: 2px 6px;
  display: inline-block;
}

/* Prompt overlay */
.oz-mcp-prompt-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 2147483646;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(4px);
}

.oz-mcp-prompt {
  background: #ffffff;
  color: #1f2937;
  min-width: 300px;
  max-width: 92vw;
  border-radius: 12px;
  box-shadow: 0 25px 50px rgba(0, 0, 0, 0.25);
  padding: 24px;
  border: 1px solid #e5e7eb;
}

.oz-mcp-prompt h4 {
  margin: 0 0 12px 0;
  font-size: 16px;
  font-weight: 600;
  color: #111827;
}

.oz-mcp-prompt input {
  width: 100%;
  box-sizing: border-box;
  border-radius: 8px;
  border: 1px solid #d1d5db;
  background: #ffffff;
  color: #111827;
  padding: 12px 16px;
  font-size: 14px;
  outline: none;
  transition: all 150ms ease;
}

.oz-mcp-prompt input:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.oz-mcp-prompt .row {
  display: flex;
  gap: 12px;
  margin-top: 16px;
  justify-content: flex-end;
}

.oz-mcp-btn {
  border: none;
  border-radius: 8px;
  padding: 10px 16px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 150ms ease;
}

.oz-mcp-btn.cancel {
  background: #f9fafb;
  color: #6b7280;
  border: 1px solid #d1d5db;
}

.oz-mcp-btn.cancel:hover {
  background: #f3f4f6;
  color: #4b5563;
}

.oz-mcp-btn.ok {
  background: #3b82f6;
  color: #ffffff;
}

.oz-mcp-btn.ok:hover {
  background: #2563eb;
}

/* Spinner */
.oz-mcp-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  border-top-color: #ffffff;
  animation: oz-spin 600ms linear infinite;
  margin-right: 6px;
}

/* Animations */
@keyframes oz-spin {
  to { transform: rotate(360deg); }
}

@keyframes oz-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@keyframes slideInUp {
  from {
    transform: translate(-50%, 100%);
    opacity: 0;
  }
  to {
    transform: translate(-50%, 0);
    opacity: 1;
  }
}

@keyframes slideInDown {
  from {
    transform: translateY(-100%);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

/* Dark mode support */
@media (prefers-color-scheme: dark) {
  .oz-mcp-toast:not(.loading):not(.success):not(.error) {
    background: #1f2937;
    color: #f9fafb;
    border-color: #374151;
  }
  
  .oz-mcp-confirm {
    background: #1f2937;
    color: #f9fafb;
    border-color: #374151;
  }
  
  .oz-mcp-confirm .addr {
    color: #d1d5db;
  }
  
  .oz-mcp-confirm input {
    background: #374151;
    border-color: #4b5563;
    color: #f9fafb;
  }
  
  .oz-mcp-confirm input:focus {
    background: #4b5563;
    border-color: #3b82f6;
  }
  
  .oz-mcp-confirm .btn.edit {
    background: #374151;
    color: #d1d5db;
    border-color: #4b5563;
  }
  
  .oz-mcp-confirm .btn.edit:hover {
    background: #4b5563;
    color: #f9fafb;
  }
  
  .oz-mcp-confirm .tag {
    background: #374151;
    color: #9ca3af;
  }
  
  .oz-mcp-prompt {
    background: #1f2937;
    color: #f9fafb;
    border-color: #374151;
  }
  
  .oz-mcp-prompt h4 {
    color: #f9fafb;
  }
  
  .oz-mcp-prompt input {
    background: #374151;
    border-color: #4b5563;
    color: #f9fafb;
  }
  
  .oz-mcp-prompt input:focus {
    background: #4b5563;
    border-color: #3b82f6;
  }
  
  .oz-mcp-btn.cancel {
    background: #374151;
    color: #d1d5db;
    border-color: #4b5563;
  }
  
  .oz-mcp-btn.cancel:hover {
    background: #4b5563;
    color: #f9fafb;
  }
}
`;
  document.head.appendChild(style);
}

function showToast(text, isLoading = false) {
  ensureStyles();
  const existing = document.querySelector('.oz-mcp-toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = isLoading ? 'oz-mcp-toast loading' : 'oz-mcp-toast';
  if (isLoading) {
    const spinner = document.createElement('span');
    spinner.className = 'oz-mcp-spinner';
    el.appendChild(spinner);
  }
  el.appendChild(document.createTextNode(text));
  document.body.appendChild(el);
  if (!isLoading) {
    setTimeout(() => el.remove(), 3000);
  }
  return el;
}

function showToastNearSelection(text, isLoading = false) {
  ensureStyles();
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return showToast(text, isLoading);
  }
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = isLoading ? 'oz-mcp-toast loading' : 'oz-mcp-toast';
  if (isLoading) {
    const spinner = document.createElement('span');
    spinner.className = 'oz-mcp-spinner';
    el.appendChild(spinner);
  }
  el.appendChild(document.createTextNode(text));
  el.style.position = 'fixed';
  const left = Math.min(Math.max(rect.left + rect.width / 2, 12), window.innerWidth - 12);
  const top = Math.min(Math.max(rect.bottom + 8, 12), window.innerHeight - 12);
  el.style.left = `${left}px`;
  el.style.bottom = 'auto';
  el.style.top = `${top}px`;
  el.style.transform = 'translateX(-50%)';
  document.body.appendChild(el);
  if (!isLoading) {
    setTimeout(() => el.remove(), 3000);
  }
  return el;
}

function createBadge(info) {
  const badge = document.createElement('span');
  badge.className = 'oz-mcp-badge';
  badge.textContent = 'OZ';
  badge.style.position = 'relative';

  if (info?.opportunityZoneId || info?.metadata?.lastUpdated) {
    const tip = document.createElement('span');
    tip.className = 'oz-mcp-tooltip';
    tip.textContent = `Zone ${info.opportunityZoneId || ''} • Updated ${info.metadata?.lastUpdated || ''}`.trim();
    badge.appendChild(tip);
  }
  return badge;
}

function createLoadingBadge() {
  const badge = document.createElement('span');
  badge.className = 'oz-mcp-badge loading';
  badge.textContent = '...';
  badge.style.position = 'relative';
  return badge;
}

function isVisible(node) {
  const rect = node.getBoundingClientRect?.();
  if (!rect) return false;
  if (rect.width === 0 || rect.height === 0) return false;
  const style = window.getComputedStyle(node);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  return true;
}

function dedupeAndLimit(arr) {
  const seen = new Set();
  const out = [];
  for (const s of arr) {
    const key = s.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(s);
    }
    if (out.length >= MAX_CHECKS_PER_PAGE) break;
  }
  return out;
}

function isPaused() {
  return Date.now() < pausedUntilTs;
}

function enqueueAddress(address) {
  const key = address.toLowerCase();
  if (scannedAddresses.has(address)) return;
  scannedAddresses.add(address);
  addressQueue.push(address);
  processQueue();
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function isRateLimitedResponse(resp) {
  if (!resp) return false;
  if (resp.status === 429) return true;
  if (resp.status === 500 && typeof resp.message === 'string' && /429/gi.test(resp.message)) return true;
  return false;
}

// Simple async request function - backend handles deduplication
async function performOzLookup(address) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'OZ_LOOKUP', address }, (resp) => {
      if (chrome.runtime.lastError) {
        ozLog('Background connection failed:', chrome.runtime.lastError.message);
        resolve({ ok: false, error: true, message: 'Extension not ready' });
        return;
      }
      resolve(resp);
    });
  });
}

async function processQueue() {
  if (queueProcessing) return;
  queueProcessing = true;
  try {
    while (addressQueue.length > 0) {
      if (checksUsed >= MAX_CHECKS_PER_PAGE) break;
      if (isPaused()) {
        // wait until pause expires
        const waitMs = Math.max(50, pausedUntilTs - Date.now());
        await sleep(waitMs);
        continue;
      }

      const address = addressQueue.shift();
      
      // Debug: Log address being processed
      
      
      // Show loading badge immediately
      const node = findTextNode(document.body, address);
      let loadingBadge = null;
      if (node && node.parentElement) {
        loadingBadge = createLoadingBadge();
        node.parentElement.appendChild(loadingBadge);
      }
      
      pendingRequests++;
      
      try {
        const resp = await performOzLookup(address);
        
        // Remove loading badge
        if (loadingBadge && loadingBadge.parentElement) {
          loadingBadge.remove();
        }

        if (!resp || resp.error) {
          if (isRateLimitedResponse(resp)) {
            pausedUntilTs = Date.now() + RATE_LIMIT_BACKOFF_MS;
            showToast('Rate limited — pausing checks for 90s');
            break; // exit loop; will resume after pause
          }
          if (resp?.status >= 500) {
            showToast('Service unavailable. Try again later.');
          }
        } else {
          if (!resp.addressNotFound && resp.isInOpportunityZone) {
            const currentNode = findTextNode(document.body, address);
            if (currentNode && currentNode.parentElement) {
              const badge = createBadge(resp);
              currentNode.parentElement.appendChild(badge);
            }
          }
          checksUsed += 1;
        }
      } catch (e) {
        // Remove loading badge on error
        if (loadingBadge && loadingBadge.parentElement) {
          loadingBadge.remove();
        }
      } finally {
        pendingRequests--;
        
        // Hide scan loading toast if no more pending requests
        if (pendingRequests === 0 && scanLoadingToast && scanLoadingToast.parentElement) {
          scanLoadingToast.remove();
          scanLoadingToast = null;
        }
      }

      await sleep(BETWEEN_CHECK_DELAY_MS);
    }
  } finally {
    queueProcessing = false;
  }
}

async function scanForAddresses() {
  if (checksUsed >= MAX_CHECKS_PER_PAGE) {
    if (scanLoadingToast && scanLoadingToast.parentElement) {
      scanLoadingToast.remove();
      scanLoadingToast = null;
    }
    return;
  }
  if (isPaused()) return;
  if (manualLookupInProgress) return;
  
  const config = getCurrentSiteConfig();
  ozLog(`Scanning for addresses using ${config.siteName} configuration`);
  
  // Wait for dynamic content if needed
  if (config.waitForSelector) {
    try {
      await waitForElement(config.waitForSelector, 5000);
      ozLog('Wait selector found, proceeding with scan');
    } catch (e) {
      ozLog('Wait selector timeout, continuing with scan');
    }
  }
  
  // Apply scan delay for dynamic content
  await new Promise(resolve => setTimeout(resolve, config.scanDelay));
  
  const candidates = [];
  
  // First try site-specific selectors
  for (const selector of config.addressSelectors) {
    try {
      const elements = document.querySelectorAll(selector);
      
      for (const element of elements) {
        if (!element || !element.textContent || !isVisible(element)) continue;
        
        const strategy = EXTRACTION_STRATEGIES[config.extractionStrategy] || 
                        EXTRACTION_STRATEGIES.standard;
        const address = strategy(element);
        
        if (isValidAddress(address)) {
          candidates.push(address);
          ozLog('Found address via site selector', { selector, address });
        }
      }
    } catch (error) {
      ozLog(`Error with selector ${selector}:`, error);
    }
  }
  
  // Fallback to text walker if no site-specific addresses found
  if (candidates.length === 0) {
    ozLog('No site-specific addresses found, falling back to text walker');
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const text = (node.nodeValue || '').trim();
        if (!text || text.length > 200) return NodeFilter.FILTER_REJECT;
        if (!ADDRESS_REGEX.test(text)) return NodeFilter.FILTER_SKIP;
        const parent = node.parentElement;
        if (!parent || !isVisible(parent)) return NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    while (walker.nextNode()) {
      const text = walker.currentNode.nodeValue;
      const m = text.match(ADDRESS_REGEX);
      if (m) candidates.push(m[0]);
    }
  }

  const toEnqueue = dedupeAndLimit(candidates).filter((addr) => !scannedAddresses.has(addr));
  
  ozLog('Scan results', { 
    siteName: config.siteName, 
    candidates: candidates.length, 
    toEnqueue: toEnqueue.length 
  });
  
  if (toEnqueue.length === 0 && scanLoadingToast && scanLoadingToast.parentElement) {
    scanLoadingToast.remove();
    scanLoadingToast = null;
  }
  
  for (const address of toEnqueue) enqueueAddress(address);
}

function findTextNode(root, text) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  while (walker.nextNode()) {
    if ((walker.currentNode.nodeValue || '').includes(text)) return walker.currentNode;
  }
  return null;
}

function getSelectionText() {
  try {
    const sel = window.getSelection();
    if (sel && sel.toString()) return sel.toString();
  } catch {}
  return '';
}

function promptForAddressInline() {
  return new Promise((resolve) => {
    ensureStyles();
    // Ensure only one prompt/confirm UI is visible at a time
    document.querySelectorAll('.oz-mcp-confirm').forEach((e) => e.remove());

    // Reuse the compact confirm-style toast positioned near the extension icon (top-right)
    const wrap = document.createElement('div');
    wrap.className = 'oz-mcp-confirm';

    const label = document.createElement('span');
    label.textContent = 'Could not determine address. Please enter:';

    const input = document.createElement('input');
    input.placeholder = 'Enter full address (e.g., 1600 Pennsylvania Ave NW, Washington, DC 20500)';
    const prefill = getSelectionText();
    if (prefill) input.value = prefill;

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn edit';
    cancelBtn.textContent = 'Cancel';

    const okBtn = document.createElement('button');
    okBtn.className = 'btn ok';
    okBtn.textContent = 'Check';

    wrap.appendChild(label);
    wrap.appendChild(input);
    wrap.appendChild(cancelBtn);
    wrap.appendChild(okBtn);
    document.body.appendChild(wrap);

    function cleanup(val) { wrap.remove(); resolve(val); }

    okBtn.addEventListener('click', () => {
      const val = (input.value || '').trim();
      cleanup(val || null);
    });
    cancelBtn.addEventListener('click', () => cleanup(null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = (input.value || '').trim();
        cleanup(val || null);
      } else if (e.key === 'Escape') {
        cleanup(null);
      }
    });
    setTimeout(() => input.focus(), 0);
  });
}

function showConfirmAddressToast(initialAddress, { normalized = false } = {}) {
  return new Promise((resolve) => {
    ensureStyles();
    // Remove any existing confirm
    document.querySelectorAll('.oz-mcp-confirm').forEach((e) => e.remove());

    const wrap = document.createElement('div');
    wrap.className = 'oz-mcp-confirm';
    const label = document.createElement('span');
    label.textContent = 'Confirm address:';
    const addr = document.createElement('span');
    addr.className = 'addr';
    addr.textContent = initialAddress || '';
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = normalized ? 'normalized' : 'detected';
    const editBtn = document.createElement('button');
    editBtn.className = 'btn edit';
    editBtn.textContent = 'Edit';
    const okBtn = document.createElement('button');
    okBtn.className = 'btn ok';
    okBtn.textContent = 'Confirm';

    wrap.appendChild(label);
    wrap.appendChild(addr);
    wrap.appendChild(tag);
    wrap.appendChild(editBtn);
    wrap.appendChild(okBtn);
    document.body.appendChild(wrap);

    function cleanup(payload) { wrap.remove(); resolve(payload); }

    okBtn.addEventListener('click', () => cleanup({ action: 'confirm', address: initialAddress }));
    editBtn.addEventListener('click', () => {
      // swap to an input field inline
      const input = document.createElement('input');
      input.value = initialAddress || '';
      wrap.replaceChild(input, addr);
      input.focus();
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') cleanup({ action: 'edit', address: input.value.trim() });
        if (e.key === 'Escape') cleanup({ action: 'cancel' });
      });
      okBtn.textContent = 'Submit';
      okBtn.onclick = () => cleanup({ action: 'edit', address: input.value.trim() });
      editBtn.textContent = 'Cancel';
      editBtn.onclick = () => cleanup({ action: 'cancel' });
    });

    // Auto-dismiss after 15s if no interaction
    setTimeout(() => cleanup({ action: 'cancel' }), 15000);
  });
}

let scanTimeout = null;
let lastScanTime = 0;
const MIN_SCAN_INTERVAL = 3000; // minimum 3 seconds between scans

function scheduleScan() {
  if (scanTimeout) clearTimeout(scanTimeout);
  
  // Enforce minimum interval between scans
  const now = Date.now();
  const timeSinceLastScan = now - lastScanTime;
  const delay = Math.max(SCAN_DEBOUNCE_MS, MIN_SCAN_INTERVAL - timeSinceLastScan);
  
  scanTimeout = setTimeout(() => {
    lastScanTime = Date.now();
    scanForAddresses();
  }, delay);
}

// Conservative mutation observer - only clear stale addresses, don't auto-scan
let mutationTimeout = null;
let lastPageContent = document.body?.textContent || '';
const observer = new MutationObserver(() => {
  // Additional throttling for mutation events
  if (mutationTimeout) clearTimeout(mutationTimeout);
  mutationTimeout = setTimeout(() => {
    // Clear stale addresses on major DOM changes but don't auto-scan
    const currentPageContent = document.body?.textContent || '';
    if (currentPageContent !== lastPageContent) {
      
      scannedAddresses.clear();
      addressQueue.length = 0;
      lastPageContent = currentPageContent;
    }
    // Don't call scheduleScan() - only scan on explicit user request
  }, 1000); // Wait 1 second after mutations stop
});

observer.observe(document.documentElement, { 
  childList: true, 
  subtree: true, 
  characterData: true 
});

// Initialize styles but don't start automatic scanning
// Scans should only happen when explicitly requested via manual scan or context menu
ensureStyles();
ozLog('Content script loaded - automatic scanning disabled');
const config = getCurrentSiteConfig();
ozLog('Page info', { 
  url: window.location.href, 
  title: document.title,
  domain: window.location.hostname,
  siteName: config.siteName,
  supportedSite: config.siteName !== 'generic'
});

let contextLoadingToast = null;

// Context menu result handler → show toast near selection
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  ozLog('Content script received message', { type: message?.type });
  
  if (message?.type === 'OZ_MANUAL_SCAN') {
    checksUsed = 0; // allow another batch
    
    scannedAddresses.clear(); // Clear stale addresses
    addressQueue.length = 0; // Clear pending queue
    scanLoadingToast = showToast('Scanning for addresses...', true);
    scheduleScan();
    return; // no async
  }
  if (message?.type === 'OZ_TOAST' && message.text) {
    const isLoading = !!message.loading;
    if (isLoading) {
      // Store reference to loading toast so we can hide it later
      scanLoadingToast = showToast(message.text, true);
    } else {
      showToast(message.text);
    }
    return; // no async
  }
  if (message?.type === 'OZ_CONTEXT_LOADING') {
    contextLoadingToast = showToastNearSelection('Checking opportunity zone...', true);
    return; // no async
  }
  if (message?.type === 'OZ_HIDE_LOADING_TOAST') {
    // Hide scan loading toast if visible
    if (scanLoadingToast && scanLoadingToast.parentElement) {
      scanLoadingToast.remove();
      scanLoadingToast = null;
    }
    return; // no async
  }
  if (message?.type === 'OZ_PING') {
    // Respond to ping to confirm content script is available
    sendResponse({ pong: true });
    return true; // async
  }
  if (message?.type === 'OZ_GET_LOGS') {
    // Return internal logs for debugging
    sendResponse({ logs: ozGetLogs() });
    return true; // async
  }
  if (message?.type === 'OZ_CLEAR_LOGS') {
    // Clear internal logs
    ozClearLogs();
    sendResponse({ cleared: true });
    return true; // async
  }
  if (message?.type === 'OZ_GET_PAGE_ADDRESSES') {
    ozLog('Received OZ_GET_PAGE_ADDRESSES request - comparing methods');
    
    try {
      // Method 1: Comprehensive extraction
      const comprehensiveAddress = extractListingAddress();
      ozLog('Comprehensive method result', { address: comprehensiveAddress });
      
      // Method 2: Original simple regex (for comparison)
      const originalAddresses = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const text = (node.nodeValue || '').trim();
          if (!text || text.length > 200) return NodeFilter.FILTER_REJECT;
          if (!ADDRESS_REGEX.test(text)) return NodeFilter.FILTER_SKIP;
          const parent = node.parentElement;
          if (!parent || !isVisible(parent)) return NodeFilter.FILTER_SKIP;
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      while (walker.nextNode()) {
        const text = walker.currentNode.nodeValue;
        const m = text.match(ADDRESS_REGEX);
        if (m) originalAddresses.push(m[0]);
      }

      const uniqueOriginal = [...new Set(originalAddresses)];
      ozLog('Original regex method result', { addresses: uniqueOriginal });
      
      // Prefer original regex method since comprehensive seems to be wrong
      const finalAddress = (uniqueOriginal.length > 0 ? uniqueOriginal[0] : null) || comprehensiveAddress;
      const addresses = finalAddress ? [finalAddress] : [];
      
      ozLog('Final selected address for response', { addresses });
      sendResponse({ addresses });
    } catch (error) {
      ozLog('ERROR: Address extraction failed', { error: error.message });
      sendResponse({ addresses: [] });
    }
    
    return true; // async
  }
  if (message?.type === 'OZ_CONFIRM_ADDRESS') {
    (async () => {
      const resp = await showConfirmAddressToast(message.address || '', { normalized: !!message.normalized });
      // Only block automatic scanning if user confirms or edits (not if they cancel)
      if (resp?.action === 'confirm' || resp?.action === 'edit') {
        manualLookupInProgress = true;
      }
      sendResponse(resp);
    })();
    return true; // async
  }
  if (message?.type === 'OZ_GET_SELECTION') {
    const selection = getSelectionText();
    sendResponse({ selection });
    return true; // async ok
  }
  if (message?.type === 'OZ_PROMPT_FOR_ADDRESS') {
    (async () => {
      const address = await promptForAddressInline();
      // Only block automatic scanning if user provided an address
      if (address) {
        manualLookupInProgress = true;
      }
      sendResponse({ address });
    })();
    return true; // keep the channel open for async response
  }
  if (message?.type !== 'OZ_CONTEXT_RESULT') return;
  
  // Remove loading toast
  if (contextLoadingToast && contextLoadingToast.parentElement) {
    contextLoadingToast.remove();
    contextLoadingToast = null;
  }
  
  const { query, result } = message;
  // Manual lookup is complete, re-enable automatic scanning
  manualLookupInProgress = false;
  
  if (!result || result.error) {
    if (result?.status === 429) {
      showToastNearSelection('Over limit — upgrade for more');
    } else {
      showToastNearSelection('Service unavailable. Try again later.');
    }
    return; // no async
  }
  if (result.addressNotFound) {
    showToastNearSelection('Address not found');
    return; // no async
  }
  if (result.isInOpportunityZone) {
    showToastNearSelection('In an Opportunity Zone');
  } else {
    showToastNearSelection('Not in an Opportunity Zone');
  }
  // no async response
});
