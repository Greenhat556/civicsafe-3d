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

// User Geolocation tracking variables
let isTrackingLocation = false;
let watchPositionId = null;
let hasLocatedOnce = false;

// Navigation system variables
let isNavigating = false;
let navigationRouteEntities = [];

// --- LIVE TOPOGRAPHIC CANVAS ANIMATION SYSTEM ---
let isLoginCanvasRunning = false;
let loginCanvasAnimationFrameId = null;

// Fast 2D Perlin Noise Generator
const PERM = new Uint8Array([
    151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,
    23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,
    174,20,125,136,171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,
    133,230,220,105,92,41,55,46,245,40,244,102,143,54,65,25,63,161, 1,216,80,73,209,76,132,187,208,
    89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186, 3,64,52,217,226,250,124,123,
    5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,119,
    248,152, 2,44,154,163, 70,221,153,101,155,167, 43,172,9,129,22,39,253, 19,98,108,110,79,113,224,
    232,178,185, 112,104,218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241, 81,51,145,235,
    249,14,239,107,49,192,214, 31,181,199,106,157,184, 84,204,176,115,121,50,45,127, 4,150,254,138,
    236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180
]);
const perm = new Uint8Array(512);
for (let i = 0; i < 512; i++) {
    perm[i] = PERM[i & 255];
}

const perlinGrads = [
    {x:1, y:1}, {x:-1, y:1}, {x:1, y:-1}, {x:-1, y:-1},
    {x:1, y:0}, {x:-1, y:0}, {x:0, y:1}, {x:0, y:-1}
];

function perlinNoise2D(x, y) {
    let X = Math.floor(x) & 255;
    let Y = Math.floor(y) & 255;
    
    let xf = x - Math.floor(x);
    let yf = y - Math.floor(y);
    
    // Fade curves
    let u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    let v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    
    let gi00 = perm[X + perm[Y]] % perlinGrads.length;
    let gi10 = perm[X + 1 + perm[Y]] % perlinGrads.length;
    let gi01 = perm[X + perm[Y + 1]] % perlinGrads.length;
    let gi11 = perm[X + 1 + perm[Y + 1]] % perlinGrads.length;
    
    let n00 = perlinGrads[gi00].x * xf + perlinGrads[gi00].y * yf;
    let n10 = perlinGrads[gi10].x * (xf - 1) + perlinGrads[gi10].y * yf;
    let n01 = perlinGrads[gi01].x * xf + perlinGrads[gi01].y * (yf - 1);
    let n11 = perlinGrads[gi11].x * (xf - 1) + perlinGrads[gi11].y * (yf - 1);
    
    let x0 = n00 + (n10 - n00) * u;
    let x1 = n01 + (n11 - n01) * u;
    
    return x0 + (x1 - x0) * v;
}

// Grid dimensions for sampling noise
const GRID_COLS = 55;
const GRID_ROWS = 35;
const gridValues = Array.from({ length: GRID_ROWS }, () => new Float32Array(GRID_COLS));

// Marching Squares Case Lookup Table
// Connects edges for each 4-bit corner code: TL TR BR BL
// midpoints: top, right, bottom, left
const MARCHING_CASES = {
    0: [],
    1: [['left', 'bottom']],
    2: [['bottom', 'right']],
    3: [['left', 'right']],
    4: [['top', 'right']],
    5: [['left', 'top'], ['bottom', 'right']],
    6: [['top', 'bottom']],
    7: [['left', 'top']],
    8: [['left', 'top']],
    9: [['top', 'bottom']],
    10: [['left', 'bottom'], ['top', 'right']],
    11: [['top', 'right']],
    12: [['left', 'right']],
    13: [['bottom', 'right']],
    14: [['left', 'bottom']],
    15: []
};

// Contour levels between 0.15 and 0.85
const CONTOUR_LEVELS = [0.16, 0.22, 0.28, 0.34, 0.40, 0.46, 0.52, 0.58, 0.64, 0.70, 0.76, 0.82];

function drawLoginTopography() {
    if (!isLoginCanvasRunning) return;
    
    const canvas = document.getElementById('login-canvas');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    ctx.clearRect(0, 0, width, height);
    
    // Fill background solid midnight black
    ctx.fillStyle = '#050811';
    ctx.fillRect(0, 0, width, height);
    
    const time = Date.now() * 0.00015;
    
    // 1. Populate Perlin noise field on grid
    for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
            // Frequency scales for organic contour warping
            const nx = c * 0.07;
            const ny = r * 0.07;
            const nt = time;
            
            // Add octaves/harmonics for a richer, more detailed topographic loop look
            const val1 = perlinNoise2D(nx, ny - nt);
            const val2 = perlinNoise2D(nx * 2 + nt, ny * 2) * 0.4;
            
            // Scale total noise to 0..1 range
            gridValues[r][c] = (val1 + val2) * 0.38 + 0.5;
        }
    }
    
    // 2. Marching Squares grid scan
    const stepX = width / (GRID_COLS - 1);
    const stepY = height / (GRID_ROWS - 1);
    
    ctx.beginPath();
    // Beautiful subtle semi-transparent white lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.085)';
    ctx.lineWidth = 1.2;
    
    for (let r = 0; r < GRID_ROWS - 1; r++) {
        for (let c = 0; c < GRID_COLS - 1; c++) {
            const valTL = gridValues[r][c];
            const valTR = gridValues[r][c + 1];
            const valBR = gridValues[r + 1][c + 1];
            const valBL = gridValues[r + 1][c];
            
            const x = c * stepX;
            const y = r * stepY;
            
            CONTOUR_LEVELS.forEach(iso => {
                let code = 0;
                if (valTL >= iso) code |= 8;
                if (valTR >= iso) code |= 4;
                if (valBR >= iso) code |= 2;
                if (valBL >= iso) code |= 1;
                
                if (code === 0 || code === 15) return;
                
                // Linear interpolation (lerp) for smooth crossings
                const t_top = (iso - valTL) / (valTR - valTL || 1e-5);
                const p_top = { x: x + stepX * Math.min(Math.max(t_top, 0), 1), y: y };
                
                const t_right = (iso - valTR) / (valBR - valTR || 1e-5);
                const p_right = { x: x + stepX, y: y + stepY * Math.min(Math.max(t_right, 0), 1) };
                
                const t_bottom = (iso - valBL) / (valBR - valBL || 1e-5);
                const p_bottom = { x: x + stepX * Math.min(Math.max(t_bottom, 0), 1), y: y + stepY };
                
                const t_left = (iso - valTL) / (valBL - valTL || 1e-5);
                const p_left = { x: x, y: y + stepY * Math.min(Math.max(t_left, 0), 1) };
                
                const points = { top: p_top, right: p_right, bottom: p_bottom, left: p_left };
                
                const edges = MARCHING_CASES[code];
                edges.forEach(edge => {
                    const p1 = points[edge[0]];
                    const p2 = points[edge[1]];
                    ctx.moveTo(p1.x, p1.y);
                    ctx.lineTo(p2.x, p2.y);
                });
            });
        }
    }
    ctx.stroke();
    
    loginCanvasAnimationFrameId = requestAnimationFrame(drawLoginTopography);
}

