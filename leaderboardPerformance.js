'use strict';

const { computeMonthlyWindows, computeDailyWindows, MONTHLY_RESET_HOUR } = require('./monthlyWindows');
const CACHE_VERSION = 2;
const GIFT_FIELDS = ['receivedTalent', 'receivedTalents', 'receivedTalentUid', 'toMemberUid', 'cost', 'sessionId'];

function createWindowContext(resetHour, freezeUntil, now = new Date()) {
    const { dailyStart, yesterdayStart } = computeDailyWindows(now, resetHour);
    const monthly = computeMonthlyWindows(now, MONTHLY_RESET_HOUR);
    let frozen = false;
    if (freezeUntil) {
        const [h, m] = freezeUntil.split(':').map(Number);
        const end = new Date(now);
        end.setHours(h, m, 0, 0);
        frozen = now < end && now >= dailyStart;
    }
    const windows = { daily: +dailyStart, yesterday: +yesterdayStart, monthly: +monthly.displayStart, monthlyEnd: monthly.displayEnd ? +monthly.displayEnd : null };
    const queryKey = JSON.stringify(windows);
    return { resetHour, freezeUntil, windows, frozen, monthly, queryKey,
        key: JSON.stringify([CACHE_VERSION, resetHour, freezeUntil, frozen, windows]) };
}

function windowFlags(timeStamp, windows) {
    if (!windows) return {};
    return { daily: timeStamp >= windows.daily, yesterday: timeStamp >= windows.yesterday && timeStamp < windows.daily,
        monthly: timeStamp >= windows.monthly && (windows.monthlyEnd === null || timeStamp < windows.monthlyEnd) };
}

// In-memory equivalent for differential fixtures. Production groups in MongoDB.
function compactGifts(gifts, windows) {
    const buckets = new Map();
    for (const gift of gifts) {
        const entry = Object.fromEntries(GIFT_FIELDS.filter(key => gift[key] !== undefined).map(key => [key, gift[key]]));
        entry.manual = gift.user?.userId === 'Manual';
        Object.assign(entry, windowFlags(gift.timeStamp, windows));
        const key = JSON.stringify(entry);
        if (!buckets.has(key)) buckets.set(key, { ...entry, count: 0 });
        buckets.get(key).count++;
    }
    return [...buckets.values()];
}

function buildGiftBucketPipeline({ windows, start, end, sessionIds } = {}) {
    const minimum = start ?? Math.min(windows.daily, windows.yesterday, windows.monthly);
    const match = { timeStamp: { $gte: minimum } };
    if (end !== undefined && end !== null) match.timeStamp.$lt = end;
    if (sessionIds) match.sessionId = { $in: sessionIds };
    const identity = Object.fromEntries(GIFT_FIELDS.map(field => [field, `$${field}`]));
    identity.manual = { $eq: ['$user.userId', 'Manual'] };
    identity.costMissing = { $eq: [{ $type: '$cost' }, 'missing'] };
    if (windows) {
        identity.daily = { $gte: ['$timeStamp', windows.daily] };
        identity.yesterday = { $and: [{ $gte: ['$timeStamp', windows.yesterday] }, { $lt: ['$timeStamp', windows.daily] }] };
        identity.monthly = { $and: [{ $gte: ['$timeStamp', windows.monthly] }, ...(windows.monthlyEnd === null ? [] : [{ $lt: ['$timeStamp', windows.monthlyEnd] }])] };
    }
    return [{ $match: match }, { $group: { _id: identity, count: { $sum: 1 } } }, { $project: { _id: 0, gift: '$_id', count: 1 } }];
}

function decodeGiftBuckets(documents) {
    return documents.map(({ gift, count }) => {
        const result = { ...gift, count };
        if (result.costMissing) delete result.cost;
        delete result.costMissing;
        if (result.cost != null && typeof result.cost !== 'number') throw new Error('Non-numeric gift cost requires legacy data repair; refusing ambiguous aggregation');
        return result;
    });
}

function validBoard(data) {
    return data && ['individual', 'group'].every(kind => ['daily', 'monthly', 'yesterday'].every(period => Array.isArray(data[kind]?.[period]))) && Array.isArray(data.groups) && Array.isArray(data.locations);
}

