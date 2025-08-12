# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development & Testing
```bash
# Run unit tests
npm test

# Run unit tests in watch mode
npm run test:watch

# Run end-to-end tests (headless)
npm run e2e

# Run end-to-end tests with browser UI
npm run e2e:headed

# Package extension for distribution
npm run zip

# Build extension (placeholder command)
npm run build

# Lint extension files (placeholder command)
npm run lint
```

### Loading Extension for Development
1. Go to `chrome://extensions/`
2. Enable Developer mode
3. Click "Load unpacked" and select this directory

## Architecture Overview

This is a Manifest V3 Chrome extension that checks if real estate addresses are in Opportunity Zones using the OZ-MCP backend service.

### Core Components

**Three-Script Architecture:**
- `background.js` - Service worker handling API calls, authentication, caching, and context menu
- `content.js` - Injected into web pages for address scanning, badge injection, and toast notifications  
- `sidepanel.js` - Sidebar UI with step-by-step workflow for address confirmation and lookup

**Key Architectural Patterns:**

1. **Message Passing System**: Background service worker communicates with content scripts and sidepanel through Chrome runtime messaging. All API calls are routed through background to avoid CORS issues.

2. **Circuit Breaker Pattern**: Background implements circuit breaker with failure tracking, backoff, and automatic recovery to handle API failures gracefully.

3. **LRU Caching**: Background maintains ~100 address lookups cached for 24h with deduplication and TTL management.

4. **Request Deduplication**: Active request tracking prevents duplicate API calls for same addresses across multiple tabs/contexts.

5. **Rate Limiting**: Content script implements intelligent rate limiting with configurable delays, backoff on 429 responses, and per-page limits.

### Data Flow

1. **Address Detection**: Content script scans DOM for address patterns using enhanced regex
2. **User Confirmation**: Sidepanel presents step-by-step UI for address verification
3. **OZ Lookup**: Background service worker makes authenticated API calls to `https://oz-mcp.vercel.app`
4. **Result Display**: Results shown via badges (inline) or sidepanel with detailed zone information

### Authentication & Backend Integration

- Temporary API key lifecycle managed in background service worker
- Keys stored in `chrome.storage.local` with automatic refresh
- All requests include `Authorization: Bearer <token>` and `X-OZ-Extension: <version>` headers
- Upgrade flow handles rate limits by opening pricing page

### Testing Architecture

**Unit Tests (Vitest)**:
- `tests/setup/vitest.setup.ts` - Global Chrome API mocks for extension testing
- `tests/unit/` - Component-specific tests with jsdom environment
- Mock chrome APIs including runtime, storage, tabs, contextMenus

**E2E Tests (Playwright)**:
- `tests/e2e/extension.spec.ts` - Full browser automation with extension loading
- Tests content script injection and extension functionality in real Chrome context
- Handles MV3 service worker lazy loading and timing issues

### Configuration Files

- `vitest.config.ts` - Unit test configuration with jsdom and Chrome mocks
- `playwright.config.ts` - E2E test configuration with extension loading
- `manifest.json` - MV3 configuration with sidePanel, storage, contextMenus permissions
- `recipes/get-listing-address.recipe.yaml` - MCP recipe for address extraction workflow

### Feature Flags & Constants

Background service worker uses feature flags (`FEATURE_FLAGS`) for enabling/disabling functionality like listing-address API fallback. Key constants include rate limits, cache settings, and API endpoints.

### Logging System

Content script implements silent production logging with `ozLog()` system. Logs are exposed via `window.ozDebug` for debugging but remain silent in production mode.