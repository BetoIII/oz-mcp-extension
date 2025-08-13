// OZ-MCP Background service worker (MV3)
// Responsibilities: temp-key lifecycle, OZ lookup networking, LRU cache, context menu, message routing

// Feature flags
const FEATURE_FLAGS = {
  // Enable URL-based listing-address fallback to resolve addresses on pages
  // where a full inline address isn't present (e.g., search results or
  // dynamically rendered sites like Zillow). This allows the sidebar flow to
  // proceed by extracting from the current tab URL via the server endpoint.
  USE_LISTING_ADDRESS_FALLBACK: true,
};

const BASE_URL = 'https://oz-mcp.vercel.app';
const CHECK_ENDPOINT = '/api/opportunity-zones/check';
const LISTING_ADDRESS_ENDPOINT = '/api/listing-address';
const GEOCODE_ENDPOINT = '/api/opportunity-zones/geocode';
const TEMP_KEY_ENDPOINT = '/api/temporary-key';

const STORAGE_KEYS = {
  AUTH: 'oz_mcp_auth',
  CACHE: 'oz_mcp_cache',
  CIRCUIT_BREAKER: 'oz_mcp_circuit_breaker',
};

const CACHE_LIMIT = 100; // LRU approx size
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// Request deduplication - track active requests to prevent duplicates
const activeRequests = new Map();

// Circuit breaker configuration
const CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: 3, // After 3 consecutive failures
  resetTimeout: 30000, // 30 seconds
  backoffMultiplier: 2,
  maxBackoff: 60000, // Max 60 seconds
};

let circuitBreakerState = {
  failures: 0,
  lastFailure: 0,
  state: 'CLOSED', // CLOSED, OPEN, HALF_OPEN
  nextAttempt: 0,
};

// Circuit breaker helpers
async function loadCircuitBreakerState() {
  const { [STORAGE_KEYS.CIRCUIT_BREAKER]: saved } = await getLocal([STORAGE_KEYS.CIRCUIT_BREAKER]);
  if (saved) {
    circuitBreakerState = { ...circuitBreakerState, ...saved };
  }
}

async function saveCircuitBreakerState() {
  await setLocal({ [STORAGE_KEYS.CIRCUIT_BREAKER]: circuitBreakerState });
}

function isCircuitBreakerOpen() {
  const now = Date.now();
  if (circuitBreakerState.state === 'OPEN' && now < circuitBreakerState.nextAttempt) {
    return true;
  }
  if (circuitBreakerState.state === 'OPEN' && now >= circuitBreakerState.nextAttempt) {
    circuitBreakerState.state = 'HALF_OPEN';
    saveCircuitBreakerState();
  }
  return false;
}

function recordSuccess() {
  if (circuitBreakerState.failures > 0) {
    circuitBreakerState.failures = 0;
    circuitBreakerState.state = 'CLOSED';
    saveCircuitBreakerState();
  }
}

function recordFailure() {
  circuitBreakerState.failures += 1;
  circuitBreakerState.lastFailure = Date.now();
  
  if (circuitBreakerState.failures >= CIRCUIT_BREAKER_CONFIG.failureThreshold) {
    circuitBreakerState.state = 'OPEN';
    const backoff = Math.min(
      CIRCUIT_BREAKER_CONFIG.resetTimeout * Math.pow(CIRCUIT_BREAKER_CONFIG.backoffMultiplier, circuitBreakerState.failures - CIRCUIT_BREAKER_CONFIG.failureThreshold),
      CIRCUIT_BREAKER_CONFIG.maxBackoff
    );
    circuitBreakerState.nextAttempt = Date.now() + backoff;
  }
  saveCircuitBreakerState();
}

// Simple request deduplication for identical requests
function createRequestKey(endpoint, params) {
  return `${endpoint}_${JSON.stringify(params)}`;
}

