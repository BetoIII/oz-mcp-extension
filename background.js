// OZ-MCP Background service worker (MV3)
// Responsibilities: temp-key lifecycle, OZ lookup networking, LRU cache, context menu, message routing

const BASE_URL = 'https://oz-mcp.vercel.app';
const CHECK_ENDPOINT = '/api/opportunity-zones/check';
const LISTING_ADDRESS_ENDPOINT = '/api/listing-address';
const GEOCODE_ENDPOINT = '/api/opportunity-zones/geocode';
const TEMP_KEY_ENDPOINT = '/api/temporary-key';

const STORAGE_KEYS = {
  AUTH: 'oz_mcp_auth',
  CACHE: 'oz_mcp_cache',
};

const CACHE_LIMIT = 100; // LRU approx size
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

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

// Auth token lifecycle: use stored API key or fetch a temporary key
async function getAuthToken() {
  const { [STORAGE_KEYS.AUTH]: auth } = await getLocal([STORAGE_KEYS.AUTH]);
  const now = Date.now();
  if (auth && auth.token && (!auth.expiresAt || now < auth.expiresAt - 60_000)) {
    return auth.token;
  }

  // fetch temporary key
  const res = await fetch(`${BASE_URL}${TEMP_KEY_ENDPOINT}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-OZ-Extension': chrome.runtime.getManifest().version || 'unknown',
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to retrieve temporary key: ${res.status}`);
  }
  const { token, expiresAt, usageLimit } = await res.json();
  await setLocal({ [STORAGE_KEYS.AUTH]: { token, expiresAt: expiresAt ? Date.parse(expiresAt) : null, usageLimit } });
  return token;
}

async function openUpgradeTab() {
  chrome.tabs.create({ url: `${BASE_URL}/pricing?upgrade=chrome` });
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
    const res = await fetch(`${BASE_URL}${LISTING_ADDRESS_ENDPOINT}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-OZ-Extension': chrome.runtime.getManifest().version || 'unknown',
      },
      body: JSON.stringify({ url: listingUrl }),
    });

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

    if (res.status === 429) {
      const code = data?.code || 'RATE_LIMITED';
      return { error: true, status: 429, code, message: 'Rate limited' };
    }
    if (!res.ok) {
      return { error: true, status: res.status, message: data?.message || 'Failed to extract address' };
    }

    const candidate = (data && (
      data.address ||
      data.normalizedAddress ||
      data.result?.address ||
      data.result?.normalizedAddress ||
      null
    ));

    if (!candidate || typeof candidate !== 'string' || candidate.trim().length < 5) {
      return { address: null };
    }
    return { address: candidate.trim(), meta: data?.meta };
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
    const res = await fetch(`${BASE_URL}${GEOCODE_ENDPOINT}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-OZ-Extension': chrome.runtime.getManifest().version || 'unknown',
      },
      body: JSON.stringify({ address }),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (res.status === 429) {
      const code = data?.code || 'RATE_LIMITED';
      return { error: true, status: 429, code, message: 'Rate limited' };
    }
    if (!res.ok) {
      return { error: true, status: res.status, message: data?.message || 'Failed to normalize address' };
    }
    const normalized = data?.normalizedAddress || data?.address || null;
    return { address: normalized || address, meta: data?.meta };
  } catch (e) {
    return { error: true, status: 0, message: 'Network error' };
  }
}

// Full flow: 1) URL → listing-address, 2) highlighted selection, 3) manual prompt → OZ check
async function runAddressCheckFlow(tab, highlightedText) {
  const tabId = tab?.id;
  const url = tab?.url || '';
  let chosenAddress = null;

  // Step 1: try listing-address from URL
  const urlResult = await resolveAddressFromUrl(url);
  if (urlResult?.error && urlResult.status === 429) {
    openUpgradeTab();
    if (tabId) await safeSend(tabId, { type: 'OZ_TOAST', text: 'Over limit — upgrade for more' });
    return;
  }
  if (!urlResult?.error && urlResult?.address) {
    chosenAddress = urlResult.address;
  }

  // Step 2: user-highlighted selection (if URL resolution failed)
  if (!chosenAddress) {
    const selection = highlightedText || (tabId ? await getCurrentSelection(tabId) : null);
    if (selection) chosenAddress = selection;
  }

  // Step 3: manual inline entry prompt
  if (!chosenAddress && tabId) {
    chosenAddress = await promptForAddress(tabId);
  }

  if (!chosenAddress) {
    if (tabId) await safeSend(tabId, { type: 'OZ_TOAST', text: 'No address provided' });
    return;
  }

  // Step A: Ask user to confirm the detected address near the icon
  if (tabId) {
    const first = await requestUserAddressConfirmation(tabId, chosenAddress, { normalized: false });
    if (first?.action === 'cancel') return;
    if (first?.action === 'edit') {
      // Normalize once using geocoding
      const norm = await normalizeAddressViaGeocode(first.address || chosenAddress);
      if (norm?.error && norm.status === 429) {
        openUpgradeTab();
        await safeSend(tabId, { type: 'OZ_TOAST', text: 'Over limit — upgrade for more' });
        return;
      }
      if (norm?.error) {
        await safeSend(tabId, { type: 'OZ_TOAST', text: 'Could not normalize address' });
        return;
      }
      const normalizedAddress = norm.address || first.address || chosenAddress;
      const second = await requestUserAddressConfirmation(tabId, normalizedAddress, { normalized: true });
      if (second?.action !== 'confirm') return;
      chosenAddress = normalizedAddress;
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
    if (params.address) search.set('address', params.address);
    if (typeof params.lat === 'number' && typeof params.lon === 'number') {
      search.set('lat', String(params.lat));
      search.set('lon', String(params.lon));
    }

    const res = await fetch(`${BASE_URL}${CHECK_ENDPOINT}?${search.toString()}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-OZ-Extension': chrome.runtime.getManifest().version || 'unknown',
      },
    });

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

    if (res.status === 429) {
      const code = data?.code || 'RATE_LIMITED';
      return { error: true, status: 429, code, message: 'Rate limited' };
    }
    if (res.status >= 500) {
      return { error: true, status: res.status, message: data?.details || 'Service unavailable' };
    }
    if (!res.ok) {
      return { error: true, status: res.status, message: 'Request failed' };
    }
    return data || {};
  } catch (err) {
    return { error: true, status: 0, message: 'Network error' };
  }
}

// Primary message router
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;
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

// Context menu for selection
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'oz_mcp_check_selection',
    title: 'Check Opportunity Zone',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'oz_mcp_check_selection') return;
  const selectedText = (info.selectionText || '').trim();

  (async () => {
    try {
      await runAddressCheckFlow(tab, selectedText);
    } catch (e) {
      if (tab?.id) await safeSend(tab.id, { type: 'OZ_TOAST', text: 'Service unavailable. Try again later.' });
    }
  })();
});

// Toolbar click → run the universal flow on any site (content script may not exist on restricted pages)
chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return;
  (async () => {
    try {
      await runAddressCheckFlow(tab, null);
    } catch (e) {
      await safeSend(tab.id, { type: 'OZ_TOAST', text: 'Service unavailable. Try again later.' });
    }
  })();
});