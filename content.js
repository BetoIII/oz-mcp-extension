// OZ-MCP Content Script: scans pages for candidate addresses, injects badges, handles context menu toast

const MAX_CHECKS_PER_PAGE = 5;
const SCAN_DEBOUNCE_MS = 800;
const scannedAddresses = new Set();
let checksUsed = 0;

// Conservative US address regex (very rough, tuned to avoid massive false positives)
const ADDRESS_REGEX = /\b(\d{1,6})\s+([A-Za-z0-9'.\-]+(?:\s+[A-Za-z0-9'.\-]+)*)\s+(Ave|Avenue|St|Street|Rd|Road|Blvd|Boulevard|Ln|Lane|Dr|Drive|Ct|Court|Pl|Place|Ter|Terrace|Way|Pkwy|Parkway)\b[ ,]*([A-Za-z .'-]+)?[ ,]+([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/;

// Styles
function ensureStyles() {
  if (document.getElementById('oz-mcp-styles')) return;
        const style = document.createElement('style');
        style.id = 'oz-mcp-styles';
        style.textContent = `
.oz-mcp-badge{display:inline-flex;align-items:center;gap:4px;background:#1abc9c;color:#fff;border-radius:10px;padding:2px 6px;font-size:11px;font-weight:600;box-shadow:0 1px 4px rgba(0,0,0,.2);margin-left:6px;vertical-align:baseline;}
.oz-mcp-badge:hover .oz-mcp-tooltip{opacity:1;visibility:visible}
.oz-mcp-tooltip{position:absolute;transform:translateY(6px);background:#111;color:#fff;padding:6px 8px;border-radius:6px;font-size:11px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.3);opacity:0;visibility:hidden;transition:opacity .15s;z-index:2147483647}
.oz-mcp-toast{position:fixed;z-index:2147483647;left:50%;transform:translateX(-50%);bottom:24px;background:#111;color:#fff;padding:10px 14px;border-radius:8px;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.35)}
`;
  document.head.appendChild(style);
}

function showToast(text) {
  ensureStyles();
  const existing = document.querySelector('.oz-mcp-toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'oz-mcp-toast';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function showToastNearSelection(text) {
  ensureStyles();
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    showToast(text);
    return;
  }
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'oz-mcp-toast';
  el.textContent = text;
  el.style.position = 'fixed';
  const left = Math.min(Math.max(rect.left + rect.width / 2, 12), window.innerWidth - 12);
  const top = Math.min(Math.max(rect.bottom + 8, 12), window.innerHeight - 12);
  el.style.left = `${left}px`;
  el.style.bottom = 'auto';
  el.style.top = `${top}px`;
  el.style.transform = 'translateX(-50%)';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
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

function scanForAddresses() {
  if (checksUsed >= MAX_CHECKS_PER_PAGE) return;
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

  const candidates = [];
  while (walker.nextNode()) {
    const text = walker.currentNode.nodeValue;
    const m = text.match(ADDRESS_REGEX);
    if (m) candidates.push(m[0]);
  }

  const toCheck = dedupeAndLimit(candidates).filter((addr) => !scannedAddresses.has(addr));
  for (const address of toCheck) {
    scannedAddresses.add(address);
    if (checksUsed >= MAX_CHECKS_PER_PAGE) break;
    checksUsed += 1;

    chrome.runtime.sendMessage({ type: 'OZ_LOOKUP', address }, (resp) => {
      if (!resp || resp.error) {
        if (resp?.status === 429) {
          showToast('Over limit — upgrade for more');
        } else if (resp?.status >= 500) {
          showToast('Service unavailable. Try again later.');
        }
        return;
      }
      if (resp.addressNotFound) return;
      if (resp.isInOpportunityZone) {
        // inject badge after the text node's parent
        const range = document.createRange();
        const node = findTextNode(document.body, address);
        if (node && node.parentElement) {
          const badge = createBadge(resp);
          node.parentElement.appendChild(badge);
        }
      }
    });
  }
}

function findTextNode(root, text) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  while (walker.nextNode()) {
    if ((walker.currentNode.nodeValue || '').includes(text)) return walker.currentNode;
  }
  return null;
}

let scanTimeout = null;
function scheduleScan() {
  if (scanTimeout) clearTimeout(scanTimeout);
  scanTimeout = setTimeout(scanForAddresses, SCAN_DEBOUNCE_MS);
}

// Observe dynamic changes
const observer = new MutationObserver(() => scheduleScan());
observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

// Initial scan
ensureStyles();
scheduleScan();

// Context menu result handler → show toast near selection
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'OZ_MANUAL_SCAN') {
    checksUsed = 0; // allow another batch
    scheduleScan();
    return; // no async
  }
  if (message?.type === 'OZ_TOAST' && message.text) {
    showToast(message.text);
    return; // no async
  }
  if (message?.type !== 'OZ_CONTEXT_RESULT') return;
  const { query, result } = message;
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
