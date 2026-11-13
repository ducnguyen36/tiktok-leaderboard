'use strict';
(function(){
let lastInteraction=Date.now();
['pointerdown','pointermove','keydown'].forEach(type=>document.addEventListener(type,()=>lastInteraction=Date.now(),{passive:true}));
let _wakeLockSentinel = null;
let _wakeLockAudioCtx = null;

async function requestWakeLock() {
    console.log('[WakeLock] Initializing anti-sleep system...');

    // Strategy 1: Samsung Tizen Power API
    tryTizenPowerLock();

    // Strategy 2: Native Wake Lock API
    tryNativeWakeLock();

    // Strategy 3: Web Audio silent tone (keeps audio pipeline active)
    startSilentAudio();

    // Strategy 4: Periodic page refresh to reset TV idle timer
    startPeriodicRefresh();

    // Strategy 5: Simulate activity via DOM mutations
    startDOMMutationKeepAlive();

    console.log('[WakeLock] All anti-sleep strategies activated');
}

// --- Strategy 1: Samsung Tizen Native API ---
function tryTizenPowerLock() {
    try {
        // Samsung Tizen Smart TV API
        if (typeof tizen !== 'undefined' && tizen.power) {
            tizen.power.request('SCREEN', 'SCREEN_NORMAL');
            tizen.power.setScreenStateChangeListener((prev, current) => {
                if (current === 'SCREEN_OFF') {
                    tizen.power.turnScreenOn();
                    tizen.power.request('SCREEN', 'SCREEN_NORMAL');
                }
            });
            console.log('[WakeLock] ✓ Tizen Power API active');
            return;
        }
        // Tizen Web Device API alternative
        if (typeof webapis !== 'undefined' && webapis.avplay) {
            console.log('[WakeLock] Tizen webapis detected');
        }
    } catch (e) {
        console.log('[WakeLock] Tizen API not available:', e.message);
    }

    try {
        // TCL / Android TV: try cordova plugin if available
        if (window.plugins && window.plugins.insomnia) {
            window.plugins.insomnia.keepAwake();
            console.log('[WakeLock] ✓ Insomnia plugin active');
        }
    } catch (e) {
        console.log('[WakeLock] Insomnia plugin not available');
    }
}

// --- Strategy 2: Native Wake Lock API ---
async function tryNativeWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            _wakeLockSentinel = await navigator.wakeLock.request('screen');
            console.log('[WakeLock] ✓ Native Wake Lock active');
            _wakeLockSentinel.addEventListener('release', () => {
                console.log('[WakeLock] Native lock released, re-acquiring...');
                _wakeLockSentinel = null;
                setTimeout(() => tryNativeWakeLock(), 1000);
            });

            document.addEventListener('visibilitychange', async () => {
                if (document.visibilityState === 'visible' && !_wakeLockSentinel) {
                    try {
                        _wakeLockSentinel = await navigator.wakeLock.request('screen');
                        console.log('[WakeLock] Re-acquired after visibility change');
                    } catch (e) { /* ignore */ }
                }
            });
        }
    } catch (e) {
        console.log('[WakeLock] Native API not supported:', e.message);
    }
}

// --- Strategy 3: Web Audio silent tone ---
function startSilentAudio() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;

        const startAudio = () => {
            if (_wakeLockAudioCtx) return;
            _wakeLockAudioCtx = new AudioContext();

            // Create a silent oscillator (frequency too low to hear)
            const oscillator = _wakeLockAudioCtx.createOscillator();
            const gainNode = _wakeLockAudioCtx.createGain();
            gainNode.gain.value = 0.001; // Nearly silent
            oscillator.frequency.value = 1; // 1 Hz — inaudible
            oscillator.connect(gainNode);
            gainNode.connect(_wakeLockAudioCtx.destination);
            oscillator.start();

            console.log('[WakeLock] ✓ Silent audio active');
        };

        // Try immediately
        startAudio();

        // Also try on user interaction (required by most TV browsers)
        const interactHandler = () => {
            startAudio();
            if (_wakeLockAudioCtx && _wakeLockAudioCtx.state === 'suspended') {
                _wakeLockAudioCtx.resume();
            }
            document.removeEventListener('click', interactHandler);
            document.removeEventListener('keydown', interactHandler);
            document.removeEventListener('touchstart', interactHandler);
        };
        document.addEventListener('click', interactHandler);
        document.addEventListener('keydown', interactHandler);
        document.addEventListener('touchstart', interactHandler);

        // Keep audio context alive
        setInterval(() => {
            if (_wakeLockAudioCtx && _wakeLockAudioCtx.state === 'suspended') {
                _wakeLockAudioCtx.resume().catch(() => {});
            }
        }, 15000);

    } catch (e) {
        console.log('[WakeLock] Audio strategy failed:', e.message);
    }
}

// --- Strategy 4: Periodic page refresh (nuclear option for stubborn TVs) ---
function startPeriodicRefresh() {
    // Reload the page every 4 minutes to reset the TV's idle timer. The reload is meant
    // to be invisible: the board saves its position on pagehide and comes back at once
    // from cached data, then changes only if the fresh data differs (see next-app.js).
    const REFRESH_INTERVAL = 4 * 60 * 1000; // 4 minutes

    setInterval(() => {
        // Never interrupt a pending initial load, background revalidation or manual refresh.
        if (document.getElementById('settings-dialog').hidden && !document.querySelector('.board.loading') && Date.now() - lastInteraction > 30000) {
            console.log('[WakeLock] Performing keep-alive refresh...');
            window.location.reload();
        }
    }, REFRESH_INTERVAL);

    console.log('[WakeLock] ✓ Periodic refresh armed (every 4 min)');
}

// --- Strategy 5: DOM mutation keep-alive ---
function startDOMMutationKeepAlive() {
    // Periodically mutate the DOM to simulate page activity
    // Some TVs track DOM changes as a sign of active content
    const el = document.createElement('div');
    el.id = 'wakelock-heartbeat';
    el.style.cssText = 'position:fixed;bottom:0;right:0;width:1px;height:1px;opacity:0;pointer-events:none;';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);

    setInterval(() => {
        // Toggle content to force a DOM mutation
        el.textContent = el.textContent === '.' ? '' : '.';
        // Also trigger a layout recalculation
        void el.offsetHeight;
    }, 5000); // every 5 seconds

    // Also change document title periodically
    setInterval(() => {
        document.title = document.title.endsWith(' ')
            ? document.title.trimEnd()
            : document.title + ' ';
    }, 15000);

    console.log('[WakeLock] ✓ DOM mutation keep-alive active');
}


window.HeliosWake={start:requestWakeLock};
})();