function startLoginCanvas() {
    const canvas = document.getElementById('login-canvas');
    if (!canvas) return;
    
    isLoginCanvasRunning = true;
    
    // Setup dimensions
    const resize = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resize);
    resize();
    
    drawLoginTopography();
}

function stopLoginCanvas() {
    isLoginCanvasRunning = false;
    if (loginCanvasAnimationFrameId) {
        cancelAnimationFrame(loginCanvasAnimationFrameId);
        loginCanvasAnimationFrameId = null;
    }
}

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

function checkAuthSession(animate = false) {
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
        if (animate) {
            // Smooth slide up reveal transition
            loginScreen.classList.add('slide-up');
            
            // Instantly reveal main UI behind it so it's loaded as the screen slides up
            mainSidebar.classList.remove('hidden');
            searchBar.classList.remove('hidden');
            themeBtn.classList.remove('hidden');
            hudCoords.classList.remove('hidden');
            routeContainer.classList.remove('hidden');
            if (sosContainer) sosContainer.classList.remove('hidden');
            if (burgerMenu) burgerMenu.classList.remove('hidden');
            
            setTimeout(() => {
                loginScreen.classList.add('hidden');
                loginScreen.classList.remove('slide-up');
                stopLoginCanvas();
            }, 1200);
        } else {
            loginScreen.classList.add('hidden');
            loginScreen.classList.remove('slide-up');
            stopLoginCanvas();
            
            mainSidebar.classList.remove('hidden');
            searchBar.classList.remove('hidden');
            themeBtn.classList.remove('hidden');
            hudCoords.classList.remove('hidden');
            routeContainer.classList.remove('hidden');
            if (sosContainer) sosContainer.classList.remove('hidden');
            if (burgerMenu) burgerMenu.classList.remove('hidden');
        }
        
        document.getElementById('logged-user-name').textContent = activeUser;
        
        // Connect to SSE stream for live notifications
        if (!notificationEventSource) {
            startSSEConnection();
        }
        
        // Apply role specific details
        const terminalToggle = document.getElementById('btn-terminal-toggle');
        const floatingTerminal = document.getElementById('floating-admin-terminal');

        if (activeUser === 'admin') {
            document.body.classList.remove('vigilante-mode');
            if (subtitleEl) subtitleEl.innerHTML = '<span style="color: #ef4444; font-weight: bold;">⚡ Admin Control Center</span>';
            if (adminTabLink) adminTabLink.classList.remove('hidden');
            if (terminalToggle) {
                terminalToggle.classList.remove('hidden');
                terminalToggle.classList.add('active');
            }
            if (floatingTerminal) floatingTerminal.classList.remove('hidden');
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
            if (terminalToggle) {
                terminalToggle.classList.add('hidden');
                terminalToggle.classList.remove('active');
            }
            if (floatingTerminal) floatingTerminal.classList.add('hidden');
            
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
            if (terminalToggle) {
                terminalToggle.classList.add('hidden');
                terminalToggle.classList.remove('active');
            }
            if (floatingTerminal) floatingTerminal.classList.add('hidden');
            
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
        loginScreen.classList.remove('slide-up');
        startLoginCanvas();
        
        mainSidebar.classList.add('hidden');
        searchBar.classList.add('hidden');
        themeBtn.classList.add('hidden');
        hudCoords.classList.add('hidden');
        routeContainer.classList.add('hidden');
        if (sosContainer) sosContainer.classList.add('hidden');
        if (adminTabLink) adminTabLink.classList.add('hidden');
        if (burgerMenu) burgerMenu.classList.add('hidden');
        
        const terminalToggle = document.getElementById('btn-terminal-toggle');
        const floatingTerminal = document.getElementById('floating-admin-terminal');
        if (terminalToggle) {
            terminalToggle.classList.add('hidden');
            terminalToggle.classList.remove('active');
        }
        if (floatingTerminal) floatingTerminal.classList.add('hidden');
        
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
            if (data.type === 'broadcast') {
                showGlobalBroadcastNotification(data.message);
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

function showGlobalBroadcastNotification(message) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    
    const toast = document.createElement('div');
    toast.className = 'notification-toast broadcast-toast';
    toast.style.borderColor = 'var(--color-primary)';
    toast.style.background = 'rgba(10, 15, 28, 0.95)';
    toast.style.boxShadow = '0 0 15px rgba(16, 185, 129, 0.4)';
    
    toast.innerHTML = `
        <div class="notification-toast-header" style="border-bottom: 1px solid rgba(16, 185, 129, 0.2); padding-bottom: 6px;">
            <div class="notification-toast-title" style="color: #10b981; font-weight: bold; text-shadow: 0 0 8px rgba(16, 185, 129, 0.5); font-family: monospace; font-size: 0.85rem;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="animation: alert-flash 0.5s infinite alternate;">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="2" y1="12" x2="22" y2="12"/>
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                </svg>
                🌐 SYSTEM BROADCAST
            </div>
            <button class="notification-toast-close" style="color: #10b981; border: none; background: transparent; cursor: pointer; font-size: 1.2rem;">&times;</button>
        </div>
        <div class="notification-toast-body" style="font-family: monospace; font-size: 0.82rem; color: #e2e8f0; padding-top: 8px; line-height: 1.4; text-align: left;">
            ${message}
        </div>
    `;
    
    const closeBtn = toast.querySelector('.notification-toast-close');
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
    
    // Play distinctive dual cyber beep sounds
    playAlertBeep(600, 0.1);
    setTimeout(() => {
        playAlertBeep(800, 0.1);
    }, 100);
    setTimeout(() => {
        playAlertBeep(1000, 0.12);
    }, 200);
    
    setTimeout(() => {
        dismissToast();
    }, 12000);
    
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

    // High-DPI and high quality configurations for visual clarity
    viewer.resolutionScale = window.devicePixelRatio || 1.0;
    viewer.scene.globe.maximumScreenSpaceError = 1.5;

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
    
    const activeRole = sessionStorage.getItem('auth_role') || 'citizen';
    let navButtonHtml = '';
    if (activeRole === 'vigilante') {
        navButtonHtml = `
            <div style="border-top: 1px solid var(--border-color); padding-top: 8px; margin-top: 8px;">
                <button onclick="startNavigationToIncident('${entityId}')" class="btn-action-primary" style="width: 100%; font-size: 0.72rem; padding: 6px; display: flex; align-items: center; justify-content: center; gap: 4px; margin: 0; cursor: pointer; border-radius: 6px;">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="transform: rotate(45deg);">
                        <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
                    </svg>
                    <span>Navigate to Site</span>
                </button>
            </div>
        `;
    }

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
            ${navButtonHtml}
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
                checkAuthSession(true);
                playAlertBeep(1000, 0.15);
            }
        } catch (err) {
            authErrorMsg.textContent = err.message;
            authErrorMsg.classList.remove('hidden');
            playAlertBeep(300, 0.2);
        }
    });

    document.getElementById('btn-logout').addEventListener('click', () => {
        sessionStorage.removeItem('auth_user');
        sessionStorage.removeItem('auth_role');
        
        // Clear active geolocation watch on logout
        if (watchPositionId !== null) {
            navigator.geolocation.clearWatch(watchPositionId);
            watchPositionId = null;
        }
        isTrackingLocation = false;
        hasLocatedOnce = false;
        
        const gpsLocateBtn = document.getElementById('btn-gps-locate');
        if (gpsLocateBtn) {
            gpsLocateBtn.classList.remove('gps-tracking');
        }
        
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

    // GPS locate and tracking bindings
    const gpsLocateBtn = document.getElementById('btn-gps-locate');
    if (gpsLocateBtn) {
        gpsLocateBtn.addEventListener('click', () => {
            toggleLocationTracking(gpsLocateBtn);
        });
    }

    // Stop navigation button binding
    const stopNavBtn = document.getElementById('btn-stop-navigation');
    if (stopNavBtn) {
        stopNavBtn.addEventListener('click', () => {
            stopNavigation();
        });
    }

    // Expose navigation methods globally for inline event handlers
    window.startNavigationToIncident = startNavigationToIncident;
    window.stopNavigation = stopNavigation;

    // 3D Globe / 2D Map mode toggle
    const mapModeBtn = document.getElementById('btn-map-mode');
    if (mapModeBtn) {
        mapModeBtn.addEventListener('click', () => {
            if (!viewer) return;
            const globe3dIcon = document.getElementById('icon-globe-3d');
            const flat2dIcon = document.getElementById('icon-flat-2d');

            if (viewer.scene.mode === Cesium.SceneMode.SCENE3D) {
                viewer.scene.morphTo2D(1.5);
                if (globe3dIcon) globe3dIcon.classList.add('hidden');
                if (flat2dIcon) flat2dIcon.classList.remove('hidden');
                mapModeBtn.title = 'Switch to 3D Globe';
            } else {
                viewer.scene.morphTo3D(1.5);
                if (flat2dIcon) flat2dIcon.classList.add('hidden');
                if (globe3dIcon) globe3dIcon.classList.remove('hidden');
                mapModeBtn.title = 'Switch to 2D Map';
            }
            playAlertBeep(800, 0.08);
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
// GEOLOCATION GPS AND LOCATION TRACKING
// ----------------------------------------------------
function toggleLocationTracking(btn) {
    if (isTrackingLocation) {
        // Turn off tracking
        if (watchPositionId !== null) {
            navigator.geolocation.clearWatch(watchPositionId);
            watchPositionId = null;
        }
        
        // Remove location entities
        if (viewer) {
            viewer.entities.removeById('user-location-marker');
            viewer.entities.removeById('user-location-accuracy');
        }
        
        btn.classList.remove('gps-tracking');
        isTrackingLocation = false;
        hasLocatedOnce = false;
        
        showGPSToast("GPS Status", "Location tracking deactivated.");
        playAlertBeep(400, 0.15); // low tone
    } else {
        // Turn on tracking
        if (!navigator.geolocation) {
            alert("Geolocation is not supported by your browser.");
            return;
        }
        
        btn.classList.add('gps-tracking');
        isTrackingLocation = true;
        hasLocatedOnce = false;
        
        playAlertBeep(900, 0.1); // high alert tone
        
        showGPSToast("GPS Status", "Acquiring satellite signal...");
        
        watchPositionId = navigator.geolocation.watchPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                const accuracy = position.coords.accuracy || 10.0;
                
                updateUserLocationOnMap(lat, lng, accuracy);
            },
            (error) => {
                console.error("Geolocation tracking error:", error);
                
                // Reset tracking state in case of failure
                if (watchPositionId !== null) {
                    navigator.geolocation.clearWatch(watchPositionId);
                    watchPositionId = null;
                }
                
                if (viewer) {
                    viewer.entities.removeById('user-location-marker');
                    viewer.entities.removeById('user-location-accuracy');
                }
                
                btn.classList.remove('gps-tracking');
                isTrackingLocation = false;
                hasLocatedOnce = false;
                
                let errorMsg = "Unable to retrieve your location.";
                if (error.code === error.PERMISSION_DENIED) {
                    errorMsg = "Location access denied. Please grant GPS permission.";
                } else if (error.code === error.POSITION_UNAVAILABLE) {
                    errorMsg = "Position unavailable. Verify network/GPS connection.";
                } else if (error.code === error.TIMEOUT) {
                    errorMsg = "GPS connection timed out.";
                }
                
                alert(errorMsg);
                playAlertBeep(300, 0.25);
            },
            {
                enableHighAccuracy: true,
                maximumAge: 1000,
                timeout: 10000
            }
        );
    }
}

function updateUserLocationOnMap(lat, lng, accuracy) {
    if (!viewer) return;
    
    const activeRole = sessionStorage.getItem('auth_role');
    const colorHex = (activeRole === 'vigilante') ? '#10b981' : '#38bdf8'; // green for vigilante, blue/cyan for citizen
    const markerColor = Cesium.Color.fromCssColorString(colorHex);
    
    const position = Cesium.Cartesian3.fromDegrees(lng, lat, 0.0);
    
    // 1. Update/Create point marker
    const existingMarker = viewer.entities.getById('user-location-marker');
    if (existingMarker) {
        existingMarker.position = position;
        existingMarker.point.color = markerColor;
    } else {
        viewer.entities.add({
            id: 'user-location-marker',
            position: position,
            point: {
                pixelSize: 16,
                color: markerColor,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 3,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY // Always render on top
            },
            properties: {
                title: "My Location"
            }
        });
    }
    
    // 2. Update/Create accuracy ellipse
    const existingAccuracy = viewer.entities.getById('user-location-accuracy');
    if (existingAccuracy) {
        existingAccuracy.position = position;
        existingAccuracy.ellipse.semiMajorAxis = accuracy;
        existingAccuracy.ellipse.semiMinorAxis = accuracy;
        existingAccuracy.ellipse.outlineColor = markerColor.withAlpha(0.5);
        existingAccuracy.ellipse.material = markerColor.withAlpha(0.12);
    } else {
        viewer.entities.add({
            id: 'user-location-accuracy',
            position: position,
            ellipse: {
                semiMajorAxis: accuracy,
                semiMinorAxis: accuracy,
                material: markerColor.withAlpha(0.12),
                outline: true,
                outlineColor: markerColor.withAlpha(0.5),
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
            }
        });
    }
    
    // 3. Zoom/Fly to location on first lock
    if (!hasLocatedOnce) {
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(lng, lat, 1500.0), // Zoom in to 1.5km
            duration: 2.0
        });
        hasLocatedOnce = true;
        
        showGPSToast("GPS Status", "Location signal locked.");
    }
    
    // 4. Update HUD coordinates locator display dynamically
    const coordsEl = document.getElementById('hud-coords-value');
    if (coordsEl) {
        coordsEl.textContent = `${lat.toFixed(4)}° N, ${lng.toFixed(4)}° E (GPS)`;
    }
}

function showGPSToast(title, description) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    
    const toast = document.createElement('div');
    toast.className = 'notification-toast';
    
    const activeRole = sessionStorage.getItem('auth_role');
    const color = (activeRole === 'vigilante') ? '#10b981' : '#38bdf8';
    
    toast.style.borderColor = `${color}44`;
    
    toast.innerHTML = `
        <div class="notification-toast-header">
            <div class="notification-toast-title" style="color: ${color};">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="animation: alert-flash 1s infinite alternate;">
                    <circle cx="12" cy="12" r="10"/>
                    <circle cx="12" cy="12" r="3"/>
                </svg>
                ${title}
            </div>
            <button class="notification-toast-close">&times;</button>
        </div>
        <div class="notification-toast-body">
            ${description}
        </div>
    `;
    
    const closeBtn = toast.querySelector('.notification-toast-close');
    
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
    
    setTimeout(() => {
        dismissToast();
    }, 4000);
    
    container.appendChild(toast);
}