async function deduplicatedFetch(endpoint, options, params = {}) {
  // Check circuit breaker first
  if (isCircuitBreakerOpen()) {
    return { error: true, status: 503, message: 'Service temporarily unavailable (circuit breaker open)' };
  }

  const requestKey = createRequestKey(endpoint, params);
  
  // Return existing request if already in progress
  if (activeRequests.has(requestKey)) {
    return await activeRequests.get(requestKey);
  }

  const requestPromise = (async () => {
    try {
      // Enforce HTTP-only content negotiation headers on every request
      const baseHeaders = new Headers(options && options.headers ? options.headers : {});
      baseHeaders.set('Accept', 'application/json');
      baseHeaders.set('X-OZ-Capabilities', 'http-only');

      const mergedOptions = { ...(options || {}), headers: baseHeaders };

      const response = await fetch(`${BASE_URL}${endpoint}`, mergedOptions);
      // Explicitly reject any streaming/SSE responses
      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('text/event-stream')) {
        recordFailure();
        return {
          ok: false,
          status: 406,
          error: true,
          data: {
            error: 'SSE_NOT_SUPPORTED',
            message: 'Received text/event-stream but the extension requires JSON (http-only).'
          }
        };
      }

      const text = await response.text();
      let data = null;
      try { 
        data = text ? JSON.parse(text) : null; 
      } catch { 
        // If the body looks like SSE frames, treat as a protocol error
        if (/^data:\s/m.test(text) || /^event:\s/m.test(text)) {
          recordFailure();
          return {
            ok: false,
            status: 406,
            error: true,
            data: {
              error: 'SSE_NOT_SUPPORTED',
              message: 'Detected event-stream framing in response; expected JSON.'
            }
          };
        }
        data = { raw: text }; 
      }

      if (response.ok) {
        recordSuccess();
      } else {
        recordFailure();
      }

      return {
        ok: response.ok,
        status: response.status,
        data,
        error: !response.ok
      };
    } catch (error) {
      recordFailure();
      return { error: true, status: 0, message: 'Network error' };
    } finally {
      activeRequests.delete(requestKey);
    }
  })();

  activeRequests.set(requestKey, requestPromise);
  return await requestPromise;
}

// Debounce function for requests
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Helper function for delays
function sleep(ms) { 
  return new Promise(resolve => setTimeout(resolve, ms)); 
}

// Address extraction using same regex as content script
const ADDRESS_REGEX = /\b(\d{1,6})\s+([A-Za-z0-9'.\-]+(?:\s+[A-Za-z0-9'.\-]+)*)\s+(Ave|Avenue|St|Street|Rd|Road|Blvd|Boulevard|Ln|Lane|Dr|Drive|Ct|Court|Pl|Place|Ter|Terrace|Way|Pkwy|Parkway)\b[ ,]*([A-Za-z .'-]+)?[ ,]+([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/;

// Request deduplication for getAddressesFromPage (clear on startup for testing)
const addressScanCache = new Map();


// Ask content script to scan page for addresses using regex
function getAddressesFromPage(tabId) {
  // Check if we already have a scan in progress for this tab
  const cacheKey = `tab_${tabId}`;
  if (addressScanCache.has(cacheKey)) {
    
    return addressScanCache.get(cacheKey);
  }

  const promise = new Promise((resolve) => {
    let settled = false;
    
    try {
      chrome.tabs.sendMessage(tabId, { type: 'OZ_GET_PAGE_ADDRESSES' }, (resp) => {
        if (chrome.runtime.lastError) {
          if (!settled) { settled = true; resolve([]); }
          return;
        }
        if (settled) return;
        settled = true;
        const addresses = (resp && Array.isArray(resp.addresses)) ? resp.addresses : [];
        
        resolve(addresses);
      });
    } catch {
      resolve([]);
    }
    setTimeout(() => { if (!settled) { settled = true; resolve([]); } }, 3000);
  });

  // Cache the promise and clear it after completion
  addressScanCache.set(cacheKey, promise);
  promise.finally(() => {
    setTimeout(() => addressScanCache.delete(cacheKey), 5000); // Clear cache after 5 seconds
  });

  return promise;
}

// Utility: get and set in local storage (avoid sync for quota)
function getLocal(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (data) => resolve(data));
  });
}

function setLocal(obj) {
  return new Promise((resolve) => {
    chrome.storage.local.set(obj, () => resolve());
  });
}

