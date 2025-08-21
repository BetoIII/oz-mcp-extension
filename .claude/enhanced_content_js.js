// Enhanced content.js with support for top 6 real estate sites
// Supports: Zillow, Realtor.com, Redfin, LoopNet, Crexi, CommercialSearch

// Site-specific configurations
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
    listingPagePatterns: [
      '/homedetails/',
      '/b/',
      '/homes/',
      '/for_sale/',
      '/for_rent/'
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
    listingPagePatterns: [
      '/realestateandhomes-detail/',
      '/property/',
      '/mls-',
      '/realestateandhomes-search/',
      '/apartments/'
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
    listingPagePatterns: [
      '/home/',
      '/zipcode/',
      '/city/',
      '/stingray/',
      '/building/'
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
    listingPagePatterns: [
      '/Listing/',
      '/search/',
      '/property/',
      '/Properties/',
      '/Land/',
      '/Building/'
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
    listingPagePatterns: [
      '/properties/',
      '/lease/',
      '/sale/',
      '/assets/',
      '/property/',
      '/properties/search'
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
    listingPagePatterns: [
      '/property/',
      '/listing/',
      '/space/',
      '/office-space/',
      '/industrial/',
      '/retail/'
    ],
    extractionStrategy: 'costar',
    waitForSelector: '.property-address, .listing-detail-address',
    scanDelay: 1200
  }
};

// Extraction strategies for different sites
const EXTRACTION_STRATEGIES = {
  'standard': (element) => {
    return cleanAddress(element.textContent.trim());
  },
  
  'realtor': (element) => {
    // Realtor.com sometimes has address in child elements
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
      return cleanAddress(element.textContent.trim());
    }
    
    return cleanAddress(addressParts.join(', '));
  },
  
  'redfin': (element) => {
    // Redfin often splits address into multiple elements
    const parts = [];
    const streetElement = element.querySelector('.street-address') || 
                         element.querySelector('[data-rf-test-id="abp-streetLine"]');
    const cityStateZip = element.querySelector('.cityStateZip') || 
                        element.querySelector('.bp-cityStateZip');
    
    if (streetElement) parts.push(streetElement.textContent.trim());
    if (cityStateZip) parts.push(cityStateZip.textContent.trim());
    
    // If no specific elements found, try to get full text
    if (parts.length === 0) {
      return cleanAddress(element.textContent.trim());
    }
    
    return cleanAddress(parts.join(', '));
  },
  
  'loopnet': (element) => {
    // LoopNet sometimes has structured data
    const addressLine1 = element.querySelector('.address-line-1');
    const addressLine2 = element.querySelector('.address-line-2');
    
    if (addressLine1 && addressLine2) {
      return cleanAddress(`${addressLine1.textContent.trim()}, ${addressLine2.textContent.trim()}`);
    }
    
    // Check for breadcrumb format
    if (element.classList.contains('breadcrumbs__crumb')) {
      const text = element.textContent.trim();
      // Remove "Properties in" prefix if present
      return cleanAddress(text.replace(/^Properties in\s+/i, ''));
    }
    
    return cleanAddress(element.textContent.trim());
  },
  
  'costar': (element) => {
    // CoStar/CommercialSearch properties often have structured address data
    const lines = element.querySelectorAll('[class*="address-line"]');
    if (lines.length > 0) {
      return cleanAddress(Array.from(lines).map(l => l.textContent.trim()).join(', '));
    }
    
    // Check for address within header
    if (element.tagName === 'ADDRESS') {
      const spans = element.querySelectorAll('span');
      if (spans.length > 0) {
        return cleanAddress(Array.from(spans).map(s => s.textContent.trim()).join(', '));
      }
    }
    
    return cleanAddress(element.textContent.trim());
  }
};

// Helper function to clean and normalize addresses
function cleanAddress(address) {
  return address
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/^[,\s]+|[,\s]+$/g, '') // Trim commas and spaces
    .replace(/,,+/g, ',') // Remove duplicate commas
    .replace(/\|/g, ',') // Replace pipes with commas
    .replace(/\s*,\s*/g, ', ') // Normalize comma spacing
    .trim();
}

// Get current site configuration
function getCurrentSiteConfig() {
  const hostname = window.location.hostname.replace('www.', '');
  
  // Check for exact match first
  if (SITE_CONFIGS[hostname]) {
    return { ...SITE_CONFIGS[hostname], siteName: hostname };
  }
  
  // Check for subdomain matches
  for (const [site, config] of Object.entries(SITE_CONFIGS)) {
    if (hostname.endsWith(site)) {
      return { ...config, siteName: site };
    }
  }
  
  // Return a generic config for unsupported sites
  return {
    addressSelectors: [
      '.address',
      '.property-address',
      '[class*="address"]',
      '[data-testid*="address"]',
      'address'
    ],
    listingPagePatterns: [],
    extractionStrategy: 'standard',
    waitForSelector: null,
    scanDelay: 1000,
    siteName: 'generic'
  };
}

// Enhanced address detection with site-specific logic
async function detectAddresses(config) {
  const addresses = new Set();
  const addressElements = [];
  
  // Wait for dynamic content if needed
  if (config.waitForSelector) {
    try {
      await waitForElement(config.waitForSelector, 5000);
    } catch (e) {
      console.log('Timeout waiting for selector, continuing with scan...');
    }
  }
  
  // Apply scan delay for dynamic content
  await new Promise(resolve => setTimeout(resolve, config.scanDelay));
  
  // Try each selector
  for (const selector of config.addressSelectors) {
    try {
      const elements = document.querySelectorAll(selector);
      
      for (const element of elements) {
        if (!element || !element.textContent) continue;
        
        // Extract address using appropriate strategy
        const strategy = EXTRACTION_STRATEGIES[config.extractionStrategy] || 
                        EXTRACTION_STRATEGIES.standard;
        const address = strategy(element);
        
        // Validate address format
        if (isValidAddress(address) && !addresses.has(address)) {
          addresses.add(address);
          addressElements.push({
            element,
            address,
            selector
          });
        }
      }
    } catch (error) {
      console.debug(`Error with selector ${selector}:`, error);
    }
  }
  
  return addressElements;
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

// Validate address format
function isValidAddress(address) {
  if (!address || address.length < 10) return false;
  
  // Must contain at least a number and letters
  const hasNumber = /\d/.test(address);
  const hasLetters = /[a-zA-Z]/.test(address);
  
  // Common invalid patterns
  const invalidPatterns = [
    /^(for sale|for rent|for lease)/i,
    /^(price|sold|pending)/i,
    /^(bed|bath|sqft)/i,
    /^(\$|price)/i,
    /^(call|contact|email)/i
  ];
  
  if (!hasNumber || !hasLetters) return false;
  
  for (const pattern of invalidPatterns) {
    if (pattern.test(address)) return false;
  }
  
  return true;
}

// Mutation observer to handle dynamic content
function setupMutationObserver(config) {
  let timeoutId;
  
  const observer = new MutationObserver(() => {
    // Debounce the scan
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      scanPageForAddresses(config);
    }, 1000);
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: false,
    characterData: false
  });
  
  return observer;
}