// ----------------------------------------------------
// GOOGLE MAPS STYLE NAVIGATION SYSTEM FOR VIGILANTES
// ----------------------------------------------------
function startNavigationToIncident(entityId) {
    if (!viewer) return;
    
    // Find incident coordinates
    const incident = incidents.find(item => item.id === entityId);
    if (!incident) {
        // Fallback: check if we can get it from entity position
        const entity = viewer.entities.getById(entityId);
        if (entity && entity.position) {
            const pos = entity.position.getValue(viewer.clock.currentTime);
            const cartographic = Cesium.Cartographic.fromCartesian(pos);
            const lat = Cesium.Math.toDegrees(cartographic.latitude);
            const lng = Cesium.Math.toDegrees(cartographic.longitude);
            initiateNavigation(lat, lng, entityId);
        } else {
            alert("Unable to locate incident coordinates.");
        }
    } else {
        initiateNavigation(incident.lat, incident.lng, incident.id);
    }
    
    closeCesiumPopup();
}

function stopNavigation() {
    navigationRouteEntities.forEach(ent => viewer.entities.remove(ent));
    navigationRouteEntities = [];
    isNavigating = false;
    
    const navPanel = document.getElementById('navigation-directions-panel');
    if (navPanel) navPanel.classList.add('hidden');
    document.body.classList.remove('nav-active');
    
    playAlertBeep(400, 0.15);
}

