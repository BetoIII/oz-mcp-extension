// OZ-MCP Sidebar Panel JavaScript

class OZSidebar {
    constructor() {
        this.currentStep = null;
        this.currentAddress = null;
        this.isProcessing = false;
        this.authState = null;
        this.authMeta = null;
        
        this.initializeElements();
        this.attachEventListeners();
        this.resetSteps();
        this.requestAuthStatus();
    }

    initializeElements() {
        // Usage elements
        this.usageSection = document.getElementById('usageSection');
        this.usageText = document.getElementById('usageText');
        this.usageBar = document.getElementById('usageBar');
        this.usageProgress = document.getElementById('usageProgress');
        this.usageDetails = document.getElementById('usageDetails');
        this.reloadKeyBtn = document.getElementById('reloadKeyBtn');
        this.upgradeBtn = document.getElementById('upgradeBtn');
        this.upgradedActions = document.getElementById('upgradedActions');
        this.reloadAfterUpgradeBtn = document.getElementById('reloadAfterUpgradeBtn');
        
        // Steps
        this.stepScan = document.getElementById('step-scan');
        this.stepConfirm = document.getElementById('step-confirm');
        this.stepLookup = document.getElementById('step-lookup');
        
        // Spinners
        this.spinnerScan = document.getElementById('spinner-scan');
        this.spinnerConfirm = document.getElementById('spinner-confirm');
        this.spinnerLookup = document.getElementById('spinner-lookup');
        
        // Status elements
        this.statusScan = document.getElementById('status-scan');
        this.statusConfirm = document.getElementById('status-confirm');
        this.statusLookup = document.getElementById('status-lookup');
        
        // Sections
        this.addressSection = document.getElementById('addressSection');
        this.addressDisplay = document.getElementById('addressDisplay');
        this.resultsSection = document.getElementById('resultsSection');
        this.resultCard = document.getElementById('resultCard');
        this.resultIcon = document.getElementById('resultIcon');
        this.resultStatus = document.getElementById('resultStatus');
        this.resultDetails = document.getElementById('resultDetails');
        
        // Buttons
        this.scanPageBtn = document.getElementById('scanPageBtn');
        this.editAddressBtn = document.getElementById('editAddressBtn');
        this.resetBtn = document.getElementById('resetBtn');
        this.closeResultBtn = document.getElementById('closeResultBtn');
        this.closeSidebar = document.getElementById('closeSidebar');
        this.viewOnMapsBtn = document.getElementById('viewOnMapsBtn');
    }

