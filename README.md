# Oz MCP Extension

A Chrome extension scaffold with MCP (Model Context Protocol) integration capabilities.

## Structure

```
oz-mcp-extension/
├── manifest.json          # Extension configuration
├── popup.html             # Extension popup interface
├── popup.css              # Popup styling
├── popup.js               # Popup functionality
├── background.js          # Background service worker
├── content.js             # Content script for webpage interaction
├── icons/                 # Extension icons directory
│   └── README.md          # Icon requirements and instructions
├── package.json           # Development dependencies and scripts
└── README.md              # This file
```

## Installation

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked" and select this directory
4. The extension will appear in your Chrome toolbar

## Development

### Scripts

- `npm run build` - Build the extension
- `npm run lint` - Lint extension files  
- `npm run zip` - Create a zip file for distribution

### Key Features

- **Popup Interface**: Modern gradient UI with action buttons
- **Background Service Worker**: Handles extension lifecycle and messaging
- **Content Scripts**: Interact with web pages and DOM manipulation
- **Storage**: Chrome storage API integration for data persistence
- **Messaging**: Communication between popup, background, and content scripts

### Adding Icons

Replace the placeholder files in the `icons/` directory with actual PNG icons:
- `icon16.png` (16x16) - Toolbar icon
- `icon32.png` (32x32) - Windows icon
- `icon48.png` (48x48) - Extension management
- `icon128.png` (128x128) - Chrome Web Store

## Usage

1. Click the extension icon to open the popup
2. Click "Take Action" to interact with the current webpage
3. The extension will highlight links and show notifications
4. Data is automatically saved to Chrome storage

## Customization

- Modify `popup.html/css/js` for the popup interface
- Edit `background.js` for background processing
- Update `content.js` for webpage interactions
- Adjust `manifest.json` for permissions and configuration

## MCP Integration

This scaffold is prepared for MCP integration. You can extend the background script and content scripts to communicate with MCP servers and handle model context protocols.