// Main scanning function
async function scanPageForAddresses(config) {
  console.log(`[OZ Extension] Scanning ${config.siteName} for addresses...`);
  
  try {
    const addressElements = await detectAddresses(config);
    
    if (addressElements.length === 0) {
      console.log('[OZ Extension] No addresses found on page');
      return;
    }
    
    console.log(`[OZ Extension] Found ${addressElements.length} addresses`);
    
    // Process each address
    for (const { element, address } of addressElements) {
      // Check if already processed
      if (element.dataset.ozProcessed === 'true') continue;
      
      // Mark as processed
      element.dataset.ozProcessed = 'true';
      
      // Send to background for OZ check
      chrome.runtime.sendMessage({
        type: 'CHECK_OZ',
        address: address,
        siteName: config.siteName
      }, (response) => {
        if (response && response.inOZ) {
          injectOZBadge(element, response);
        }
      });
    }
  } catch (error) {
    console.error('[OZ Extension] Error scanning page:', error);
  }
}

// Inject OZ badge into the page
function injectOZBadge(element, ozData) {
  // Check if badge already exists
  if (element.querySelector('.oz-badge')) return;
  
  const badge = document.createElement('span');
  badge.className = 'oz-badge';
  badge.innerHTML = 'OZ';
  badge.style.cssText = `
    display: inline-block;
    background: #40E0D0;
    color: #000;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: bold;
    margin-left: 8px;
    cursor: help;
    position: relative;
    vertical-align: middle;
  `;
  
  // Add tooltip
  const tooltip = document.createElement('div');
  tooltip.className = 'oz-tooltip';
  tooltip.innerHTML = `
    <strong>Opportunity Zone</strong><br>
    Tract: ${ozData.tractId || 'N/A'}<br>
    ${ozData.county ? `County: ${ozData.county}<br>` : ''}
    ${ozData.state ? `State: ${ozData.state}` : ''}
  `;
  tooltip.style.cssText = `
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    background: #333;
    color: #fff;
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 12px;
    white-space: nowrap;
    display: none;
    z-index: 10000;
    margin-bottom: 5px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  `;
  
  badge.appendChild(tooltip);
  
  // Show/hide tooltip on hover
  badge.addEventListener('mouseenter', () => {
    tooltip.style.display = 'block';
  });
  
  badge.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
  });
  
  // Append badge to element
  element.appendChild(badge);
}

// Initialize extension on page load
function initializeExtension() {
  const config = getCurrentSiteConfig();
  
  console.log(`[OZ Extension] Initialized for ${config.siteName}`);
  
  // Initial scan
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      scanPageForAddresses(config);
    });
  } else {
    scanPageForAddresses(config);
  }
  
  // Setup mutation observer for dynamic content
  setupMutationObserver(config);
  
  // Listen for URL changes (for SPAs)
  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      setTimeout(() => scanPageForAddresses(config), 1000);
    }
  }).observe(document, { subtree: true, childList: true });
}

// Message listener for communication with background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'SCAN_PAGE') {
    const config = getCurrentSiteConfig();
    scanPageForAddresses(config).then(() => {
      sendResponse({ success: true });
    });
    return true; // Keep channel open for async response
  }
  
  if (request.type === 'GET_SITE_INFO') {
    const config = getCurrentSiteConfig();
    sendResponse({
      siteName: config.siteName,
      supported: config.siteName !== 'generic'
    });
    return false;
  }
});

// Initialize the extension
initializeExtension();