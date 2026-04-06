require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { MongoClient } = require('mongodb');
const dns = require('dns');

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

// --- MongoDB Connection ---
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
let db = null;
let mongoClient = null;

// --- SSE (Server-Sent Events) for real-time push ---
const sseClients = new Set();

async function connectDB() {
    try {
        console.log('[Database] Connecting to MongoDB...');
        mongoClient = new MongoClient(MONGODB_URI);
        await mongoClient.connect();

        const uriDb = new URL(MONGODB_URI.replace('mongodb+srv://', 'https://')).pathname.slice(1);
        db = mongoClient.db(uriDb || 'helioscontrol');

        console.log(`[Database] Connected to: ${db.databaseName}`);

        // Ensure indexes
        await db.collection('gifts').createIndex({ timeStamp: 1 });
        await db.collection('gifts').createIndex({ receivedTalent: 1 });
        await db.collection('profiles').createIndex({ updatedAt: -1 });

        return db;
    } catch (err) {
        console.error('[Database] Connection failed:', err.message);
        throw err;
    }
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

// Avatar cache: { url, fetchedAt, failed } — avoids re-fetching constantly
const avatarCache = new Map();
const AVATAR_CACHE_TTL = 8 * 60 * 60 * 1000;   // 8 hours for successful fetches
const AVATAR_FAIL_TTL  = 30 * 60 * 1000;        // 30 minutes before retrying failed fetches

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
            // Cache the result
            avatarCache.set(tiktokUsername, {
                url: result || '',
                fetchedAt: Date.now(),
                failed: !result
            });
            return result || avatarUrl || '';
        } catch (err) {
            // Cache the failure so we don't retry immediately
            avatarCache.set(tiktokUsername, {
                url: '',
                fetchedAt: Date.now(),
                failed: true
            });
            return avatarUrl || '';
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
        return await db.collection('profiles').find().toArray();
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
    // Returns { profileId: { name, avatar, username, talentNames[], updatedAt } }
    const map = {};
    for (const profile of profiles) {
        const pid = profile._id;
        map[pid] = {
            name: profile.name || pid.toString(),
            avatar: profile.avatar || '',
            username: profile.username || '',
            talentNames: profile.talents ? Object.keys(profile.talents) : [],
            updatedAt: profile.updatedAt ? new Date(profile.updatedAt).getTime() : 0
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

// ==========================================
// AGGREGATION PIPELINES
// ==========================================

// Individual: returns all talents from profiles, merging gift totals (0 if no gifts)
// Excludes profile-name gifts (those belong to group only)
async function aggregateIndividual(startMs, talentAvatarMap, profileNameToId) {
    // Get gift totals from DB — exclude 'Group', 'Unassigned', and profile names
    const allProfileNames = Object.keys(profileNameToId);
    const excludeList = ['Group', 'Unassigned', null, ...allProfileNames];

    const giftTotals = await db.collection('gifts').aggregate([
        { $match: { timeStamp: { $gte: startMs }, 'user.userId': { $ne: 'Manual' } } },
        { $group: { _id: '$receivedTalent', totalDiamonds: { $sum: '$cost' } } },
        { $match: { _id: { $ne: null, $nin: excludeList } } }
    ]).toArray();

    // Build a map of gift totals by talent name
    const giftMap = {};
    for (const entry of giftTotals) {
        giftMap[entry._id] = entry.totalDiamonds;
    }

    // Merge: start with all known talents (from profiles), then overlay gift data
    const allTalents = Object.keys(talentAvatarMap);
    const results = allTalents.map(name => ({
        _id: name,
        totalDiamonds: giftMap[name] || 0
    }));

    // Also include any talents from gifts that aren't in profiles (edge case)
    for (const entry of giftTotals) {
        if (!talentAvatarMap[entry._id]) {
            results.push({ _id: entry._id, totalDiamonds: entry.totalDiamonds });
        }
    }

    // Sort by diamonds descending, then alphabetically for ties
    results.sort((a, b) => b.totalDiamonds - a.totalDiamonds || a._id.localeCompare(b._id));
    return results.slice(0, 50);
}

// Group: returns ALL profiles with TOTAL income (talent gifts + Group/profile-name gifts)
async function aggregateGroup(startMs, talentToProfile, profileMap, profileNameToId) {
    // Step 1: Get ALL gift totals per receivedTalent (including 'Group' and profile names)
    const allGiftTotals = await db.collection('gifts').aggregate([
        { $match: { timeStamp: { $gte: startMs }, 'user.userId': { $ne: 'Manual' } } },
        { $group: { _id: '$receivedTalent', totalDiamonds: { $sum: '$cost' } } },
        { $match: { _id: { $ne: null } } }
    ]).toArray();

    // Start with ALL profiles at 0
    const profileTotals = {};
    for (const [pid, pInfo] of Object.entries(profileMap)) {
        profileTotals[pid] = { name: pInfo.name, totalDiamonds: 0 };
    }

    // Step 2: Add talent-specific gifts AND profile-name gifts to their profile
    for (const entry of allGiftTotals) {
        if (entry._id === 'Group' || entry._id === 'Unassigned') continue;

        // Check if receivedTalent is a talent name
        const talentMapping = talentToProfile[entry._id];
        if (talentMapping) {
            const pid = talentMapping.profileId;
            if (!profileTotals[pid]) {
                profileTotals[pid] = { name: talentMapping.profileName, totalDiamonds: 0 };
            }
            profileTotals[pid].totalDiamonds += entry.totalDiamonds;
            continue;
        }

        // Check if receivedTalent is a profile name (new helioscontrol format)
        const profileId = profileNameToId[entry._id];
        if (profileId) {
            if (!profileTotals[profileId]) {
                profileTotals[profileId] = { name: entry._id, totalDiamonds: 0 };
            }
            profileTotals[profileId].totalDiamonds += entry.totalDiamonds;
        }
    }

    // Step 3: Handle legacy 'Group' gifts by checking session co-occurrence
    // (New format uses profile names directly — handled in Step 2)
    const allProfileNames = Object.values(profileMap).map(p => p.name);
    const groupGifts = await db.collection('gifts').aggregate([
        { $match: { timeStamp: { $gte: startMs }, receivedTalent: 'Group', 'user.userId': { $ne: 'Manual' } } },
        { $group: { _id: '$sessionId', groupTotal: { $sum: '$cost' } } }
    ]).toArray();

    for (const sessionGroup of groupGifts) {
        // Find which talents are in this session (exclude Group, Unassigned, and profile names)
        const sessionTalents = await db.collection('gifts').distinct('receivedTalent', {
            sessionId: sessionGroup._id,
            receivedTalent: { $nin: ['Group', 'Unassigned', null, ...allProfileNames] }
        });

        // Determine which profile these talents belong to
        const sessionProfiles = new Set();
        for (const t of sessionTalents) {
            if (talentToProfile[t]) sessionProfiles.add(talentToProfile[t].profileId);
        }

        if (sessionProfiles.size === 1) {
            // Single profile identified — assign all Group gifts to it
            const pid = [...sessionProfiles][0];
            if (profileTotals[pid]) {
                profileTotals[pid].totalDiamonds += sessionGroup.groupTotal;
            }
        } else if (sessionProfiles.size === 0) {
            // No talent-specific gifts in this session — try to infer from which
            // profile was most recently updated (likely the active one)
            const sortedProfiles = Object.entries(profileMap)
                .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));
            if (sortedProfiles.length > 0) {
                const pid = sortedProfiles[0][0];
                if (profileTotals[pid]) {
                    profileTotals[pid].totalDiamonds += sessionGroup.groupTotal;
                }
            }
        } else {
            // Multiple profiles in same session (rare) — split equally
            const share = Math.floor(sessionGroup.groupTotal / sessionProfiles.size);
            for (const pid of sessionProfiles) {
                if (profileTotals[pid]) {
                    profileTotals[pid].totalDiamonds += share;
                }
            }
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
let lastResetHour = 6; // default, updated from client requests

async function buildLeaderboardData(resetHour) {
    const now = new Date();

    // Daily boundary
    const dailyStart = new Date(now);
    dailyStart.setHours(resetHour, 0, 0, 0);
    if (now < dailyStart) dailyStart.setDate(dailyStart.getDate() - 1);
    const dailyStartMs = dailyStart.getTime();

    // Monthly boundary
    const monthlyStart = new Date(now.getFullYear(), now.getMonth(), 1, resetHour, 0, 0, 0);
    const monthlyStartMs = monthlyStart.getTime();

    // Load profiles
    const profiles = await loadProfiles();
    const talentAvatarMap = buildTalentAvatars(profiles);
    const profileMap = buildProfileMap(profiles);
    const talentToProfile = buildTalentToProfileMap(profiles);
    const profileNameToId = buildProfileNameToIdMap(profiles);

    // Run all 4 aggregations
    const [individualDaily, individualMonthly, groupDaily, groupMonthly] = await Promise.all([
        aggregateIndividual(dailyStartMs, talentAvatarMap, profileNameToId),
        aggregateIndividual(monthlyStartMs, talentAvatarMap, profileNameToId),
        aggregateGroup(dailyStartMs, talentToProfile, profileMap, profileNameToId),
        aggregateGroup(monthlyStartMs, talentToProfile, profileMap, profileNameToId)
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
                avatar
            };
        }));
    }

    const [indDaily, indMonthly, grpDaily, grpMonthly] = await Promise.all([
        formatIndividual(individualDaily),
        formatIndividual(individualMonthly),
        formatGroup(groupDaily),
        formatGroup(groupMonthly)
    ]);

    return {
        individual: { daily: indDaily, monthly: indMonthly },
        group: { daily: grpDaily, monthly: grpMonthly }
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

    // Send initial data immediately
    if (db) {
        buildLeaderboardData(lastResetHour)
            .then(data => {
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

function startChangeStreams() {
    if (!db) return;

    // Watch gifts collection
    const giftsStream = db.collection('gifts').watch([], { fullDocument: 'updateLookup' });
    giftsStream.on('change', (change) => {
        console.log(`[ChangeStream] Gift ${change.operationType}`);
        debouncedBroadcast();
    });
    giftsStream.on('error', (err) => {
        console.error('[ChangeStream] Gifts stream error:', err.message);
        // Restart after delay
        setTimeout(() => startChangeStreams(), 5000);
    });

    // Watch profiles collection
    const profilesStream = db.collection('profiles').watch([], { fullDocument: 'updateLookup' });
    profilesStream.on('change', (change) => {
        console.log(`[ChangeStream] Profile ${change.operationType}`);
        debouncedBroadcast();
    });
    profilesStream.on('error', (err) => {
        console.error('[ChangeStream] Profiles stream error:', err.message);
    });

    console.log('[ChangeStream] Watching gifts + profiles collections for real-time updates');
}

function debouncedBroadcast() {
    // Debounce: wait 500ms after last change before re-aggregating
    // This prevents 100 rapid gifts from triggering 100 re-aggregations
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
        try {
            const data = await buildLeaderboardData(lastResetHour);
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
    if (!db) {
        return res.status(503).json({ status: 'error', message: 'Database not connected' });
    }

    try {
        const resetHour = parseInt(req.query.resetHour) || 6;
        lastResetHour = resetHour; // Save for SSE broadcasts

        const data = await buildLeaderboardData(resetHour);

        res.json({ status: 'ok', data });
    } catch (err) {
        console.error('[Leaderboard] Error:', err);
        res.json({ status: 'error', message: err.message });
    }
});

// Catch-all: serve index.html
app.get('*path', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Start Server ---
connectDB()
    .then(() => {
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`✅ Leaderboard server running at http://0.0.0.0:${PORT}`);
            console.log(`📁 Avatars: Electron=${ELECTRON_AVATARS} | Dev=${DEV_AVATARS} | Local=${LOCAL_AVATARS}`);
            console.log(`🔴 SSE endpoint: /api/leaderboard/stream`);
        });

        // Start watching MongoDB for changes
        startChangeStreams();
    })
    .catch(err => {
        console.error('Failed to start server:', err.message);
        process.exit(1);
    });