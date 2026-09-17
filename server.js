require('dotenv').config();
process.env.TZ = 'Asia/Ho_Chi_Minh';
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const dns = require('dns');
const {
    createHistoryArchiveService,
    latestClosedHistoryMonth,
    loadLeaderboardDependencies,
    parseFreshContext,
    previousCalendarMonth,
    validateRequestedHistoryMonth,
} = require('./leaderboardHistory');
const { createWindowContext, buildGiftBucketPipeline, decodeGiftBuckets, createLeaderboardCache, createSessionBucketStore, observeStreamCompletion } = require('./leaderboardPerformance');

// --- Global crash guards: prevent container from dying on unhandled errors ---
process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught exception (kept alive):', err.message);
    console.error(err.stack);
});
process.on('unhandledRejection', (reason) => {
    console.error('[FATAL] Unhandled rejection (kept alive):', reason);
});

// --- Memory monitoring ---
function logMemory(label) {
    const mem = process.memoryUsage();
    const rss = (mem.rss / 1024 / 1024).toFixed(1);
    const heap = (mem.heapUsed / 1024 / 1024).toFixed(1);
    const heapTotal = (mem.heapTotal / 1024 / 1024).toFixed(1);
    console.log(`[Memory] ${label}: RSS=${rss}MB, Heap=${heap}/${heapTotal}MB`);
}

