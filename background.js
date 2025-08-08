// Background service worker for Chrome extension

// Installation listener
chrome.runtime.onInstalled.addListener((details) => {
    console.log('Extension installed:', details);
    
    // Set default storage values
    chrome.storage.sync.set({
        extensionData: {
            installDate: new Date().toISOString(),
            version: chrome.runtime.getManifest().version
        }
    });
});

// Message listener for communication with content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Background received message:', message);
    
    switch (message.action) {
        case 'getData':
            // Return stored data
            chrome.storage.sync.get(['extensionData'], (result) => {
                sendResponse({ data: result.extensionData });
            });
            return true; // Keep the message channel open for async response
            
        case 'saveData':
            // Save data to storage
            chrome.storage.sync.set({ extensionData: message.data }, () => {
                sendResponse({ success: true });
            });
            return true;
            
        case 'performBackgroundTask':
            // Handle background processing
            console.log('Performing background task:', message.data);
            sendResponse({ 
                success: true, 
                message: 'Background task completed',
                timestamp: Date.now()
            });
            break;
            
        default:
            sendResponse({ error: 'Unknown action' });
    }
});

// Tab update listener
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
        console.log('Tab updated:', tab.url);
        // You can perform actions when pages load
    }
});

// Context menu (optional - uncomment if needed)
/*
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: 'ozMcpAction',
        title: 'Oz MCP Action',
        contexts: ['selection']
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'ozMcpAction') {
        console.log('Context menu clicked:', info.selectionText);
        // Handle context menu action
    }
});
*/