function initiateNavigation(destLat, destLng, destId) {
    // 1. Clear any existing navigation route
    stopNavigation();
    
    // 2. Determine start location (GPS coordinates or profile fallback)
    let startLat = DEFAULT_CENTER_DEG[0];
    let startLng = DEFAULT_CENTER_DEG[1];
    
    // Check if tracking is active
    if (isTrackingLocation) {
        const marker = viewer.entities.getById('user-location-marker');
        if (marker && marker.position) {
            const pos = marker.position.getValue(viewer.clock.currentTime);
            const cartographic = Cesium.Cartographic.fromCartesian(pos);
            startLat = Cesium.Math.toDegrees(cartographic.latitude);
            startLng = Cesium.Math.toDegrees(cartographic.longitude);
        }
    } else {
        // Fallback: check profile settings defaultLocation
        const savedProfile = localStorage.getItem(`profile_${sessionStorage.getItem('auth_user')}`);
        if (savedProfile) {
            try {
                const profile = JSON.parse(savedProfile);
                if (profile.defaultLocation) {
                    const parts = profile.defaultLocation.split(',');
                    if (parts.length === 2) {
                        startLat = parseFloat(parts[0]);
                        startLng = parseFloat(parts[1]);
                    }
                }
            } catch (e) {
                console.error("Profile load error during routing:", e);
            }
        }
    }
    
    // 3. Generate route positions
    const routePositions = generateMockNavigationRoute(startLat, startLng, destLat, destLng);
    
    // 4. Draw route polyline (neon green for vigilante theme, cyan/blue for citizen)
    const activeRole = sessionStorage.getItem('auth_role');
    const colorHex = (activeRole === 'vigilante') ? '#10b981' : '#38bdf8';
    
    const routeLine = viewer.entities.add({
        id: `nav-route-${destId}`,
        polyline: {
            positions: routePositions,
            width: 5.0,
            material: new Cesium.PolylineGlowMaterialProperty({
                glowPower: 0.25,
                color: Cesium.Color.fromCssColorString(colorHex)
            }),
            clampToGround: true
        }
    });
    navigationRouteEntities.push(routeLine);
    
    // 5. Generate and render turn directions
    const guidance = generateNavigationDirections(startLat, startLng, destLat, destLng);
    
    document.getElementById('nav-distance').textContent = guidance.distance;
    document.getElementById('nav-duration').textContent = guidance.duration;
    
    const stepsList = document.getElementById('nav-steps-list');
    stepsList.innerHTML = '';
    
    guidance.steps.forEach((stepText, idx) => {
        const stepDiv = document.createElement('div');
        stepDiv.className = 'nav-step-item';
        stepDiv.innerHTML = `
            <span class="nav-step-number">${idx + 1}</span>
            <span class="nav-step-text">${stepText}</span>
        `;
        stepsList.appendChild(stepDiv);
    });
    
    // 6. Reveal navigation panel
    const navPanel = document.getElementById('navigation-directions-panel');
    if (navPanel) navPanel.classList.remove('hidden');
    document.body.classList.add('nav-active');
    
    isNavigating = true;
    playAlertBeep(880, 0.12);
    playAlertBeep(1100, 0.12);
    
    // Collapse mobile sidebar
    const mainSidebar = document.getElementById('main-sidebar');
    if (mainSidebar) mainSidebar.classList.remove('sidebar-open');
    
    // 7. Fly camera to view the entire route
    const midpointLat = startLat + (destLat - startLat) * 0.5;
    const midpointLng = startLng + (destLng - startLng) * 0.5;
    const distanceKm = Math.sqrt(Math.pow(destLat - startLat, 2) + Math.pow(destLng - startLng, 2)) * 111.0;
    const cameraHeight = Math.max(distanceKm * 1000.0 * 1.5, 1200.0); // height proportional to distance
    
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(midpointLng, midpointLat, cameraHeight),
        duration: 2.0
    });
}