// Fix DNS for SRV lookups (same as helioscontrol)
dns.setDefaultResultOrder('ipv4first');
try { dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']); } catch (e) { /* ignore */ }

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Cache-busting version for static assets: a content hash of every client runtime file.
// Cloudflare/browsers cache these with a 4h TTL, so without this a deploy can
// leave stale JS running against fresh HTML (e.g. empty Groups panel). The hash
// changes only when the client code changes, so each deploy invalidates the cache.
function computeAssetVersion() {
    try {
        const h = crypto.createHash('sha1');
        for (const file of ['app.js', 'style.css', 'leaderboard-core.js', 'keep-awake.js']) {
            const filePath = path.join(__dirname, 'public', file);
            if (fs.existsSync(filePath)) h.update(fs.readFileSync(filePath));
        }
        return h.digest('hex').slice(0, 10);
    } catch (e) {
        return String(Date.now());
    }
}
const ASSET_VERSION = computeAssetVersion();

// OBS overlay (/?overlay=true) + cache-busted index.html.
// Registered BEFORE express.static, which would otherwise serve index.html for '/'.
app.get('/', (req, res) => {
    if (req.query.overlay === 'true') {
        res.set('Cache-Control', 'no-cache');
        return res.sendFile(path.join(__dirname, 'public', 'overlay.html'));
    }
    // Serve index.html with versioned asset URLs so JS/CSS updates take effect on the
    // next load instead of waiting out the CDN/browser TTL. HTML itself is not cached.
    try {
        const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8')
            .replace('/style.css', `/style.css?v=${ASSET_VERSION}`)
            .replace('/app.js', `/app.js?v=${ASSET_VERSION}`)
            .replace('/leaderboard-core.js', `/leaderboard-core.js?v=${ASSET_VERSION}`)
            .replace('/keep-awake.js', `/keep-awake.js?v=${ASSET_VERSION}`);
        res.set('Cache-Control', 'no-cache');
        res.type('html').send(html);
    } catch (e) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

// Serve static files from public/
app.use(express.static(path.join(__dirname, 'public')));

// --- Avatar directories ---
const ELECTRON_AVATARS = path.join(process.env.APPDATA || '', 'HeliosControl', 'avatars');
const DEV_AVATARS = path.join(__dirname, '..', 'helioscontrol', 'avatars');
const LOCAL_AVATARS = path.join(__dirname, 'avatars'); // local cache for fetched avatars

// Ensure local avatars dir exists
if (!fs.existsSync(LOCAL_AVATARS)) fs.mkdirSync(LOCAL_AVATARS, { recursive: true });

// Serve avatars at /userdata/avatars/* (matches the avatarUrl format in MongoDB)
app.get('/userdata/avatars/:filename', (req, res) => {
    const filename = req.params.filename;
    const paths = [
        path.join(ELECTRON_AVATARS, filename),
        path.join(DEV_AVATARS, filename),
        path.join(LOCAL_AVATARS, filename)
    ];

    for (const p of paths) {
        if (fs.existsSync(p)) {
            return res.sendFile(p);
        }
    }
    res.status(404).send('Avatar not found');
});

// --- Health Check (lightweight, no aggregation) ---
app.get('/api/health', (req, res) => {
    res.json({ status: db ? 'ok' : 'no_db', uptime: process.uptime() });
});

// --- Debug: compare time boundaries and gift counts ---
app.get('/api/debug', async (req, res) => {
    if (!db) return res.json({ error: 'no db' });
    // if (!db) return res.status(503).json({ status: 'error', error: 'Database not connected' });

   
        const parsed = parseInt(req.query.resetHour);
        const resetHour = isNaN(parsed) ? 0 : parsed;
        const now = new Date();

        const dailyStart = new Date(now);
        dailyStart.setHours(resetHour, 0, 0, 0);
        if (now < dailyStart) dailyStart.setDate(dailyStart.getDate() - 1);

        const monthlyStart = new Date(now.getFullYear(), now.getMonth(), 1, resetHour, 0, 0, 0);

        const totalGifts = await db.collection('gifts').countDocuments();
        const dailyGifts = await db.collection('gifts').countDocuments({ timeStamp: { $gte: dailyStart.getTime() } });
        const monthlyGifts = await db.collection('gifts').countDocuments({ timeStamp: { $gte: monthlyStart.getTime() } });

        res.json({
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            now: now.toISOString(),
            nowLocal: now.toString(),
            dailyStart: { iso: dailyStart.toISOString(), local: dailyStart.toString(), ms: dailyStart.getTime() },
            monthlyStart: { iso: monthlyStart.toISOString(), local: monthlyStart.toString(), ms: monthlyStart.getTime() },
            giftCounts: { total: totalGifts, daily: dailyGifts, monthly: monthlyGifts }
        });
   
});

// --- MongoDB Connection ---
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
let db = null;
let mongoClient = null;
let isReconnecting = false;

// --- SSE (Server-Sent Events) for real-time push ---
const sseClients = new Set();

async function connectDB() {
    try {
        console.log('[Database] Connecting to MongoDB...');
        // Close existing client if any (reconnect scenario)
        if (mongoClient) {
            try { await mongoClient.close(true); } catch (e) { /* ignore */ }
        }
        mongoClient = new MongoClient(MONGODB_URI, {
            serverSelectionTimeoutMS: 15000,
            connectTimeoutMS: 15000,
            socketTimeoutMS: 45000,
        });
        await mongoClient.connect();

        const uriDb = new URL(MONGODB_URI.replace('mongodb+srv://', 'https://')).pathname.slice(1);
        db = mongoClient.db(uriDb || 'helioscontrol');
        lastEnsuredClosedMonth = ''; // reconnects must re-check durable history state

        console.log(`[Database] Connected to: ${db.databaseName}`);

        // Ensure indexes
        await db.collection('gifts').createIndex({ timeStamp: 1 });
        await db.collection('gifts').createIndex({ sessionId: 1, timeStamp: 1 });
        await db.collection('gifts').createIndex({ receivedTalent: 1 });
        await db.collection('profiles').createIndex({ updatedAt: -1 });
        await db.collection('leaderboard_monthly_snapshots').createIndex(
            { month: 1, aggregationVersion: 1, timezone: 1, periodStart: 1, periodEnd: 1 },
            { unique: true }
        );

        // Monitor for disconnects and auto-reconnect
        mongoClient.on('close', () => {
            console.warn('[Database] Connection closed unexpectedly');
            db = null;
            invalidateLeaderboard();
            scheduleReconnect();
        });
        mongoClient.on('error', (err) => {
            console.error('[Database] Client error:', err.message);
        });

        return db;
    } catch (err) {
        console.error('[Database] Connection failed:', err.message);
        throw err;
    }
}

// Reconnect with exponential backoff (5s, 10s, 20s, 40s… max 5min)
let reconnectAttempt = 0;
function scheduleReconnect() {
    if (isReconnecting) return;
    isReconnecting = true;
    const delay = Math.min(5000 * Math.pow(2, reconnectAttempt), 5 * 60 * 1000);
    reconnectAttempt++;
    console.log(`[Database] Reconnecting in ${delay / 1000}s (attempt #${reconnectAttempt})...`);
    setTimeout(async () => {
        isReconnecting = false;
        try {
            await connectDB();
            reconnectAttempt = 0;
            console.log('[Database] ✅ Reconnected successfully');
            // Restart change streams after reconnect
            startChangeStreams();
            ensureLatestClosedHistory()
                .catch(err => console.error('[History] Reconnect backfill failed:', err.message));
            // Refresh cache
            try {
                await buildLeaderboardData(lastResetHour, lastFreezeUntil);
            } catch (e) { /* cache refresh can fail gracefully */ }
        } catch (err) {
            console.error('[Database] Reconnect failed:', err.message);
            scheduleReconnect(); // try again
        }
    }, delay);
}

// fetch() with a hard timeout so a slow/hung TikTok response can never stall
// the background avatar queue indefinitely.
function fetchWithTimeout(url, opts = {}, ms = 8000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

// ==========================================
// TikTok Avatar Fetcher (fallback)
// Strategy 1: tikwm.com API (no auth, reliable in Docker)
// Strategy 2: TikTok page scraping (fallback)
// ==========================================
async function fetchTikTokAvatar(username) {
    if (!username) return '';
    const cleanUsername = username.replace('@', '');

    try {
        console.log(`[TikTokAPI] Fetching avatar for: ${cleanUsername}`);
        let avatarSource = '';

        // Strategy 1: tikwm.com API (no auth needed, returns JSON with avatar)
        try {
            const tikwmRes = await fetchWithTimeout(`https://www.tikwm.com/api/user/info?unique_id=${cleanUsername}`, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
            });
            if (tikwmRes.ok) {
                const tikwmData = await tikwmRes.json();
                if (tikwmData.data && tikwmData.data.user) {
                    const u = tikwmData.data.user;
                    avatarSource = u.avatarLarger || u.avatarMedium || u.avatarThumb || '';
                    if (avatarSource) {
                        console.log(`[TikTokAPI] Found avatar via tikwm for: ${cleanUsername}`);
                    }
                }
            }
        } catch (e) {
            console.log('[TikTokAPI] tikwm failed:', e.message);
        }

        // Strategy 2: TikTok webapp page scraping (fallback)
        if (!avatarSource) {
            try {
                const url = `https://www.tiktok.com/@${cleanUsername}?is_from_webapp=1&sender_device=pc`;
                const response = await fetchWithTimeout(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.5',
                        'Cookie': `sessionid=${process.env.TIKTOK_SESSION_ID || ''}`
                    }
                });

                if (response.ok) {
                    const html = await response.text();

                    // Try SIGI_STATE
                    const sigiMatch = html.match(/<script id="SIGI_STATE" type="application\/json">(.*?)<\/script>/);
                    if (sigiMatch && sigiMatch[1]) {
                        try {
                            const sigiData = JSON.parse(sigiMatch[1]);
                            const userModule = sigiData.UserModule;
                            if (userModule && userModule.users && userModule.users[cleanUsername]) {
                                avatarSource = userModule.users[cleanUsername].avatarLarger || '';
                                if (avatarSource) console.log(`[TikTokAPI] Found avatar via SIGI_STATE`);
                            }
                        } catch (e) { /* ignore parse error */ }
                    }

                    // Try userInfo regex
                    if (!avatarSource) {
                        const userMatch = html.match(/"userInfo"\s*:\s*\{\s*"user"\s*:\s*(\{.+?\})\s*,\s*"stats"/);
                        if (userMatch && userMatch[1]) {
                            try {
                                const userData = JSON.parse(userMatch[1]);
                                avatarSource = userData.avatarLarger || '';
                                if (avatarSource) console.log(`[TikTokAPI] Found avatar via regex fallback`);
                            } catch (e) { /* ignore */ }
                        }
                    }

                    // Try hydration pattern
                    if (!avatarSource) {
                        const hydrationMatch = html.match(/"webapp\.user-detail"\s*:\s*(\{.+"userInfo".+\})(?=,\s*"webapp)/);
                        if (hydrationMatch && hydrationMatch[1]) {
                            try {
                                const detail = JSON.parse(hydrationMatch[1]);
                                avatarSource = detail.userInfo.user.avatarLarger || '';
                                if (avatarSource) console.log(`[TikTokAPI] Found avatar via hydration regex`);
                            } catch (e) { /* ignore */ }
                        }
                    }
                }
            } catch (e) {
                console.log('[TikTokAPI] Webapp scraping failed:', e.message);
            }
        }

        if (!avatarSource) {
            console.log(`[TikTokAPI] No avatar found for ${cleanUsername}`);
            return '';
        }

        // Download avatar image
        const imgRes = await fetchWithTimeout(avatarSource);
        if (imgRes.ok) {
            const arrayBuffer = await imgRes.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const fileName = `${cleanUsername}_${Date.now()}.jpg`;
            fs.writeFileSync(path.join(LOCAL_AVATARS, fileName), buffer);
            recordDiskAvatar(fileName); // keep the username→file index fresh
            const avatarUrl = `userdata/avatars/${fileName}`;
            console.log(`[TikTokAPI] ✅ Avatar saved for ${cleanUsername}: ${avatarUrl}`);
            return avatarUrl;
        }
    } catch (err) {
        console.error(`[TikTokAPI] Error fetching avatar for ${cleanUsername}:`, err.message);
    }
    return '';
}

// ==========================================
// AVATAR RESOLUTION
// Checks if an avatar file exists, falls back to TikTok scraping
// ==========================================
function avatarFileExists(avatarUrl) {
    if (!avatarUrl) return false;
    // Extract filename from 'userdata/avatars/xxx.jpg'
    const filename = avatarUrl.replace(/^userdata\/avatars\//, '');
    const paths = [
        path.join(ELECTRON_AVATARS, filename),
        path.join(DEV_AVATARS, filename),
        path.join(LOCAL_AVATARS, filename)
    ];
    return paths.some(p => fs.existsSync(p));
}

// Sequential fetch queue — tikwm rate-limits concurrent requests
// This ensures only one avatar fetch runs at a time with a small delay
const fetchQueue = [];
let isFetchingAvatars = false;
const FETCH_DELAY_MS = 200; // 200ms between requests

function enqueueAvatarFetch(fn) {
    return new Promise((resolve, reject) => {
        fetchQueue.push({ fn, resolve, reject });
        processQueue();
    });
}

async function processQueue() {
    if (isFetchingAvatars || fetchQueue.length === 0) return;
    isFetchingAvatars = true;

    while (fetchQueue.length > 0) {
        const { fn, resolve, reject } = fetchQueue.shift();
        try {
            const result = await fn();
            resolve(result);
        } catch (err) {
            reject(err);
        }
        // Small delay between requests to avoid rate limiting
        if (fetchQueue.length > 0) {
            await new Promise(r => setTimeout(r, FETCH_DELAY_MS));
        }
    }

    isFetchingAvatars = false;
}

// In-flight fetch tracker to avoid duplicate TikTok fetches
const pendingFetches = new Map();

// Avatar cache: { url, fetchedAt, failed, lastGoodUrl } — avoids re-fetching constantly
const avatarCache = new Map();
const AVATAR_CACHE_TTL = 8 * 60 * 60 * 1000;   // 8 hours for successful fetches
const AVATAR_FAIL_TTL = 30 * 1000;              // 30 seconds before retrying failed fetches

// ------------------------------------------------------------------
// Disk avatar index — maps a TikTok username to a previously-fetched
// avatar file on the persistent volume (LOCAL_AVATARS). Rebuilt at
// startup so fetched avatars survive container restarts WITHOUT
// re-hitting TikTok. Files are named "<username>_<timestamp>.jpg".
// ------------------------------------------------------------------
const diskAvatarIndex = new Map(); // username -> 'userdata/avatars/<file>'
const diskAvatarTs = new Map();    // username -> newest timestamp seen

function normAvatarKey(u) {
    return (u || '').replace('@', '');
}

function recordDiskAvatar(file) {
    const m = file.match(/^(.+)_(\d+)\.jpg$/);
    if (!m) return;
    const key = m[1];
    const ts = Number(m[2]);
    if (ts >= (diskAvatarTs.get(key) || 0)) {
        diskAvatarTs.set(key, ts);
        diskAvatarIndex.set(key, `userdata/avatars/${file}`);
    }
}

function buildDiskAvatarIndex() {
    diskAvatarIndex.clear();
    diskAvatarTs.clear();
    try {
        for (const file of fs.readdirSync(LOCAL_AVATARS)) recordDiskAvatar(file);
        console.log(`[Avatars] Indexed ${diskAvatarIndex.size} cached avatars on disk`);
    } catch (e) {
        console.log('[Avatars] Disk index build failed:', e.message);
    }
}

// Non-blocking avatar resolution used during leaderboard builds.
// Returns instantly from local/cached sources; on a miss it kicks off a
// background fetch (fire-and-forget) and returns the best value available
// now, so the build NEVER waits on the network. The fetched avatar shows
// up on the next rebuild (change-stream/poll/refresh).
function resolveAvatarFast(avatarUrl, tiktokUsername) {
    // 1. Stored avatar file already present on disk
    if (avatarUrl && avatarFileExists(avatarUrl)) return avatarUrl;

    const key = normAvatarKey(tiktokUsername);

    // 2. Previously-fetched file on the persistent volume
    if (key && diskAvatarIndex.has(key)) return diskAvatarIndex.get(key);

    // 3. In-memory cache hit (this process)
    if (key) {
        const cached = avatarCache.get(key) || avatarCache.get(tiktokUsername);
        if (cached && Date.now() - cached.fetchedAt < (cached.failed ? AVATAR_FAIL_TTL : AVATAR_CACHE_TTL)) {
            return cached.url || cached.lastGoodUrl || avatarUrl || '';
        }
    }

    // 4. Miss — fetch in the background (fire-and-forget), return best-effort now
    if (tiktokUsername) resolveAvatar(avatarUrl, tiktokUsername).catch(() => {});
    return avatarUrl || '';
}

async function resolveAvatar(avatarUrl, tiktokUsername) {
    // If avatar URL exists and the file is present, use it directly
    if (avatarUrl && avatarFileExists(avatarUrl)) {
        return avatarUrl;
    }

    // No username to fall back to
    if (!tiktokUsername) return avatarUrl || '';

    // Check cache — avoid re-fetching if we already tried recently
    const cached = avatarCache.get(tiktokUsername);
    if (cached) {
        const age = Date.now() - cached.fetchedAt;
        const ttl = cached.failed ? AVATAR_FAIL_TTL : AVATAR_CACHE_TTL;
        if (age < ttl) {
            // Cache still valid — return cached result (or empty for failures)
            return cached.url || avatarUrl || '';
        }
        // Cache expired, will re-fetch below
    }

    // Deduplicate concurrent fetches for the same username
    if (pendingFetches.has(tiktokUsername)) {
        return pendingFetches.get(tiktokUsername);
    }

    const fetchPromise = (async () => {
        try {
            // Use queue to avoid overwhelming tikwm with concurrent requests
            const result = await enqueueAvatarFetch(() => fetchTikTokAvatar(tiktokUsername));
            // Find last good URL from a previous successful file
            const previousGood = cached ? cached.lastGoodUrl : '';
            // Cache the result
            avatarCache.set(tiktokUsername, {
                url: result || '',
                fetchedAt: Date.now(),
                failed: !result,
                lastGoodUrl: result || previousGood || ''
            });
            return result || previousGood || avatarUrl || '';
        } catch (err) {
            const previousGood = cached ? cached.lastGoodUrl : '';
            // Cache the failure so we retry after AVATAR_FAIL_TTL
            avatarCache.set(tiktokUsername, {
                url: '',
                fetchedAt: Date.now(),
                failed: true,
                lastGoodUrl: previousGood || ''
            });
            return previousGood || avatarUrl || '';
        } finally {
            pendingFetches.delete(tiktokUsername);
        }
    })();

    pendingFetches.set(tiktokUsername, fetchPromise);
    return fetchPromise;
}

// ==========================================
// PROFILE & TALENT DATA HELPERS
// ==========================================
async function readProfilesFromDb() {
    const all = await db.collection('profiles').find({}, { projection: { name: 1, avatar: 1, username: 1, talents: 1, updatedAt: 1, locationId: 1 } }).toArray();
    // Filter out accidental "new profile" entries.
    return all.filter(profile => {
        const name = (profile.name || '').toLowerCase().trim();
        return name !== 'new profile';
    });
}

async function readSessionProfileMapFromDb() {
    const sessions = await db.collection('sessions').find(
        {},
        { projection: { profileId: 1 } }
    ).toArray();
    const sessionProfileMap = {};
    for (const session of sessions) {
        if (session.profileId) sessionProfileMap[session._id.toString()] = session.profileId;
    }
    return sessionProfileMap;
}

async function readLocationsFromDb() {
    const documents = await db.collection('locations').find().sort({ createdAt: 1 }).toArray();
    return documents.map(document => ({ id: document._id, name: document.name || document._id }));
}

const liveDependencyRepository = {
    readProfiles: readProfilesFromDb,
    readSessionProfileMap: readSessionProfileMapFromDb,
    readLocations: readLocationsFromDb,
};

const { buildTalentAvatars, buildProfileMap, buildTalentToProfileMap, buildProfileNameToIdMap, buildUidMaps, aggregateIndividual, aggregateGroup } = require('./leaderboardAggregation');

// ==========================================
// SHARED AGGREGATION (used by API + SSE push)
// ==========================================
const lastResetHour = 0; // background warm-up only; client settings are scoped per request
const lastFreezeUntil = '09:00';

// ==========================================
// DATA CACHE — serve instantly, refresh in background
// ==========================================
const CACHE_BG_INTERVAL = 60 * 60 * 1000; // 1 hour background refresh when no clients

// ==========================================
// PERSISTENT SNAPSHOT — instant cold start
// The last computed result is stored in MongoDB so a fresh container can
// serve it after one small read while a full rebuild runs in the background.
// Survives restarts AND container replacement (each deploy = new container).
// ==========================================
const SNAPSHOT_COLLECTION = 'leaderboard_cache';
const SNAPSHOT_SAVE_THROTTLE = 60 * 1000; // persist at most once/min (builds run every ~10s)
const snapshotSavedAt = new Map();
const hydratedContexts = new Set();
// Sixteen bounded durable slots. Collisions only discard a warm-start opportunity;
// identity validation below prevents ever serving another context's result.
function snapshotId(context) { return `v2:${crypto.createHash('sha256').update(context.key).digest('hex')[0]}`; }

async function loadSnapshot(context) {
    if (!db) return null;
    try {
        return await db.collection(SNAPSHOT_COLLECTION).findOne({ _id: snapshotId(context) });
    } catch (e) {
        console.error('[Snapshot] Load failed:', e.message);
        return null;
    }
}

async function saveSnapshot(document, context) {
    if (!db) return;
    const now = Date.now();
    const id = snapshotId(context);
    if (now - (snapshotSavedAt.get(id) || 0) < SNAPSHOT_SAVE_THROTTLE) return;
    snapshotSavedAt.set(id, now);
    try {
        await db.collection(SNAPSHOT_COLLECTION).updateOne({ _id: id }, { $set: document }, { upsert: true });
    } catch (error) { snapshotSavedAt.delete(id); throw error; }
}

const giftBucketStore = createSessionBucketStore({
    async read(context, sessionIds) {
        if (!db) throw new Error('Database not connected');
        const docs = await db.collection('gifts').aggregate(buildGiftBucketPipeline({ windows: context.windows, sessionIds }), { allowDiskUse: true, maxTimeMS: 60000 }).toArray();
        return decodeGiftBuckets(docs);
    },
});
const leaderboardCache = createLeaderboardCache({
    build: (context, options) => _buildLeaderboardDataInner(context, options),
    isStale: context => giftBucketStore.isStale(context),
    onPublish(document, context) {
        debouncedBroadcast();
        return saveSnapshot(document, context);
    },
    onError: error => console.error('[LeaderboardCache]', error.message),
});

async function getLeaderboardResult(resetHour, freezeUntil, { force = false } = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
        const context = createWindowContext(resetHour, freezeUntil || '');
        if (!force && !hydratedContexts.has(context.key)) {
            hydratedContexts.add(context.key);
            while (hydratedContexts.size > 8) hydratedContexts.delete(hydratedContexts.values().next().value);
            const document = await loadSnapshot(context);
            leaderboardCache.hydrate(document, context);
        }
        const result = await leaderboardCache.get(context, { force });
        // A slow cold build must not cross a freeze/month/day boundary and return
        // yesterday's context to a request completing after that boundary.
        if (createWindowContext(resetHour, freezeUntil || '').key === context.key) return result;
    }
    throw new Error('Leaderboard window changed during refresh; retry shortly');
}

async function buildLeaderboardData(resetHour, freezeUntil, options = {}) {
    return (await getLeaderboardResult(resetHour, freezeUntil, options)).data;
}

async function _buildLeaderboardDataInner(context, { force = false } = {}) {
    const isFrozen = context.frozen;
    const mw = context.monthly;

    const { profiles, sessionProfileMap, locations } = await loadLeaderboardDependencies(
        liveDependencyRepository,
        {
            strict: true,
            onOptionalError(name, error) {
                if (name === 'readProfiles') {
                    console.error('[Profiles] Error loading:', error.message);
                }
            },
        }
    );
    const talentAvatarMap = buildTalentAvatars(profiles);
    const profileMap = buildProfileMap(profiles);
    const talentToProfile = buildTalentToProfileMap(profiles);
    const profileNameToId = buildProfileNameToIdMap(profiles);
    const { uidToTalent, uidToProfile } = buildUidMaps(profiles);

    const allBuckets = await giftBucketStore.get(context, { force });
    const allDailyGifts = allBuckets.filter(g => g.daily);
    const allYesterdayGifts = allBuckets.filter(g => g.yesterday);
    const allDisplayedMonthlyGifts = allBuckets.filter(g => g.monthly);

    // Individual view excludes manual gifts
    const isNotManual = g => !g.manual;
    const dailyGifts = allDailyGifts.filter(isNotManual);
    const yesterdayGifts = allYesterdayGifts.filter(isNotManual);
    const monthlyGifts = allDisplayedMonthlyGifts.filter(isNotManual);

    // Run all 6 aggregations (today + yesterday for daily)
    // Individual uses non-manual gifts; Group uses ALL gifts + session map
    const [individualDaily, individualYesterday, individualMonthly, groupDaily, groupYesterday, groupMonthly] = await Promise.all([
        aggregateIndividual(dailyGifts, talentAvatarMap, profileNameToId, uidToTalent, talentToProfile, profileMap, uidToProfile),
        aggregateIndividual(yesterdayGifts, talentAvatarMap, profileNameToId, uidToTalent, talentToProfile, profileMap, uidToProfile),
        aggregateIndividual(monthlyGifts, talentAvatarMap, profileNameToId, uidToTalent, talentToProfile, profileMap, uidToProfile),
        aggregateGroup(allDailyGifts, talentToProfile, profileMap, profileNameToId, uidToTalent, uidToProfile, sessionProfileMap),
        aggregateGroup(allYesterdayGifts, talentToProfile, profileMap, profileNameToId, uidToTalent, uidToProfile, sessionProfileMap),
        aggregateGroup(allDisplayedMonthlyGifts, talentToProfile, profileMap, profileNameToId, uidToTalent, uidToProfile, sessionProfileMap)
    ]);

    // Format individual: resolve avatar from cache/disk only (non-blocking).
    // Missing avatars are fetched in the background and appear on the next build.
    function formatIndividual(raw) {
        return raw.map(entry => {
            const talentInfo = talentAvatarMap[entry._id] || {};
            const avatar = resolveAvatarFast(talentInfo.avatarUrl, talentInfo.uniqueId);
            return {
                name: entry._id,
                value: entry.totalDiamonds,
                avatar
            };
        });
    }

    // Format group: use profile avatar from cache/disk only (non-blocking).
    function formatGroup(raw) {
        return raw.map(entry => {
            const pInfo = profileMap[entry._id] || {};
            const avatar = resolveAvatarFast(pInfo.avatar, pInfo.username);
            return {
                name: entry.name,
                value: entry.totalDiamonds,
                avatar,
                locationId: pInfo.locationId || '',
                groupId: String(entry._id)
            };
        });
    }

    const [indDaily, indYesterday, indMonthly, grpDaily, grpYesterday, grpMonthly] = await Promise.all([
        formatIndividual(individualDaily),
        formatIndividual(individualYesterday),
        formatIndividual(individualMonthly),
        formatGroup(groupDaily),
        formatGroup(groupYesterday),
        formatGroup(groupMonthly)
    ]);

    // Build yesterday lookup maps for rank/value comparison
    function buildYesterdayMap(yesterdayArr) {
        const map = {};
        yesterdayArr.forEach((entry, idx) => {
            map[entry.name] = { rank: idx + 1, value: entry.value };
        });
        return map;
    }

    // Attach yesterday's data to each daily entry
    function attachYesterday(dailyArr, yesterdayArr) {
        const ydMap = buildYesterdayMap(yesterdayArr);
        return dailyArr.map((entry, idx) => ({
            ...entry,
            yesterday: ydMap[entry.name] || null
        }));
    }

    const indDailyWithHistory = attachYesterday(indDaily, indYesterday);
    const grpDailyWithHistory = attachYesterday(grpDaily, grpYesterday);

    // If frozen, use yesterday's daily data as today's daily
    // but still attach yesterday info for display
    const finalIndDaily = isFrozen ? attachYesterday(indYesterday, indYesterday) : indDailyWithHistory;
    const finalGrpDaily = isFrozen ? attachYesterday(grpYesterday, grpYesterday) : grpDailyWithHistory;

    // Build talent → locationId and talent → groupId maps for individual filtering
    const talentLocationMap = {};
    const talentGroupMap = {};
    for (const [pid, pInfo] of Object.entries(profileMap)) {
        for (const talentName of pInfo.talentNames) {
            talentLocationMap[talentName] = pInfo.locationId || '';
            talentGroupMap[talentName] = String(pid);
        }
    }

    // Attach locationId + groupId to individual entries (groupId = the talent's profile/group)
    function attachLocationToIndividual(arr) {
        return arr.map(entry => ({
            ...entry,
            locationId: talentLocationMap[entry.name] || '',
            groupId: talentGroupMap[entry.name] || ''
        }));
    }

    // Groups list (every profile = a group) for client-side group filtering, grouped by location
    const groups = Object.entries(profileMap)
        .map(([pid, p]) => ({ id: String(pid), name: p.name, locationId: p.locationId || '' }))
        .sort((a, b) => a.name.localeCompare(b.name));

    return {
        individual: {
            daily: attachLocationToIndividual(finalIndDaily),
            monthly: attachLocationToIndividual(indMonthly),
            yesterday: attachLocationToIndividual(indYesterday)
        },
        group: { daily: finalGrpDaily, monthly: grpMonthly, yesterday: grpYesterday },
        frozen: isFrozen,
        monthlyGrace: mw.inGrace,
        locations,
        groups
    };
}

// ==========================================
// EXACT MONTH HISTORY — durable, unfiltered snapshots
// ==========================================
const HISTORY_SNAPSHOT_COLLECTION = 'leaderboard_monthly_snapshots';

async function buildHistoricalLeaderboardData(period) {
    // History is publish-once when complete. Unlike the live board, every dependency
    // read is strict so a transient profile/session error cannot publish partial data.
    const profiles = await readProfilesFromDb();
    const talentAvatarMap = buildTalentAvatars(profiles);
    const profileMap = buildProfileMap(profiles);
    const talentToProfile = buildTalentToProfileMap(profiles);
    const profileNameToId = buildProfileNameToIdMap(profiles);
    const { uidToTalent, uidToProfile } = buildUidMaps(profiles);

    const sessionProfileMap = await readSessionProfileMapFromDb();

    const allGifts = decodeGiftBuckets(await db.collection('gifts').aggregate(
        buildGiftBucketPipeline({ start: Date.parse(period.start), end: Date.parse(period.end) }),
        { allowDiskUse: true, maxTimeMS: 60000 }
    ).toArray());
    const individualGifts = allGifts.filter(gift => !gift.manual);

    const individualRaw = aggregateIndividual(
        individualGifts,
        talentAvatarMap,
        profileNameToId,
        uidToTalent,
        talentToProfile,
        profileMap,
        uidToProfile
    );
    const groupRaw = aggregateGroup(
        allGifts,
        talentToProfile,
        profileMap,
        profileNameToId,
        uidToTalent,
        uidToProfile,
        sessionProfileMap
    );

    const talentLocationMap = {};
    const talentGroupMap = {};
    for (const [profileId, profile] of Object.entries(profileMap)) {
        for (const talentName of profile.talentNames) {
            talentLocationMap[talentName] = profile.locationId || '';
            talentGroupMap[talentName] = String(profileId);
        }
    }

    return {
        individual: individualRaw.map(entry => {
            const talent = talentAvatarMap[entry._id] || {};
            return {
                id: String(talent.id || entry._id),
                name: entry._id,
                value: entry.totalDiamonds,
                avatar: resolveAvatarFast(talent.avatarUrl, talent.uniqueId),
                groupId: talentGroupMap[entry._id] || '',
                locationId: talentLocationMap[entry._id] || '',
            };
        }),
        group: groupRaw.map(entry => {
            const profile = profileMap[entry._id] || {};
            const id = String(entry._id);
            return {
                id,
                name: entry.name,
                value: entry.totalDiamonds,
                avatar: resolveAvatarFast(profile.avatar, profile.username),
                groupId: id,
                locationId: profile.locationId || '',
            };
        }),
    };
}

const historyRepository = {
    async findById(id) {
        if (!db) throw new Error('Database not connected');
        return db.collection(HISTORY_SNAPSHOT_COLLECTION).findOne({ _id: id });
    },
    async upsertComplete(document) {
        if (!db) throw new Error('Database not connected');
        if (!document.complete) throw new Error('Refusing to persist an incomplete history period');
        await db.collection(HISTORY_SNAPSHOT_COLLECTION).updateOne(
            { _id: document._id },
            { $setOnInsert: document },
            { upsert: true }
        );
    },
};

const historyArchive = createHistoryArchiveService({
    repository: historyRepository,
    build: buildHistoricalLeaderboardData,
});

let lastEnsuredClosedMonth = '';
async function ensureLatestClosedHistory() {
    if (!db) return;
    const month = latestClosedHistoryMonth(new Date());
    if (lastEnsuredClosedMonth === month) return;
    await historyArchive.get(month);
    lastEnsuredClosedMonth = month;
    console.log(`[History] Ensured closed snapshot ${month}`);
}

// ==========================================
// SSE: REAL-TIME PUSH TO BROWSERS
// ==========================================
function broadcastLeaderboard() {
    const message = `data: ${JSON.stringify({ status: 'ok', invalidated: true })}\n\n`;
    for (const client of sseClients) {
        try {
            client.write(message);
        } catch (e) {
            sseClients.delete(client);
        }
    }
    if (sseClients.size > 0) {
        console.log(`[SSE] Pushed update to ${sseClients.size} client(s)`);
    }
}

app.get('/api/leaderboard/stream', (req, res) => {
    // SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    // Keep-alive
    res.write(':ok\n\n');

    // Track client
    sseClients.add(res);
    console.log(`[SSE] Client connected (${sseClients.size} total)`);

    // Each browser revalidates its own reset/freeze context through /current.
    res.write(`data: ${JSON.stringify({ status: 'ok', invalidated: true })}\n\n`);

    // Cleanup on disconnect
    req.on('close', () => {
        sseClients.delete(res);
        console.log(`[SSE] Client disconnected (${sseClients.size} remaining)`);
    });
});

// ==========================================
// CHANGE STREAMS: WATCH MongoDB FOR CHANGES
// ==========================================
let debounceTimer = null;
let activeGiftsStream = null;
let activeProfilesStream = null;
let activeSessionsStream = null;
let activeLocationsStream = null;

function invalidateLeaderboard() {
    giftBucketStore.invalidate();
    leaderboardCache.invalidate();
}

function stopChangeStreams() {
    if (activeGiftsStream) {
        try { activeGiftsStream.close(); } catch (e) { /* ignore */ }
        activeGiftsStream = null;
    }
    if (activeProfilesStream) {
        try { activeProfilesStream.close(); } catch (e) { /* ignore */ }
        activeProfilesStream = null;
    }
    for (const stream of [activeSessionsStream, activeLocationsStream]) {
        if (stream) stream.close().catch(() => {});
    }
    activeSessionsStream = activeLocationsStream = null;
}

function startChangeStreams() {
    if (!db) return;

    // Close any existing streams first to avoid duplicates.
    stopChangeStreams();
    invalidateLeaderboard();

    try {
        // Watch gifts collection
        activeGiftsStream = db.collection('gifts').watch([], { fullDocument: 'updateLookup' });
        const giftsStream = activeGiftsStream;
        observeStreamCompletion(giftsStream, () => activeGiftsStream === giftsStream, () => {
            activeGiftsStream = null; invalidateLeaderboard(); debouncedBroadcast();
        });
        activeGiftsStream.on('change', (change) => {
            console.log(`[ChangeStream] Gift ${change.operationType}`);
            giftBucketStore.change(change);
            leaderboardCache.invalidate();
            debouncedBroadcast();
        });
        activeGiftsStream.on('error', (err) => {
            console.error('[ChangeStream] Gifts stream error:', err.message);
            activeGiftsStream = null;
            invalidateLeaderboard();
            debouncedBroadcast();
            // Don't restart here — the MongoDB client 'close' event will trigger reconnection
        });

        // Watch profiles collection
        activeProfilesStream = db.collection('profiles').watch([], { fullDocument: 'updateLookup' });
        const profilesStream = activeProfilesStream;
        observeStreamCompletion(profilesStream, () => activeProfilesStream === profilesStream, () => {
            activeProfilesStream = null; invalidateLeaderboard(); debouncedBroadcast();
        });
        activeProfilesStream.on('change', (change) => {
            console.log(`[ChangeStream] Profile ${change.operationType}`);
            invalidateLeaderboard();
            debouncedBroadcast();
        });
        activeProfilesStream.on('error', (err) => {
            console.error('[ChangeStream] Profiles stream error:', err.message);
            activeProfilesStream = null;
            invalidateLeaderboard();
            debouncedBroadcast();
        });

        function watchDependency(collection) {
            const stream = db.collection(collection).watch([], { fullDocument: 'updateLookup' });
            observeStreamCompletion(stream, () => (collection === 'sessions' ? activeSessionsStream : activeLocationsStream) === stream, () => {
                if (collection === 'sessions') activeSessionsStream = null;
                else activeLocationsStream = null;
                invalidateLeaderboard(); debouncedBroadcast();
            });
            stream.on('change', () => { invalidateLeaderboard(); debouncedBroadcast(); });
            stream.on('error', error => {
                console.error(`[ChangeStream] ${collection} stream error:`, error.message);
                if (collection === 'sessions') activeSessionsStream = null;
                else activeLocationsStream = null;
                invalidateLeaderboard(); debouncedBroadcast();
            });
            return stream;
        }
        activeSessionsStream = watchDependency('sessions');
        activeLocationsStream = watchDependency('locations');

        console.log('[ChangeStream] Watching gifts, profiles, sessions and locations');
    } catch (err) {
        console.error('[ChangeStream] Failed to start:', err.message);
        invalidateLeaderboard();
    }
}

let lastBroadcastTime = 0;
const BROADCAST_THROTTLE = 10000; // At most 1 rebuild every 10 seconds

function debouncedBroadcast() {
    // Throttle + debounce: ensure at most 1 rebuild per 10s
    // If a build happened recently, schedule one for later
    // Keep the first scheduled deadline; continuous gifts must not postpone it.
    if (debounceTimer) return;

    const timeSinceLast = Date.now() - lastBroadcastTime;
    const delay = Math.max(BROADCAST_THROTTLE - timeSinceLast, 2000); // at least 2s debounce

    debounceTimer = setTimeout(async () => {
        debounceTimer = null;
        if (!db) return; // guard against broadcasting when DB is down
        try {
            lastBroadcastTime = Date.now();
            broadcastLeaderboard();
        } catch (err) {
            console.error('[ChangeStream] Broadcast error:', err.message);
        }
    }, delay);
}

// ==========================================
// API: LEADERBOARD (polling fallback)
// ==========================================
app.get('/api/leaderboard/fresh', async (req, res) => {
    let context;
    try {
        context = parseFreshContext(req.query);
    } catch (err) {
        return res.status(400).json({ status: 'error', message: err.message });
    }
    if (!db) {
        return res.status(503).json({ status: 'error', message: 'Database not connected' });
    }

    try {
        const result = await getLeaderboardResult(
            context.resetHour,
            context.freezeUntil,
            { force: true }
        );
        // Only this exact window/settings cache entry is replaced.
        res.set('Cache-Control', 'no-store').json(result);
    } catch (err) {
        console.error('[LeaderboardFresh] Error:', err.message);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.get(['/api/leaderboard/current', '/api/leaderboard'], async (req, res) => {
    let context;
    try { context = parseFreshContext(req.query); }
    catch (error) { return res.status(400).json({ status: 'error', message: error.message }); }
    try {
        const result = await getLeaderboardResult(context.resetHour, context.freezeUntil);
        res.set('Cache-Control', 'no-store').json(result);
    } catch (err) {
        console.error('[Leaderboard] Error:', err.message);
        res.status(db ? 500 : 503).json({ status: 'error', message: err.message });
    }
});

// ==========================================
// API: EXACT MONTH HISTORY + legacy last-month compatibility
// ==========================================
app.get('/api/leaderboard/history', async (req, res) => {
    try {
        validateRequestedHistoryMonth(req.query.month, new Date());
    } catch (err) {
        return res.status(400).json({ status: 'error', message: err.message });
    }
    if (!db) {
        return res.status(503).json({ status: 'error', message: 'Database not connected' });
    }

    try {
        const result = await historyArchive.get(req.query.month);
        res.json({ status: 'ok', ...result });
    } catch (err) {
        console.error('[History] Error:', err.message);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.get('/api/leaderboard/lastmonth', async (req, res) => {
    if (!db) {
        return res.status(503).json({ status: 'error', message: 'Database not connected' });
    }
    try {
        const result = await historyArchive.get(previousCalendarMonth(new Date()));
        res.json({ status: 'ok', data: result.data });
    } catch (err) {
        console.error('[LastMonth] Error:', err.message);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// Catch-all: serve index.html (but NOT for /api/ routes)
app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Start Server ---
// Start HTTP server first — it should ALWAYS be running, even without DB
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Leaderboard server running at http://0.0.0.0:${PORT}`);
    console.log(`📁 Avatars: Electron=${ELECTRON_AVATARS} | Dev=${DEV_AVATARS} | Local=${LOCAL_AVATARS}`);
    console.log(`🔴 SSE endpoint: /api/leaderboard/stream`);
});

// Connect to MongoDB (with retry on failure — never exits the process)
(async function initDB() {
    try {
        buildDiskAvatarIndex(); // index cached avatars so cold starts don't re-fetch
        await connectDB();
        reconnectAttempt = 0;

        // Start watching MongoDB for changes
        startChangeStreams();
        ensureLatestClosedHistory()
            .catch(err => console.error('[History] Startup backfill failed:', err.message));

        // The same strict context cache serves startup and browser requests.
        buildLeaderboardData(lastResetHour, lastFreezeUntil)
            .then(() => console.log('[Cache] Startup context available'))
            .catch(err => console.error('[Cache] Startup rebuild error:', err.message));
    } catch (err) {
        console.error('[Startup] Initial DB connection failed:', err.message);
        console.log('[Startup] Server is running WITHOUT database — will keep retrying...');
        scheduleReconnect();
    }
})();

// Background refresh every hour when no clients connected
setInterval(async () => {
    if (!db) return; // skip if DB is down
    if (sseClients.size > 0) return; // clients connected = cache stays fresh via change streams
    try {
        await buildLeaderboardData(lastResetHour, lastFreezeUntil);
        console.log('[Cache] Background refresh (no clients connected)');
    } catch (err) {
        console.error('[Cache] Background refresh error:', err.message);
    }
}, CACHE_BG_INTERVAL);

// Recover standalone stream failures too (not every stream error closes MongoClient).
setInterval(() => {
    if (db && (!activeGiftsStream || !activeProfilesStream || !activeSessionsStream || !activeLocationsStream)) startChangeStreams();
}, 30000);

// Ensure the latest closed calendar month exists even when no browser is open.
// A failed attempt is intentionally not memoized, so the next minute retries.
setInterval(() => {
    ensureLatestClosedHistory()
        .catch(err => console.error('[History] Periodic backfill failed:', err.message));
}, 60 * 1000);

// Periodic memory log (every 10 minutes)
setInterval(() => {
    logMemory('periodic');
    // Force garbage collection hint if available (run with --expose-gc)
    if (global.gc) {
        global.gc();
        logMemory('post-gc');
    }
}, 10 * 60 * 1000);
logMemory('startup');
