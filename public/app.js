// ==========================================
// UNIFIED LEADERBOARD — CLIENT APP
// ==========================================

// ==========================================
// STATE & CONFIG
// ==========================================
let rawData = {
    individual: { monthly: [], daily: [] },
    group: { monthly: [], daily: [] }
};
let currentTab = 'group-monthly';
let currentTheme = 'classic'; // 'classic' or 'modern'
let rotation = 0;
let isInteracting = false;
let interactionTimer = null;
let cycleTimer = null;
let timeLeft = 10;

const TAB_ORDER = ['group-monthly', 'group-daily', 'individual-monthly', 'individual-daily'];

let config = {
    visibleTabs: {
        'group-monthly': true,
        'group-daily': true,
        'individual-monthly': true,
        'individual-daily': true
    },
    showIncome: {
        'group-monthly': true,
        'group-daily': true,
        'individual-monthly': true,
        'individual-daily': true
    },
    showAvatars: {
        'group-monthly': true,
        'group-daily': true,
        'individual-monthly': true,
        'individual-daily': true
    },
    cycleDuration: 10,
    resetHour: 6,
    rotation: 0,
    podiumSlots: 5,
    listColumns: 3,
    refreshInterval: 10
};

// ==========================================
// INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    loadSavedSettings();
    detectTV();
    startClock();
    startCycleTimer();
    setupInteractionListeners();
    updateUIFromConfig();
    requestWakeLock();

    // Fetch data immediately on load (don't wait for SSE handshake)
    fetchData();

    // Then connect SSE for real-time updates (falls back to polling)
    connectSSE();
});

// ==========================================
// REAL-TIME: SSE (primary) + POLLING (fallback)
// ==========================================
let eventSource = null;
let pollingInterval = null;
let isSSEConnected = false;

function connectSSE() {
    if (!window.EventSource) {
        console.log('[SSE] Not supported, using polling');
        startPolling();
        return;
    }

    console.log('[SSE] Connecting to /api/leaderboard/stream...');
    eventSource = new EventSource('/api/leaderboard/stream');

    eventSource.onmessage = (event) => {
        try {
            const json = JSON.parse(event.data);
            if (json.status === 'ok') {
                rawData = json.data;
                renderLeaderboard();
                updateConnectionStatus('live');

                // Hide loader
                const loader = document.getElementById('header-loader');
                if (loader) loader.classList.add('hidden');
            }
        } catch (err) {
            console.error('[SSE] Parse error:', err);
        }
    };

    eventSource.onopen = () => {
        console.log('[SSE] Connected — receiving real-time updates');
        isSSEConnected = true;
        updateConnectionStatus('live');

        // Stop polling if it was running as fallback
        if (pollingInterval) {
            clearInterval(pollingInterval);
            pollingInterval = null;
        }
    };

    eventSource.onerror = () => {
        console.warn('[SSE] Connection lost, falling back to polling');
        isSSEConnected = false;
        updateConnectionStatus('polling');

        // SSE will auto-reconnect, but start polling as backup
        if (!pollingInterval) {
            startPolling();
        }
    };
}

function startPolling() {
    // Initial fetch
    fetchData();
    // Poll at configured interval
    pollingInterval = setInterval(fetchData, (config.refreshInterval || 10) * 1000);
    updateConnectionStatus('polling');
}

function updateConnectionStatus(mode) {
    const el = document.getElementById('footer-connection');
    if (!el) return;
    if (mode === 'live') {
        el.textContent = '🟢 LIVE';
        el.style.color = '#4ade80';
    } else {
        el.textContent = '🟡 POLL';
        el.style.color = '#facc15';
    }
}

async function fetchData() {
    const loader = document.getElementById('header-loader');
    try {
        if (loader) loader.classList.remove('hidden');
        const response = await fetch(`/api/leaderboard?resetHour=${config.resetHour}`);
        const json = await response.json();

        if (json.status === 'error') {
            console.error('API Error:', json.message);
            if (loader) loader.classList.add('hidden');
            return;
        }

        rawData = json.data;
        renderLeaderboard();
        if (loader) loader.classList.add('hidden');
    } catch (error) {
        console.error('Fetch error:', error);
        if (loader) loader.classList.add('hidden');
    }
}

// ==========================================
// TAB DATA MAPPING
// ==========================================
function getDataForTab(tab) {
    // Map tab name to the correct data path
    const category = getTabCategory(tab); // 'group' or 'individual'
    const period = tab.includes('monthly') ? 'monthly' : 'daily';

    if (rawData[category] && rawData[category][period]) {
        return rawData[category][period];
    }
    return [];
}