function generateMockNavigationRoute(startLat, startLng, endLat, endLng) {
    // Generates a mock grid street route between start and end coordinates
    const points = [];
    points.push(Cesium.Cartesian3.fromDegrees(startLng, startLat, 10.0));
    
    // Add intermediate points to simulate turning corners on streets
    const midLat = startLat + (endLat - startLat) * 0.4;
    const midLng = startLng + (endLng - startLng) * 0.6;
    
    points.push(Cesium.Cartesian3.fromDegrees(midLng, startLat, 10.0)); // corner 1
    points.push(Cesium.Cartesian3.fromDegrees(midLng, midLat, 10.0));  // corner 2
    points.push(Cesium.Cartesian3.fromDegrees(endLng, midLat, 10.0));  // corner 3
    
    points.push(Cesium.Cartesian3.fromDegrees(endLng, endLat, 10.0));
    return points;
}

function generateNavigationDirections(startLat, startLng, endLat, endLng) {
    const latDiff = endLat - startLat;
    const lngDiff = endLng - startLng;
    
    // Calculate mock distance (1 degree is approx 111km)
    const distanceKm = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 111.0;
    const timeMins = Math.round(distanceKm * 2.5 + 1); // Mock 2.5 minutes per km + 1 min buffer
    
    const steps = [];
    
    // Step 1: Initial heading
    if (latDiff > 0) {
        steps.push(`Head North toward the nearest street intersection. (${(distanceKm * 0.2).toFixed(1)} km)`);
    } else {
        steps.push(`Head South toward the nearest street intersection. (${(distanceKm * 0.2).toFixed(1)} km)`);
    }
    
    // Step 2: First turn
    if (lngDiff > 0) {
        steps.push(`Turn right at the intersection onto East avenue. (${(distanceKm * 0.4).toFixed(1)} km)`);
    } else {
        steps.push(`Turn left at the intersection onto West avenue. (${(distanceKm * 0.4).toFixed(1)} km)`);
    }
    
    // Step 3: Second turn
    if (latDiff > 0) {
        steps.push(`Turn left onto North Boulevard. (${(distanceKm * 0.3).toFixed(1)} km)`);
    } else {
        steps.push(`Turn right onto South Boulevard. (${(distanceKm * 0.3).toFixed(1)} km)`);
    }
    
    // Step 4: Arrival
    steps.push("Arrive at the incident coordinates. Use caution on site.");
    
    return {
        distance: distanceKm < 1.0 ? `${Math.round(distanceKm * 1000)} m` : `${distanceKm.toFixed(1)} km`,
        duration: `${timeMins} min${timeMins > 1 ? 's' : ''}`,
        steps: steps
    };
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
    const role = document.getElementById('admin-create-role').value;
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
                role,
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
            alert(`User "${username}" registered successfully with role "${role}"!`);
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

    // Initialize Admin Command Console
    initTerminal();
});

/* ====================================================
   ADMIN COMMAND CONSOLE (TERMINAL) IMPLEMENTATION
   ==================================================== */
let terminalHistory = [];
let terminalHistoryIndex = -1;

function initTerminal() {
    const input = document.getElementById('terminal-input');
    const output = document.getElementById('terminal-output');
    if (!input || !output) return;

    input.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            const command = input.value.trim();
            input.value = '';
            if (!command) return;

            terminalHistory.push(command);
            terminalHistoryIndex = terminalHistory.length;

            appendTerminalOutput(`admin@civicsafe:~$ ${command}`, 'prompt');
            await processTerminalCommand(command);
            output.scrollTop = output.scrollHeight;
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (terminalHistory.length > 0 && terminalHistoryIndex > 0) {
                terminalHistoryIndex--;
                input.value = terminalHistory[terminalHistoryIndex];
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (terminalHistoryIndex < terminalHistory.length - 1) {
                terminalHistoryIndex++;
                input.value = terminalHistory[terminalHistoryIndex];
            } else {
                terminalHistoryIndex = terminalHistory.length;
                input.value = '';
            }
        }
    });

    const terminalBox = document.getElementById('admin-terminal');
    if (terminalBox) {
        terminalBox.addEventListener('click', () => {
            input.focus();
        });
    }

    const toggleBtn = document.getElementById('btn-terminal-toggle');
    const floatingPanel = document.getElementById('floating-admin-terminal');
    const minimizeBtn = document.getElementById('btn-terminal-minimize');

    if (toggleBtn && floatingPanel) {
        toggleBtn.addEventListener('click', () => {
            const isHidden = floatingPanel.classList.toggle('hidden');
            if (isHidden) {
                toggleBtn.classList.remove('active');
            } else {
                toggleBtn.classList.add('active');
                input.focus();
            }
            playAlertBeep(700, 0.05);
        });
    }

    if (minimizeBtn && floatingPanel && toggleBtn) {
        minimizeBtn.addEventListener('click', () => {
            floatingPanel.classList.add('hidden');
            toggleBtn.classList.remove('active');
            playAlertBeep(500, 0.05);
        });
    }
}

