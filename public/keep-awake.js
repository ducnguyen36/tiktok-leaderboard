'use strict';
(function(){
let lastInteraction=Date.now();
['pointerdown','pointermove','keydown'].forEach(type=>document.addEventListener(type,()=>lastInteraction=Date.now(),{passive:true}));
let _wakeLockSentinel = null;
let _wakeLockVideo = null;
let _wakeLockCanvas = null;
let _wakeLockAudioCtx = null;

async function requestWakeLock() {
    console.log('[WakeLock] Initializing anti-sleep system...');

    // Strategy 1: Samsung Tizen Power API
    tryTizenPowerLock();

    // Strategy 2: Native Wake Lock API
    tryNativeWakeLock();

    // Strategy 3: Video playback (larger, visible-enough for TV OS detection)
    startVideoKeepAwake();

    // Strategy 4: Web Audio silent tone (keeps audio pipeline active)
    startSilentAudio();

    // Strategy 5: Canvas animation (keeps GPU/rendering active)
    startCanvasAnimation();

    // Strategy 6: Periodic page refresh to reset TV idle timer
    startPeriodicRefresh();

    // Strategy 7: Simulate activity via DOM mutations
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

// --- Strategy 3: Video playback keep-awake ---
function startVideoKeepAwake() {
    try {
        // Create a canvas-generated video stream instead of a static file
        // This is more reliable on smart TVs as it's an active media stream
        const canvas = document.createElement('canvas');
        canvas.width = 2;
        canvas.height = 2;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, 2, 2);

        const video = document.createElement('video');
        video.setAttribute('playsinline', '');
        video.setAttribute('muted', '');
        video.setAttribute('loop', '');
        video.muted = true;
        video.volume = 0;
        // Make it small but NOT invisible — some TVs ignore 0-size or fully hidden elements
        video.style.cssText = 'position:fixed;bottom:0;right:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:9999;';
        document.body.appendChild(video);
        _wakeLockVideo = video;

        // Try canvas captureStream (works on Chromium-based TV browsers)
        if (canvas.captureStream) {
            const stream = canvas.captureStream(1); // 1 fps
            video.srcObject = stream;

            // Animate the canvas to keep the stream active
            const animateCanvas = () => {
                ctx.fillStyle = `rgb(0,0,${Math.random() > 0.5 ? 1 : 0})`;
                ctx.fillRect(0, 0, 2, 2);
                requestAnimationFrame(animateCanvas);
            };
            animateCanvas();
        } else {
            // Fallback: use base64 webm
            video.src = 'data:video/webm;base64,GkXfo0AgQoaBAUL3gQFC8oEEQvOBCEKCQAR3ZWJtQoeBAkKFgQIYU4BnQI0VSalmQCgq17FAAw9CQE2AQAZ3aGFtbXlXQUAGd2hhbW15RIlACECPQAAAAAAAFlSua0AxrkAu14EBY8WBAZyBACK1nEADdW5khkAFVl9WUDglhohAA1ZQOIOBAeBABrCBCLqBCB9DtnVAIueBAKNAHIEAAIAwAQCdASoIAAgAAUAmJaQAA3AA/vz0AAA=';
        }

        const playVideo = () => {
            video.play().then(() => {
                console.log('[WakeLock] ✓ Video playing');
            }).catch(() => {
                // Wait for user interaction
                const startOnInteract = () => {
                    video.play().catch(() => {});
                    document.removeEventListener('click', startOnInteract);
                    document.removeEventListener('keydown', startOnInteract);
                    document.removeEventListener('touchstart', startOnInteract);
                };
                document.addEventListener('click', startOnInteract);
                document.addEventListener('keydown', startOnInteract);
                document.addEventListener('touchstart', startOnInteract);
            });
        };

        playVideo();

        // Auto-restart if paused
        video.addEventListener('pause', () => {
            setTimeout(() => video.play().catch(() => {}), 200);
        });
        video.addEventListener('ended', () => {
            video.currentTime = 0;
            video.play().catch(() => {});
        });

        // Periodically ensure video is still playing
        setInterval(() => {
            if (video.paused) {
                video.play().catch(() => {});
            }
        }, 10000);

    } catch (e) {
        console.log('[WakeLock] Video strategy failed:', e.message);
    }
}

// --- Strategy 4: Web Audio silent tone ---
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

// --- Strategy 5: Canvas animation (keeps GPU active) ---
function startCanvasAnimation() {
    try {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        canvas.style.cssText = 'position:fixed;bottom:0;left:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-1;';
        document.body.appendChild(canvas);
        _wakeLockCanvas = canvas;

        const ctx = canvas.getContext('2d');
        let frame = 0;

        const animate = () => {
            frame++;
            // Tiny pixel change to force GPU render
            ctx.fillStyle = frame % 2 === 0 ? '#000' : '#001';
            ctx.fillRect(0, 0, 1, 1);
            requestAnimationFrame(animate);
        };
        animate();
        console.log('[WakeLock] ✓ Canvas animation active');
    } catch (e) {
        console.log('[WakeLock] Canvas strategy failed:', e.message);
    }
}

// --- Strategy 6: Periodic page refresh (nuclear option for stubborn TVs) ---
function startPeriodicRefresh() {
    // Reload the page every 4 minutes to reset the TV's idle timer
    // This is a last resort but very reliable on all TV platforms
    const REFRESH_INTERVAL = 4 * 60 * 1000; // 4 minutes

    setInterval(() => {
        // Only auto-refresh if no user interaction in the last 30 seconds
        if (document.getElementById('settings-dialog').hidden && Date.now() - lastInteraction > 30000) {
            console.log('[WakeLock] Performing keep-alive refresh...');
            // Use soft refresh — preserves state via localStorage
            window.location.reload();
        }
    }, REFRESH_INTERVAL);

    console.log('[WakeLock] ✓ Periodic refresh armed (every 4 min)');
}

// --- Strategy 7: DOM mutation keep-alive ---
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
