// ADHARM VINASH - CLIENT-SIDE CORE LOGIC

// 1. STATE & CONSTANTS
const DEFAULT_CENTER_DEG = [28.6304, 77.2177]; // Connaught Place, New Delhi [Lat, Lng]
let viewer;
let incidents = [];
let activeRouteEntities = [];
let isSettingLocation = false;
let audioCtx = null;
let activeOscillators = [];
let isDispatchingSOS = false;
let notificationEventSource = null;

// For 3D Popup overlay tracking
let selectedEntity = null;
const popupElement = document.getElementById('cesium-popup-container');
const popupContent = document.getElementById('cesium-popup-content');

// Local landmark geocode lookup (offline fallback)
const MOCK_LANDMARKS = {
    "connaught place": [28.6304, 77.2177],
    "cp": [28.6304, 77.2177],
    "india gate": [28.6129, 77.2295],
    "palika bazar": [28.6300, 77.2165],
    "janpath": [28.6275, 77.2195],
    "mandi house": [28.6250, 77.2340],
    "rashtrapati bhavan": [28.6143, 77.1996],
    "red fort": [28.6562, 77.2410],
    "qutub minar": [28.5245, 77.1855],
    "mumbai": [18.9220, 72.8347],
    "bengaluru": [12.9716, 77.5946],
    "delhi": [28.6139, 77.2090]
};

// Formal styling configuration for report categories
const CATEGORY_STYLES = {
    assault: { color: '#ef4444', label: '⚠️ ASSAULT / THREAT' },
    theft: { color: '#f59e0b', label: '💸 LARCENY / THEFT' },
    harassment: { color: '#06b6d4', label: '👁️ PUBLIC HARASSMENT' },
    suspicious: { color: '#3b82f6', label: '🕵️ SUSPICIOUS ACTIVITY' },
    vandalism: { color: '#10b981', label: '🎨 PROPERTY DAMAGE' }
};

// Simple alert sound utility
function playAlertBeep(freq = 800, duration = 0.1) {
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        osc.type = 'sine';
        osc.frequency.value = freq;
        gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.005, audioCtx.currentTime + duration);

        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    } catch(e) {}
}

// ----------------------------------------------------
// APP INITIALIZATION
// ----------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize Map (spinning in background of auth screen)
    initMap();

    // 2. Check Session Login State
    checkAuthSession();

    // 3. Bind UI & Auth Events
    setupUIEventListeners();
});

function checkAuthSession() {
    const activeUser = sessionStorage.getItem('auth_user');
    const authRole = sessionStorage.getItem('auth_role') || 'citizen';
    const loginScreen = document.getElementById('login-screen');
    const mainSidebar = document.getElementById('main-sidebar');
    const searchBar = document.getElementById('global-search-container');
    const themeBtn = document.getElementById('btn-theme-toggle');
    const hudCoords = document.getElementById('hud-coordinates');
    const routeContainer = document.getElementById('route-toggle-container');
    const sosContainer = document.getElementById('sos-trigger-container');
    const adminTabLink = document.getElementById('tab-link-admin');
    const burgerMenu = document.getElementById('sidebar-toggle-container');
    
    const subtitleEl = document.getElementById('sidebar-subtitle');
    const tabsList = document.querySelectorAll('.sidebar-tabs .tab-link');

    if (activeUser) {
        // Logged in: Hide login and reveal citizen UI
        loginScreen.classList.add('hidden');
        mainSidebar.classList.remove('hidden');
        searchBar.classList.remove('hidden');
        themeBtn.classList.remove('hidden');
        hudCoords.classList.remove('hidden');
        routeContainer.classList.remove('hidden');
        if (sosContainer) sosContainer.classList.remove('hidden');
        if (burgerMenu) burgerMenu.classList.remove('hidden');
        
        document.getElementById('logged-user-name').textContent = activeUser;
        
        // Connect to SSE stream for live notifications
        if (!notificationEventSource) {
            startSSEConnection();
        }
        
        // Apply role specific details
        if (activeUser === 'admin') {
            document.body.classList.remove('vigilante-mode');
            if (subtitleEl) subtitleEl.innerHTML = '<span style="color: #ef4444; font-weight: bold;">⚡ Admin Control Center</span>';
            if (adminTabLink) adminTabLink.classList.remove('hidden');
            loadAdminData();
            
            // Restore default labels
            if (tabsList.length >= 3) {
                tabsList[0].textContent = "Active Logs";
                tabsList[1].textContent = "File Report";
                tabsList[2].textContent = "Profile";
            }
        } else if (authRole === 'vigilante') {
            document.body.classList.add('vigilante-mode');
            if (subtitleEl) subtitleEl.innerHTML = '<span style="color: #10b981; font-weight: bold; text-shadow: 0 0 5px rgba(16,185,129,0.3);">🕵️ Vigilante Mode Active</span>';
            if (adminTabLink) adminTabLink.classList.add('hidden');
            
            // Update labels to stealth names
            if (tabsList.length >= 3) {
                tabsList[0].textContent = "Threat Radar";
                tabsList[1].textContent = "Submit Intel";
                tabsList[2].textContent = "Agent Profile";
            }
        } else {
            document.body.classList.remove('vigilante-mode');
            if (subtitleEl) subtitleEl.innerHTML = 'Citizen Incident Portal';
            if (adminTabLink) adminTabLink.classList.add('hidden');
            
            // Restore default labels
            if (tabsList.length >= 3) {
                tabsList[0].textContent = "Active Logs";
                tabsList[1].textContent = "File Report";
                tabsList[2].textContent = "Profile";
            }
        }

        // Load data
        loadIncidents();
        loadUserProfile(activeUser);
    } else {
        // Not Logged in: Show login and keep UI hidden
        loginScreen.classList.remove('hidden');
        mainSidebar.classList.add('hidden');
        searchBar.classList.add('hidden');
        themeBtn.classList.add('hidden');
        hudCoords.classList.add('hidden');
        routeContainer.classList.add('hidden');
        if (sosContainer) sosContainer.classList.add('hidden');
        if (adminTabLink) adminTabLink.classList.add('hidden');
        if (burgerMenu) burgerMenu.classList.add('hidden');
        
        document.body.classList.remove('vigilante-mode');
        
        // Stop SSE connection
        stopSSEConnection();
    }
}

function startSSEConnection() {
    if (notificationEventSource) {
        notificationEventSource.close();
    }
    
    notificationEventSource = new EventSource('/api/notifications/subscribe');
    
    notificationEventSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.connected) {
                console.log("Live push notification stream connected.");
                return;
            }
            handleLiveIncidentNotification(data);
        } catch (e) {
            console.error("Error parsing SSE event data:", e);
        }
    };
    
    notificationEventSource.onerror = (err) => {
        console.error("SSE stream error, re-establishing in 5s...", err);
        if (notificationEventSource) {
            notificationEventSource.close();
        }
        notificationEventSource = null;
        setTimeout(startSSEConnection, 5000);
    };
}

function stopSSEConnection() {
    if (notificationEventSource) {
        notificationEventSource.close();
        notificationEventSource = null;
        console.log("Live push notification stream disconnected.");
    }
}

function handleLiveIncidentNotification(incident) {
    if (!incidents.some(i => i.id === incident.id)) {
        incidents.push(incident);
        renderMarkers();
        updateFeedList();
        
        if (sessionStorage.getItem('auth_user') === 'admin') {
            loadAdminData();
        }
    }
    
    playAlertBeep(880, 0.15);
    setTimeout(() => {
        playAlertBeep(1046.50, 0.2);
    }, 150);
    
    showLiveNotificationToast(incident);
}