function appendTerminalOutput(text, type = 'normal') {
    const output = document.getElementById('terminal-output');
    if (!output) return;
    const div = document.createElement('div');
    div.className = `terminal-line-${type}`;
    
    if (type === 'pre') {
        div.style.whiteSpace = 'pre';
        div.style.fontFamily = 'monospace';
        div.textContent = text;
    } else {
        div.textContent = text;
    }
    
    output.appendChild(div);
    output.scrollTop = output.scrollHeight;
}

async function processTerminalCommand(cmdString) {
    const parts = cmdString.match(/"[^"]+"|[^\s]+/g) || [];
    if (parts.length === 0) return;
    
    const args = parts.map(arg => arg.replace(/^"|"$/g, ''));
    const command = args[0].toLowerCase();
    
    switch (command) {
        case 'help':
            printTerminalHelp();
            break;
        case 'clear':
            const output = document.getElementById('terminal-output');
            if (output) output.innerHTML = '';
            break;
        case 'motd':
            printTerminalMotd();
            break;
        case 'status':
            await printTerminalStatus();
            break;
        case 'users':
            await printTerminalUsers();
            break;
        case 'incidents':
            await printTerminalIncidents();
            break;
        case 'approvals':
            await printTerminalApprovals();
            break;
        case 'resets':
            await printTerminalResets();
            break;
        case 'add':
            await handleTerminalAdd(args.slice(1));
            break;
        case 'delete':
            await handleTerminalDelete(args.slice(1));
            break;
        case 'approve':
            await handleTerminalApprove(args.slice(1));
            break;
        case 'reject':
            await handleTerminalReject(args.slice(1));
            break;
        case 'approve-reset':
            await handleTerminalApproveReset(args.slice(1));
            break;
        case 'purge':
            await handleTerminalPurge();
            break;
        case 'broadcast':
            await handleTerminalBroadcast(args.slice(1));
            break;
        case 'flyto':
            handleTerminalFlyTo(args.slice(1));
            break;
        case 'simulate-incident':
            await handleTerminalSimulateIncident(args.slice(1));
            break;
        case 'vigilante':
            handleTerminalVigilante(args.slice(1));
            break;
        case 'theme':
            handleTerminalTheme(args.slice(1));
            break;
        case 'locate':
            handleTerminalLocate();
            break;
        default:
            appendTerminalOutput(`Command not found: ${command}. Type 'help' for available commands.`, 'error');
    }
}

function printTerminalHelp() {
    appendTerminalOutput("CivicSafe Tactical OS v4.3 - Command Reference", "header");
    appendTerminalOutput("========================================================================", "muted");
    const commands = [
        ["help", "Show this command reference guide"],
        ["clear", "Clear terminal screen output"],
        ["motd", "Display tactical warning message of the day"],
        ["status", "Print system health and database status info"],
        ["users", "List all registered accounts in directory"],
        ["incidents", "List active reports and danger markings"],
        ["approvals", "List pending citizen registration requests"],
        ["resets", "List pending password reset requests"],
        ["add [citizen|admin|vigilante] <user> <pass>", "Create new account directly"],
        ["delete user <username>", "Remove user account from database"],
        ["delete incident <id>", "Delete incident record by ID"],
        ["approve <username>", "Approve pending citizen registration"],
        ["reject <username>", "Reject/delete pending registration"],
        ["approve-reset <username>", "Approve password reset request"],
        ["purge", "Clean database logs older than 30 days"],
        ["broadcast <message>", "Broadcast real-time alert toast to all clients"],
        ["flyto <lat> <lng> [height]", "Move 3D map camera to coords (height optional)"],
        ["simulate-incident <cat> <lat> <lng> <desc>", "Simulate incident on live map"],
        ["vigilante [on|off]", "Toggle grid overlay Vigilante Mode"],
        ["theme [light|dark]", "Toggle site aesthetic scheme"],
        ["locate", "Trigger GPS tracking simulation"]
    ];
    
    commands.forEach(([cmd, desc]) => {
        const paddedCmd = cmd.padEnd(36, ' ');
        appendTerminalOutput(`${paddedCmd} - ${desc}`, 'pre');
    });
    appendTerminalOutput("========================================================================", "muted");
}

function printTerminalMotd() {
    const banner = 
`   ______  _______    _______   _________ _ 
  / ___/ |/ / _ \\ \\  / / __/ | / / _ \\__ / 
 / /___/    / , _/\\ \\/ / _/| |/ /  __//_ <  
 \\___/_/|_/_/|_|   \\__/___/|___/\\___/____/  
                                            `;
    appendTerminalOutput(banner, "pre");
    appendTerminalOutput("========================================================================", "muted");
    appendTerminalOutput("SECURITY WARNING: AUTHORIZED PERSONNEL ONLY. ALL ACTIONS ARE LOGGED.", "warning");
    appendTerminalOutput("========================================================================", "muted");
}

async function printTerminalStatus() {
    appendTerminalOutput("Fetching system diagnostics...", "muted");
    try {
        const usersRes = await fetch('/api/admin/users');
        const users = await usersRes.json();
        
        const incidentsRes = await fetch('/api/incidents');
        const activeIncidents = await incidentsRes.json();
        
        const approvalsRes = await fetch('/api/admin/pending-approvals');
        const approvals = await approvalsRes.json();

        const resetsRes = await fetch('/api/admin/reset-requests');
        const resets = await resetsRes.json();

        const dbType = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'Local JSON File' : 'MongoDB Cloud';

        appendTerminalOutput("System Health Diagnostics:", "header");
        appendTerminalOutput(`- Database Engine:   ${dbType}`, "normal");
        appendTerminalOutput(`- Map Engine:        Cesium 3D Globe`, "normal");
        appendTerminalOutput(`- Active Incidents:  ${activeIncidents.length}`, "normal");
        appendTerminalOutput(`- Registered Users:  ${users.length}`, "normal");
        appendTerminalOutput(`- Pending Approvals: ${approvals.length}`, "normal");
        appendTerminalOutput(`- Reset Requests:    ${resets.length}`, "normal");
        appendTerminalOutput(`- Connection State:  Online (SSE Connected)`, "success");
    } catch (e) {
        appendTerminalOutput(`Diagnostic retrieval failed: ${e.message}`, "error");
    }
}