// Normalize address for cache key
function normalizeAddress(address) {
  return (address || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[#,]/g, '')
    .trim();
}

// LRU cache helpers stored as simple map with timestamps
async function getCachedResult(key) {
  const { [STORAGE_KEYS.CACHE]: cache = {} } = await getLocal([STORAGE_KEYS.CACHE]);
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    // expired
    delete cache[key];
    await setLocal({ [STORAGE_KEYS.CACHE]: cache });
    return null;
  }
  entry.timestamp = Date.now(); // touch
  await setLocal({ [STORAGE_KEYS.CACHE]: cache });
  return entry.value;
}

async function setCachedResult(key, value) {
  const { [STORAGE_KEYS.CACHE]: cache = {} } = await getLocal([STORAGE_KEYS.CACHE]);
  // enforce size limit
  const keys = Object.keys(cache);
  if (keys.length >= CACHE_LIMIT) {
    // evict least-recently-used (oldest timestamp)
    let oldestKey = keys[0];
    for (const k of keys) {
      if (cache[k].timestamp < cache[oldestKey].timestamp) oldestKey = k;
    }
    delete cache[oldestKey];
  }
  cache[key] = { value, timestamp: Date.now() };
  await setLocal({ [STORAGE_KEYS.CACHE]: cache });
}

// Auth data model and utilities
let authState = {
  token: null,
  expiresAt: null,
  usageLimit: 5,
  usedCount: 0,
  isRegistered: false,
  issuedAt: null,
  nextResetAt: null
};

let authMeta = {
  lastError: null,
  overLimit: false,
  circuitBreaker: {
    state: 'CLOSED',
    nextAttempt: 0
  }
};

// Initialize auth state on startup
async function initializeAuthState() {
  const { [STORAGE_KEYS.AUTH]: stored } = await getLocal([STORAGE_KEYS.AUTH]);
  if (stored) {
    authState = { ...authState, ...stored };
  }
  // Update circuit breaker state in auth meta
  authMeta.circuitBreaker = {
    state: circuitBreakerState.state,
    nextAttempt: circuitBreakerState.nextAttempt
  };
  broadcastAuthStatus();
}

// Save auth state to storage
async function saveAuthState() {
  await setLocal({ [STORAGE_KEYS.AUTH]: authState });
}

// Broadcast auth status to all listeners
function broadcastAuthStatus() {
  // Update circuit breaker info in meta
  authMeta.circuitBreaker = {
    state: circuitBreakerState.state,
    nextAttempt: circuitBreakerState.nextAttempt
  };
  
  chrome.runtime.sendMessage({
    type: 'OZ_AUTH_STATUS',
    auth: authState,
    meta: authMeta
  }).catch(() => {
    // Ignore errors from inactive listeners
  });
}

// Track usage from server response headers or increment locally
function trackUsage(fetchResult, wasFromCache = false) {
  if (wasFromCache) return; // Don't track cached results
  
  // For successful requests, increment usage count
  // (Server headers would be available in the actual fetch response, but our 
  // deduplicatedFetch wrapper doesn't expose them - we'll use fallback counting)
  if (fetchResult && fetchResult.ok && !fetchResult.error) {
    authState.usedCount = Math.min(authState.usedCount + 1, authState.usageLimit);
    saveAuthState();
    broadcastAuthStatus();
  }
}

// Handle rate limit response
function handleRateLimit(response) {
  authMeta.overLimit = true;
  authState.usedCount = authState.usageLimit; // Mark as fully used
  saveAuthState();
  broadcastAuthStatus();
}

// Auth token lifecycle: use stored API key or fetch a temporary key
async function getAuthToken() {
  const now = Date.now();
  if (authState.token && (!authState.expiresAt || now < authState.expiresAt - 60_000)) {
    return authState.token;
  }

  // Clear auth meta errors before attempting new request
  authMeta.lastError = null;
  authMeta.overLimit = false;

  // fetch temporary key using deduplicated request
  const result = await deduplicatedFetch(TEMP_KEY_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-OZ-Extension': chrome.runtime.getManifest().version || 'unknown',
    },
  }, { endpoint: 'temp_key' });

  if (result.error) {
    authMeta.lastError = `Failed to retrieve temporary key: ${result.status}`;
    broadcastAuthStatus();
    throw new Error(authMeta.lastError);
  }
  
  const { token, expiresAt, usageLimit, isRegistered } = result.data;
  authState = {
    token,
    expiresAt: expiresAt ? Date.parse(expiresAt) : null,
    usageLimit: usageLimit || 5,
    usedCount: 0, // Reset usage count on new token
    isRegistered: isRegistered || false,
    issuedAt: now,
    nextResetAt: expiresAt ? Date.parse(expiresAt) : null
  };
  
  await saveAuthState();
  broadcastAuthStatus();
  return token;
}

