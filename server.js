require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { MongoClient } = require('mongodb');
const dns = require('dns');

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

        console.log(`[Database] Connected to: ${db.databaseName}`);

        // Ensure indexes
        await db.collection('gifts').createIndex({ timeStamp: 1 });
        await db.collection('gifts').createIndex({ receivedTalent: 1 });
        await db.collection('profiles').createIndex({ updatedAt: -1 });

        // Monitor for disconnects and auto-reconnect
        mongoClient.on('close', () => {
            console.warn('[Database] Connection closed unexpectedly');
            db = null;
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
            // Refresh cache
            try {
                const data = await buildLeaderboardData(lastResetHour, lastFreezeUntil);
                cachedData = data;
                cacheTimestamp = Date.now();
                broadcastLeaderboard(data);
            } catch (e) { /* cache refresh can fail gracefully */ }
        } catch (err) {
            console.error('[Database] Reconnect failed:', err.message);
            scheduleReconnect(); // try again
        }
    }, delay);
}

// ==========================================
// TikTok Avatar Fetcher (fallback)
// Same logic as helioscontrol's /api/fetch-tiktok-user
// ==========================================
async function fetchTikTokAvatar(username) {
    if (!username) return '';
    const cleanUsername = username.replace('@', '');

    try {
        console.log(`[TikTokAPI] Fetching avatar for: ${cleanUsername}`);
        const url = `https://www.tiktok.com/@${cleanUsername}`;
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Cookie': `sessionid=${process.env.TIKTOK_SESSION_ID || ''}`
            }
        });

        if (!response.ok) {
            console.error(`[TikTokAPI] TikTok responded with ${response.status} for ${cleanUsername}`);
            return '';
        }

        const html = await response.text();
        let avatarLarger = '';

        // Strategy 1: SIGI_STATE
        const sigiMatch = html.match(/<script id="SIGI_STATE" type="application\/json">(.*?)<\/script>/);
        if (sigiMatch && sigiMatch[1]) {
            try {
                const sigiData = JSON.parse(sigiMatch[1]);
                const userModule = sigiData.UserModule;
                if (userModule && userModule.users && userModule.users[cleanUsername]) {
                    avatarLarger = userModule.users[cleanUsername].avatarLarger || '';
                }
            } catch (e) { /* ignore parse error */ }
        }

        // Strategy 2: userInfo pattern
        if (!avatarLarger) {
            const userMatch = html.match(/"userInfo"\s*:\s*\{\s*"user"\s*:\s*(\{.+?\})\s*,\s*"stats"/);
            if (userMatch && userMatch[1]) {
                try {
                    const userData = JSON.parse(userMatch[1]);
                    avatarLarger = userData.avatarLarger || '';
                } catch (e) { /* ignore */ }
            }
        }

        // Strategy 3: webapp.user-detail hydration
        if (!avatarLarger) {
            const hydrationMatch = html.match(/"webapp\.user-detail"\s*:\s*(\{.+"userInfo".+\})(?=,\s*"webapp)/);
            if (hydrationMatch && hydrationMatch[1]) {
                try {
                    const detail = JSON.parse(hydrationMatch[1]);
                    avatarLarger = detail.userInfo.user.avatarLarger || '';
                } catch (e) { /* ignore */ }
            }
        }

        if (!avatarLarger) {
            console.log(`[TikTokAPI] No avatar found for ${cleanUsername}`);
            return '';
        }

        // Download avatar image
        const imgRes = await fetch(avatarLarger);
        if (imgRes.ok) {
            const arrayBuffer = await imgRes.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const fileName = `${cleanUsername}_${Date.now()}.jpg`;
            fs.writeFileSync(path.join(LOCAL_AVATARS, fileName), buffer);
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

// In-flight fetch tracker to avoid duplicate TikTok fetches
const pendingFetches = new Map();

// Avatar cache: { url, fetchedAt, failed, lastGoodUrl } — avoids re-fetching constantly
const avatarCache = new Map();
const AVATAR_CACHE_TTL = 8 * 60 * 60 * 1000;   // 8 hours for successful fetches
const AVATAR_FAIL_TTL = 30 * 1000;              // 30 seconds before retrying failed fetches

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
            const result = await fetchTikTokAvatar(tiktokUsername);
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
async function loadProfiles() {
    try {
        const all = await db.collection('profiles').find().toArray();
        // Filter out accidental "new profile" entries
        return all.filter(p => {
            const name = (p.name || '').toLowerCase().trim();
            return name !== 'new profile';
        });
    } catch (err) {
        console.error('[Profiles] Error loading:', err.message);
        return [];
    }
}

function buildTalentAvatars(profiles) {
    // Returns { talentName: { avatarUrl, uniqueId } }
    const map = {};
    for (const profile of profiles) {
        if (profile.talents) {
            for (const [name, info] of Object.entries(profile.talents)) {
                map[name] = {
                    avatarUrl: info.avatarUrl || '',
                    uniqueId: info.uniqueId || ''
                };
            }
        }
    }
    return map;
}

function buildProfileMap(profiles) {
    // Returns { profileId: { name, avatar, username, talentNames[], updatedAt, locationId } }
    const map = {};
    for (const profile of profiles) {
        const pid = profile._id;
        map[pid] = {
            name: profile.name || pid.toString(),
            avatar: profile.avatar || '',
            username: profile.username || '',
            talentNames: profile.talents ? Object.keys(profile.talents) : [],
            updatedAt: profile.updatedAt ? new Date(profile.updatedAt).getTime() : 0,
            locationId: profile.locationId || ''
        };
    }
    return map;
}

function buildTalentToProfileMap(profiles) {
    const map = {};
    for (const profile of profiles) {
        const profileId = profile._id;
        const profileName = profile.name || profileId.toString();
        if (profile.talents) {
            for (const talentName of Object.keys(profile.talents)) {
                map[talentName] = { profileId, profileName };
            }
        }
    }
    return map;
}

// Maps profile display name -> profileId (for new helioscontrol format
// where group gifts are saved with receivedTalent = profile name)
function buildProfileNameToIdMap(profiles) {
    const map = {};
    for (const profile of profiles) {
        const pid = profile._id;
        const name = profile.name || pid.toString();
        map[name] = pid;
    }
    return map;
}

// Maps talent UID -> { talentName, profileId, profileName }
// Used to resolve gifts by UID instead of nickname
function buildUidMaps(profiles) {
    const uidToTalent = {};   // uid -> talentName
    const uidToProfile = {};  // uid -> profileId
    for (const profile of profiles) {
        const pid = profile._id;
        const pName = profile.name || pid.toString();
        if (profile.talents) {
            for (const [talentName, info] of Object.entries(profile.talents)) {
                if (info.id) {
                    uidToTalent[info.id] = talentName;
                    uidToProfile[info.id] = { profileId: pid, profileName: pName };
                }
            }
        }
    }
    return { uidToTalent, uidToProfile };
}

// ==========================================
// GIFT ENTRY RESOLVER
// Extracts talent names from a gift, handling all formats:
// - New: receivedTalents: [{name, uid}, ...] (objects with UIDs)
// - Old: receivedTalents: ["name", ...] (plain strings)
// - Legacy: receivedTalent: "name" (single string, no array)
// Returns: [{ name, uid }]
// ==========================================
function resolveGiftTalents(gift, uidToTalent) {
    const results = [];

    // Prefer receivedTalents array (new format)
    if (gift.receivedTalents && Array.isArray(gift.receivedTalents) && gift.receivedTalents.length > 0) {
        for (const entry of gift.receivedTalents) {
            if (typeof entry === 'object' && entry.name) {
                // {name, uid} format — resolve name by UID if possible
                const resolvedName = (entry.uid && uidToTalent[entry.uid]) || entry.name;
                results.push({ name: resolvedName, uid: entry.uid || '' });
            } else {
                // Plain string
                results.push({ name: String(entry), uid: '' });
            }
        }
        return results;
    }

    // Fallback: single receivedTalent string
    if (gift.receivedTalent) {
        // Try to resolve by UID if available
        const uid = gift.receivedTalentUid || gift.toMemberUid || '';
        const resolvedName = (uid && uidToTalent[uid]) || gift.receivedTalent;
        results.push({ name: resolvedName, uid });
    }

    return results;
}

// ==========================================
// AGGREGATION — INDIVIDUAL
// Fetches raw gifts and processes in JS to handle multi-talent splitting + UID resolution
// ==========================================
function aggregateIndividual(gifts, talentAvatarMap, profileNameToId, uidToTalent, talentToProfile, profileMap, uidToProfile) {
    const allProfileNames = Object.keys(profileNameToId);
    const allTalentNames = Object.keys(talentAvatarMap);

    // Accumulate diamonds per talent (individual gifts)
    const talentTotals = {};
    // Accumulate group/profile gifts per profileId for later splitting
    const profileGroupTotals = {};

    for (const gift of gifts) {
        const talents = resolveGiftTalents(gift, uidToTalent);
        if (talents.length === 0) continue;

        // Separate individual talents vs group-level entries
        const individualTalents = [];
        const groupEntries = [];

        for (const t of talents) {
            if (t.name === 'Group' || t.name === 'Unassigned' || allProfileNames.includes(t.name)) {
                groupEntries.push(t);
            } else {
                individualTalents.push(t);
            }
        }

        // Process individual talents — each gets cost / total_talents_in_gift
        if (individualTalents.length > 0) {
            const perTalentCost = Math.floor(gift.cost / talents.length);
            for (const t of individualTalents) {
                talentTotals[t.name] = (talentTotals[t.name] || 0) + perTalentCost;
            }
        }

        // Process group-level entries — accumulate for later splitting among members
        if (groupEntries.length > 0) {
            const perEntryCost = Math.floor(gift.cost / talents.length);

            for (const t of groupEntries) {
                // Resolve which profile this group gift belongs to
                let pid = null;

                // Try UID first
                const uid = t.uid || gift.toMemberUid || '';
                if (uid && uidToProfile[uid]) {
                    pid = uidToProfile[uid].profileId;
                }

                // Try profile name match
                if (!pid && allProfileNames.includes(t.name)) {
                    pid = profileNameToId[t.name];
                }

                // Try talent → profile mapping (shouldn't normally hit here, but safety)
                if (!pid && talentToProfile[t.name]) {
                    pid = talentToProfile[t.name].profileId;
                }

                if (pid) {
                    profileGroupTotals[pid] = (profileGroupTotals[pid] || 0) + perEntryCost;
                }
            }
        }
    }

    // Split accumulated group gifts evenly among each profile's talent members
    for (const [pid, groupTotal] of Object.entries(profileGroupTotals)) {
        const pInfo = profileMap[pid];
        if (!pInfo || !pInfo.talentNames || pInfo.talentNames.length === 0) continue;

        const perMember = Math.floor(groupTotal / pInfo.talentNames.length);
        for (const talentName of pInfo.talentNames) {
            talentTotals[talentName] = (talentTotals[talentName] || 0) + perMember;
        }
    }

    // Merge with all known talents (ensure 0-diamond entries appear)
    // Only include talents registered in profiles — old/renamed nicknames are excluded
    const results = allTalentNames.map(name => ({
        _id: name,
        totalDiamonds: talentTotals[name] || 0
    }));

    results.sort((a, b) => b.totalDiamonds - a.totalDiamonds || a._id.localeCompare(b._id));
    return results.slice(0, 50);
}

// ==========================================
// AGGREGATION — GROUP
// Accumulates total income per profile using the sessions collection to
// map gifts to their owning profile. Includes ALL gifts (manual + auto).
// Each gift's FULL cost goes to the owning profile — no splitting when
// all talents belong to the same profile. Unmatched/unknown talents and
// Group/Unassigned labels fall back to session-based profile lookup.
// ==========================================
function aggregateGroup(gifts, talentToProfile, profileMap, profileNameToId, uidToTalent, uidToProfile, sessionProfileMap) {
    // Start with ALL profiles at 0
    const profileTotals = {};
    for (const [pid, pInfo] of Object.entries(profileMap)) {
        profileTotals[pid] = { name: pInfo.name, totalDiamonds: 0 };
    }

    // Helper: resolve a single talent entry to a profileId
    function resolveToProfile(t) {
        // 1. Check by UID
        if (t.uid && uidToProfile[t.uid]) {
            return uidToProfile[t.uid].profileId;
        }
        // 2. Check by talent name -> profile
        const talentMapping = talentToProfile[t.name];
        if (talentMapping) {
            return talentMapping.profileId;
        }
        // 3. Check if it's a profile name directly
        const profileId = profileNameToId[t.name];
        if (profileId) {
            return profileId;
        }
        return null;
    }

    // Helper: get the owning profile from the sessions collection
    function getSessionProfile(gift) {
        const sid = gift.sessionId ? gift.sessionId.toString() : '';
        return sessionProfileMap[sid] || null;
    }

    for (const gift of gifts) {
        const talents = resolveGiftTalents(gift, uidToTalent);
        const cost = gift.cost || 0;

        // If no talent info at all, fall back to session
        if (talents.length === 0) {
            const sessionPid = getSessionProfile(gift);
            if (sessionPid && profileTotals[sessionPid]) {
                profileTotals[sessionPid].totalDiamonds += cost;
            }
            continue;
        }

        // Resolve all talent entries to profiles
        const resolvedPids = new Set();

        for (const t of talents) {
            // "Group" and "Unassigned" labels — try UID first
            if (t.name === 'Group' || t.name === 'Unassigned') {
                const uid = t.uid || gift.toMemberUid || '';
                if (uid && uidToProfile[uid]) {
                    resolvedPids.add(uidToProfile[uid].profileId);
                }
                continue;
            }

            const pid = resolveToProfile(t);
            if (pid) {
                resolvedPids.add(pid);
            }
        }

        // If resolved to exactly one profile → credit FULL cost (no splitting)
        if (resolvedPids.size === 1) {
            const pid = [...resolvedPids][0];
            if (profileTotals[pid]) {
                profileTotals[pid].totalDiamonds += cost;
            }
            continue;
        }

        // If resolved to multiple profiles → split evenly among distinct profiles
        if (resolvedPids.size > 1) {
            const share = Math.floor(cost / resolvedPids.size);
            for (const pid of resolvedPids) {
                if (profileTotals[pid]) {
                    profileTotals[pid].totalDiamonds += share;
                }
            }
            continue;
        }

        // Nothing resolved via talent/UID → use sessions collection
        const sessionPid = getSessionProfile(gift);
        if (sessionPid) {
            if (!profileTotals[sessionPid]) {
                const pInfo = profileMap[sessionPid];
                profileTotals[sessionPid] = { name: pInfo ? pInfo.name : sessionPid, totalDiamonds: 0 };
            }
            profileTotals[sessionPid].totalDiamonds += cost;
        }
    }

    return Object.entries(profileTotals)
        .map(([id, data]) => ({ _id: id, name: data.name, totalDiamonds: data.totalDiamonds }))
        .sort((a, b) => b.totalDiamonds - a.totalDiamonds || a.name.localeCompare(b.name))
        .slice(0, 50);
}

// ==========================================
// SHARED AGGREGATION (used by API + SSE push)
// ==========================================
let lastResetHour = 0; // default, updated from client requests
let lastFreezeUntil = '09:00'; // e.g. '09:15' — freeze yesterday's daily scores until this time

// ==========================================
// DATA CACHE — serve instantly, refresh in background
// ==========================================
let cachedData = null;
let cacheTimestamp = 0;
const CACHE_BG_INTERVAL = 60 * 60 * 1000; // 1 hour background refresh when no clients

let isBuilding = false; // guard against concurrent builds

async function buildLeaderboardData(resetHour, freezeUntil) {
    // Prevent concurrent builds from piling up memory
    if (isBuilding) {
        console.log('[Build] Skipping — another build is already running');
        return cachedData; // return stale cache instead of building again
    }
    isBuilding = true;
    try {
    return await _buildLeaderboardDataInner(resetHour, freezeUntil);
    } finally {
        isBuilding = false;
    }
}

async function _buildLeaderboardDataInner(resetHour, freezeUntil) {
    const now = new Date();

    // Daily boundary
    const dailyStart = new Date(now);
    dailyStart.setHours(resetHour, 0, 0, 0);
    if (now < dailyStart) dailyStart.setDate(dailyStart.getDate() - 1);
    const dailyStartMs = dailyStart.getTime();

    // Yesterday boundary (the 24h window before dailyStart)
    const yesterdayStart = new Date(dailyStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const yesterdayStartMs = yesterdayStart.getTime();
    const yesterdayEndMs = dailyStartMs; // yesterday ends where today starts

    // Check if we should freeze (show yesterday's daily data as today's)
    let isFrozen = false;
    if (freezeUntil) {
        const [fh, fm] = freezeUntil.split(':').map(Number);
        if (!isNaN(fh) && !isNaN(fm)) {
            const freezeTime = new Date(now);
            freezeTime.setHours(fh, fm, 0, 0);
            // Frozen = current time is before the freeze-until time AND after daily reset
            if (now < freezeTime && now >= dailyStart) {
                isFrozen = true;
            }
            console.log(`[Freeze] freezeUntil=${freezeUntil}, now=${now.toLocaleTimeString()}, freezeTime=${freezeTime.toLocaleTimeString()}, dailyStart=${dailyStart.toLocaleTimeString()}, isFrozen=${isFrozen}`);
        }
    }

    // Monthly boundary
    const monthlyStart = new Date(now.getFullYear(), now.getMonth(), 1, resetHour, 0, 0, 0);
    const monthlyStartMs = monthlyStart.getTime();

    // Load profiles
    const profiles = await loadProfiles();
    const talentAvatarMap = buildTalentAvatars(profiles);
    const profileMap = buildProfileMap(profiles);
    const talentToProfile = buildTalentToProfileMap(profiles);
    const profileNameToId = buildProfileNameToIdMap(profiles);
    const { uidToTalent, uidToProfile } = buildUidMaps(profiles);

    // Build session → profileId map from sessions collection
    const sessionProfileMap = {};
    try {
        const sessions = await db.collection('sessions').find(
            {},
            { projection: { profileId: 1 } }
        ).toArray();
        for (const s of sessions) {
            if (s.profileId) {
                sessionProfileMap[s._id.toString()] = s.profileId;
            }
        }
    } catch (e) { /* sessions collection may not exist */ }

    const giftProjection = { projection: { receivedTalent: 1, receivedTalents: 1, receivedTalentUid: 1, toMemberUid: 1, cost: 1, sessionId: 1, timeStamp: 1, user: 1 } };

    // Fetch ALL gifts (including manual) — group view needs them, individual filters them out
    const [allDailyGifts, allYesterdayGifts, allMonthlyGifts] = await Promise.all([
        db.collection('gifts').find(
            { timeStamp: { $gte: dailyStartMs } },
            giftProjection
        ).toArray(),
        db.collection('gifts').find(
            { timeStamp: { $gte: yesterdayStartMs, $lt: yesterdayEndMs } },
            giftProjection
        ).toArray(),
        db.collection('gifts').find(
            { timeStamp: { $gte: monthlyStartMs } },
            giftProjection
        ).toArray()
    ]);

    // Individual view excludes manual gifts
    const isNotManual = g => !(g.user && g.user.userId === 'Manual');
    const dailyGifts = allDailyGifts.filter(isNotManual);
    const yesterdayGifts = allYesterdayGifts.filter(isNotManual);
    const monthlyGifts = allMonthlyGifts.filter(isNotManual);

    // Run all 6 aggregations (today + yesterday for daily)
    // Individual uses non-manual gifts; Group uses ALL gifts + session map
    const [individualDaily, individualYesterday, individualMonthly, groupDaily, groupYesterday, groupMonthly] = await Promise.all([
        aggregateIndividual(dailyGifts, talentAvatarMap, profileNameToId, uidToTalent, talentToProfile, profileMap, uidToProfile),
        aggregateIndividual(yesterdayGifts, talentAvatarMap, profileNameToId, uidToTalent, talentToProfile, profileMap, uidToProfile),
        aggregateIndividual(monthlyGifts, talentAvatarMap, profileNameToId, uidToTalent, talentToProfile, profileMap, uidToProfile),
        aggregateGroup(allDailyGifts, talentToProfile, profileMap, profileNameToId, uidToTalent, uidToProfile, sessionProfileMap),
        aggregateGroup(allYesterdayGifts, talentToProfile, profileMap, profileNameToId, uidToTalent, uidToProfile, sessionProfileMap),
        aggregateGroup(allMonthlyGifts, talentToProfile, profileMap, profileNameToId, uidToTalent, uidToProfile, sessionProfileMap)
    ]);

    // Format individual: resolve avatar with TikTok fallback
    async function formatIndividual(raw) {
        return Promise.all(raw.map(async entry => {
            const talentInfo = talentAvatarMap[entry._id] || {};
            const avatar = await resolveAvatar(talentInfo.avatarUrl, talentInfo.uniqueId);
            return {
                name: entry._id,
                value: entry.totalDiamonds,
                avatar
            };
        }));
    }

    // Format group: use profile avatar with TikTok fallback
    async function formatGroup(raw) {
        return Promise.all(raw.map(async entry => {
            const pInfo = profileMap[entry._id] || {};
            const avatar = await resolveAvatar(pInfo.avatar, pInfo.username);
            return {
                name: entry.name,
                value: entry.totalDiamonds,
                avatar,
                locationId: pInfo.locationId || ''
            };
        }));
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

    // Load locations for client-side filtering
    let locations = [];
    try {
        const locDocs = await db.collection('locations').find().sort({ createdAt: 1 }).toArray();
        locations = locDocs.map(doc => ({ id: doc._id, name: doc.name || doc._id }));
    } catch (e) { /* ignore */ }

    // Build talent → locationId map for individual filtering
    const talentLocationMap = {};
    for (const [pid, pInfo] of Object.entries(profileMap)) {
        for (const talentName of pInfo.talentNames) {
            talentLocationMap[talentName] = pInfo.locationId || '';
        }
    }

    // Attach locationId to individual entries
    function attachLocationToIndividual(arr) {
        return arr.map(entry => ({
            ...entry,
            locationId: talentLocationMap[entry.name] || ''
        }));
    }

    return {
        individual: {
            daily: attachLocationToIndividual(finalIndDaily),
            monthly: attachLocationToIndividual(indMonthly),
            yesterday: attachLocationToIndividual(indYesterday)
        },
        group: { daily: finalGrpDaily, monthly: grpMonthly, yesterday: grpYesterday },
        frozen: isFrozen,
        locations
    };
}

// ==========================================
// SSE: REAL-TIME PUSH TO BROWSERS
// ==========================================
function broadcastLeaderboard(data) {
    const message = `data: ${JSON.stringify({ status: 'ok', data })}\n\n`;
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

    // Send initial data immediately (from cache or fresh)
    if (cachedData) {
        res.write(`data: ${JSON.stringify({ status: 'ok', data: cachedData })}\n\n`);
        // Refresh in background if stale (>30s old)
        if (Date.now() - cacheTimestamp > 30000 && db) {
            buildLeaderboardData(lastResetHour, lastFreezeUntil)
                .then(data => {
                    cachedData = data;
                    cacheTimestamp = Date.now();
                })
                .catch(() => {});
        }
    } else if (db) {
        buildLeaderboardData(lastResetHour, lastFreezeUntil)
            .then(data => {
                cachedData = data;
                cacheTimestamp = Date.now();
                res.write(`data: ${JSON.stringify({ status: 'ok', data })}\n\n`);
            })
            .catch(err => {
                console.error('[SSE] Initial data error:', err.message);
            });
    }

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

function stopChangeStreams() {
    if (activeGiftsStream) {
        try { activeGiftsStream.close(); } catch (e) { /* ignore */ }
        activeGiftsStream = null;
    }
    if (activeProfilesStream) {
        try { activeProfilesStream.close(); } catch (e) { /* ignore */ }
        activeProfilesStream = null;
    }
}

function startChangeStreams() {
    if (!db) return;

    // Close any existing streams first to avoid duplicates
    stopChangeStreams();

    try {
        // Watch gifts collection
        activeGiftsStream = db.collection('gifts').watch([], { fullDocument: 'updateLookup' });
        activeGiftsStream.on('change', (change) => {
            console.log(`[ChangeStream] Gift ${change.operationType}`);
            debouncedBroadcast();
        });
        activeGiftsStream.on('error', (err) => {
            console.error('[ChangeStream] Gifts stream error:', err.message);
            activeGiftsStream = null;
            // Don't restart here — the MongoDB client 'close' event will trigger reconnection
        });

        // Watch profiles collection
        activeProfilesStream = db.collection('profiles').watch([], { fullDocument: 'updateLookup' });
        activeProfilesStream.on('change', (change) => {
            console.log(`[ChangeStream] Profile ${change.operationType}`);
            debouncedBroadcast();
        });
        activeProfilesStream.on('error', (err) => {
            console.error('[ChangeStream] Profiles stream error:', err.message);
            activeProfilesStream = null;
        });

        console.log('[ChangeStream] Watching gifts + profiles collections for real-time updates');
    } catch (err) {
        console.error('[ChangeStream] Failed to start:', err.message);
    }
}

function debouncedBroadcast() {
    // Debounce: wait 500ms after last change before re-aggregating
    // This prevents 100 rapid gifts from triggering 100 re-aggregations
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
        if (!db) return; // guard against broadcasting when DB is down
        try {
            const data = await buildLeaderboardData(lastResetHour, lastFreezeUntil);
            // Update cache
            cachedData = data;
            cacheTimestamp = Date.now();
            broadcastLeaderboard(data);
        } catch (err) {
            console.error('[ChangeStream] Broadcast error:', err.message);
        }
    }, 500);
}

// ==========================================
// API: LEADERBOARD (polling fallback)
// ==========================================
app.get('/api/leaderboard', async (req, res) => {
    const parsed = parseInt(req.query.resetHour);
    const resetHour = isNaN(parsed) ? 0 : parsed;
    lastResetHour = resetHour; // Save for SSE broadcasts

    // Freeze-until setting (e.g. '09:15')
    const freezeUntil = req.query.freezeUntil || '';
    if (freezeUntil) lastFreezeUntil = freezeUntil;

    // Return cached data instantly if available
    if (cachedData) {
        res.json({ status: 'ok', data: cachedData });
        // Refresh in background if stale (>10s)
        if (Date.now() - cacheTimestamp > 10000 && db) {
            buildLeaderboardData(resetHour, lastFreezeUntil)
                .then(data => { cachedData = data; cacheTimestamp = Date.now(); })
                .catch(() => {});
        }
        return;
    }

    // No cache — must build fresh
    if (!db) {
        return res.status(503).json({ status: 'error', message: 'Database not connected' });
    }

    try {
        const data = await buildLeaderboardData(resetHour, lastFreezeUntil);
        cachedData = data;
        cacheTimestamp = Date.now();
        res.json({ status: 'ok', data });
    } catch (err) {
        console.error('[Leaderboard] Error:', err);
        res.json({ status: 'error', message: err.message });
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
        await connectDB();
        reconnectAttempt = 0;

        // Start watching MongoDB for changes
        startChangeStreams();

        // Pre-warm cache on startup
        try {
            const data = await buildLeaderboardData(lastResetHour, lastFreezeUntil);
            cachedData = data;
            cacheTimestamp = Date.now();
            console.log('[Cache] Pre-warmed leaderboard cache on startup');
        } catch (err) {
            console.error('[Cache] Pre-warm error:', err.message);
        }
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
        const data = await buildLeaderboardData(lastResetHour, lastFreezeUntil);
        cachedData = data;
        cacheTimestamp = Date.now();
        console.log('[Cache] Background refresh (no clients connected)');
    } catch (err) {
        console.error('[Cache] Background refresh error:', err.message);
    }
}, CACHE_BG_INTERVAL);

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