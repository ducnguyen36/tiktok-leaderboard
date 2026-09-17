'use strict';
process.env.TZ = 'Asia/Ho_Chi_Minh';
const test = require('node:test');
const assert = require('node:assert/strict');
const reference = { api: require('./support/legacyAggregation') };
let perf = {};
try { perf = require('../leaderboardPerformance'); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
const profiles = [
    { _id: 'p', name: 'Alpha', talents: { Alice: { id: 'a' }, Bob: { id: 'b' }, Zero: { id: 'z' } } },
    { _id: 'q', name: 'Beta', talents: { Carol: { id: 'c' } } },
];
const maps = reference.api;
function scores(api, gifts, ps = profiles) {
    const avatars = maps.buildTalentAvatars(ps), names = maps.buildProfileNameToIdMap(ps);
    const pm = maps.buildProfileMap(ps), tp = maps.buildTalentToProfileMap(ps);
    const { uidToTalent: ut, uidToProfile: up } = maps.buildUidMaps(ps);
    return JSON.parse(JSON.stringify({
        individual: api.aggregateIndividual(gifts.filter(g => !g.manual && g.user?.userId !== 'Manual'), avatars, names, ut, tp, pm, up),
        group: api.aggregateGroup(gifts, tp, pm, names, ut, up, { s: 'p' }),
    }));
}
test('compact repeated gifts preserve per-gift floors, pooled floors, UID rename, duplicate recipients and manual exclusion', () => {
    assert.equal(typeof perf.compactGifts, 'function');
    const production = require('../leaderboardAggregation');
    const gifts = [
        ...Array.from({ length: 6 }, () => ({ cost: 5, receivedTalents: ['Alice', 'Bob'], sessionId: 's', timeStamp: 100 })),
        ...Array.from({ length: 3 }, () => ({ cost: 1, receivedTalent: 'Alpha', timeStamp: 100 })),
        { cost: 7, receivedTalents: [{ name: 'Old Alice', uid: 'a' }, 'Carol', 'Alice'] },
        { cost: 9, receivedTalent: 'Unknown', sessionId: 's' },
        { cost: 8, sessionId: 's' },
        { cost: 11, receivedTalent: 'Group', toMemberUid: 'a' },
        { cost: 100, receivedTalent: 'Alice', user: { userId: 'Manual', huge: 'excluded' } },
    ];
    const compact = perf.compactGifts(gifts);
    assert.ok(compact.length < gifts.length);
    assert.deepEqual(scores(production, compact), scores(reference.api, gifts));
    // 6*floor(5/2) + floor(3/3) + 2*floor(7/3) + 11 (Group UID resolves Alice).
    assert.equal(scores(production, compact).individual.find(x => x._id === 'Alice').totalDiamonds, 28);
});
test('all known idols are returned including zero rows beyond rank fifty', () => {
    assert.equal(typeof perf.compactGifts, 'function');
    const production = require('../leaderboardAggregation');
    const ps = [{ _id: 'p', talents: Object.fromEntries(Array.from({ length: 71 }, (_, i) => [`Idol${i}`, {}])) }];
    assert.equal(scores(production, [], ps).individual.length, 71);
});
test('window identity changes at daily reset, freeze end, and monthly grace close', () => {
    assert.equal(typeof perf.createWindowContext, 'function');
    const key = iso => perf.createWindowContext(0, '09:00', new Date(iso)).key;
    assert.notEqual(key('2026-09-17T16:59:59Z'), key('2026-09-17T17:00:00Z'));
    assert.notEqual(key('2026-09-18T01:59:59Z'), key('2026-09-18T02:00:00Z'));
    const before = perf.createWindowContext(7, '', new Date('2026-10-01T16:59:59Z'));
    const after = perf.createWindowContext(7, '', new Date('2026-10-01T17:00:00Z'));
    assert.notEqual(before.windows.monthly, after.windows.monthly);
});

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
const board = n => ({ individual: { daily: [{ name: 'Alice', value: n }], monthly: [], yesterday: [] }, group: { daily: [], monthly: [], yesterday: [] }, groups: [], locations: [] });
test('warm cache is immediate, strict failures retain old data as stale and force propagates failure', async () => {
    assert.equal(typeof perf.createLeaderboardCache, 'function');
    let time = 1000, calls = 0, fail = false, wait;
    const cache = perf.createLeaderboardCache({ clock: () => time, ttl: 10,
        build: async () => { calls++; if (wait) await wait.promise; if (fail) throw Error('offline'); return board(calls); } });
    const context = { key: 'a' };
    const cold = await Promise.all([cache.get(context), cache.get(context)]);
    assert.equal(calls, 1);
    assert.equal(cold[0].meta.source, 'computed');
    time = 2000; fail = true; wait = deferred();
    const warm = await cache.get(context);
    assert.equal(warm.data.individual.daily[0].value, 1);
    assert.equal(warm.meta.stale, true);
    wait.resolve();
    await assert.rejects(cache.get(context, { force: true }), /offline/);
    const retained = await cache.get(context);
    assert.equal(retained.data.individual.daily[0].value, 1);
    assert.equal(retained.meta.stale, true);
    assert.equal(retained.meta.computedAt, cold[0].meta.computedAt);
    await assert.rejects(cache.get({ key: 'other' }, { force: true }), /offline/);
});
test('cache invalidation during a build publishes a stale snapshot without starving and validates durable context', async () => {
    assert.equal(typeof perf.createLeaderboardCache, 'function');
    const gate = deferred(); let calls = 0;
    const cache = perf.createLeaderboardCache({ clock: () => 10000, build: async () => { const n = ++calls; if (n === 1) await gate.promise; return board(n); } });
    const pending = cache.get({ key: 'a' });
    cache.invalidate(); gate.resolve();
    const raced = await pending;
    assert.equal(raced.data.individual.daily[0].value, 1);
    assert.equal(raced.meta.stale, true);
    assert.equal(cache.hydrate({ version: perf.CACHE_VERSION, contextKey: 'b', computedAt: 9000, data: board(7) }, { key: 'a' }), false);
    assert.equal(cache.hydrate({ version: 0, contextKey: 'a', computedAt: 9000, data: board(7) }, { key: 'a' }), false);
    const fresh = perf.createLeaderboardCache({ clock: () => 10000, build: async () => board(8) });
    assert.equal(fresh.hydrate({ version: perf.CACHE_VERSION, contextKey: 'a', computedAt: 9000, data: board(7) }, { key: 'a' }), true);
    const result = await fresh.get({ key: 'a' });
    assert.equal(result.meta.source, 'snapshot');
    assert.equal(result.meta.stale, true);
});
test('session buckets replace affected sessions and unsafe changes recover fully without drift', async () => {
    assert.equal(typeof perf.createSessionBucketStore, 'function');
    let rows = [{ sessionId: 's', cost: 5 }, { sessionId: 't', cost: 8 }];
    const calls = [];
    const store = perf.createSessionBucketStore({ read: async (_context, ids) => { calls.push(ids || null); return rows.filter(r => !ids || ids.includes(r.sessionId)); } });
    const context = { queryKey: 'month' };
    assert.equal((await store.get(context)).length, 2);
    rows = [{ sessionId: 's', cost: 7 }, { sessionId: 't', cost: 8 }];
    store.change({ operationType: 'update', fullDocument: { sessionId: 's' }, updateDescription: { updatedFields: { cost: 7 }, removedFields: [] } });
    assert.deepEqual((await store.get(context)).map(r => r.cost).sort(), [7, 8]);
    assert.deepEqual(calls[1], ['s']);
    store.change({ operationType: 'update', fullDocument: { sessionId: 't' }, updateDescription: { updatedFields: { sessionId: 't' } } });
    await store.get(context);
    assert.equal(calls[2], null);
    store.change({ operationType: 'delete' }); await store.get(context);
    assert.equal(calls[3], null);
});
test('mutation during full read retains dirty sessions, failed replacement preserves snapshot and force reads database', async () => {
    assert.equal(typeof perf.createSessionBucketStore, 'function');
    const gate = deferred(); let calls = 0, fail = false;
    const store = perf.createSessionBucketStore({ read: async () => { const n = ++calls; if (n === 1) await gate.promise; if (fail) throw Error('read failed'); return [{ sessionId: 's', cost: n }]; } });
    const context = { queryKey: 'month' };
    const pending = store.get(context);
    store.change({ operationType: 'insert', fullDocument: { sessionId: 's' } }); gate.resolve();
    assert.equal((await pending)[0].cost, 1);
    assert.equal((await store.get(context))[0].cost, 2);
    store.change({ operationType: 'insert', fullDocument: { sessionId: 's' } }); fail = true;
    await assert.rejects(store.get(context), /read failed/);
    fail = false;
    assert.equal((await store.get(context))[0].cost, 4);
    assert.equal((await store.get(context, { force: true }))[0].cost, 5);
});
test('sustained writes publish snapshots as stale and every post-start session is recovered', async () => {
    assert.equal(typeof perf.createSessionBucketStore, 'function');
    let cache, store, calls = 0;
    const reads = [];
    store = perf.createSessionBucketStore({ read: async (_context, ids) => {
        calls++; reads.push(ids || null);
        store.change({ operationType: 'insert', fullDocument: { sessionId: calls % 2 ? 's' : 't' } });
        cache.invalidate();
        return [{ sessionId: ids?.[0] || 's', cost: calls }];
    } });
    cache = perf.createLeaderboardCache({ build: async context => { const rows = await store.get(context); return board(rows.reduce((n, r) => n + r.cost, 0)); } });
    const context = { key: 'a', queryKey: 'a' };
    const first = await cache.get(context);
    assert.equal(first.meta.stale, true);
    assert.equal(calls, 1);
    assert.equal((await cache.get(context, { force: true })).meta.stale, true);
    assert.deepEqual(reads[1], ['s']);
    await cache.get(context, { force: true });
    assert.deepEqual(reads[2], ['t']);
});
test('window buckets keep exact exclusive month end and daily boundary membership', () => {
    const windows = { daily: 300, yesterday: 200, monthly: 100, monthlyEnd: 250 };
    const gifts = [100, 199, 200, 249, 250, 299, 300].map(timeStamp => ({ timeStamp, cost: 1, receivedTalent: 'Alice' }));
    const buckets = perf.compactGifts(gifts, windows);
    const total = flag => buckets.filter(row => row[flag]).reduce((n, row) => n + row.count, 0);
    assert.equal(total('daily'), 1);
    assert.equal(total('yesterday'), 4);
    assert.equal(total('monthly'), 4);
    const pipeline = perf.buildGiftBucketPipeline({ windows, sessionIds: ['s'] });
    assert.deepEqual(pipeline[0].$match, { timeStamp: { $gte: 100 }, sessionId: { $in: ['s'] } });
    assert.deepEqual(perf.buildGiftBucketPipeline({ start: 100, end: 250 })[0].$match, { timeStamp: { $gte: 100, $lt: 250 } });
    assert.throws(() => perf.decodeGiftBuckets([{ gift: { cost: '5' }, count: 2 }]), /Non-numeric/);
});
test('partial replacement never postpones periodic authoritative reconciliation', async () => {
    let time = 0; const calls = [];
    const store = perf.createSessionBucketStore({ clock: () => time, maxAge: 900000, read: async (_c, ids) => { calls.push(ids || null); return [{ sessionId: 's', cost: 1 }]; } });
    const context = { queryKey: 'month' };
    await store.get(context);
    time = 899999;
    store.change({ operationType: 'insert', fullDocument: { sessionId: 's' } });
    await store.get(context);
    time = 900000;
    await store.get(context);
    assert.deepEqual(calls, [null, ['s'], null]);
});
test('journal overflow during read and unsafe attribution changes require full replacement', async () => {
    let store, calls = 0; const reads = [];
    store = perf.createSessionBucketStore({ read: async (_c, ids) => {
        reads.push(ids || null);
        if (++calls === 1) for (let i = 0; i < 1025; i++) store.change({ operationType: 'insert', fullDocument: { sessionId: 's' } });
        return [{ sessionId: 's', cost: calls }];
    } });
    await store.get({ queryKey: 'month' });
    await store.get({ queryKey: 'month' });
    assert.deepEqual(reads, [null, null]);
    store.change({ operationType: 'replace', fullDocument: { sessionId: 't' } });
    await store.get({ queryKey: 'month' });
    assert.equal(reads[2], null);
});
test('result and bucket LRU eviction cannot leak context or grow without bound', async () => {
    let calls = 0;
    const cache = perf.createLeaderboardCache({ maxEntries: 2, build: async () => board(++calls) });
    await cache.get({ key: 'a' }); await cache.get({ key: 'b' }); await cache.get({ key: 'c' });
    const a = await cache.get({ key: 'a' });
    assert.equal(a.data.individual.daily[0].value, 4);
    assert.equal(a.meta.contextKey, 'a');
    let reads = 0;
    const store = perf.createSessionBucketStore({ maxEntries: 1, read: async () => [{ cost: ++reads }] });
    await store.get({ queryKey: 'a' }); await store.get({ queryKey: 'b' });
    assert.equal((await store.get({ queryKey: 'a' }))[0].cost, 3);
});
test('concurrent manual refresh waits for automatic work then makes an actual new forced read', async () => {
    const gate = deferred(); const forces = [];
    const cache = perf.createLeaderboardCache({ build: async (_context, { force }) => {
        forces.push(force);
        if (forces.length === 1) await gate.promise;
        return board(forces.length);
    } });
    const automatic = cache.get({ key: 'a' });
    const manual = cache.get({ key: 'a' }, { force: true });
    gate.resolve();
    assert.equal((await automatic).data.individual.daily[0].value, 1);
    assert.equal((await manual).data.individual.daily[0].value, 2);
    assert.deepEqual(forces, [false, true]);
});
test('a later context sharing a raced bucket read cannot call that snapshot fresh', async () => {
    const gate = deferred();
    const store = perf.createSessionBucketStore({ read: async () => { await gate.promise; return [{ sessionId: 's', cost: 1 }]; } });
    const cache = perf.createLeaderboardCache({
        build: async context => { await store.get(context); return board(1); },
        isStale: context => store.isStale(context),
    });
    const first = cache.get({ key: 'freeze0', queryKey: 'month' });
    store.change({ operationType: 'insert', fullDocument: { sessionId: 's' } }); cache.invalidate();
    const second = cache.get({ key: 'freeze9', queryKey: 'month' });
    gate.resolve();
    assert.equal((await first).meta.stale, true);
    assert.equal((await second).meta.stale, true);
});
test('unexpected stream close invalidates once while intentional replaced-stream close is ignored', () => {
    assert.equal(typeof perf.observeStreamCompletion, 'function');
    const { EventEmitter } = require('node:events');
    const stream = new EventEmitter(), replaced = new EventEmitter();
    let active = stream, gaps = 0;
    perf.observeStreamCompletion(stream, () => active === stream, () => { active = null; gaps++; });
    stream.emit('end'); stream.emit('close');
    assert.equal(gaps, 1);
    active = replaced;
    perf.observeStreamCompletion(replaced, () => active === replaced, () => { gaps++; });
    active = new EventEmitter();
    replaced.emit('close');
    assert.equal(gaps, 1);
});