// Force refresh temporary key
async function requestNewTempKey() {
  // Clear current auth state
  authState = {
    token: null,
    expiresAt: null,
    usageLimit: 5,
    usedCount: 0,
    isRegistered: false,
    issuedAt: null,
    nextResetAt: null
  };
  authMeta.overLimit = false;
  authMeta.lastError = null;
  
  await saveAuthState();
  broadcastAuthStatus();
  
  // Fetch new token
  return await getAuthToken();
}

async function openUpgradeTab() {
  chrome.tabs.create({ url: `${BASE_URL}/signup?source=ext` });
}

// Safe send to content script: resolves false if no receiver
function safeSend(tabId, message) {
  return new Promise((resolve) => {
    if (!tabId) return resolve(false);
    try {
      chrome.tabs.sendMessage(tabId, message, () => {
        // Read lastError to silence "Unchecked runtime.lastError"
        const hadError = Boolean(chrome.runtime.lastError);
        resolve(!hadError);
      });
    } catch {
      resolve(false);
    }
  });
}

// Try to resolve an address from the current tab URL using production listing-address service
async function resolveAddressFromUrl(listingUrl) {
  try {
    if (!listingUrl) return { address: null };
    const token = await getAuthToken();
    
    const result = await deduplicatedFetch(LISTING_ADDRESS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-OZ-Extension': chrome.runtime.getManifest().version || 'unknown',
      },
      body: JSON.stringify({ url: listingUrl }),
    }, { url: listingUrl });

    if (result.status === 429) {
      handleRateLimit(result);
      const code = result.data?.code || 'RATE_LIMITED';
      return { error: true, status: 429, code, message: 'Rate limited' };
    }
    if (result.error) {
      return { error: true, status: result.status, message: result.data?.message || 'Failed to extract address' };
    }
    
    // Track usage for successful listing-address API calls
    trackUsage(result);

    const candidate = (result.data && (
      result.data.address ||
      result.data.normalizedAddress ||
      result.data.result?.address ||
      result.data.result?.normalizedAddress ||
      null
    ));

    if (!candidate || typeof candidate !== 'string' || candidate.trim().length < 5) {
      return { address: null };
    }
    return { address: candidate.trim(), meta: result.data?.meta };
  } catch (e) {
    return { error: true, status: 0, message: 'Network error' };
  }
}

// Ask the content script to prompt the user inline for an address (fallback)
function promptForAddress(tabId) {
  return new Promise((resolve) => {
    let settled = false;
    try {
      chrome.tabs.sendMessage(tabId, { type: 'OZ_PROMPT_FOR_ADDRESS' }, (resp) => {
        // consume lastError to avoid warnings
        if (chrome.runtime.lastError) {
          if (!settled) { settled = true; resolve(null); }
          return;
        }
        if (settled) return;
        settled = true;
        const address = (resp && typeof resp.address === 'string') ? resp.address.trim() : '';
        resolve(address || null);
      });
    } catch {
      // ignore
    }
    setTimeout(() => { if (!settled) { settled = true; resolve(null); } }, 4000);
  });
}