async function printTerminalUsers() {
    appendTerminalOutput("Querying user registry database...", "muted");
    try {
        const res = await fetch('/api/admin/users');
        const users = await res.json();
        
        appendTerminalOutput("USERNAME".padEnd(16, ' ') + "ROLE".padEnd(12, ' ') + "STATUS".padEnd(12, ' ') + "FULL NAME", "header");
        appendTerminalOutput("------------------------------------------------------------------------", "muted");
        users.forEach(u => {
            const status = u.approved ? "Active" : "Pending";
            const row = u.username.padEnd(16, ' ') + 
                        u.role.padEnd(12, ' ') + 
                        status.padEnd(12, ' ') + 
                        (u.fullName || "N/A");
            appendTerminalOutput(row, "pre");
        });
    } catch (e) {
        appendTerminalOutput(`User registry query failed: ${e.message}`, "error");
    }
}

async function printTerminalIncidents() {
    appendTerminalOutput("Querying active incident reports...", "muted");
    try {
        const res = await fetch('/api/incidents');
        const list = await res.json();
        
        appendTerminalOutput("ID".padEnd(12, ' ') + "CATEGORY".padEnd(14, ' ') + "VOTES".padEnd(8, ' ') + "COORDINATES".padEnd(24, ' ') + "DESCRIPTION", "header");
        appendTerminalOutput("------------------------------------------------------------------------", "muted");
        list.forEach(inc => {
            const votesCount = inc.votes ? Object.keys(inc.votes).length : 0;
            const coords = `${inc.lat.toFixed(4)}, ${inc.lng.toFixed(4)}`;
            const row = inc.id.substring(0, 10).padEnd(12, ' ') + 
                        inc.category.padEnd(14, ' ') + 
                        String(votesCount).padEnd(8, ' ') + 
                        coords.padEnd(24, ' ') + 
                        (inc.description || "No details");
            appendTerminalOutput(row, "pre");
        });
    } catch (e) {
        appendTerminalOutput(`Incident query failed: ${e.message}`, "error");
    }
}

async function printTerminalApprovals() {
    try {
        const res = await fetch('/api/admin/pending-approvals');
        const list = await res.json();
        if (list.length === 0) {
            appendTerminalOutput("No pending registration approvals.");
            return;
        }
        appendTerminalOutput("PENDING USER REGISTRATIONS:", "header");
        list.forEach(u => {
            appendTerminalOutput(`- ${u.username} (${u.fullName || "No Name"}) - Role Request: ${u.role}`, "normal");
        });
    } catch (e) {
        appendTerminalOutput(`Approvals check failed: ${e.message}`, "error");
    }
}

async function printTerminalResets() {
    try {
        const res = await fetch('/api/admin/reset-requests');
        const list = await res.json();
        if (list.length === 0) {
            appendTerminalOutput("No pending password reset requests.");
            return;
        }
        appendTerminalOutput("PENDING PASSWORD RESET REQUESTS:", "header");
        list.forEach(r => {
            appendTerminalOutput(`- ${r.username} (New Password Requested: ${r.newPassword})`, "normal");
        });
    } catch (e) {
        appendTerminalOutput(`Reset requests check failed: ${e.message}`, "error");
    }
}

async function handleTerminalAdd(args) {
    if (args.length < 3) {
        appendTerminalOutput("Usage: add [citizen|admin|vigilante] <username> <password>", "warning");
        return;
    }
    const role = args[0].toLowerCase();
    const username = args[1];
    const password = args[2];
    
    if (role !== 'citizen' && role !== 'admin' && role !== 'vigilante') {
        appendTerminalOutput("Role must be 'citizen', 'admin', or 'vigilante'", "warning");
        return;
    }
    
    appendTerminalOutput(`Creating ${role} account '${username}'...`, "muted");
    try {
        const res = await fetch('/api/admin/users/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username,
                password,
                fullName: `Terminal Created ${role}`,
                role,
                phone: "",
                emergencyContact: "",
                autoAnonymous: true,
                defaultLocation: ""
            })
        });
        const data = await res.json();
        if (res.ok) {
            appendTerminalOutput(`Account '${username}' created successfully.`, "success");
            loadAdminData();
        } else {
            appendTerminalOutput(`Creation failed: ${data.error}`, "error");
        }
    } catch (e) {
        appendTerminalOutput(`Creation failed: ${e.message}`, "error");
    }
}

async function handleTerminalDelete(args) {
    if (args.length < 2) {
        appendTerminalOutput("Usage: delete user <username> OR delete incident <id>", "warning");
        return;
    }
    const type = args[0].toLowerCase();
    const target = args[1];
    
    if (type === 'user') {
        appendTerminalOutput(`Deleting user '${target}'...`, "muted");
        try {
            const res = await fetch(`/api/admin/users/${encodeURIComponent(target)}`, { method: 'DELETE' });
            const data = await res.json();
            if (res.ok) {
                appendTerminalOutput(`User '${target}' deleted.`, "success");
                loadAdminData();
            } else {
                appendTerminalOutput(`Deletion failed: ${data.error}`, "error");
            }
        } catch (e) {
            appendTerminalOutput(`Deletion failed: ${e.message}`, "error");
        }
    } else if (type === 'incident') {
        appendTerminalOutput(`Deleting incident '${target}'...`, "muted");
        try {
            const res = await fetch(`/api/admin/incidents/${encodeURIComponent(target)}`, { method: 'DELETE' });
            const data = await res.json();
            if (res.ok) {
                appendTerminalOutput(`Incident '${target}' deleted.`, "success");
                loadAdminData();
            } else {
                appendTerminalOutput(`Deletion failed: ${data.error}`, "error");
            }
        } catch (e) {
            appendTerminalOutput(`Deletion failed: ${e.message}`, "error");
        }
    } else {
        appendTerminalOutput("Invalid deletion type. Specify 'user' or 'incident'", "warning");
    }
}