function showLiveNotificationToast(incident) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    
    const toast = document.createElement('div');
    toast.className = 'notification-toast';
    
    const categoryLabel = CATEGORY_STYLES[incident.category]?.label || '⚠️ ALERT';
    const categoryColor = CATEGORY_STYLES[incident.category]?.color || '#ef4444';
    
    toast.style.borderColor = `${categoryColor}44`;
    
    toast.innerHTML = `
        <div class="notification-toast-header">
            <div class="notification-toast-title" style="color: ${categoryColor};">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="animation: alert-flash 1s infinite alternate;">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                ${categoryLabel}
            </div>
            <button class="notification-toast-close">&times;</button>
        </div>
        <div class="notification-toast-body">
            ${incident.description}
        </div>
        <div class="notification-toast-actions">
            <button class="notification-toast-btn" id="toast-fly-${incident.id}">Fly to Map</button>
        </div>
    `;
    
    const closeBtn = toast.querySelector('.notification-toast-close');
    const flyBtn = toast.querySelector(`#toast-fly-${incident.id}`);
    
    const dismissToast = () => {
        toast.style.animation = 'toastSlideOut 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards';
        toast.addEventListener('animationend', () => {
            toast.remove();
        });
    };
    
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dismissToast();
        playAlertBeep(500, 0.05);
    });
    
    flyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dismissToast();
        playAlertBeep(600, 0.08);
        
        const mainSidebar = document.getElementById('main-sidebar');
        if (mainSidebar) mainSidebar.classList.remove('sidebar-open');
        
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(incident.lng, incident.lat, 800.0),
            orientation: {
                heading: Cesium.Math.toRadians(0.0),
                pitch: Cesium.Math.toRadians(-45.0),
                roll: 0.0
            },
            duration: 2.0
        });
        
        setTimeout(() => {
            const entity = viewer.entities.getById(incident.id);
            if (entity) {
                openCesiumPopup(entity);
            }
        }, 2100);
    });
    
    setTimeout(() => {
        dismissToast();
    }, 8000);
    
    container.appendChild(toast);
}

function initMap() {
    // Determine initially loaded imagery theme
    const savedTheme = localStorage.getItem('civicsafe_theme');
    const isLight = savedTheme === 'light';
    const imageryUrl = isLight 
        ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

    // Initialize Cesium Viewer
    viewer = new Cesium.Viewer('map', {
        imageryProvider: new Cesium.UrlTemplateImageryProvider({
            url: imageryUrl,
            subdomains: ['a', 'b', 'c', 'd']
        }),
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        infoBox: false,
        sceneModePicker: false,
        selectionIndicator: false,
        timeline: false,
        navigationHelpButton: false,
        navigationInstructionsInitiallyVisible: false,
        animation: false,
        fullscreenButton: false,
        vrButton: false
    });

    if (viewer.creditContainer) {
        viewer.creditContainer.style.display = 'none';
    }

    // Set initial view centered at New Delhi (wide view)
    viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(DEFAULT_CENTER_DEG[1], DEFAULT_CENTER_DEG[0], 25000.0),
        orientation: {
            heading: Cesium.Math.toRadians(0.0),
            pitch: Cesium.Math.toRadians(-90.0),
            roll: 0.0
        }
    });

    // Fly camera down to Connaught Place for a stunning intro
    setTimeout(() => {
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(DEFAULT_CENTER_DEG[1], DEFAULT_CENTER_DEG[0], 2000.0),
            orientation: {
                heading: Cesium.Math.toRadians(0.0),
                pitch: Cesium.Math.toRadians(-40.0),
                roll: 0.0
            },
            duration: 3.5
        });
    }, 600);

    // Screen click handler for raycasting selection / coordinate pin
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction(async (click) => {
        // Disallow clicks if not logged in
        if (!sessionStorage.getItem('auth_user')) return;

        // 1. Raycast check for clicked Entity
        const pickedObject = viewer.scene.pick(click.position);
        if (Cesium.defined(pickedObject) && pickedObject.id) {
            const entity = pickedObject.id;
            if (entity.properties && entity.properties.category) {
                openCesiumPopup(entity);
                return;
            }
        }

        // Close popup if clicked elsewhere
        closeCesiumPopup();

        // 2. Raycast check for GPS Capture coordinates picking
        if (isSettingLocation) {
            const ray = viewer.camera.getPickRay(click.position);
            const position = viewer.scene.globe.pick(ray, viewer.scene);
            if (Cesium.defined(position)) {
                const cartographic = Cesium.Cartographic.fromCartesian(position);
                const lat = Cesium.Math.toDegrees(cartographic.latitude);
                const lng = Cesium.Math.toDegrees(cartographic.longitude);
                
                setReportLocationInput(lat, lng);
                isSettingLocation = false;
                document.getElementById('btn-select-location').textContent = "GPS Capture";
                playAlertBeep(600, 0.1);

                const mainSidebar = document.getElementById('main-sidebar');
                if (mainSidebar) mainSidebar.classList.add('sidebar-open');

                // Auto reverse geocode and fill the address input
                const addrInput = document.getElementById('report-address');
                addrInput.value = "Locating address...";
                const address = await reverseGeocode(lat, lng);
                addrInput.value = address;
            }
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // Track dynamic popups positions during scene render loops
    viewer.scene.postRender.addEventListener(() => {
        updatePopupPosition();
    });

    // Ensure map handles browser resize actions cleanly
    window.addEventListener('resize', () => {
        viewer.resize();
    });
}

function updateMapImagery(isLightTheme) {
    if (!viewer) return;
    viewer.imageryLayers.removeAll();
    
    const url = isLightTheme 
        ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
        
    viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: url,
        subdomains: ['a', 'b', 'c', 'd']
    }));
}

function openCesiumPopup(entity) {
    selectedEntity = entity;
    
    const cat = entity.properties.category.getValue();
    const desc = entity.properties.description.getValue();
    const time = entity.properties.time.getValue();
    const isAnon = entity.properties.anonymous.getValue();
    const entityId = entity.id;

    const upCount = entity.properties.upvotes ? entity.properties.upvotes.getValue() : 0;
    const downCount = entity.properties.downvotes ? entity.properties.downvotes.getValue() : 0;
    const votesObj = entity.properties.votes ? entity.properties.votes.getValue() : {};
    
    const activeUser = sessionStorage.getItem('auth_user') || '';
    const userVote = votesObj[activeUser] || ''; // 'up' or 'down' or ''
    
    const upActive = userVote === 'up' ? 'style="color: var(--color-success); font-weight: bold; border-color: var(--color-success); background: rgba(16,185,129,0.1);"' : '';
    const downActive = userVote === 'down' ? 'style="color: var(--color-danger); font-weight: bold; border-color: var(--color-danger); background: rgba(239,68,68,0.1);"' : '';
    
    const score = upCount - downCount;
    let statusText = '⚖️ Unverified';
    let statusStyle = 'color: var(--text-secondary); background: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; border: 1px solid var(--border-color);';
    if (score > 2) {
        statusText = '✅ Verified Log';
        statusStyle = 'color: var(--color-success); background: rgba(16,185,129,0.15); border: 1px solid rgba(16,185,129,0.3); padding: 2px 6px; border-radius: 4px; font-size: 0.65rem;';
    } else if (score < -1) {
        statusText = '❌ Disputed / Fake';
        statusStyle = 'color: var(--color-danger); background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.3); padding: 2px 6px; border-radius: 4px; font-size: 0.65rem;';
    }
    
    const style = CATEGORY_STYLES[cat] || { color: '#3b82f6', label: 'ALERT' };
    
    popupContent.innerHTML = `
        <div style="border-top: 3px solid ${style.color}; padding-top: 4px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <h4 style="color: ${style.color}; font-weight: 700; margin: 0; font-size: 0.85rem;">${style.label}</h4>
                <span style="${statusStyle}">${statusText}</span>
            </div>
            <p style="margin-bottom: 8px; font-size: 0.8rem; line-height: 1.4;">${desc}</p>
            <div class="popup-footer-hud" style="margin-bottom: 10px;">
                <span>Logged: ${time}</span>
                <span>${isAnon ? 'Anonymous' : 'Precinct Sync'}</span>
            </div>
            <div style="display: flex; gap: 8px; align-items: center; border-top: 1px solid var(--border-color); padding-top: 8px;">
                <span style="font-size: 0.7rem; color: var(--text-secondary);">Verify Log:</span>
                <button onclick="submitVote('${entityId}', 'up')" class="btn-action-outline" style="padding: 2px 8px; font-size: 0.7rem; display: flex; align-items: center; gap: 4px;" ${upActive}>
                    👍 <span>${upCount}</span>
                </button>
                <button onclick="submitVote('${entityId}', 'down')" class="btn-action-outline" style="padding: 2px 8px; font-size: 0.7rem; display: flex; align-items: center; gap: 4px;" ${downActive}>
                    👎 <span>${downCount}</span>
                </button>
            </div>
        </div>
    `;
    
    popupElement.classList.remove('hidden');
    updatePopupPosition();
    playAlertBeep(520, 0.1);
}

function closeCesiumPopup() {
    selectedEntity = null;
    popupElement.classList.add('hidden');
}

function updatePopupPosition() {
    if (selectedEntity && selectedEntity.position) {
        const center = selectedEntity.position.getValue(viewer.clock.currentTime);
        if (center) {
            const screenPos = Cesium.SceneTransforms.wgs84ToWindowCoordinates(viewer.scene, center);
            if (screenPos) {
                popupElement.style.left = `${screenPos.x}px`;
                popupElement.style.top = `${screenPos.y - 30}px`;
            } else {
                popupElement.classList.add('hidden');
            }
        } else {
            popupElement.classList.add('hidden');
        }
    }
}