// Ask the content script for current selection text (if any)
function getCurrentSelection(tabId) {
  return new Promise((resolve) => {
    let settled = false;
    try {
      chrome.tabs.sendMessage(tabId, { type: 'OZ_GET_SELECTION' }, (resp) => {
        if (chrome.runtime.lastError) {
          if (!settled) { settled = true; resolve(null); }
          return;
        }
        if (settled) return;
        settled = true;
        const sel = (resp && typeof resp.selection === 'string') ? resp.selection.trim() : '';
        resolve(sel || null);
      });
    } catch {
      // ignore
    }
    setTimeout(() => { if (!settled) { settled = true; resolve(null); } }, 1000);
  });
}

// Ask user to confirm the address via content script UI (appears near toolbar icon)
function requestUserAddressConfirmation(tabId, address, { normalized = false } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    try {
      chrome.tabs.sendMessage(tabId, { type: 'OZ_CONFIRM_ADDRESS', address, normalized }, (resp) => {
        if (chrome.runtime.lastError) {
          if (!settled) { settled = true; resolve({ action: 'cancel' }); }
          return;
        }
        if (settled) return;
        settled = true;
        resolve(resp || { action: 'cancel' });
      });
    } catch {
      // ignore
    }
    setTimeout(() => { if (!settled) { settled = true; resolve({ action: 'cancel' }); } }, 15000);
  });
}

// Normalize an edited address once before final confirmation
async function normalizeAddressViaGeocode(address) {
  try {
    const token = await getAuthToken();
    
    const result = await deduplicatedFetch(GEOCODE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-OZ-Extension': chrome.runtime.getManifest().version || 'unknown',
      },
      body: JSON.stringify({ address }),
    }, { address });

    if (result.status === 429) {
      handleRateLimit(result);
      const code = result.data?.code || 'RATE_LIMITED';
      return { error: true, status: 429, code, message: 'Rate limited' };
    }
    if (result.error) {
      return { error: true, status: result.status, message: result.data?.message || 'Failed to normalize address' };
    }
    
    // Track usage for successful geocode API calls
    trackUsage(result);
    
    const normalized = result.data?.normalizedAddress || result.data?.address || null;
    return { address: normalized || address, meta: result.data?.meta };
  } catch (e) {
    return { error: true, status: 0, message: 'Network error' };
  }
}

// Sidebar-specific flow: simplified for sidebar UI
async function runSidebarAddressCheckFlow(tab) {
  const tabId = tab?.id;
  const url = tab?.url || '';
  let chosenAddress = null;

  // Send step update to sidebar
  chrome.runtime.sendMessage({
    type: 'OZ_SIDEBAR_STEP',
    step: 'scan',
    status: 'loading',
    data: { message: 'Scanning page content...' }
  });

  // Step 1: try regex scan of page content (fast and reliable)
  if (tabId) {
    const foundAddresses = await getAddressesFromPage(tabId);
    if (foundAddresses.length > 0) {
      // Use the first address found
      chosenAddress = foundAddresses[0];
      
      chrome.runtime.sendMessage({
        type: 'OZ_SIDEBAR_STEP',
        step: 'scan',
        status: 'success',
        data: { message: 'Found address' }
      });
      
      chrome.runtime.sendMessage({
        type: 'OZ_SIDEBAR_ADDRESS',
        address: chosenAddress
      });
      
      // Start confirmation step
      chrome.runtime.sendMessage({
        type: 'OZ_SIDEBAR_STEP',
        step: 'confirm',
        status: 'success',
        data: { message: 'Address ready for lookup' }
      });
      
      // Proceed to lookup
      await lookupAddressForSidebar(chosenAddress);
      return;
    }
  }

  // Step 2: try listing-address from URL (only if feature flag is enabled and no address found yet)
  if (!chosenAddress && FEATURE_FLAGS.USE_LISTING_ADDRESS_FALLBACK) {
    chrome.runtime.sendMessage({
      type: 'OZ_SIDEBAR_STEP',
      step: 'scan',
      status: 'loading',
      data: { message: 'Trying advanced extraction...' }
    });
    
    const urlResult = await resolveAddressFromUrl(url);
    if (urlResult?.error && urlResult.status === 429) {
      openUpgradeTab();
      chrome.runtime.sendMessage({
        type: 'OZ_SIDEBAR_ERROR',
        error: 'Over limit — upgrade for more'
      });
      return;
    }
    if (!urlResult?.error && urlResult?.address) {
      chosenAddress = urlResult.address;
      
      chrome.runtime.sendMessage({
        type: 'OZ_SIDEBAR_STEP',
        step: 'scan',
        status: 'success',
        data: { message: 'Found via API' }
      });
      
      chrome.runtime.sendMessage({
        type: 'OZ_SIDEBAR_ADDRESS',
        address: chosenAddress
      });
      
      // Start confirmation step
      chrome.runtime.sendMessage({
        type: 'OZ_SIDEBAR_STEP',
        step: 'confirm',
        status: 'success',
        data: { message: 'Address ready for lookup' }
      });
      
      // Proceed to lookup
      await lookupAddressForSidebar(chosenAddress);
      return;
    }
  }

  // No address found
  chrome.runtime.sendMessage({
    type: 'OZ_SIDEBAR_STEP',
    step: 'scan',
    status: 'error',
    data: { message: 'No addresses found on page' }
  });
}

