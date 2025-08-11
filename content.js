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
/* Confirm toast near icon */
.oz-mcp-confirm{position:fixed;z-index:2147483647;right:12px;top:12px;background:#111;color:#fff;padding:10px 12px;border-radius:10px;font-size:13px;box-shadow:0 6px 20px rgba(0,0,0,.35);display:flex;gap:8px;align-items:center;max-width:92vw}
.oz-mcp-confirm .addr{font-weight:600;}
.oz-mcp-confirm input{background:#1a1a1a;border:1px solid #333;color:#fff;border-radius:8px;padding:8px 10px;font-size:12px;min-width:260px}
.oz-mcp-confirm .btn{border:none;border-radius:8px;padding:8px 10px;font-size:12px;cursor:pointer}
.oz-mcp-confirm .btn.ok{background:#1abc9c;color:#fff}
.oz-mcp-confirm .btn.edit{background:#333;color:#fff}
.oz-mcp-confirm .tag{font-size:10px;background:#1f2937;color:#9ca3af;border-radius:999px;padding:2px 6px}
/* Prompt overlay */
.oz-mcp-prompt-overlay{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:2147483646;display:flex;align-items:center;justify-content:center}
.oz-mcp-prompt{background:#111;color:#fff;min-width:300px;max-width:92vw;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.4);padding:14px}
.oz-mcp-prompt h4{margin:0 0 8px 0;font-size:14px;font-weight:600}
.oz-mcp-prompt input{width:100%;box-sizing:border-box;border-radius:8px;border:1px solid #333;background:#1a1a1a;color:#fff;padding:10px 12px;font-size:13px;outline:none}
.oz-mcp-prompt .row{display:flex;gap:8px;margin-top:10px;justify-content:flex-end}
.oz-mcp-btn{border:none;border-radius:8px;padding:8px 12px;font-size:12px;cursor:pointer}
.oz-mcp-btn.cancel{background:#333;color:#fff}
.oz-mcp-btn.ok{background:#1abc9c;color:#fff}
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
    const overlay = document.createElement('div');
    overlay.className = 'oz-mcp-prompt-overlay';
    const box = document.createElement('div');
    box.className = 'oz-mcp-prompt';
    const title = document.createElement('h4');
    title.textContent = 'Enter an address to check';
    const input = document.createElement('input');
    input.placeholder = 'e.g., 1600 Pennsylvania Ave NW, Washington, DC 20500';
    const prefill = getSelectionText();
    if (prefill) input.value = prefill;
    const row = document.createElement('div');
    row.className = 'row';
    const cancel = document.createElement('button');
    cancel.className = 'oz-mcp-btn cancel';
    cancel.textContent = 'Cancel';
    const ok = document.createElement('button');
    ok.className = 'oz-mcp-btn ok';
    ok.textContent = 'Check';
    row.appendChild(cancel);
    row.appendChild(ok);
    box.appendChild(title);
    box.appendChild(input);
    box.appendChild(row);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function cleanup(val) {
      overlay.remove();
      resolve(val);
    }

    ok.addEventListener('click', () => {
      const val = (input.value || '').trim();
      cleanup(val || null);
    });
    cancel.addEventListener('click', () => cleanup(null));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(null); });
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
  if (message?.type === 'OZ_CONFIRM_ADDRESS') {
    (async () => {
      const resp = await showConfirmAddressToast(message.address || '', { normalized: !!message.normalized });
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
      sendResponse({ address });
    })();
    return true; // keep the channel open for async response
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