async function loadIncidents() {
    try {
        const response = await fetch('/api/incidents');
        incidents = await response.json();
    } catch (e) {
        console.error("Failed to load incidents from backend database:", e);
        incidents = [];
    }
    renderMarkers();
    updateFeedList();
}

function renderMarkers() {
    // Remove only incident entities (cylinders) to avoid wiping routes
    const entitiesToRemove = [];
    viewer.entities.values.forEach(entity => {
        if (entity.properties && entity.properties.category) {
            entitiesToRemove.push(entity);
        }
    });
    entitiesToRemove.forEach(entity => viewer.entities.remove(entity));

    const renderedIds = new Set();
    incidents.forEach(item => {
        if (renderedIds.has(item.id)) return;
        renderedIds.add(item.id);

        const style = CATEGORY_STYLES[item.category] || { color: '#3b82f6', label: 'ALERT' };
        
        // Render 3D cylinder standing vertically on the ground
        viewer.entities.add({
            id: item.id,
            position: Cesium.Cartesian3.fromDegrees(item.lng, item.lat, 75.0),
            cylinder: {
                length: 150.0,
                topRadius: 12.0,
                bottomRadius: 12.0,
                material: Cesium.Color.fromCssColorString(style.color).withAlpha(0.6),
                outline: true,
                outlineColor: Cesium.Color.fromCssColorString(style.color),
                outlineWidth: 2.0
            },
            properties: {
                category: item.category,
                description: item.description,
                time: item.time,
                anonymous: item.anonymous,
                upvotes: item.upvotes || 0,
                downvotes: item.downvotes || 0,
                votes: item.votes || {}
            }
        });
    });
}

function updateFeedList() {
    const listContainer = document.getElementById('fnsm-feed-list');
    const countSpan = document.getElementById('incident-count');
    
    countSpan.textContent = incidents.length;
    listContainer.innerHTML = '';

    if (incidents.length === 0) {
        listContainer.innerHTML = `<div class="status-msg">No active logs registered in scanning region.</div>`;
        return;
    }

    const sorted = [...incidents].reverse();

    sorted.forEach(item => {
        const style = CATEGORY_STYLES[item.category] || { color: '#3b82f6', label: 'ALERT' };
        const card = document.createElement('div');
        card.className = `feed-card danger-${item.category}`;
        
        const upCount = item.upvotes || 0;
        const downCount = item.downvotes || 0;
        const score = upCount - downCount;
        let badgeText = '⚖️ Unverified';
        let badgeStyle = 'color: var(--text-secondary); background: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-color);';
        if (score > 2) {
            badgeText = '✅ Verified';
            badgeStyle = 'color: var(--color-success); background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.2); padding: 2px 6px; border-radius: 4px;';
        } else if (score < -1) {
            badgeText = '❌ Disputed';
            badgeStyle = 'color: var(--color-danger); background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.2); padding: 2px 6px; border-radius: 4px;';
        }

        card.innerHTML = `
            <div class="card-header-hud">
                <span class="card-category">${style.label}</span>
                <span>${item.time}</span>
            </div>
            <div class="card-title">Coordinates: [${item.lat.toFixed(4)}, ${item.lng.toFixed(4)}]</div>
            <div class="card-desc">${item.description}</div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.04); padding-top: 6px; font-size: 0.65rem;">
                <span style="${badgeStyle}">${badgeText}</span>
                <span style="color: var(--text-secondary);">👍 ${upCount} / 👎 ${downCount}</span>
            </div>
        `;

        card.addEventListener('click', () => {
            closeCesiumPopup();

            const mainSidebar = document.getElementById('main-sidebar');
            if (mainSidebar) mainSidebar.classList.remove('sidebar-open');

            // Fly camera to location
            viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(item.lng, item.lat, 800.0),
                orientation: {
                    heading: Cesium.Math.toRadians(0.0),
                    pitch: Cesium.Math.toRadians(-45.0),
                    roll: 0.0
                },
                duration: 2.0
            });
            
            // Open popup after camera settles
            setTimeout(() => {
                const entity = viewer.entities.getById(item.id);
                if (entity) {
                    openCesiumPopup(entity);
                }
            }, 2100);
            
            playAlertBeep(520, 0.1);
        });

        listContainer.appendChild(card);
    });
}