async function lookupAddressForSidebar(address) {
  // Update lookup step
  chrome.runtime.sendMessage({
    type: 'OZ_SIDEBAR_STEP',
    step: 'lookup',
    status: 'loading',
    data: { message: 'Checking opportunity zone status...' }
  });

  // Check cache first
  const key = normalizeAddress(address);
  const cached = await getCachedResult(key);
  if (cached) {
    chrome.runtime.sendMessage({
      type: 'OZ_SIDEBAR_STEP',
      step: 'lookup',
      status: 'success',
      data: { message: 'Retrieved from cache' }
    });
    
    chrome.runtime.sendMessage({
      type: 'OZ_SIDEBAR_RESULT',
      result: { fromCache: true, ...cached }
    });
    return;
  }

  // Perform OZ lookup
  const result = await performOzLookup({ address });
  
  if (result?.error && result.status === 429) {
    openUpgradeTab();
    chrome.runtime.sendMessage({
      type: 'OZ_SIDEBAR_ERROR',
      error: 'Over limit — upgrade for more'
    });
    return;
  }
  
  if (result?.error) {
    chrome.runtime.sendMessage({
      type: 'OZ_SIDEBAR_STEP',
      step: 'lookup',
      status: 'error',
      data: { message: 'Lookup failed' }
    });
    
    chrome.runtime.sendMessage({
      type: 'OZ_SIDEBAR_ERROR',
      error: result.message || 'Service unavailable'
    });
    return;
  }

  // Success
  chrome.runtime.sendMessage({
    type: 'OZ_SIDEBAR_STEP',
    step: 'lookup',
    status: 'success',
    data: { message: 'Lookup complete' }
  });
  
  // Cache the result
  if (!result?.addressNotFound) {
    await setCachedResult(key, result);
  }
  
  chrome.runtime.sendMessage({
    type: 'OZ_SIDEBAR_RESULT',
    result: result
  });
}