function getTabCategory(tab) {
    // Returns 'group' or 'individual'
    return tab.startsWith('group') ? 'group' : 'individual';
}

function getTabKey(tab) {
    // Returns the full tab key for per-tab settings
    return tab;
}

// ==========================================
// TAB SWITCHING
// ==========================================
function switchTab(tab) {
    if (!config.visibleTabs[tab]) return;

    currentTab = tab;
    timeLeft = config.cycleDuration;

    // Update active state on buttons
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    const btn = document.getElementById('btn-' + tab);
    if (btn) btn.classList.add('active');

    renderLeaderboard();
    handleInteraction();
}

// ==========================================
// RENDERING
// ==========================================
function renderLeaderboard() {
    const data = getDataForTab(currentTab);
    const tabKey = getTabKey(currentTab);
    const podiumContainer = document.getElementById('podium');
    const listContainer = document.getElementById('list');

    podiumContainer.innerHTML = '';
    listContainer.innerHTML = '';

    if (!data || data.length === 0) {
        podiumContainer.innerHTML = '';
        listContainer.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1;">
                <div class="empty-state-icon">📊</div>
                <div class="empty-state-text">No data available for this period</div>
            </div>
        `;
        return;
    }

    const showIncome = config.showIncome[tabKey];
    const showAvatars = config.showAvatars[tabKey];
    const podiumCount = Math.min(config.podiumSlots || 5, data.length);
    const cols = config.listColumns || 3;

    // Apply list column count via CSS custom property
    listContainer.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

    // --- Render Podium (Top N) ---
    const topN = data.slice(0, podiumCount);

    topN.forEach((idol, index) => {
        const rank = index + 1;
        const card = document.createElement('div');
        card.className = `podium-card rank-${rank}`;

        const avatarSrc = getAvatarUrl(idol.avatar, idol.name);

        let trophyHtml = '';
        if (rank === 1) {
            trophyHtml = '<div class="trophy-icon">🏆</div>';
        }

        card.innerHTML = `
            ${trophyHtml}
            <div class="avatar-wrapper">
                <img src="${avatarSrc}" class="avatar" alt="${idol.name}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23333%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 fill=%22%23666%22 font-size=%2240%22>${idol.name.charAt(0)}</text></svg>'">
                <div class="rank-badge">${rank}</div>
            </div>
            <div class="idol-name">${idol.name}</div>
            ${showIncome ? `<div class="idol-value">${formatNumber(idol.value)}</div>` : ''}
        `;
        podiumContainer.appendChild(card);
    });

    // --- Render Rank N+1 and below (List) ---
    const rest = data.slice(podiumCount);

    rest.forEach((idol, index) => {
        const rank = index + podiumCount + 1;
        const item = document.createElement('div');
        item.className = 'list-item';

        const avatarSrc = getAvatarUrl(idol.avatar, idol.name);
        const avatarHtml = showAvatars
            ? `<div class="list-avatar">
                 <img src="${avatarSrc}" alt="${idol.name}" onerror="this.parentElement.innerHTML='<i class=\\'fas fa-user\\'></i>'">
               </div>`
            : '';

        item.innerHTML = `
            <div class="list-rank">${rank}</div>
            <div class="list-info">
                ${avatarHtml}
                <div class="list-name">${idol.name}</div>
            </div>
            <div class="list-value">
                ${showIncome ? formatNumber(idol.value) : ''}
            </div>
        `;
        listContainer.appendChild(item);
    });
}

// ==========================================
// THEME
// ==========================================
function setTheme(theme) {
    currentTheme = theme;
    document.body.classList.remove('theme-classic', 'theme-modern');
    if (theme === 'modern') {
        document.body.classList.add('theme-modern');
    }
    // Update theme checkboxes
    updateCheckbox('check-theme-classic', theme === 'classic');
    updateCheckbox('check-theme-modern', theme === 'modern');
    saveSettings();
}

function cycleTheme() {
    setTheme(currentTheme === 'classic' ? 'modern' : 'classic');
}

// ==========================================
// SCREEN ROTATION
// ==========================================
function rotateScreen(setDeg) {
    if (setDeg !== undefined) {
        rotation = setDeg;
    } else {
        rotation = (rotation + 90) % 360;
    }

    applyRotation();
    // Update the rotation input in settings
    const rotInput = document.getElementById('rotation-deg');
    if (rotInput) rotInput.value = rotation;
}

function setRotation(deg) {
    rotation = ((deg % 360) + 360) % 360; // normalize
    applyRotation();
}

function applyRotation() {
    const wrapper = document.getElementById('app-wrapper');
    const isPortrait = rotation % 180 !== 0;

    wrapper.style.transform = `rotate(${rotation}deg)`;

    if (isPortrait) {
        wrapper.style.width = '100vh';
        wrapper.style.height = '100vw';
    } else {
        wrapper.style.width = '100vw';
        wrapper.style.height = '100vh';
    }
}

// ==========================================
// SETTINGS
// ==========================================
function toggleSettings() {
    const modal = document.getElementById('settings-modal');
    modal.classList.toggle('hidden');
}

function toggleConfig(category, key) {
    config[category][key] = !config[category][key];
    updateUIFromConfig();
    saveSettings();

    // If current tab became hidden, switch to next visible tab
    if (category === 'visibleTabs' && !config.visibleTabs[currentTab]) {
        const nextTab = TAB_ORDER.find(t => config.visibleTabs[t]);
        if (nextTab) switchTab(nextTab);
    }

    // Re-render if we toggled income or avatars for current tab's category
    if (category === 'showIncome' || category === 'showAvatars') {
        renderLeaderboard();
    }
}

function updateConfigValue(key, value) {
    config[key] = parseInt(value) || config[key];
    if (key === 'cycleDuration') {
        timeLeft = config.cycleDuration;
        document.getElementById('footer-cycle').textContent = config.cycleDuration + 's';
    }
    if (key === 'resetHour') {
        fetchData(); // Re-fetch with new reset hour
    }
    saveSettings();
}

function updateUIFromConfig() {
    // Tab checkboxes
    TAB_ORDER.forEach(tab => {
        updateCheckbox('check-tab-' + tab, config.visibleTabs[tab]);
        const btn = document.getElementById('btn-' + tab);
        if (btn) btn.style.display = config.visibleTabs[tab] ? '' : 'none';
    });

    // Per-tab Income checkboxes
    TAB_ORDER.forEach(tab => {
        updateCheckbox('check-income-' + tab, config.showIncome[tab]);
    });

    // Per-tab Avatar checkboxes
    TAB_ORDER.forEach(tab => {
        updateCheckbox('check-avatar-' + tab, config.showAvatars[tab]);
    });

    // Theme checkboxes
    updateCheckbox('check-theme-classic', currentTheme === 'classic');
    updateCheckbox('check-theme-modern', currentTheme === 'modern');

    // Input values
    document.getElementById('cycle-duration').value = config.cycleDuration;
    document.getElementById('reset-hour').value = config.resetHour;
    const rotInput = document.getElementById('rotation-deg');
    if (rotInput) rotInput.value = rotation;

    // Layout settings
    const podiumInput = document.getElementById('podium-slots');
    if (podiumInput) podiumInput.value = config.podiumSlots || 5;
    const colInput = document.getElementById('list-columns');
    if (colInput) colInput.value = config.listColumns || 3;
    const refreshInput = document.getElementById('refresh-interval');
    if (refreshInput) refreshInput.value = config.refreshInterval || 10;

    // Footer
    document.getElementById('footer-cycle').textContent = config.cycleDuration + 's';
}

function updateCheckbox(id, isChecked) {
    const el = document.getElementById(id);
    if (!el) return;
    if (isChecked) el.classList.add('checked');
    else el.classList.remove('checked');
}

// ==========================================
// PERSISTENCE
// ==========================================
function saveSettings() {
    // Auto-save current state on every change
    try {
        config.rotation = rotation;
        localStorage.setItem('leaderboard_config', JSON.stringify(config));
        localStorage.setItem('leaderboard_theme', currentTheme);
    } catch (e) { /* ignore */ }
}

function saveAsDefault() {
    // Explicitly save everything — rotation, theme, all toggles
    config.rotation = rotation;
    try {
        localStorage.setItem('leaderboard_config', JSON.stringify(config));
        localStorage.setItem('leaderboard_theme', currentTheme);
    } catch (e) { /* ignore */ }

    // Visual feedback
    const fb = document.getElementById('save-feedback');
    if (fb) {
        fb.style.display = 'block';
        setTimeout(() => { fb.style.display = 'none'; }, 2000);
    }
}

function loadSavedSettings() {
    try {
        const saved = localStorage.getItem('leaderboard_config');
        if (saved) {
            const parsed = JSON.parse(saved);
            // Merge with defaults (in case new keys were added)
            config = { ...config, ...parsed };
            // Ensure nested objects are merged too
            if (parsed.visibleTabs) config.visibleTabs = { ...config.visibleTabs, ...parsed.visibleTabs };
            if (parsed.showIncome) config.showIncome = { ...config.showIncome, ...parsed.showIncome };
            if (parsed.showAvatars) config.showAvatars = { ...config.showAvatars, ...parsed.showAvatars };

            // Restore rotation
            if (parsed.rotation != null) {
                rotation = parsed.rotation;
                applyRotation();
            }
        }

        const savedTheme = localStorage.getItem('leaderboard_theme');
        if (savedTheme) {
            currentTheme = savedTheme;
            setTheme(currentTheme);
        }
    } catch (e) { /* ignore */ }
}

// ==========================================
// AUTO-CYCLE
// ==========================================
function startCycleTimer() {
    if (cycleTimer) clearInterval(cycleTimer);

    cycleTimer = setInterval(() => {
        if (isInteracting) return;

        // Get list of visible tabs
        const visibleTabs = TAB_ORDER.filter(t => config.visibleTabs[t]);
        if (visibleTabs.length <= 1) return;

        timeLeft--;
        document.getElementById('footer-countdown').textContent = timeLeft + 's';

        if (timeLeft <= 0) {
            // Move to next visible tab
            const currentIndex = visibleTabs.indexOf(currentTab);
            const nextIndex = (currentIndex + 1) % visibleTabs.length;
            switchTab(visibleTabs[nextIndex]);
            timeLeft = config.cycleDuration;
        }
    }, 1000);
}

// ==========================================
// CLOCK
// ==========================================
function startClock() {
    function updateClock() {
        const el = document.getElementById('footer-clock');
        if (el) el.textContent = new Date().toLocaleTimeString();
    }
    updateClock();
    setInterval(updateClock, 1000);
}

// ==========================================
// INTERACTION DETECTION
// ==========================================
function setupInteractionListeners() {
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    events.forEach(event => window.addEventListener(event, handleInteraction));
}

function handleInteraction() {
    isInteracting = true;
    if (interactionTimer) clearTimeout(interactionTimer);
    interactionTimer = setTimeout(() => {
        isInteracting = false;
    }, 5000);
}

// ==========================================
// KEYBOARD SHORTCUTS
// ==========================================
window.addEventListener('keydown', (e) => {
    handleInteraction();
    const key = e.key;

    switch (key) {
        case '0': rotateScreen(); break;
        case '1': switchTab('group-monthly'); break;
        case '2': switchTab('group-daily'); break;
        case '3': switchTab('individual-monthly'); break;
        case '4': switchTab('individual-daily'); break;
        case '5':
            // Toggle income for current tab
            toggleConfig('showIncome', currentTab);
            break;
        case '6': cycleTheme(); break;
        case '7': toggleSettings(); break;
        case '8': fetchData(); break;
    }
});

// ==========================================
// TV DETECTION
// ==========================================
function detectTV() {
    const ua = navigator.userAgent.toLowerCase();
    const tvKeywords = ['webos', 'tizen', 'smarttv', 'nexus player', 'viera', 'bravia', 'fios', 'hbbtv', 'opera tv', 'samsung', 'lg tv'];
    const isTv = tvKeywords.some(kw => ua.includes(kw));

    if (isTv) {
        console.log('TV Detected — Auto Rotating');
        rotateScreen(90);
    }
}

// ==========================================
// WAKE LOCK
// ==========================================
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            const lock = await navigator.wakeLock.request('screen');
            console.log('Wake Lock active');
            lock.addEventListener('release', () => console.log('Wake Lock released'));

            document.addEventListener('visibilitychange', async () => {
                if (document.visibilityState === 'visible') {
                    try {
                        await navigator.wakeLock.request('screen');
                    } catch (e) { /* ignore */ }
                }
            });
        }
    } catch (e) {
        console.log('Wake Lock not available:', e.message);
    }
}

// ==========================================
// UTILITY
// ==========================================
function formatNumber(num) {
    if (num == null) return '0';
    return Math.ceil(num).toLocaleString('en-US');
}

function getAvatarUrl(avatar, name) {
    if (!avatar) {
        // Generate SVG placeholder with first letter
        const letter = (name || '?').charAt(0).toUpperCase();
        return `data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23333%22 width=%22100%22 height=%22100%22 rx=%2250%22/><text x=%2250%22 y=%2260%22 text-anchor=%22middle%22 fill=%22%23888%22 font-size=%2240%22 font-family=%22Inter,sans-serif%22>${letter}</text></svg>`;
    }
    // If avatar starts with 'userdata/', it's a helioscontrol local path
    // We need to proxy or use the helioscontrol server URL
    // For now, just return as-is (works if helioscontrol is serving these files)
    return avatar;
}