function setReportLocationInput(lat, lng) {
    const input = document.getElementById('report-location');
    input.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

// Geocode Address -> Coordinates using Nominatim API or local dictionary
async function geocodeAddress(address) {
    const cleanAddress = address.trim().toLowerCase();
    
    // Check mock database first
    if (MOCK_LANDMARKS[cleanAddress]) {
        return MOCK_LANDMARKS[cleanAddress];
    }
    
    // Check key substrings
    for (let key in MOCK_LANDMARKS) {
        if (cleanAddress.includes(key)) {
            return MOCK_LANDMARKS[key];
        }
    }
    
    // Fallback to OSM Nominatim API
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`);
        const data = await response.json();
        if (data && data.length > 0) {
            return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
        }
    } catch (e) {
        console.error("Geocoding API error:", e);
    }
    return null;
}

// Reverse Geocode Coordinates -> Address using Nominatim API
async function reverseGeocode(lat, lng) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
        const data = await response.json();
        if (data && data.display_name) {
            return data.display_name.split(',').slice(0, 3).join(',').trim();
        }
    } catch (e) {
        console.error("Reverse geocoding API error:", e);
    }
    return `Incident Location near [${lat.toFixed(4)}, ${lng.toFixed(4)}]`;
}

// Helper to resolve viewer center coordinates
function getMapCenter() {
    const windowPosition = new Cesium.Cartesian2(
        viewer.container.clientWidth / 2,
        viewer.container.clientHeight / 2
    );
    const ray = viewer.camera.getPickRay(windowPosition);
    const centerPosition = viewer.scene.globe.pick(ray, viewer.scene);
    if (Cesium.defined(centerPosition)) {
        const cartographic = Cesium.Cartographic.fromCartesian(centerPosition);
        const lat = Cesium.Math.toDegrees(cartographic.latitude);
        const lng = Cesium.Math.toDegrees(cartographic.longitude);
        return { lat, lng };
    }
    return { lat: DEFAULT_CENTER_DEG[0], lng: DEFAULT_CENTER_DEG[1] };
}

// ----------------------------------------------------
// UI INTERACTION EVENT BINDINGS
// ----------------------------------------------------
function setupUIEventListeners() {
    const tabLinks = document.querySelectorAll('.tab-link');
    const tabPanels = document.querySelectorAll('.tab-panel');

    // Close button for popup
    document.getElementById('cesium-popup-close').addEventListener('click', () => {
        closeCesiumPopup();
    });

    // 1. Sidebar tab switcher
    tabLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            const tabId = link.getAttribute('data-tab');
            
            tabLinks.forEach(btn => btn.classList.remove('active'));
            link.classList.add('active');

            tabPanels.forEach(panel => panel.classList.remove('active'));
            document.getElementById(tabId).classList.add('active');

            playAlertBeep(440, 0.08);
        });
    });

    // 2. Authentication Toggle & Form Submission
    const authForm = document.getElementById('auth-form');
    const linkAuthToggle = document.getElementById('link-auth-toggle');
    const authToggleText = document.getElementById('auth-toggle-text');
    const authErrorMsg = document.getElementById('auth-error');
    const btnAuthSubmit = document.getElementById('btn-auth-submit');
    
    let isRegisterState = false; // Toggle between Login and Register states

    const forgotPasswordLink = document.getElementById('link-forgot-password');
    const backToLoginLink = document.getElementById('link-back-to-login');
    const forgotPasswordPanel = document.getElementById('forgot-password-panel');
    const resetForm = document.getElementById('reset-request-form');
    const resetErrorMsg = document.getElementById('reset-error');
    const resetSuccessMsg = document.getElementById('reset-success');

    if (forgotPasswordLink) {
        forgotPasswordLink.addEventListener('click', (e) => {
            e.preventDefault();
            authForm.classList.add('hidden');
            forgotPasswordPanel.classList.remove('hidden');
            resetErrorMsg.classList.add('hidden');
            resetSuccessMsg.classList.add('hidden');
            if (resetForm) resetForm.reset();
            playAlertBeep(600, 0.08);
        });
    }

    if (backToLoginLink) {
        backToLoginLink.addEventListener('click', (e) => {
            e.preventDefault();
            forgotPasswordPanel.classList.add('hidden');
            authForm.classList.remove('hidden');
            authErrorMsg.classList.add('hidden');
            playAlertBeep(600, 0.08);
        });
    }

    if (resetForm) {
        resetForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('reset-username').value.trim();
            const fullName = document.getElementById('reset-fullname').value.trim();
            const phone = document.getElementById('reset-phone').value.trim();
            const newPassword = document.getElementById('reset-newpassword').value;

            resetErrorMsg.classList.add('hidden');
            resetSuccessMsg.classList.add('hidden');

            try {
                const response = await fetch('/api/reset-request', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, fullName, phone, newPassword })
                });
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || "Reset request failed");
                }
                resetSuccessMsg.textContent = data.message;
                resetSuccessMsg.classList.remove('hidden');
                resetForm.reset();
                playAlertBeep(1000, 0.15);
            } catch (err) {
                resetErrorMsg.textContent = err.message;
                resetErrorMsg.classList.remove('hidden');
                playAlertBeep(300, 0.2);
            }
        });
    }

    linkAuthToggle.addEventListener('click', (e) => {
        e.preventDefault();
        isRegisterState = !isRegisterState;
        authErrorMsg.classList.add('hidden');
        if (forgotPasswordPanel) forgotPasswordPanel.classList.add('hidden');
        authForm.classList.remove('hidden');

        const roleGroup = document.getElementById('register-role-group');

        if (isRegisterState) {
            btnAuthSubmit.textContent = "Register Account";
            authToggleText.innerHTML = `Already have an account? <a href="#" id="link-auth-toggle">Sign In</a>`;
            if (roleGroup) roleGroup.classList.remove('hidden');
        } else {
            btnAuthSubmit.textContent = "Sign In";
            authToggleText.innerHTML = `New to portal? <a href="#" id="link-auth-toggle">Register account</a>`;
            if (roleGroup) roleGroup.classList.add('hidden');
        }
        
        // Rebind the newly generated toggle link
        document.getElementById('link-auth-toggle').addEventListener('click', (ev) => {
            ev.preventDefault();
            linkAuthToggle.click();
        });
        playAlertBeep(600, 0.08);
    });

    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('auth-username').value.trim();
        const password = document.getElementById('auth-password').value;
        authErrorMsg.classList.add('hidden');

        const url = isRegisterState ? '/api/register' : '/api/login';
        const role = isRegisterState ? document.getElementById('auth-role').value : 'citizen';

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, role })
            });
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || "Authentication request failed");
            }

            if (isRegisterState) {
                // Registration success: switch to login state
                alert("Registration submitted! Please wait for Administrator approval before signing in.");
                linkAuthToggle.click();
                document.getElementById('auth-password').value = '';
            } else {
                // Login success: save session and reveal maps
                sessionStorage.setItem('auth_user', data.username);
                sessionStorage.setItem('auth_role', data.role || 'citizen');
                checkAuthSession();
                playAlertBeep(1000, 0.15);
            }
        } catch (err) {
            authErrorMsg.textContent = err.message;
            authErrorMsg.classList.remove('hidden');
            playAlertBeep(300, 0.2);
        }
    });

    // Logout trigger
    document.getElementById('btn-logout').addEventListener('click', () => {
        sessionStorage.removeItem('auth_user');
        sessionStorage.removeItem('auth_role');
        checkAuthSession();
        playAlertBeep(400, 0.1);
    });

    // Mobile Sidebar Drawer Toggle
    const sidebarToggleBtn = document.getElementById('btn-sidebar-toggle');
    const sidebarCloseBtn = document.getElementById('btn-sidebar-close');
    const mainSidebarPanel = document.getElementById('main-sidebar');

    if (sidebarToggleBtn && mainSidebarPanel) {
        sidebarToggleBtn.addEventListener('click', () => {
            mainSidebarPanel.classList.toggle('sidebar-open');
            playAlertBeep(440, 0.08);
        });
    }

    if (sidebarCloseBtn && mainSidebarPanel) {
        sidebarCloseBtn.addEventListener('click', () => {
            mainSidebarPanel.classList.remove('sidebar-open');
            playAlertBeep(400, 0.08);
        });
    }

    // User settings profile update
    const profileForm = document.getElementById('profile-form');
    if (profileForm) {
        profileForm.addEventListener('submit', (e) => {
            e.preventDefault();
            saveUserProfile();
        });
    }

    // Geocode button inside profile tab
    const prefLocateBtn = document.getElementById('btn-pref-locate');
    if (prefLocateBtn) {
        prefLocateBtn.addEventListener('click', async () => {
            const address = document.getElementById('pref-default-location').value;
            if (!address) {
                alert("Please enter an address or landmark.");
                return;
            }
            
            prefLocateBtn.textContent = "Resolving...";
            playAlertBeep(520, 0.1);
            
            const coords = await geocodeAddress(address);
            prefLocateBtn.textContent = "Locate";
            
            if (coords) {
                const [lat, lng] = coords;
                document.getElementById('pref-resolved-coords').value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
                playAlertBeep(900, 0.15);
            } else {
                alert("Location address not found.");
            }
        });
    }

    // Emergency SOS bindings
    const emergencySosBtn = document.getElementById('btn-emergency-sos');
    if (emergencySosBtn) {
        emergencySosBtn.addEventListener('click', () => {
            triggerSOS();
        });
    }

    const cancelSosBtn = document.getElementById('btn-cancel-sos');
    if (cancelSosBtn) {
        cancelSosBtn.addEventListener('click', () => {
            cancelSOS();
        });
    }

    const triggerSosNowBtn = document.getElementById('btn-trigger-sos-now');
    if (triggerSosNowBtn) {
        triggerSosNowBtn.addEventListener('click', () => {
            clearInterval(sosTimerInterval);
            dispatchSOSAlert();
        });
    }

    // Admin manual purge action
    const btnAdminPurge = document.getElementById('btn-admin-purge');
    if (btnAdminPurge) {
        btnAdminPurge.addEventListener('click', () => {
            triggerManualPurge();
        });
    }

    // 3. GPS Map drop capture trigger
    const gpsBtn = document.getElementById('btn-select-location');
    gpsBtn.addEventListener('click', () => {
        isSettingLocation = true;
        gpsBtn.textContent = "Select map point...";
        playAlertBeep(520, 0.1);
        
        const mainSidebar = document.getElementById('main-sidebar');
        if (mainSidebar) mainSidebar.classList.remove('sidebar-open');
    });

    // Report Form Address Search Geocoder
    const searchAddressBtn = document.getElementById('btn-search-address');
    searchAddressBtn.addEventListener('click', async () => {
        const address = document.getElementById('report-address').value;
        if (!address) {
            alert("Please enter an address or landmark to locate.");
            return;
        }
        
        searchAddressBtn.textContent = "Searching...";
        playAlertBeep(520, 0.1);
        
        const coords = await geocodeAddress(address);
        searchAddressBtn.textContent = "Locate";
        
        if (coords) {
            const [lat, lng] = coords;
            setReportLocationInput(lat, lng);
            
            viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(lng, lat, 1000.0),
                orientation: {
                    heading: Cesium.Math.toRadians(0.0),
                    pitch: Cesium.Math.toRadians(-45.0),
                    roll: 0.0
                },
                duration: 2.0
            });
            playAlertBeep(900, 0.15);
        } else {
            alert("Address not found. Please click 'GPS Capture' to select directly on the map.");
        }
    });

    // Global Top Search Bar bindings with suggestions autocomplete
    const globalSearchInput = document.getElementById('map-search-input');
    const globalSearchBtn = document.getElementById('btn-map-search');
    const suggestionsBox = document.getElementById('search-suggestions');
    let debounceTimeout = null;

    // Suggestions listener
    globalSearchInput.addEventListener('input', () => {
        clearTimeout(debounceTimeout);
        const query = globalSearchInput.value.trim();
        if (query.length < 3) {
            suggestionsBox.classList.add('hidden');
            return;
        }
        
        debounceTimeout = setTimeout(() => {
            fetchSuggestions(query);
        }, 300);
    });

    async function fetchSuggestions(query) {
        try {
            const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`);
            const data = await response.json();
            
            if (data && data.length > 0) {
                suggestionsBox.innerHTML = '';
                data.forEach(item => {
                    const div = document.createElement('div');
                    div.className = 'suggestion-item';
                    div.textContent = item.display_name;
                    div.addEventListener('click', () => {
                        globalSearchInput.value = item.display_name;
                        suggestionsBox.classList.add('hidden');
                        
                        const mainSidebar = document.getElementById('main-sidebar');
                        if (mainSidebar) mainSidebar.classList.remove('sidebar-open');
                        
                        const lat = parseFloat(item.lat);
                        const lng = parseFloat(item.lon);
                        
                        viewer.camera.flyTo({
                            destination: Cesium.Cartesian3.fromDegrees(lng, lat, 1200.0),
                            orientation: {
                                heading: Cesium.Math.toRadians(0.0),
                                pitch: Cesium.Math.toRadians(-40.0),
                                roll: 0.0
                            },
                            duration: 2.5
                        });
                        playAlertBeep(900, 0.15);
                    });
                    suggestionsBox.appendChild(div);
                });
                suggestionsBox.classList.remove('hidden');
            } else {
                suggestionsBox.classList.add('hidden');
            }
        } catch (e) {
            console.error("Suggestions fetch error:", e);
        }
    }

    // Close recommendations box if click occurs outside search inputs
    document.addEventListener('click', (e) => {
        if (!globalSearchInput.contains(e.target) && !suggestionsBox.contains(e.target)) {
            suggestionsBox.classList.add('hidden');
        }
    });

    async function executeGlobalSearch() {
        const address = globalSearchInput.value;
        if (!address) {
            alert("Please enter a location or address to search.");
            return;
        }

        globalSearchBtn.textContent = "Locating...";
        playAlertBeep(520, 0.1);
        suggestionsBox.classList.add('hidden');

        const mainSidebar = document.getElementById('main-sidebar');
        if (mainSidebar) mainSidebar.classList.remove('sidebar-open');

        const coords = await geocodeAddress(address);
        globalSearchBtn.textContent = "Locate Position";

        if (coords) {
            const [lat, lng] = coords;
            viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(lng, lat, 1200.0),
                orientation: {
                    heading: Cesium.Math.toRadians(0.0),
                    pitch: Cesium.Math.toRadians(-40.0),
                    roll: 0.0
                },
                duration: 2.5
            });
            playAlertBeep(900, 0.15);
        } else {
            alert("Location not found. Try a different query (e.g. Times Square, Central Park, or full address).");
        }
    }

    globalSearchBtn.addEventListener('click', executeGlobalSearch);
    globalSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            executeGlobalSearch();
        }
    });

    // Theme Toggle bindings
    const themeToggleBtn = document.getElementById('btn-theme-toggle');
    const sunIcon = document.querySelector('.theme-icon-sun');
    const moonIcon = document.querySelector('.theme-icon-moon');
    const savedTheme = localStorage.getItem('civicsafe_theme');

    // Load saved theme state
    if (savedTheme === 'light') {
        document.body.classList.add('light-theme');
        sunIcon.classList.remove('hidden');
        moonIcon.classList.add('hidden');
    }

    themeToggleBtn.addEventListener('click', () => {
        const isLight = document.body.classList.toggle('light-theme');
        
        if (isLight) {
            sunIcon.classList.remove('hidden');
            moonIcon.classList.add('hidden');
            updateMapImagery(true);
            localStorage.setItem('civicsafe_theme', 'light');
        } else {
            sunIcon.classList.add('hidden');
            moonIcon.classList.remove('hidden');
            updateMapImagery(false);
            localStorage.setItem('civicsafe_theme', 'dark');
        }
        
        playAlertBeep(700, 0.08);
    });

    // 4. Submit Incident Report form
    const form = document.getElementById('incident-form');
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const category = document.getElementById('report-category').value;
        const address = document.getElementById('report-address').value;
        const locVal = document.getElementById('report-location').value;
        const time = document.getElementById('report-time').value;
        const description = document.getElementById('report-description').value;
        const anonymous = document.getElementById('report-anonymous').checked;

        if (!locVal) {
            alert("Please input an address or capture location coordinates on the map first.");
            return;
        }

        const [latStr, lngStr] = locVal.split(',');
        const lat = parseFloat(latStr);
        const lng = parseFloat(lngStr);

        const newIncident = {
            id: 'user-' + Date.now(),
            category,
            lat,
            lng,
            time,
            description: `${address}: ${description}`,
            anonymous,
            date: new Date().toISOString() // Save in parseable ISO string
        };

        // Post incident to backend Express database
        fetch('/api/incidents', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(newIncident)
        })
        .then(response => {
            if (!response.ok) {
                throw new Error("HTTP error on POST incident");
            }
            return response.json();
        })
        .then(savedData => {
            if (!incidents.some(i => i.id === savedData.id)) {
                incidents.push(savedData);
                renderMarkers();
                updateFeedList();
            }
            
            form.reset();
            document.getElementById('btn-select-location').textContent = "GPS Capture";
            
            playAlertBeep(1000, 0.2);
            alert("ADHARM VINASH LOG: Report persisted to database.");

            viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(lng, lat, 1000.0),
                orientation: {
                    heading: Cesium.Math.toRadians(0.0),
                    pitch: Cesium.Math.toRadians(-45.0),
                    roll: 0.0
                },
                duration: 2.0
            });
        })
        .catch(error => {
            console.error("Failed to persist incident to database:", error);
            playAlertBeep(300, 0.2);
            alert("ADHARM VINASH ERROR: " + error.message);
        });
    });

    // 5. Routing Simulator Toggle
    const routeToggleBtn = document.getElementById('btn-route-toggle');
    const legendOverlay = document.getElementById('routing-legend');
    const clearRouteBtn = document.getElementById('btn-clear-route');

    routeToggleBtn.addEventListener('click', () => {
        toggleWebLineRouting();
    });

    clearRouteBtn.addEventListener('click', () => {
        clearRouting();
    });

    // Zoom In/Out bindings
    const zoomInBtn = document.getElementById('btn-zoom-in');
    const zoomOutBtn = document.getElementById('btn-zoom-out');

    if (zoomInBtn) {
        zoomInBtn.addEventListener('click', () => {
            if (viewer) {
                viewer.camera.zoomIn(viewer.camera.positionCartographic.height * 0.3);
                playAlertBeep(700, 0.05);
            }
        });
    }

    if (zoomOutBtn) {
        zoomOutBtn.addEventListener('click', () => {
            if (viewer) {
                viewer.camera.zoomOut(viewer.camera.positionCartographic.height * 0.3);
                playAlertBeep(650, 0.05);
            }
        });
    }

    // Tech UI micro-feedback sounds using capturing event listeners (for all current and future elements)
    document.body.addEventListener('mouseenter', (e) => {
        const target = e.target;
        if (target && (target.tagName === 'BUTTON' || target.classList.contains('tab-link') || target.tagName === 'A' || target.classList.contains('map-ctrl-btn') || target.classList.contains('btn-sos-pulse'))) {
            playAlertBeep(1200, 0.03); // light high-pitch tick
        }
    }, true);

    document.body.addEventListener('focusin', (e) => {
        const target = e.target;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) {
            playAlertBeep(1000, 0.05); // focus click sound
        }
    }, true);
}

