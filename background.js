// OZ-MCP Background service worker (MV3)
// Responsibilities: temp-key lifecycle, OZ lookup networking, LRU cache, context menu, message routing

const BASE_URL = 'https://oz-mcp.vercel.app';
const CHECK_ENDPOINT = '/api/opportunity-zones/check';
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

// Perform the OZ check via background to avoid CORS issues
async function performOzLookup(params) {
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
    // Forward structured error
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
  if (!selectedText) return;

  (async () => {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'OZ_LOOKUP', address: selectedText }, resolve);
    });

    // pipe result back to the active tab to render toast
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'OZ_CONTEXT_RESULT', query: selectedText, result: response });
    }
  })();
});