async function handleTerminalApprove(args) {
    if (args.length < 1) {
        appendTerminalOutput("Usage: approve <username>", "warning");
        return;
    }
    const username = args[0];
    appendTerminalOutput(`Approving registration for '${username}'...`, "muted");
    try {
        const res = await fetch('/api/admin/approve-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });
        if (res.ok) {
            appendTerminalOutput(`Approved '${username}' registration.`, "success");
            loadAdminData();
        } else {
            appendTerminalOutput("Approval failed.", "error");
        }
    } catch (e) {
        appendTerminalOutput(`Approval failed: ${e.message}`, "error");
    }
}

async function handleTerminalReject(args) {
    if (args.length < 1) {
        appendTerminalOutput("Usage: reject <username>", "warning");
        return;
    }
    const username = args[0];
    appendTerminalOutput(`Rejecting registration for '${username}'...`, "muted");
    try {
        const res = await fetch('/api/admin/reject-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });
        if (res.ok) {
            appendTerminalOutput(`Rejected and deleted user '${username}'.`, "success");
            loadAdminData();
        } else {
            appendTerminalOutput("Rejection failed.", "error");
        }
    } catch (e) {
        appendTerminalOutput(`Rejection failed: ${e.message}`, "error");
    }
}

async function handleTerminalApproveReset(args) {
    if (args.length < 1) {
        appendTerminalOutput("Usage: approve-reset <username>", "warning");
        return;
    }
    const username = args[0];
    appendTerminalOutput(`Approving reset request for '${username}'...`, "muted");
    try {
        const res = await fetch('/api/admin/reset-requests/approve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });
        if (res.ok) {
            appendTerminalOutput(`Approved reset request for '${username}'.`, "success");
            loadAdminData();
        } else {
            appendTerminalOutput("Reset approval failed.", "error");
        }
    } catch (e) {
        appendTerminalOutput(`Reset approval failed: ${e.message}`, "error");
    }
}

async function handleTerminalPurge() {
    appendTerminalOutput("Purging old incident reports...", "muted");
    try {
        const res = await fetch('/api/admin/purge', { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
            appendTerminalOutput(`Database logs purged. Cleared ${data.prunedCount} old incidents.`, "success");
            loadAdminData();
        } else {
            appendTerminalOutput("Purge operation failed.", "error");
        }
    } catch (e) {
        appendTerminalOutput(`Purge failed: ${e.message}`, "error");
    }
}

async function handleTerminalBroadcast(args) {
    if (args.length < 1) {
        appendTerminalOutput("Usage: broadcast <message_content>", "warning");
        return;
    }
    const message = args.join(' ');
    appendTerminalOutput(`Broadcasting message: "${message}"...`, "muted");
    try {
        const res = await fetch('/api/admin/broadcast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
        });
        if (res.ok) {
            appendTerminalOutput("System broadcast sent successfully.", "success");
        } else {
            appendTerminalOutput("Failed to send system broadcast.", "error");
        }
    } catch (e) {
        appendTerminalOutput(`Broadcast failed: ${e.message}`, "error");
    }
}

function handleTerminalFlyTo(args) {
    if (args.length < 2) {
        appendTerminalOutput("Usage: flyto <lat> <lng> [height]", "warning");
        return;
    }
    const lat = parseFloat(args[0]);
    const lng = parseFloat(args[1]);
    const height = args[2] ? parseFloat(args[2]) : 800.0;
    
    if (isNaN(lat) || isNaN(lng)) {
        appendTerminalOutput("Invalid latitude or longitude numbers.", "warning");
        return;
    }
    
    appendTerminalOutput(`Flying map camera to (${lat}, ${lng}) height ${height}m...`, "muted");
    
    const mainSidebar = document.getElementById('main-sidebar');
    if (mainSidebar) mainSidebar.classList.remove('sidebar-open');
    
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lng, lat, height),
        orientation: {
            heading: Cesium.Math.toRadians(0.0),
            pitch: Cesium.Math.toRadians(-45.0),
            roll: 0.0
        },
        duration: 2.0
    });
}

async function handleTerminalSimulateIncident(args) {
    if (args.length < 4) {
        appendTerminalOutput("Usage: simulate-incident <category> <lat> <lng> <description>", "warning");
        appendTerminalOutput("Categories: accident | roadblock | hazard | security | other", "muted");
        return;
    }
    const category = args[0].toLowerCase();
    const lat = parseFloat(args[1]);
    const lng = parseFloat(args[2]);
    const description = args.slice(3).join(' ');
    
    if (isNaN(lat) || isNaN(lng)) {
        appendTerminalOutput("Invalid latitude or longitude numbers.", "warning");
        return;
    }
    
    appendTerminalOutput(`Simulating report creation for '${category}' at (${lat}, ${lng})...`, "muted");
    try {
        const res = await fetch('/api/incidents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                category,
                description,
                lat,
                lng,
                anonymous: true
            })
        });
        if (res.ok) {
            appendTerminalOutput("Incident simulated and broadcast to map successfully.", "success");
        } else {
            appendTerminalOutput("Simulation request failed.", "error");
        }
    } catch (e) {
        appendTerminalOutput(`Simulation request failed: ${e.message}`, "error");
    }
}

function handleTerminalVigilante(args) {
    if (args.length < 1) {
        appendTerminalOutput("Usage: vigilante [on|off]", "warning");
        return;
    }
    const state = args[0].toLowerCase();
    const isVigilanteMode = document.body.classList.contains('vigilante-mode');
    
    if (state === 'on' && !isVigilanteMode) {
        const btn = document.getElementById('btn-vigilante-toggle');
        if (btn) btn.click();
        appendTerminalOutput("Vigilante Grid mode toggled ON.", "success");
    } else if (state === 'off' && isVigilanteMode) {
        const btn = document.getElementById('btn-vigilante-toggle');
        if (btn) btn.click();
        appendTerminalOutput("Vigilante Grid mode toggled OFF.", "success");
    } else {
        appendTerminalOutput(`Vigilante mode is already ${isVigilanteMode ? 'ON' : 'OFF'}.`, "normal");
    }
}

function handleTerminalTheme(args) {
    if (args.length < 1) {
        appendTerminalOutput("Usage: theme [light|dark]", "warning");
        return;
    }
    const reqTheme = args[0].toLowerCase();
    const isLight = document.body.classList.contains('light-theme');
    
    if (reqTheme === 'light' && !isLight) {
        const btn = document.getElementById('btn-theme-toggle');
        if (btn) btn.click();
        appendTerminalOutput("Interface theme shifted to LIGHT.", "success");
    } else if (reqTheme === 'dark' && isLight) {
        const btn = document.getElementById('btn-theme-toggle');
        if (btn) btn.click();
        appendTerminalOutput("Interface theme shifted to DARK.", "success");
    } else {
        appendTerminalOutput(`Theme is already ${isLight ? 'LIGHT' : 'DARK'}.`, "normal");
    }
}

function handleTerminalLocate() {
    appendTerminalOutput("Simulating GPS location track request...", "muted");
    const gpsBtn = document.getElementById('btn-gps-locate');
    if (gpsBtn) {
        gpsBtn.click();
        appendTerminalOutput("GPS locate tracking active.", "success");
    } else {
        appendTerminalOutput("Locate button unavailable.", "error");
    }
}