function createLeaderboardCache({ build, isStale = () => false, clock = Date.now, ttl = 10000, maxEntries = 8, onPublish = () => {}, onError = () => {} }) {
    const entries = new Map(), pending = new Map();
    let generation = 0;
    function remember(key, entry) {
        entries.delete(key); entries.set(key, entry);
        while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    }
    function response(context, entry, source = entry.source) {
        return { status: 'ok', data: entry.data, meta: { source, stale: entry.generation !== generation || clock() - entry.computedAt >= ttl || !!entry.error || !!entry.dirty,
            computedAt: new Date(entry.computedAt).toISOString(), contextKey: context.key, ...(entry.error ? { error: entry.error } : {}) } };
    }
    async function refresh(context, force) {
        const active = pending.get(context.key);
        if (active) {
            if (!force || active.force) return active.promise;
            try { await active.promise; } catch (_) { /* forced request still performs its own read */ }
            return refresh(context, true);
        }
        if (pending.size >= maxEntries) throw new Error('Leaderboard busy; retry shortly');
        const promise = (async () => {
            const revision = generation;
            const startedAt = clock();
            const data = await build(context, { force });
            if (!validBoard(data)) throw new Error('Incomplete leaderboard result');
            // A busy stream must not starve publication. Its post-start mutations
            // remain queued in the bucket store; this snapshot is explicitly stale.
            const entry = { data, computedAt: startedAt, generation: revision, source: 'cache', dirty: isStale(context) };
            remember(context.key, entry);
            Promise.resolve().then(() => onPublish({ version: CACHE_VERSION, contextKey: context.key, computedAt: entry.computedAt, data }, context)).catch(onError);
            return response(context, entry, 'computed');
        })().catch(error => {
            const old = entries.get(context.key);
            if (old) old.error = error.message;
            throw error;
        }).finally(() => pending.delete(context.key));
        pending.set(context.key, { promise, force });
        return promise;
    }
    return {
        async get(context, { force = false } = {}) {
            if (force) return refresh(context, true);
            const entry = entries.get(context.key);
            if (!entry) return refresh(context, false);
            remember(context.key, entry);
            const result = response(context, entry);
            if (result.meta.stale) refresh(context, false).catch(onError);
            return result;
        },
        invalidate() { generation++; },
        hydrate(document, context) {
            if (entries.has(context.key)) return false;
            if (!document || document.version !== CACHE_VERSION || document.contextKey !== context.key || !Number.isFinite(document.computedAt) || document.computedAt > clock() || clock() - document.computedAt > 6 * 3600000 || !validBoard(document.data)) return false;
            remember(context.key, { data: document.data, computedAt: document.computedAt, generation: -1, source: 'snapshot' });
            return true;
        },
    };
}

const sessionKey = value => `${value?._bsontype || typeof value}:${String(value)}`;
function createSessionBucketStore({ read, clock = Date.now, maxAge = 900000, maxEntries = 4, maxBuckets = 50000 }) {
    const entries = new Map(), pending = new Map();
    let revision = 0;
    const journal = [];
    function mark(entry, sid) {
        if (!sid || entry.dirty.size >= 256) { entry.invalid = true; entry.dirty.clear(); }
        else if (!entry.invalid) entry.dirty.set(sessionKey(sid), sid);
    }
    function change(event) {
        revision++;
        const fields = Object.keys(event?.updateDescription?.updatedFields || {}).concat(event?.updateDescription?.removedFields || []);
        const safe = event?.operationType === 'insert' || (event?.operationType === 'update' && event.updateDescription && !fields.some(f => f === 'sessionId' || f.startsWith('sessionId.')));
        const sid = safe && event.fullDocument?.sessionId;
        journal.push({ revision, sid });
        if (journal.length > 1024) journal.shift();
        for (const entry of entries.values()) mark(entry, sid);
    }
    async function get(context, { force = false } = {}) {
        const key = context.queryKey;
        if (pending.has(key)) {
            const active = pending.get(key);
            if (!force || active.force) return active.promise;
            try { await active.promise; } catch (_) { /* force recovers from failed background reads */ }
            return get(context, { force: true });
        }
        const old = entries.get(key);
        if (!force && old && !old.invalid && !old.dirty.size && clock() - old.fullReadAt < maxAge) return old.rows;
        if (pending.size >= maxEntries) throw new Error('Gift aggregation busy; retry shortly');
        const promise = (async () => {
            const startRevision = revision;
            const startedAt = clock();
            const current = entries.get(key);
            const full = force || !current || current.invalid || clock() - current.fullReadAt >= maxAge;
            const ids = full ? undefined : [...current.dirty.values()];
            const changed = await read(context, ids);
            const keys = new Set((ids || []).map(sessionKey));
            const rows = full ? changed : [...current.rows.filter(r => !keys.has(sessionKey(r.sessionId))), ...changed];
            const entry = { rows, fullReadAt: full ? startedAt : current.fullReadAt, dirty: new Map(), invalid: revision - startRevision > journal.length };
            for (const event of journal) if (event.revision > startRevision) mark(entry, event.sid);
            entries.delete(key);
            if (rows.length <= maxBuckets) entries.set(key, entry);
            while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
            return rows;
        })().finally(() => pending.delete(key));
        pending.set(key, { promise, force });
        return promise;
    }
    return { get, change, invalidate() { change(null); }, isStale(context) {
        const entry = entries.get(context.queryKey);
        return !entry || entry.invalid || entry.dirty.size > 0 || clock() - entry.fullReadAt >= maxAge;
    } };
}

module.exports = { CACHE_VERSION, createWindowContext, compactGifts, buildGiftBucketPipeline, decodeGiftBuckets, createLeaderboardCache, createSessionBucketStore };
