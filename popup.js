// Initialize dark mode support for popup
function initializeDarkMode() {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
    
    function updateDarkMode(e) {
        document.documentElement.classList.toggle('dark', e.matches);
    }
    
    // Set initial state
    updateDarkMode(prefersDark);
    
    // Listen for changes
    prefersDark.addEventListener('change', updateDarkMode);
}

// Initialize dark mode immediately
initializeDarkMode();

document.addEventListener('DOMContentLoaded', function() {
    const actionBtn = document.getElementById('actionBtn');
    const status = document.getElementById('status');

    actionBtn.addEventListener('click', async function() {
        try {
            status.textContent = 'Processing...';
            
            // Get the active tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            // Send message to content script
            const response = await chrome.tabs.sendMessage(tab.id, {
                action: 'performAction',
                data: { timestamp: Date.now() }
            });
            
            status.textContent = response.message || 'Action completed!';
        } catch (error) {
            
            status.textContent = 'Error occurred';
        }
    });

    // Load saved data
    chrome.storage.sync.get(['extensionData'], function(result) {
        if (result.extensionData) {
            
        }
    });
});