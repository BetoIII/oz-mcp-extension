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
            console.error('Error:', error);
            status.textContent = 'Error occurred';
        }
    });

    // Load saved data
    chrome.storage.sync.get(['extensionData'], function(result) {
        if (result.extensionData) {
            console.log('Loaded data:', result.extensionData);
        }
    });
});