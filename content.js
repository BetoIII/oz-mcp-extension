// Content script for webpage interaction

console.log('Oz MCP Extension content script loaded');

// Listen for messages from popup or background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Content script received message:', message);
    
    switch (message.action) {
        case 'performAction':
            try {
                // Example: Get page information
                const pageInfo = {
                    title: document.title,
                    url: window.location.href,
                    timestamp: message.data?.timestamp || Date.now()
                };
                
                // You can manipulate the DOM here
                highlightElements();
                
                sendResponse({
                    success: true,
                    message: 'Action performed successfully',
                    data: pageInfo
                });
            } catch (error) {
                console.error('Content script error:', error);
                sendResponse({
                    success: false,
                    message: 'Error performing action',
                    error: error.message
                });
            }
            break;
            
        case 'getPageData':
            sendResponse({
                title: document.title,
                url: window.location.href,
                selectedText: window.getSelection().toString()
            });
            break;
            
        case 'injectElement':
            injectNotification(message.data?.text || 'Oz MCP Extension notification');
            sendResponse({ success: true });
            break;
            
        default:
            sendResponse({ error: 'Unknown action' });
    }
    
    return true; // Keep the message channel open for async response
});

// Function to highlight elements on the page
function highlightElements() {
    // Remove existing highlights
    document.querySelectorAll('.oz-mcp-highlight').forEach(el => {
        el.classList.remove('oz-mcp-highlight');
    });
    
    // Add highlight class to specific elements (example: all links)
    const links = document.querySelectorAll('a');
    links.forEach(link => {
        link.classList.add('oz-mcp-highlight');
    });
    
    // Inject CSS for highlighting
    if (!document.getElementById('oz-mcp-styles')) {
        const style = document.createElement('style');
        style.id = 'oz-mcp-styles';
        style.textContent = `
            .oz-mcp-highlight {
                outline: 2px solid #667eea !important;
                outline-offset: 2px !important;
                transition: outline 0.3s ease !important;
            }
            
            .oz-mcp-notification {
                position: fixed;
                top: 20px;
                right: 20px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 15px 20px;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                z-index: 10000;
                font-family: 'Segoe UI', sans-serif;
                max-width: 300px;
                animation: slideIn 0.3s ease;
            }
            
            @keyframes slideIn {
                from { transform: translateX(100%); }
                to { transform: translateX(0); }
            }
        `;
        document.head.appendChild(style);
    }
}

// Function to inject notification
function injectNotification(text) {
    // Remove existing notification
    const existing = document.querySelector('.oz-mcp-notification');
    if (existing) {
        existing.remove();
    }
    
    // Create new notification
    const notification = document.createElement('div');
    notification.className = 'oz-mcp-notification';
    notification.textContent = text;
    
    document.body.appendChild(notification);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.remove();
        }
    }, 3000);
}

// Initialize on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

function init() {
    console.log('Oz MCP Extension initialized on:', window.location.href);
    
    // Send page load event to background script
    chrome.runtime.sendMessage({
        action: 'pageLoaded',
        data: {
            url: window.location.href,
            title: document.title,
            timestamp: Date.now()
        }
    }).catch(error => {
        console.log('Could not send message to background script:', error);
    });
}