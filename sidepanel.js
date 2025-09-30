// OZ-MCP Sidebar Panel JavaScript

// Initialize dark mode support
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

// Development mode - use backend proxy for Google Maps data
const DEVELOPMENT_MODE = true;

// Load map data through backend proxy (no direct Google Maps API calls)
async function loadMapData(address, lat, lon) {
    try {
        // Get temporary key for backend authentication
        const result = await chrome.storage.local.get(['tempKey']);
        const tempKey = result.tempKey;
        
        if (!tempKey) {
            throw new Error('Authentication required');
        }
        
        // Call backend proxy for map data
        const response = await fetch(`https://oz-mcp.vercel.app/api/maps/data`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${tempKey}`,
                'X-OZ-Extension': chrome.runtime.getManifest().version
            },
            body: JSON.stringify({
                address: address,
                lat: lat,
                lon: lon
            })
        });
        
        if (!response.ok) {
            throw new Error(`Backend error: ${response.status}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error('Error loading map data:', error);
        throw error;
    }
}

// Initialize map with backend data (no Google Maps API needed)
function initializeMap(mapData) {
    // For development, show a placeholder map
    if (DEVELOPMENT_MODE) {
        console.log('Development mode: Map data received', mapData);
        return Promise.resolve();
    }
    
    // In production, you would use the mapData to render the map
    // This could be with Leaflet, Mapbox, or other mapping libraries
    // that don't require exposing API keys in the client
    return Promise.resolve();
}

// Set global flag for backend map integration
window.googleMapsLoaded = true; // Always ready since we use backend proxy

// Initialize map handler when DOM is ready (handled at the end of this file)

// Map Handler Class for Google Maps integration
class MapHandler {
    constructor() {
        this.map = null;
        this.isMapVisible = false;
        this.currentAddress = null;
        this.currentCoords = null;
        this.currentZones = null;
        this.addressMarker = null;
        this.isGoogleMapsReady = false;
        
        // Map elements
        this.mapContainer = document.getElementById('mapContainer');
        this.mapElement = document.getElementById('ozMap');
        this.mapLoading = document.getElementById('mapLoading');
        this.mapError = document.getElementById('mapError');
        this.mapToggleBtn = document.getElementById('mapToggleBtn');
        this.mapFullscreenBtn = document.getElementById('mapFullscreenBtn');
        
        // Bind event listeners
        this.mapToggleBtn.addEventListener('click', () => this.toggleMap());
        this.mapFullscreenBtn.addEventListener('click', () => this.openInGoogleMaps());
        
        // Zone colors for visual distinction
        this.zoneColors = [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FECA57',
            '#6C5CE7', '#FD79A8', '#FDCB6E', '#6C5CE7', '#A29BFE'
        ];
        this.colorMap = new Map();
    }
    
    onGoogleMapsReady() {
        this.isGoogleMapsReady = true;
        if (this.currentCoords && this.isMapVisible) {
            this.initializeMap();
        }
    }
    
    async showMap(addressData) {
        if (!addressData || (!addressData.latitude && !addressData.longitude)) {
            this.hideMap();
            return;
        }
        
        this.currentAddress = addressData.address;
        this.currentCoords = {
            lat: parseFloat(addressData.latitude),
            lng: parseFloat(addressData.longitude)
        };
        this.currentZones = addressData.opportunityZones || [];
        
        // Show map container
        this.mapContainer.classList.remove('hidden');
        this.isMapVisible = true;
        
        if (this.isGoogleMapsReady) {
            await this.initializeMap();
        } else {
            this.showLoading();
        }
    }
    
    async initializeMap() {
        if (!this.currentCoords) return;
        
        this.showLoading();
        
        try {
            // Check if Google Maps is available
            if (!window.google || !window.google.maps) {
                console.warn('Google Maps API not available - showing placeholder');
                this.showMapPlaceholder();
                return;
            }
            
            // Initialize Google Maps
            this.map = new google.maps.Map(this.mapElement, {
                center: this.currentCoords,
                zoom: 14,
                mapTypeControl: false,
                streetViewControl: false,
                fullscreenControl: false,
                zoomControl: true,
                mapTypeId: google.maps.MapTypeId.ROADMAP,
                styles: [
                    {
                        featureType: 'poi',
                        elementType: 'labels',
                        stylers: [{ visibility: 'off' }]
                    }
                ]
            });
            
            // Add marker for the searched address
            this.addressMarker = new google.maps.Marker({
                position: this.currentCoords,
                map: this.map,
                title: this.currentAddress,
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 8,
                    fillColor: '#40E0D0',
                    fillOpacity: 1,
                    strokeColor: '#ffffff',
                    strokeWeight: 2
                }
            });
            
            // Load opportunity zone shapes if available
            if (this.currentZones && this.currentZones.length > 0) {
                await this.loadZoneShapes();
            }
            
            this.hideLoading();
            
        } catch (error) {
            console.error('Failed to initialize map:', error);
            this.showError();
        }
    }
    
    async loadZoneShapes() {
        if (!this.currentZones || this.currentZones.length === 0) return;
        
        try {
            // Extract zone IDs for API call
            const zoneIds = this.currentZones.map(zone => zone.id || zone.opportunityZoneId).filter(Boolean);
            
            if (zoneIds.length === 0) return;
            
            // Request GeoJSON data from background script
            const response = await chrome.runtime.sendMessage({
                type: 'OZ_GET_ZONE_SHAPES',
                zoneIds: zoneIds,
                center: this.currentCoords
            });
            
            if (response && response.geoJson && response.geoJson.features) {
                this.renderZoneShapes(response.geoJson);
            }
            
        } catch (error) {
            console.error('Failed to load zone shapes:', error);
            // Continue without shapes - don't show error for this
        }
    }
    
    renderZoneShapes(geoJson) {
        if (!this.map || !geoJson || !geoJson.features) return;
        
        const bounds = new google.maps.LatLngBounds();
        let colorIndex = 0;
        
        // Add address marker to bounds
        bounds.extend(this.currentCoords);
        
        // Process each feature
        geoJson.features.forEach((feature) => {
            if (feature.geometry && feature.geometry.type === 'Polygon') {
                const zoneId = feature.properties?.CENSUSTRAC || feature.properties?.id;
                
                // Assign color to zone
                if (!this.colorMap.has(zoneId)) {
                    this.colorMap.set(zoneId, this.zoneColors[colorIndex % this.zoneColors.length]);
                    colorIndex++;
                }
                
                const color = this.colorMap.get(zoneId);
                
                // Convert coordinates
                const paths = feature.geometry.coordinates[0].map(coord => ({
                    lat: coord[1],
                    lng: coord[0]
                }));
                
                // Create polygon
                const polygon = new google.maps.Polygon({
                    paths: paths,
                    strokeColor: color,
                    strokeOpacity: 0.8,
                    strokeWeight: 2,
                    fillColor: color,
                    fillOpacity: 0.3,
                    map: this.map
                });
                
                // Add to bounds
                paths.forEach(coord => bounds.extend(coord));
                
                // Add click listener for info
                polygon.addListener('click', () => {
                    const infoWindow = new google.maps.InfoWindow({
                        content: `
                            <div style="padding: 8px; font-family: -apple-system, BlinkMacSystemFont, sans-serif;">
                                <strong>Opportunity Zone</strong><br>
                                Zone ID: ${zoneId || 'Unknown'}
                            </div>
                        `,
                        position: this.currentCoords
                    });
                    infoWindow.open(this.map);
                });
            }
        });
        
        // Fit map to show all zones and address
        this.map.fitBounds(bounds);
        
        // Ensure reasonable zoom level
        google.maps.event.addListenerOnce(this.map, 'bounds_changed', () => {
            if (this.map.getZoom() > 16) {
                this.map.setZoom(16);
            }
        });
    }
    
    toggleMap() {
        if (this.isMapVisible) {
            this.hideMap();
        } else if (this.currentCoords) {
            this.showMap({
                address: this.currentAddress,
                latitude: this.currentCoords.lat,
                longitude: this.currentCoords.lng,
                opportunityZones: this.currentZones
            });
        }
    }
    
    hideMap() {
        this.mapContainer.classList.add('hidden');
        this.isMapVisible = false;
        this.mapToggleBtn.innerHTML = '<span class="btn-icon">📍</span>';
        this.mapToggleBtn.title = 'Show map';
    }
    
    showLoading() {
        this.mapLoading.classList.remove('hidden');
        this.mapError.classList.add('hidden');
        this.mapToggleBtn.innerHTML = '<span class="btn-icon">📍</span>';
        this.mapToggleBtn.title = 'Hide map';
    }
    
    hideLoading() {
        this.mapLoading.classList.add('hidden');
    }
    
    showError() {
        this.mapLoading.classList.add('hidden');
        this.mapError.classList.remove('hidden');
    }
    
    showMapPlaceholder() {
        this.hideLoading();
        this.mapElement.innerHTML = `
            <div style="height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #f0f0f0; color: #666; text-align: center; padding: 20px;">
                <div style="font-size: 48px; margin-bottom: 15px;">🗺️</div>
                <div style="font-weight: 500; margin-bottom: 8px;">Map Preview</div>
                <div style="font-size: 14px; line-height: 1.4;">
                    Address: ${this.currentAddress}<br>
                    Coordinates: ${this.currentCoords.lat.toFixed(6)}, ${this.currentCoords.lng.toFixed(6)}<br>
                    <span style="color: #40E0D0; font-weight: 500;">
                        ${this.currentZones && this.currentZones.length > 0 ? 
                            `✓ ${this.currentZones.length} Opportunity Zone(s)` : 
                            '○ No zones detected'}
                    </span>
                </div>
                <div style="margin-top: 15px; font-size: 12px; color: #888;">
                    Configure Google Maps API key to see interactive map
                </div>
            </div>
        `;
    }
    
    openInGoogleMaps() {
        if (!this.currentCoords || !this.currentAddress) return;
        
        const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(this.currentAddress)}`;
        chrome.tabs.create({ url });
    }
    
    clear() {
        this.hideMap();
        this.currentAddress = null;
        this.currentCoords = null;
        this.currentZones = null;
        this.colorMap.clear();
        
        if (this.map) {
            this.map = null;
        }
        if (this.addressMarker) {
            this.addressMarker = null;
        }
        
        // Clear map element content
        this.mapElement.innerHTML = '';
    }
}

class OZSidebar {
    constructor() {
        this.currentStep = null;
        this.currentAddress = null;
        this.isProcessing = false;
        this.authState = null;
        this.authMeta = null;
        this.isOutOfSearches = false;
        
        // Initialize map handler
        this.mapHandler = new MapHandler();
        
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
        this.getMoreSearchesBtn = document.getElementById('getMoreSearchesBtn');
        
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
        this.getMoreSearchesBtn.addEventListener('click', () => this.openPricingPage());
        
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
            
            // Update upgrade button for out-of-searches state
            this.upgradeBtn.className = 'usage-action-btn alert';
            this.upgradeBtn.title = 'Get more free searches';
            this.upgradeBtn.innerHTML = '<span class="btn-icon">⚠️</span>';
            this.isOutOfSearches = true;
        } else {
            this.usageProgress.className = 'usage-progress';
            this.upgradedActions.classList.add('hidden');
            
            // Restore normal upgrade button state
            this.upgradeBtn.className = 'usage-action-btn primary';
            this.upgradeBtn.title = 'Upgrade to 15/month';
            this.upgradeBtn.innerHTML = '<span class="btn-icon">⬆️</span>';
            this.isOutOfSearches = false;
            
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
            // Use existing upgrade flow for normal upgrades
            await chrome.runtime.sendMessage({ type: 'OZ_OPEN_UPGRADE' });
        } catch (error) {
            console.error('Failed to open upgrade:', error);
        }
    }

    async openPricingPage() {
        try {
            // Open pricing page in new tab
            await chrome.tabs.create({ url: 'https://oz-mcp.vercel.app/pricing' });
        } catch (error) {
            console.error('Failed to open pricing page:', error);
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
        
        // Show map if we have coordinates
        if (result.latitude && result.longitude) {
            const mapData = {
                address: this.currentAddress,
                latitude: result.latitude,
                longitude: result.longitude,
                opportunityZones: result.isInOpportunityZone ? [result] : []
            };
            this.mapHandler.showMap(mapData);
        }
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
        
        // Clear map
        this.mapHandler.clear();
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
    // Initialize map handler once sidebar is ready
    if (window.ozSidebar && window.ozSidebar.mapHandler) {
        window.ozSidebar.mapHandler.onGoogleMapsReady();
    }
});

// Also handle case where script loads after DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.ozSidebar = new OZSidebar();
        // Initialize map handler once sidebar is ready
        if (window.ozSidebar && window.ozSidebar.mapHandler) {
            window.ozSidebar.mapHandler.onGoogleMapsReady();
        }
    });
} else {
    window.ozSidebar = new OZSidebar();
    // Initialize map handler once sidebar is ready
    if (window.ozSidebar && window.ozSidebar.mapHandler) {
        window.ozSidebar.mapHandler.onGoogleMapsReady();
    }
}