    attachEventListeners() {
        // Usage buttons
        this.reloadKeyBtn.addEventListener('click', () => this.reloadKey());
        this.upgradeBtn.addEventListener('click', () => this.openUpgrade());
        this.reloadAfterUpgradeBtn.addEventListener('click', () => this.reloadAfterUpgrade());
        
        // Main action buttons
        this.scanPageBtn.addEventListener('click', () => this.startScan());
        this.editAddressBtn.addEventListener('click', () => this.editAddress());
        this.resetBtn.addEventListener('click', () => this.reset());
        this.closeResultBtn.addEventListener('click', () => this.clearResults());
        this.closeSidebar.addEventListener('click', () => this.closeSidePanel());
        this.viewOnMapsBtn.addEventListener('click', () => this.openInGoogleMaps());
        
        // Listen for messages from background script
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            this.handleMessage(message);
        });
    }

    async startScan() {
        if (this.isProcessing) return;
        
        
        this.isProcessing = true;
        this.reset();
        this.setStep('scan', 'active');
        this.showSpinner('scan');
        this.scanPageBtn.disabled = true;
        this.scanPageBtn.textContent = 'Scanning...';
        
        try {
            // Get current tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) {
                this.showError('No active tab found');
                return;
            }
            
            
            // Send message to background script to start the flow
            chrome.runtime.sendMessage({ 
                type: 'OZ_START_SCAN', 
                tabId: tab.id 
            });
            
        } catch (error) {
            
            this.showError('Failed to start scan');
        }
    }

    handleMessage(message) {
        switch (message.type) {
            case 'OZ_AUTH_STATUS':
                this.updateAuthStatus(message.auth, message.meta);
                break;
            case 'OZ_SIDEBAR_STEP':
                this.updateStep(message.step, message.status, message.data);
                break;
            case 'OZ_SIDEBAR_ADDRESS':
                this.showAddress(message.address);
                break;
            case 'OZ_SIDEBAR_RESULT':
                this.showResult(message.result);
                break;
            case 'OZ_SIDEBAR_ERROR':
                this.showError(message.error);
                break;
        }
    }

    // Auth status management
    async requestAuthStatus() {
        try {
            const response = await chrome.runtime.sendMessage({ type: 'OZ_GET_AUTH_STATUS' });
            this.updateAuthStatus(response.auth, response.meta);
        } catch (error) {
            console.error('Failed to get auth status:', error);
        }
    }

    updateAuthStatus(auth, meta) {
        this.authState = auth;
        this.authMeta = meta;
        this.renderUsageStatus();
    }

    renderUsageStatus() {
        if (!this.authState || !this.authMeta) {
            this.usageText.textContent = 'Loading...';
            return;
        }

        const { usedCount, usageLimit, isRegistered, expiresAt } = this.authState;
        const { overLimit, lastError, circuitBreaker } = this.authMeta;

        // Handle different states
        if (lastError) {
            this.usageText.textContent = 'Error loading status';
            this.usageDetails.textContent = lastError;
            this.usageBar.style.display = 'none';
            return;
        }

        if (circuitBreaker.state === 'OPEN') {
            this.usageText.textContent = 'Service paused';
            const retryTime = Math.max(0, Math.ceil((circuitBreaker.nextAttempt - Date.now()) / 1000));
            this.usageDetails.textContent = retryTime > 0 ? `Retry in ${retryTime}s` : 'Retrying...';
            this.usageBar.style.display = 'none';
            return;
        }

        // Show usage bar
        this.usageBar.style.display = 'block';
        const percentage = Math.min((usedCount / usageLimit) * 100, 100);
        this.usageProgress.style.width = `${percentage}%`;

        // Set usage text and styling
        this.usageText.textContent = `${usedCount}/${usageLimit} searches used`;
        
        if (overLimit || usedCount >= usageLimit) {
            this.usageText.textContent = `${usageLimit}/${usageLimit} searches used`;
            this.usageDetails.textContent = 'Over limit — upgrade for more';
            this.usageProgress.className = 'usage-progress over-limit';
            this.upgradedActions.classList.remove('hidden');
        } else {
            this.usageProgress.className = 'usage-progress';
            this.upgradedActions.classList.add('hidden');
            
            // Show expiry info if available
            if (expiresAt) {
                const expiryDate = new Date(expiresAt);
                const now = new Date();
                if (expiryDate > now) {
                    const timeLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60)); // hours
                    this.usageDetails.textContent = `Expires in ${timeLeft}h`;
                } else {
                    this.usageDetails.textContent = 'Expired — reload key';
                }
            } else {
                this.usageDetails.textContent = isRegistered ? 'Registered account' : 'Temporary key';
            }
        }
    }

    // Usage actions
    async reloadKey() {
        this.reloadKeyBtn.disabled = true;
        this.reloadKeyBtn.innerHTML = '<span class="btn-icon spinner"></span>';
        
        try {
            await chrome.runtime.sendMessage({ type: 'OZ_REQUEST_NEW_TEMP_KEY' });
        } catch (error) {
            console.error('Failed to reload key:', error);
        } finally {
            this.reloadKeyBtn.disabled = false;
            this.reloadKeyBtn.innerHTML = '<span class="btn-icon">🔄</span>';
        }
    }

    async openUpgrade() {
        try {
            await chrome.runtime.sendMessage({ type: 'OZ_OPEN_UPGRADE' });
        } catch (error) {
            console.error('Failed to open upgrade:', error);
        }
    }

    async reloadAfterUpgrade() {
        this.reloadAfterUpgradeBtn.disabled = true;
        this.reloadAfterUpgradeBtn.textContent = 'Reloading...';
        
        try {
            await chrome.runtime.sendMessage({ type: 'OZ_REQUEST_NEW_TEMP_KEY' });
        } catch (error) {
            console.error('Failed to reload after upgrade:', error);
        } finally {
            this.reloadAfterUpgradeBtn.disabled = false;
            this.reloadAfterUpgradeBtn.textContent = 'I\'ve upgraded — reload';
        }
    }

    setStep(stepName, status) {
        // Remove active/completed classes from all steps
        [this.stepScan, this.stepConfirm, this.stepLookup].forEach(step => {
            step.classList.remove('active', 'completed');
        });
        
        // Set current step
        const stepElement = this[`step${stepName.charAt(0).toUpperCase() + stepName.slice(1)}`];
        if (stepElement) {
            stepElement.classList.add(status);
            this.currentStep = stepName;
        }
    }

    showSpinner(stepName) {
        const spinner = this[`spinner${stepName.charAt(0).toUpperCase() + stepName.slice(1)}`];
        if (spinner) {
            spinner.classList.remove('hidden');
        }
    }

    hideSpinner(stepName) {
        const spinner = this[`spinner${stepName.charAt(0).toUpperCase() + stepName.slice(1)}`];
        if (spinner) {
            spinner.classList.add('hidden');
        }
    }

    updateStep(stepName, status, data = {}) {
        const statusElement = this[`status${stepName.charAt(0).toUpperCase() + stepName.slice(1)}`];
        
        switch (status) {
            case 'loading':
                this.setStep(stepName, 'active');
                this.showSpinner(stepName);
                if (statusElement) statusElement.textContent = data.message || '';
                break;
                
            case 'success':
                this.hideSpinner(stepName);
                this.setStep(stepName, 'completed');
                if (statusElement) {
                    statusElement.textContent = data.message || '✓ Complete';
                    statusElement.className = 'step-status text-success';
                }
                break;
                
            case 'error':
                this.hideSpinner(stepName);
                if (statusElement) {
                    statusElement.textContent = data.message || '✗ Failed';
                    statusElement.className = 'step-status text-danger';
                }
                this.isProcessing = false;
                this.resetScanButton();
                break;
        }
    }

    showAddress(address) {
        this.currentAddress = address;
        this.addressDisplay.textContent = address;
        this.addressSection.classList.remove('hidden');
    }

    showResult(result) {
        this.isProcessing = false;
        this.resetScanButton();
        this.resetBtn.classList.remove('hidden');
        
        // Store the current address for Google Maps functionality
        this.lastResult = result;
        
        // Configure result card
        this.resultCard.className = 'result-card';
        this.resultIcon.className = 'result-icon';
        
        if (result.isInOpportunityZone) {
            this.resultCard.classList.add('success');
            this.resultIcon.classList.add('success');
            this.resultIcon.textContent = '✓';
            this.resultStatus.textContent = 'In Opportunity Zone';
            this.resultDetails.textContent = result.opportunityZoneId ? 
                `Zone ID: ${result.opportunityZoneId}` : 
                'This address is located in a qualified Opportunity Zone.';
        } else {
            this.resultCard.classList.add('error');
            this.resultIcon.classList.add('error');
            this.resultIcon.textContent = '✗';
            this.resultStatus.textContent = 'Not in Opportunity Zone';
            this.resultDetails.textContent = 'This address is not located in a qualified Opportunity Zone.';
        }
        
        this.resultsSection.classList.remove('hidden');
    }

    showError(error) {
        this.isProcessing = false;
        this.resetScanButton();
        
        // Show error in result card
        this.resultCard.className = 'result-card error';
        this.resultIcon.className = 'result-icon error';
        this.resultIcon.textContent = '!';
        this.resultStatus.textContent = 'Error';
        this.resultDetails.textContent = error;
        this.resultsSection.classList.remove('hidden');
    }

    editAddress() {
        // Create inline input for address editing
        const input = document.createElement('input');
        input.type = 'text';
        input.value = this.currentAddress;
        input.className = 'address-display';
        input.style.border = '2px solid #1abc9c';
        
        // Replace display with input
        this.addressDisplay.replaceWith(input);
        input.focus();
        input.select();
        
        // Handle input completion
        const finishEdit = () => {
            const newAddress = input.value.trim();
            this.addressDisplay.textContent = newAddress;
            input.replaceWith(this.addressDisplay);
            
            if (newAddress && newAddress !== this.currentAddress) {
                this.currentAddress = newAddress;
                // Trigger OZ lookup with new address
                this.lookupAddress(newAddress);
            }
        };
        
        input.addEventListener('blur', finishEdit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') finishEdit();
            if (e.key === 'Escape') {
                this.addressDisplay.textContent = this.currentAddress;
                input.replaceWith(this.addressDisplay);
            }
        });
    }

    async lookupAddress(address) {
        this.clearResults();
        this.setStep('lookup', 'active');
        this.showSpinner('lookup');
        
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            chrome.runtime.sendMessage({
                type: 'OZ_LOOKUP_ADDRESS',
                address: address,
                tabId: tab.id
            });
        } catch (error) {
            this.showError('Failed to lookup address');
        }
    }

    clearResults() {
        this.resultsSection.classList.add('hidden');
    }

    reset() {
        this.isProcessing = false;
        this.currentAddress = null;
        this.resetSteps();
        this.addressSection.classList.add('hidden');
        this.resultsSection.classList.add('hidden');
        this.resetBtn.classList.add('hidden');
        this.resetScanButton();
    }

    resetSteps() {
        // Reset all steps
        [this.stepScan, this.stepConfirm, this.stepLookup].forEach(step => {
            step.classList.remove('active', 'completed');
        });
        
        // Hide all spinners
        [this.spinnerScan, this.spinnerConfirm, this.spinnerLookup].forEach(spinner => {
            spinner.classList.add('hidden');
        });
        
        // Clear status text
        [this.statusScan, this.statusConfirm, this.statusLookup].forEach(status => {
            status.textContent = '';
            status.className = 'step-status';
        });
    }

    resetScanButton() {
        this.scanPageBtn.disabled = false;
        this.scanPageBtn.innerHTML = '<span class="btn-icon">🔍</span><span>Scan This Page</span>';
    }

    closeSidePanel() {
        // Note: Chrome side panels can't be closed programmatically by the extension
        // This button is for UI consistency but won't actually close the panel
        
    }

    // Generate Google Maps URL for the current address
    generateGoogleMapsUrl(address) {
        if (!address) return null;
        
        // Encode the address for URL usage
        const encodedAddress = encodeURIComponent(address);
        
        // Generate Google Maps URL
        return `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
    }

    // Open current address in Google Maps
    openInGoogleMaps() {
        if (!this.currentAddress) {
            return;
        }
        
        const mapsUrl = this.generateGoogleMapsUrl(this.currentAddress);
        if (mapsUrl) {
            // Open in new tab
            chrome.tabs.create({ url: mapsUrl });
        }
    }
}

// Initialize sidebar when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.ozSidebar = new OZSidebar();
});

// Also handle case where script loads after DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.ozSidebar = new OZSidebar();
    });
} else {
    window.ozSidebar = new OZSidebar();
}