// Legacy flow for context menu and other integrations
async function runAddressCheckFlow(tab, highlightedText) {
  const tabId = tab?.id;
  const url = tab?.url || '';
  let chosenAddress = null;

  // Show loading indicator for the entire flow
  if (tabId) {
    await safeSend(tabId, { type: 'OZ_TOAST', text: 'Scanning page for addresses...', loading: true });
  }

  // Step 1: try regex scan of page content (fast and reliable)
  if (tabId) {
    const foundAddresses = await getAddressesFromPage(tabId);
    if (foundAddresses.length > 0) {
      // Use the first address found
      chosenAddress = foundAddresses[0];
      // Debug: Show what address was detected
      if (tabId) {
        await safeSend(tabId, { type: 'OZ_TOAST', text: `Found address: ${chosenAddress.substring(0, 50)}...` });
        await sleep(1500); // Short delay to show the debug message
      }
    }
  }

  // Step 2: try listing-address from URL (only if feature flag is enabled and no address found yet)
  if (!chosenAddress && FEATURE_FLAGS.USE_LISTING_ADDRESS_FALLBACK) {
    if (tabId) {
      await safeSend(tabId, { type: 'OZ_TOAST', text: 'Trying advanced address extraction...', loading: true });
    }
    const urlResult = await resolveAddressFromUrl(url);
    if (urlResult?.error && urlResult.status === 429) {
      openUpgradeTab();
      if (tabId) {
        await safeSend(tabId, { type: 'OZ_HIDE_LOADING_TOAST' });
        await safeSend(tabId, { type: 'OZ_TOAST', text: 'Over limit — upgrade for more' });
      }
      return;
    }
    if (!urlResult?.error && urlResult?.address) {
      chosenAddress = urlResult.address;
      // Debug: Show what address was detected
      if (tabId) {
        await safeSend(tabId, { type: 'OZ_TOAST', text: `API found address: ${chosenAddress.substring(0, 50)}...` });
        await sleep(1500); // Short delay to show the debug message
      }
    }
  }

  // Step 3: user-highlighted selection (if no address found yet)
  if (!chosenAddress) {
    const selection = highlightedText || (tabId ? await getCurrentSelection(tabId) : null);
    if (selection) chosenAddress = selection;
  }

  // Step 4: manual inline entry prompt
  if (!chosenAddress && tabId) {
    chosenAddress = await promptForAddress(tabId);
  }

  if (!chosenAddress) {
    // Hide loading toast and show error message
    if (tabId) {
      await safeSend(tabId, { type: 'OZ_HIDE_LOADING_TOAST' });
      await safeSend(tabId, { type: 'OZ_TOAST', text: 'No address provided' });
    }
    return;
  }

  // Step A: Ask user to confirm the detected address near the icon
  if (tabId) {
    // Hide loading toast before showing confirmation
    await safeSend(tabId, { type: 'OZ_HIDE_LOADING_TOAST' });
    const first = await requestUserAddressConfirmation(tabId, chosenAddress, { normalized: false });
    if (first?.action === 'cancel') return;
    if (first?.action === 'edit') {
      // Use the edited address directly, skip normalization confirmation
      chosenAddress = first.address || chosenAddress;
    } else if (first?.action === 'confirm') {
      chosenAddress = first.address || chosenAddress;
    } else {
      return;
    }
  }

  // Check cache
  const key = normalizeAddress(chosenAddress);
  const cached = await getCachedResult(key);
  if (cached) {
    if (tabId) await safeSend(tabId, { type: 'OZ_CONTEXT_RESULT', query: chosenAddress, result: { fromCache: true, ...cached } });
    return;
  }

  // Perform OZ lookup
  let result = await performOzLookup({ address: chosenAddress });
  if (result?.error && result.status === 429) {
    openUpgradeTab();
    if (tabId) await safeSend(tabId, { type: 'OZ_CONTEXT_RESULT', query: chosenAddress, result: { error: true, status: 429, code: result.code } });
    return;
  }
  if (!result?.error && !result?.addressNotFound) {
    await setCachedResult(key, result);
  }
  if (tabId) await safeSend(tabId, { type: 'OZ_CONTEXT_RESULT', query: chosenAddress, result });
}