// ----------------------------------------------------
// SAFEPATH ROUTING DESIGN
// ----------------------------------------------------
function toggleWebLineRouting() {
    clearRouting();
    
    // Start: India Gate [28.6129, 77.2295]
    // End: Connaught Place [28.6304, 77.2177]

    const pathRedFastest = [
        [28.6129, 77.2295],
        [28.6275, 77.2195], // Janpath Market (Incident node)
        [28.6304, 77.2177]
    ];

    const pathBlueSafest = [
        [28.6129, 77.2295],
        [28.6210, 77.2285], // Kasturba Gandhi Marg detour
        [28.6250, 77.2340], // Mandi House safe circle
        [28.6295, 77.2270], // Barakhamba Road
        [28.6304, 77.2177]
    ];

    // Convert paths to Cartesian3 degrees
    const redPositions = pathRedFastest.map(p => Cesium.Cartesian3.fromDegrees(p[1], p[0], 15.0));
    const bluePositions = pathBlueSafest.map(p => Cesium.Cartesian3.fromDegrees(p[1], p[0], 15.0));

    // Red line (Fastest but goes through Janpath incident node)
    const redRoute = viewer.entities.add({
        polyline: {
            positions: redPositions,
            width: 4,
            material: new Cesium.PolylineDashMaterialProperty({
                color: Cesium.Color.fromCssColorString('#ef4444')
            }),
            clampToGround: true
        }
    });

    // Blue line (Safest route avoiding incidents)
    const blueRoute = viewer.entities.add({
        polyline: {
            positions: bluePositions,
            width: 6,
            material: Cesium.Color.fromCssColorString('#3b82f6'),
            clampToGround: true
        }
    });

    activeRouteEntities.push(redRoute, blueRoute);

    // Zoom/Fly camera to view the routes cleanly
    viewer.flyTo([redRoute, blueRoute], {
        offset: new Cesium.HeadingPitchRange(
            Cesium.Math.toRadians(0.0),
            Cesium.Math.toRadians(-45.0),
            2500.0
        )
    });

    document.getElementById('routing-legend').classList.remove('hidden');
    playAlertBeep(880, 0.15);
}

