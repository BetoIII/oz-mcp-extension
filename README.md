# OZ‑MCP Opportunity Zone Checker (MV3)

Minimal Chrome extension that uses the production OZ‑MCP backend to check whether addresses on Zillow, LoopNet, and CREXi are in an Opportunity Zone.

## What it does

- Inline scan: detects up to 5 U.S. address candidates per page and, when in an OZ, injects a small turquoise “OZ” badge with a tooltip (zone info).
- Right‑click: select text → “Check Opportunity Zone” → shows a toast with the result.
- All network calls are made from the background service worker to `https://oz-mcp.vercel.app`.

## Files

- `manifest.json` — MV3 config, permissions, host permissions, content script domains
- `background.js` — temp key lifecycle, OZ lookup networking, LRU cache, context menu, message routing
- `content.js` — DOM scanning, debounce + dedupe, badge/tooltip injection, toast renderer, message bridge
- `icons/oz-mcp-pin-icon.png` — used for all sizes

## Load unpacked

1. Go to `chrome://extensions/`
2. Enable Developer mode
3. Click “Load unpacked” and select this folder

No popup or options page are included by design.

## Backend and auth

- Base URL: `https://oz-mcp.vercel.app`
- GET `/api/opportunity-zones/check` with `address` or `lat`/`lon`
- On first use, the background requests a temporary key via POST `/api/temporary-key` and stores it in `chrome.storage.local`.
- The background adds `Authorization: Bearer <token>` and `X-OZ-Extension: <version>` headers on all requests.

## Upgrade flow

- Over limit (HTTP 429 with `TEMP_KEY_LIMIT_EXCEEDED` or `MONTHLY_LIMIT_EXCEEDED`): content shows a toast; background opens `https://oz-mcp.vercel.app/pricing?upgrade=chrome` in a new tab.

## Domains scanned

- `zillow.com`, `loopnet.com`, `crexi.com` (and subdomains)

## Notes

- CORS: all fetches occur in the background worker with host permissions to avoid CORS issues.
- Cache: last ~100 lookups cached for 24h (positive/negative, skip when `addressNotFound: true`).
- Privacy: addresses are not stored beyond the short‑term cache.