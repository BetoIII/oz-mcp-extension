# OZ‑MCP Opportunity Zone Checker (MV3)

Chrome extension that uses the production OZ‑MCP backend to check whether addresses on real estate sites are in an Opportunity Zone, featuring a comprehensive sidebar interface and automated testing suite.

## What it does

- **Inline scan**: detects up to 5 U.S. address candidates per page and, when in an OZ, injects a small turquoise "OZ" badge with a tooltip (zone info)
- **Right‑click**: select text → "Check Opportunity Zone" → shows a toast with the result
- **Side panel**: interactive step-by-step UI for address scanning, confirmation, and OZ lookup with visual progress indicators
- **Action button**: click the extension icon to open the sidebar and scan the current page
- All network calls are made from the background service worker to `https://oz-mcp.vercel.app`

## Key Features

- **Step-by-step UX**: Guided workflow through the sidebar showing scan → confirm → lookup phases
- **Address confirmation**: Interactive dialog to verify detected addresses before lookup
- **Loading indicators**: Visual feedback during address extraction and API calls
- **Comprehensive logging**: Production-ready logging system for debugging and monitoring
- **Testing suite**: Full unit and end-to-end test coverage with Vitest and Playwright

## Files

### Core Extension
- `manifest.json` — MV3 config with sidePanel permission, all_urls content script
- `background.js` — temp key lifecycle, OZ lookup networking, LRU cache, context menu, message routing
- `content.js` — DOM scanning, debounce + dedupe, badge/tooltip injection, toast renderer, message bridge
- `sidepanel.html/css/js` — Interactive sidebar UI with step-by-step workflow
- `popup.html/css/js` — Simple popup interface (legacy)
- `icons/oz-mcp-pin-icon.png` — extension icon for all sizes

### Testing & Development
- `tests/unit/smoke.test.ts` — Vitest unit tests with Chrome API mocks
- `tests/e2e/extension.spec.ts` — Playwright end-to-end tests for MV3 extension
- `tests/setup/vitest.setup.ts` — Global Chrome API mock setup
- `vitest.config.ts/js` — Vitest configuration for unit tests
- `playwright.config.ts` — Playwright configuration for e2e tests
- `package.json` — Scripts for test, test:watch, e2e, e2e:headed

## Development Setup

1. Go to `chrome://extensions/`
2. Enable Developer mode
3. Click "Load unpacked" and select this folder

## Testing

```bash
# Run unit tests
npm test

# Run unit tests in watch mode
npm run test:watch

# Run end-to-end tests (headless)
npm run e2e

# Run end-to-end tests (headed)
npm run e2e:headed
```

## Backend and auth

- Base URL: `https://oz-mcp.vercel.app`
- GET `/api/opportunity-zones/check` with `address` or `lat`/`lon`
- On first use, the background requests a temporary key via POST `/api/temporary-key` and stores it in `chrome.storage.local`.
- The background adds `Authorization: Bearer <token>` and `X-OZ-Extension: <version>` headers on all requests.

## Upgrade flow

- Over limit (HTTP 429 with `TEMP_KEY_LIMIT_EXCEEDED` or `MONTHLY_LIMIT_EXCEEDED`): content shows a toast; background opens `https://oz-mcp.vercel.app/pricing?upgrade=chrome` in a new tab.

## Supported Sites

The extension now runs on all URLs (`<all_urls>`) but is optimized for:
- `zillow.com`, `loopnet.com`, `crexi.com` (and subdomains)
- Any website with detectable address patterns

## Architecture Notes

- **CORS**: All fetches occur in the background worker with host permissions to avoid CORS issues
- **Cache**: Last ~100 lookups cached for 24h (positive/negative, skip when `addressNotFound: true`)
- **Privacy**: Addresses are not stored beyond the short‑term cache
- **MV3 Compatibility**: Fully compatible with Manifest V3 using service workers and modern Chrome APIs
- **Testing**: Comprehensive test coverage with mocked Chrome APIs and real browser automation

## Recent Updates

- Added interactive sidebar with step-by-step UX workflow
- Implemented comprehensive testing with Vitest (unit) and Playwright (e2e) 
- Enhanced address extraction with confirmation dialogs
- Added loading indicators and improved user feedback
- Production-ready logging system for debugging and monitoring