// Clear drawn routes
function clearRouting() {
    activeRouteEntities.forEach(entity => viewer.entities.remove(entity));
    activeRouteEntities = [];
    document.getElementById('routing-legend').classList.add('hidden');
}

// ----------------------------------------------------
// USER PROFILE & PREFERENCES
// ----------------------------------------------------
let userProfile = {
    fullName: "",
    phone: "",
    emergencyContact: "",
    autoAnonymous: true,
    defaultLocation: ""
};

async function loadUserProfile(username) {
    try {
        const response = await fetch(`/api/profile?username=${encodeURIComponent(username)}`);
        const data = await response.json();
        if (response.ok) {
            userProfile = data;
            
            // Populate form fields
            document.getElementById('profile-fullname').value = data.fullName || '';
            document.getElementById('profile-phone').value = data.phone || '';
            document.getElementById('profile-emergency').value = data.emergencyContact || '';
            document.getElementById('pref-auto-anonymous').checked = data.autoAnonymous !== false;
            document.getElementById('pref-resolved-coords').value = data.defaultLocation || '';
            
            // Apply preferences to reporting screen
            document.getElementById('report-anonymous').checked = data.autoAnonymous !== false;

            // Handle map centering preference
            if (data.defaultLocation) {
                const parts = data.defaultLocation.split(',');
                if (parts.length === 2) {
                    const lat = parseFloat(parts[0]);
                    const lng = parseFloat(parts[1]);
                    if (!isNaN(lat) && !isNaN(lng)) {
                        setTimeout(() => {
                            viewer.camera.flyTo({
                                destination: Cesium.Cartesian3.fromDegrees(lng, lat, 2000.0),
                                orientation: {
                                    heading: Cesium.Math.toRadians(0.0),
                                    pitch: Cesium.Math.toRadians(-40.0),
                                    roll: 0.0
                                },
                                duration: 2.5
                            });
                        }, 4100);
                    }
                }
            }
        }
    } catch (e) {
        console.error("Failed to load user profile:", e);
    }
}

async function saveUserProfile() {
    const activeUser = sessionStorage.getItem('auth_user');
    if (!activeUser) return;

    const fullName = document.getElementById('profile-fullname').value.trim();
    const phone = document.getElementById('profile-phone').value.trim();
    const emergencyContact = document.getElementById('profile-emergency').value.trim();
    const autoAnonymous = document.getElementById('pref-auto-anonymous').checked;
    const defaultLocation = document.getElementById('pref-resolved-coords').value.trim();

    try {
        const response = await fetch('/api/profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: activeUser,
                fullName,
                phone,
                emergencyContact,
                autoAnonymous,
                defaultLocation
            })
        });
        const data = await response.json();
        if (response.ok && data.success) {
            userProfile = { fullName, phone, emergencyContact, autoAnonymous, defaultLocation };
            
            // Sync current anonymous check box in reporting form
            document.getElementById('report-anonymous').checked = autoAnonymous;

            playAlertBeep(1000, 0.2);
            alert("ADHARM VINASH: Settings saved successfully!");
        } else {
            throw new Error(data.error || "Failed to update profile settings.");
        }
    } catch (e) {
        console.error("Save profile error:", e);
        playAlertBeep(300, 0.2);
        alert(`Error: ${e.message}`);
    }
}

// ----------------------------------------------------
// EMERGENCY POLICE SOS SYSTEMS
// ----------------------------------------------------
let sosTimerInterval = null;
let sosCountdownSeconds = 5;
let sosAudioInterval = null;

function triggerSOS() {
    const activeUser = sessionStorage.getItem('auth_user');
    if (!activeUser) return;

    const mainSidebar = document.getElementById('main-sidebar');
    if (mainSidebar) mainSidebar.classList.remove('sidebar-open');

    isDispatchingSOS = false;
    const overlay = document.getElementById('sos-countdown-overlay');
    const timerDisplay = document.getElementById('sos-timer');
    const alertTextEl = document.querySelector('.sos-alert-text');
    
    alertTextEl.textContent = "Initiating police dispatch & dialing responder in...";
    sosCountdownSeconds = 5;
    timerDisplay.textContent = sosCountdownSeconds;
    overlay.classList.remove('hidden');

    startSOSEmergencyAudio();

    clearInterval(sosTimerInterval);
    sosTimerInterval = setInterval(() => {
        sosCountdownSeconds--;
        timerDisplay.textContent = sosCountdownSeconds;
        
        if (sosCountdownSeconds <= 0) {
            clearInterval(sosTimerInterval);
            dispatchSOSAlert();
        }
    }, 1000);
}

function startSOSEmergencyAudio() {
    stopSOSEmergencyAudio();
    let toggle = false;
    sosAudioInterval = setInterval(() => {
        playAlertBeep(toggle ? 987.77 : 880.00, 0.4);
        toggle = !toggle;
    }, 500);
}

function stopSOSEmergencyAudio() {
    if (sosAudioInterval) {
        clearInterval(sosAudioInterval);
        sosAudioInterval = null;
    }
}

function cancelSOS() {
    clearInterval(sosTimerInterval);
    stopSOSEmergencyAudio();
    isDispatchingSOS = false;
    document.getElementById('sos-countdown-overlay').classList.add('hidden');
    playAlertBeep(400, 0.15);
}

async function dispatchSOSAlert() {
    if (isDispatchingSOS) return;
    isDispatchingSOS = true;

    stopSOSEmergencyAudio();
    playAlertBeep(1200, 0.6);
    
    const activeUser = sessionStorage.getItem('auth_user');
    const center = getMapCenter();
    
    const name = userProfile.fullName || activeUser;
    const phone = userProfile.phone || "Not specified";
    const emergencyContact = userProfile.emergencyContact || "Not specified";

    const newIncident = {
        id: 'sos-' + Date.now(),
        category: 'assault',
        lat: center.lat,
        lng: center.lng,
        time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
        description: `🚨 EMERGENCY POLICE SOS DISPATCH: Citizen "${name}" (Phone: ${phone}) triggered distress beacon. Emergency Contact: ${emergencyContact}.`,
        anonymous: false,
        date: new Date().toISOString()
    };

    try {
        const response = await fetch('/api/incidents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newIncident)
        });
        if (response.ok) {
            const savedData = await response.json();
            incidents.push(savedData);
            renderMarkers();
            updateFeedList();
            
            // Fly camera to event location
            viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(center.lng, center.lat, 1000.0),
                duration: 1.5
            });
        }
    } catch (e) {
        console.error("SOS incident post failed:", e);
    }

    const alertTextEl = document.querySelector('.sos-alert-text');
    alertTextEl.innerHTML = `🚨 <strong style="color: #ef4444;">DISPATCHED!</strong> Coordinates: [${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}]<br>Connecting to police service 112...`;

    // Click direct dial button
    const callLink = document.getElementById('btn-trigger-sos-now');
    callLink.click();

    setTimeout(() => {
        document.getElementById('sos-countdown-overlay').classList.add('hidden');
        alertTextEl.textContent = "Initiating police dispatch & dialing responder in...";
        isDispatchingSOS = false;
    }, 4000);
}

// ----------------------------------------------------
// ADMINISTRATOR PORTAL CONTROLS
// ----------------------------------------------------
async function loadAdminData() {
    const activeUser = sessionStorage.getItem('auth_user');
    if (activeUser !== 'admin') return;

    try {
        // 1. Fetch and render user directory
        const uResponse = await fetch('/api/admin/users');
        const usersList = await uResponse.json();
        renderAdminUsers(usersList);

        // 2. Fetch and render pending approvals
        const aResponse = await fetch('/api/admin/pending-approvals');
        const approvalsList = await aResponse.json();
        renderAdminApprovals(approvalsList);

        // 3. Fetch and render password reset requests
        const rResponse = await fetch('/api/admin/reset-requests');
        const resetsList = await rResponse.json();
        renderAdminResetRequests(resetsList);

        // 4. Fetch and render moderation incidents
        const iResponse = await fetch('/api/incidents');
        const incidentsList = await iResponse.json();
        renderAdminIncidents(incidentsList);
    } catch (e) {
        console.error("Failed to load admin directory datasets:", e);
    }
}