// Perform the OZ check via background to avoid CORS issues
async function performOzLookup(params) {
  try {
    const token = await getAuthToken();
    const search = new URLSearchParams();
    if (params.address) {
      
      search.set('address', params.address);
    }
    if (typeof params.lat === 'number' && typeof params.lon === 'number') {
      search.set('lat', String(params.lat));
      search.set('lon', String(params.lon));
    }

    const result = await deduplicatedFetch(`${CHECK_ENDPOINT}?${search.toString()}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-OZ-Extension': chrome.runtime.getManifest().version || 'unknown',
      },
    }, params);

    if (result.status === 429) {
      handleRateLimit(result);
      const code = result.data?.code || 'RATE_LIMITED';
      return { error: true, status: 429, code, message: 'Rate limited' };
    }
    if (result.status >= 500) {
      return { error: true, status: result.status, message: result.data?.details || 'Service unavailable' };
    }
    if (result.error) {
      return { error: true, status: result.status, message: 'Request failed' };
    }
    
    // Track successful usage (result object has headers in the raw fetch response)
    trackUsage(result);
    
    return result.data || {};
  } catch (err) {
    return { error: true, status: 0, message: 'Network error' };
  }
}

// Primary message router
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;
  
  // Handle auth status requests
  if (message.type === 'OZ_GET_AUTH_STATUS') {
    authMeta.circuitBreaker = {
      state: circuitBreakerState.state,
      nextAttempt: circuitBreakerState.nextAttempt
    };
    sendResponse({ auth: authState, meta: authMeta });
    return;
  }
  
  // Handle request for new temporary key
  if (message.type === 'OZ_REQUEST_NEW_TEMP_KEY') {
    (async () => {
      try {
        await requestNewTempKey();
        sendResponse({ success: true });
      } catch (e) {
        authMeta.lastError = 'Failed to get new key';
        broadcastAuthStatus();
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true; // async response
  }
  
  // Handle upgrade action
  if (message.type === 'OZ_OPEN_UPGRADE') {
    openUpgradeTab();
    sendResponse({ ok: true });
    return;
  }
  
  // Handle sidebar-initiated scan
  if (message.type === 'OZ_START_SCAN') {
    
    (async () => {
      try {
        const tab = await chrome.tabs.get(message.tabId);
        
        await runSidebarAddressCheckFlow(tab);
      } catch (e) {
        
        // Send error to sidebar
        chrome.runtime.sendMessage({
          type: 'OZ_SIDEBAR_ERROR',
          error: 'Failed to scan page'
        });
      }
    })();
    // Immediately acknowledge to avoid keeping the message channel open
    try { sendResponse({ ok: true }); } catch (e) { /* noop */ }
    return; // no async response expected
  }
  
  // Handle sidebar-initiated address lookup
  if (message.type === 'OZ_LOOKUP_ADDRESS') {
    (async () => {
      try {
        await lookupAddressForSidebar(message.address);
      } catch (e) {
        
        chrome.runtime.sendMessage({
          type: 'OZ_SIDEBAR_ERROR',
          error: 'Failed to lookup address'
        });
      }
    })();
    // Immediately acknowledge to avoid keeping the message channel open
    try { sendResponse({ ok: true }); } catch (e) { /* noop */ }
    return; // no async response expected
  }
  
  // Legacy OZ_LOOKUP for content script automatic scanning
  if (message.type === 'OZ_LOOKUP') {
    (async () => {
      try {
        const key = message.address ? normalizeAddress(message.address) : null;
        if (key) {
          const cached = await getCachedResult(key);
          if (cached) {
            sendResponse({ fromCache: true, ...cached });
            return;
          }
        }

        const result = await performOzLookup(message);
        if (result?.error && result.status === 429) {
          // open upgrade flow and notify caller
          openUpgradeTab();
          sendResponse({ error: true, status: 429, code: result.code, message: 'Over limit' });
          return;
        }
        if (result?.error) {
          sendResponse({ error: true, status: result.status, message: result.message });
          return;
        }

        if (key && !result?.addressNotFound) {
          await setCachedResult(key, result);
        }
        sendResponse(result);
      } catch (e) {
        sendResponse({ error: true, status: 500, message: 'Service unavailable' });
      }
    })();
    return true; // async
  }
});

// Context menu setup - only create on install/update, not on startup
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'oz_mcp_check_selection',
      title: 'Check Opportunity Zone',
      contexts: ['selection'],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'oz_mcp_check_selection') return;
  const selectedText = (info.selectionText || '').trim();

  // Show loading indicator immediately
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'OZ_CONTEXT_LOADING', query: selectedText });
  }

  (async () => {
    try {
      await runAddressCheckFlow(tab, selectedText);
    } catch (e) {
      if (tab?.id) await safeSend(tab.id, { type: 'OZ_TOAST', text: 'Service unavailable. Try again later.' });
    }
  })();
});

// Toolbar click → open side panel and start scan
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  
  try {
    // Open the side panel
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (e) {
    
  }
});

// Initialize circuit breaker state and auth on startup
loadCircuitBreakerState();
initializeAuthState();