function renderAdminUsers(usersList) {
    const container = document.getElementById('admin-citizens-list');
    const countEl = document.getElementById('admin-user-count');
    
    countEl.textContent = usersList.length;
    container.innerHTML = '';

    if (usersList.length === 0) {
        container.innerHTML = '<div class="status-msg">No registered citizens.</div>';
        return;
    }

    usersList.forEach(user => {
        const row = document.createElement('div');
        row.className = 'admin-row';

        let roleBadge = '';
        if (user.role === 'admin') {
            roleBadge = `<span class="badge" style="font-size: 0.6rem; padding: 1px 4px; border-radius: 4px; color: #ef4444; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.25);">⚡ Admin</span>`;
        } else if (user.role === 'vigilante') {
            roleBadge = `<span class="badge" style="font-size: 0.6rem; padding: 1px 4px; border-radius: 4px; color: #ff9f43; background: rgba(255,159,67,0.1); border: 1px solid rgba(255,159,67,0.25);">🕵️ Vigilante</span>`;
        } else {
            roleBadge = `<span class="badge" style="font-size: 0.6rem; padding: 1px 4px; border-radius: 4px; color: #38bdf8; background: rgba(56,189,248,0.1); border: 1px solid rgba(56,189,248,0.25);">👤 Citizen</span>`;
        }

        const approvalBadge = (user.approved !== false) ? '' : ' <span style="color: var(--color-warning); font-size: 0.65rem;">(Pending Approval)</span>';

        row.innerHTML = `
            <div class="admin-row-info" style="cursor: pointer;" onclick="openAdminUserEditor('${user.username}')" title="Click to edit user profile settings">
                <span class="admin-row-title">${user.username} ${roleBadge}${approvalBadge}</span>
                <span class="admin-row-subtitle">${user.fullName || 'No profile settings saved'}</span>
            </div>
            <div class="admin-actions-group">
                <button class="btn-admin-edit" title="Edit User Profile" onclick="openAdminUserEditor('${user.username}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                </button>
                ${user.username !== 'admin' ? `
                <button class="btn-admin-delete" title="Delete User" onclick="deleteUser('${user.username}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>` : ''}
            </div>
        `;
        container.appendChild(row);
    });
}

function renderAdminResetRequests(resetsList) {
    const container = document.getElementById('admin-resets-list');
    const countEl = document.getElementById('admin-reset-count');
    
    countEl.textContent = resetsList.length;
    container.innerHTML = '';

    if (resetsList.length === 0) {
        container.innerHTML = '<div class="status-msg">No pending reset requests.</div>';
        return;
    }

    resetsList.forEach(req => {
        const row = document.createElement('div');
        row.className = 'admin-row';
        row.innerHTML = `
            <div class="admin-row-info" style="max-width: 70%;">
                <span class="admin-row-title">${req.username}</span>
                <span class="admin-row-subtitle">Name: <strong>${req.fullName}</strong></span>
                <span class="admin-row-subtitle">Phone: <strong>${req.phone}</strong></span>
                <span class="admin-row-subtitle">New Pass: <strong style="color: var(--color-warning);">${req.newPassword}</strong></span>
            </div>
            <div class="admin-actions-group">
                <button class="btn-admin-approve" title="Approve Request" onclick="approveResetRequest('${req.username}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                </button>
                <button class="btn-admin-delete" title="Reject Request" onclick="rejectResetRequest('${req.username}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
        `;
        container.appendChild(row);
    });
}

async function approveResetRequest(username) {
    if (!confirm(`Are you sure you want to approve the password reset request for user "${username}"?`)) return;

    try {
        const response = await fetch('/api/admin/reset-requests/approve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });
        const data = await response.json();
        if (response.ok && data.success) {
            playAlertBeep(1000, 0.2);
            alert(`Password reset for user "${username}" approved!`);
            loadAdminData();
        } else {
            alert(data.error || "Failed to approve request.");
        }
    } catch (e) {
        console.error("Approve reset error:", e);
    }
}

async function rejectResetRequest(username) {
    if (!confirm(`Are you sure you want to reject and delete the password reset request for user "${username}"?`)) return;

    try {
        const response = await fetch('/api/admin/reset-requests/reject', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });
        const data = await response.json();
        if (response.ok && data.success) {
            playAlertBeep(900, 0.15);
            loadAdminData();
        } else {
            alert(data.error || "Failed to reject request.");
        }
    } catch (e) {
        console.error("Reject reset error:", e);
    }
}

window.approveResetRequest = approveResetRequest;
window.rejectResetRequest = rejectResetRequest;

function renderAdminApprovals(approvalsList) {
    const container = document.getElementById('admin-approvals-list');
    const countEl = document.getElementById('admin-approval-count');
    
    countEl.textContent = approvalsList.length;
    container.innerHTML = '';

    if (approvalsList.length === 0) {
        container.innerHTML = '<div class="status-msg">No pending registrations.</div>';
        return;
    }

    approvalsList.forEach(user => {
        const row = document.createElement('div');
        row.className = 'admin-row';
        
        const roleLabel = user.role === 'vigilante' ? '🕵️ Vigilante' : '👤 Citizen';
        const roleColor = user.role === 'vigilante' ? 'color: #ff9f43; background: rgba(255,159,67,0.1); border: 1px solid rgba(255,159,67,0.25);' : 'color: #38bdf8; background: rgba(56,189,248,0.1); border: 1px solid rgba(56,189,248,0.25);';

        row.innerHTML = `
            <div class="admin-row-info">
                <span class="admin-row-title">${user.username} <span class="badge" style="font-size: 0.6rem; padding: 1px 4px; border-radius: 4px; ${roleColor}">${roleLabel}</span></span>
                <span class="admin-row-subtitle">${user.fullName || 'New registration'}</span>
            </div>
            <div class="admin-actions-group">
                <button class="btn-admin-approve" title="Approve Registration" onclick="approveUser('${user.username}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                </button>
                <button class="btn-admin-delete" title="Reject Registration" onclick="rejectUser('${user.username}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
        `;
        container.appendChild(row);
    });
}

async function approveUser(username) {
    if (!confirm(`Are you sure you want to approve user account "${username}"?`)) return;
    try {
        const res = await fetch('/api/admin/approve-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });
        if (res.ok) {
            playAlertBeep(900, 0.15);
            alert(`User account "${username}" approved successfully!`);
            loadAdminData();
        } else {
            const data = await res.json();
            alert(`Approval failed: ${data.error}`);
        }
    } catch (e) {
        console.error("Approve request error:", e);
    }
}

async function rejectUser(username) {
    if (!confirm(`Are you sure you want to reject and delete user account "${username}"?`)) return;
    try {
        const res = await fetch('/api/admin/reject-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });
        if (res.ok) {
            playAlertBeep(400, 0.15);
            alert(`User account "${username}" rejected and removed.`);
            loadAdminData();
        } else {
            const data = await res.json();
            alert(`Rejection failed: ${data.error}`);
        }
    } catch (e) {
        console.error("Reject request error:", e);
    }
}

window.approveUser = approveUser;
window.rejectUser = rejectUser;

function renderAdminIncidents(incidentsList) {
    const container = document.getElementById('admin-incidents-list');
    const countEl = document.getElementById('admin-incident-count');

    countEl.textContent = incidentsList.length;
    container.innerHTML = '';

    if (incidentsList.length === 0) {
        container.innerHTML = '<div class="status-msg">No active logs reported.</div>';
        return;
    }

    // Sort to show newest first
    const sorted = [...incidentsList].reverse();

    sorted.forEach(incident => {
        const row = document.createElement('div');
        row.className = 'admin-row';
        row.innerHTML = `
            <div class="admin-row-info" style="max-width: 80%;">
                <span class="admin-row-title" style="color: #ef4444; font-size: 0.7rem;">${incident.category.toUpperCase()}</span>
                <span class="admin-row-subtitle" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    ${incident.description}
                </span>
            </div>
            <button class="btn-admin-delete" title="Delete Incident" onclick="deleteIncident('${incident.id}')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </button>
        `;
        container.appendChild(row);
    });
}

async function deleteUser(username) {
    if (!confirm(`Are you sure you want to permanently delete user account "${username}"?`)) return;

    try {
        const response = await fetch(`/api/admin/users/${encodeURIComponent(username)}`, {
            method: 'DELETE'
        });
        const data = await response.json();
        if (response.ok && data.success) {
            playAlertBeep(900, 0.1);
            loadAdminData();
        } else {
            alert(data.error || "Failed to delete user account.");
        }
    } catch (e) {
        console.error("Delete user API request error:", e);
    }
}

async function deleteIncident(id) {
    if (!confirm(`Are you sure you want to permanently delete incident report marker?`)) return;

    try {
        const response = await fetch(`/api/admin/incidents/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
        const data = await response.json();
        if (response.ok && data.success) {
            playAlertBeep(900, 0.1);
            
            // Remove incident from map locally
            incidents = incidents.filter(i => i.id !== id);
            renderMarkers();
            updateFeedList();

            // Refresh admin directory data
            loadAdminData();
        } else {
            alert(data.error || "Failed to delete incident report.");
        }
    } catch (e) {
        console.error("Delete incident API request error:", e);
    }
}

async function triggerManualPurge() {
    try {
        const response = await fetch('/api/admin/purge', {
            method: 'POST'
        });
        const data = await response.json();
        if (response.ok && data.success) {
            playAlertBeep(1000, 0.2);
            alert(`Database maintenance completed successfully! Deleted ${data.prunedCount} old logs.`);
            
            // Reload datasets
            loadIncidents();
            loadAdminData();
        } else {
            alert("Database purge request failed.");
        }
    } catch (e) {
        console.error("Purge API request error:", e);
    }
}

// Bind admin methods to window scope for onclick actions
window.deleteUser = deleteUser;
window.deleteIncident = deleteIncident;

async function openAdminUserEditor(username) {
    try {
        const response = await fetch(`/api/admin/users/${encodeURIComponent(username)}`);
        const data = await response.json();
        if (response.ok) {
            document.getElementById('admin-edit-username').value = data.username;
            document.getElementById('admin-edit-password').value = data.password;
            document.getElementById('admin-edit-fullname').value = data.fullName || '';
            document.getElementById('admin-edit-phone').value = data.phone || '';
            document.getElementById('admin-edit-emergency').value = data.emergencyContact || '';
            document.getElementById('admin-edit-anonymous').checked = data.autoAnonymous !== false;
            document.getElementById('admin-edit-location').value = data.defaultLocation || '';
            
            document.getElementById('admin-user-modal').classList.remove('hidden');
            playAlertBeep(600, 0.1);
        } else {
            alert(data.error || "Failed to load user data.");
        }
    } catch (e) {
        console.error("Failed to load user for edit:", e);
    }
}

async function saveAdminUserEdit() {
    const username = document.getElementById('admin-edit-username').value;
    const password = document.getElementById('admin-edit-password').value;
    const fullName = document.getElementById('admin-edit-fullname').value.trim();
    const phone = document.getElementById('admin-edit-phone').value.trim();
    const emergencyContact = document.getElementById('admin-edit-emergency').value.trim();
    const autoAnonymous = document.getElementById('admin-edit-anonymous').checked;
    const defaultLocation = document.getElementById('admin-edit-location').value.trim();

    try {
        const response = await fetch(`/api/admin/users/${encodeURIComponent(username)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password,
                fullName,
                phone,
                emergencyContact,
                autoAnonymous,
                defaultLocation
            })
        });
        const data = await response.json();
        if (response.ok && data.success) {
            playAlertBeep(1000, 0.2);
            alert("ADHARM VINASH: User settings updated successfully!");
            closeAdminUserEditor();
            loadAdminData(); // Refresh list
        } else {
            alert(data.error || "Failed to save user details.");
        }
    } catch (e) {
        console.error("Failed to save user details:", e);
    }
}

function closeAdminUserEditor() {
    document.getElementById('admin-user-modal').classList.add('hidden');
    playAlertBeep(400, 0.15);
}

// Bind methods to window scope
window.openAdminUserEditor = openAdminUserEditor;

async function submitVote(incidentId, voteType) {
    const activeUser = sessionStorage.getItem('auth_user');
    if (!activeUser) {
        alert("Please log in to verify logs.");
        return;
    }
    
    try {
        const response = await fetch(`/api/incidents/${incidentId}/vote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ voteType, username: activeUser })
        });
        const data = await response.json();
        if (response.ok) {
            playAlertBeep(800, 0.08);
            
            // Update incident in local list
            const idx = incidents.findIndex(i => i.id === incidentId);
            if (idx !== -1) {
                incidents[idx].upvotes = data.upvotes;
                incidents[idx].downvotes = data.downvotes;
                incidents[idx].votes = data.votes;
            }
            
            // Re-render markers and update feed list
            renderMarkers();
            updateFeedList();
            
            // Re-open updated popup
            const entity = viewer.entities.getById(incidentId);
            if (entity) {
                openCesiumPopup(entity);
            }
        } else {
            alert(data.error || "Failed to submit verification.");
        }
    } catch (e) {
        console.error("Vote API failed:", e);
    }
}
window.submitVote = submitVote;

// Bind event listeners for admin edit user modal controls
document.addEventListener('DOMContentLoaded', () => {
    const editForm = document.getElementById('admin-user-edit-form');
    if (editForm) {
        editForm.addEventListener('submit', (e) => {
            e.preventDefault();
            saveAdminUserEdit();
        });
    }

    const editCancelBtn = document.getElementById('btn-admin-edit-cancel');
    if (editCancelBtn) {
        editCancelBtn.addEventListener('click', () => {
            closeAdminUserEditor();
        });
    }
});

// Admin Create User modal handlers
function openAdminCreateUserModal() {
    const modal = document.getElementById('admin-create-user-modal');
    const form = document.getElementById('admin-create-user-form');
    const errorMsg = document.getElementById('admin-create-error');
    if (form) form.reset();
    if (errorMsg) errorMsg.classList.add('hidden');
    if (modal) modal.classList.remove('hidden');
    playAlertBeep(600, 0.1);
}

function closeAdminCreateUserModal() {
    const modal = document.getElementById('admin-create-user-modal');
    if (modal) modal.classList.add('hidden');
    playAlertBeep(400, 0.1);
}

async function handleAdminCreateUserSubmit() {
    const username = document.getElementById('admin-create-username').value.trim();
    const password = document.getElementById('admin-create-password').value;
    const fullName = document.getElementById('admin-create-fullname').value.trim();
    const phone = document.getElementById('admin-create-phone').value.trim();
    const emergencyContact = document.getElementById('admin-create-emergency').value.trim();
    const autoAnonymous = document.getElementById('admin-create-anonymous').checked;
    const defaultLocation = document.getElementById('admin-create-location').value.trim();

    const errorMsg = document.getElementById('admin-create-error');
    errorMsg.classList.add('hidden');

    try {
        const response = await fetch('/api/admin/users/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username,
                password,
                fullName,
                phone,
                emergencyContact,
                autoAnonymous,
                defaultLocation
            })
        });

        const data = await response.json();
        if (response.ok && data.success) {
            playAlertBeep(1000, 0.2);
            alert(`Citizen "${username}" registered successfully!`);
            closeAdminCreateUserModal();
            loadAdminData();
        } else {
            errorMsg.textContent = data.error || "Username already exists";
            errorMsg.classList.remove('hidden');
            playAlertBeep(300, 0.2);
        }
    } catch (err) {
        console.error("Admin user creation failed:", err);
        errorMsg.textContent = "Server communication error";
        errorMsg.classList.remove('hidden');
        playAlertBeep(300, 0.2);
    }
}

// Bind event listeners for admin edit/create user modal controls
document.addEventListener('DOMContentLoaded', () => {
    const editForm = document.getElementById('admin-user-edit-form');
    if (editForm) {
        editForm.addEventListener('submit', (e) => {
            e.preventDefault();
            saveAdminUserEdit();
        });
    }

    const editCancelBtn = document.getElementById('btn-admin-edit-cancel');
    if (editCancelBtn) {
        editCancelBtn.addEventListener('click', () => {
            closeAdminUserEditor();
        });
    }

    // Admin Create User bindings
    const addCitizenBtn = document.getElementById('btn-admin-add-citizen');
    if (addCitizenBtn) {
        addCitizenBtn.addEventListener('click', () => {
            openAdminCreateUserModal();
        });
    }

    const createForm = document.getElementById('admin-create-user-form');
    if (createForm) {
        createForm.addEventListener('submit', (e) => {
            e.preventDefault();
            handleAdminCreateUserSubmit();
        });
    }

    const createCancelBtn = document.getElementById('btn-admin-create-cancel');
    if (createCancelBtn) {
        createCancelBtn.addEventListener('click', () => {
            closeAdminCreateUserModal();
        });
    }
});
