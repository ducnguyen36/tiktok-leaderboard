const { test } = require('node:test');
const assert = require('node:assert/strict');

// The archive helpers must not depend on the host/server timezone.
process.env.TZ = 'America/Los_Angeles';

const {
    archiveIdForPeriod,
    createHistoryArchiveService,
    createSerializedContextBuilder,
    historyPeriodForMonth,
    leaderboardBuildContextKey,
    latestClosedHistoryMonth,
    loadLeaderboardDependencies,
    parseFreshContext,
    previousCalendarMonth,
    validateRequestedHistoryMonth,
} = require('../leaderboardHistory');

function createFakeRepository(initial = []) {
    const documents = new Map(initial.map(doc => [doc._id, structuredClone(doc)]));
    const calls = { find: 0, upsert: 0 };
    return {
        documents,
        calls,
        async findById(id) {
            calls.find++;
            const doc = documents.get(id);
            return doc ? structuredClone(doc) : null;
        },
        async upsertComplete(doc) {
            calls.upsert++;
            if (!documents.has(doc._id)) documents.set(doc._id, structuredClone(doc));
        },
    };
}

function completedSnapshot(month, data = { individual: [], group: [] }) {
    const now = new Date('2026-09-18T00:00:00.000Z');
    const period = historyPeriodForMonth(month, now);
    return {
        _id: archiveIdForPeriod(period),
        aggregationVersion: 2,
        timezone: 'Asia/Ho_Chi_Minh',
        month,
        periodStart: period.start,
        periodEnd: period.end,
        generatedAt: '2026-09-01T00:00:03.000Z',
        complete: true,
        individual: structuredClone(data.individual),
        group: structuredClone(data.group),
    };
}

test('history period stays provisional until exactly 07:00 Vietnam time on day 1', () => {
    const beforeClose = historyPeriodForMonth('2026-08', new Date('2026-08-31T23:59:59.999Z'));
    assert.deepEqual(beforeClose, {
        month: '2026-08',
        start: '2026-08-01T00:00:00.000Z',
        end: '2026-09-01T00:00:00.000Z',
        complete: false,
    });

    const atClose = historyPeriodForMonth('2026-08', new Date('2026-09-01T00:00:00.000Z'));
    assert.equal(atClose.complete, true);
});

test('history period handles leap years and year rollover with literal ISO boundaries', () => {
    assert.deepEqual(
        historyPeriodForMonth('2024-02', new Date('2026-09-18T00:00:00.000Z')),
        {
            month: '2024-02',
            start: '2024-02-01T00:00:00.000Z',
            end: '2024-03-01T00:00:00.000Z',
            complete: true,
        }
    );
    assert.deepEqual(
        historyPeriodForMonth('2025-12', new Date('2026-09-18T00:00:00.000Z')),
        {
            month: '2025-12',
            start: '2025-12-01T00:00:00.000Z',
            end: '2026-01-01T00:00:00.000Z',
            complete: true,
        }
    );
});

test('previous calendar month follows Vietnam calendar time, including January rollover', () => {
    assert.equal(previousCalendarMonth(new Date('2026-01-01T00:30:00.000Z')), '2025-12');
    assert.equal(previousCalendarMonth(new Date('2025-12-31T18:00:00.000Z')), '2025-12');
});

test('requested history month rejects malformed and later-than-previous-calendar months', () => {
    const now = new Date('2026-09-18T00:00:00.000Z');
    for (const month of ['', '2026-9', '2026-13', 'not-a-month']) {
        assert.throws(() => validateRequestedHistoryMonth(month, now), /YYYY-MM/);
    }
    assert.throws(() => validateRequestedHistoryMonth('2026-09', now), /future/i);
    assert.equal(validateRequestedHistoryMonth('2026-08', now).month, '2026-08');
});

test('latest closed month flips at the exact Vietnam closing boundary', () => {
    assert.equal(latestClosedHistoryMonth(new Date('2026-08-31T23:59:59.999Z')), '2026-07');
    assert.equal(latestClosedHistoryMonth(new Date('2026-09-01T00:00:00.000Z')), '2026-08');
});

test('archive id deterministically includes version, month, timezone and exact boundaries', () => {
    const period = historyPeriodForMonth('2026-08', new Date('2026-09-18T00:00:00.000Z'));
    assert.equal(
        archiveIdForPeriod(period),
        'leaderboard:v2:2026-08:Asia/Ho_Chi_Minh:2026-08-01T00:00:00.000Z:2026-09-01T00:00:00.000Z'
    );
});

test('empty completed snapshot is a cache hit and does not invoke the builder', async () => {
    const snapshot = completedSnapshot('2026-08');
    const repository = createFakeRepository([snapshot]);
    const service = createHistoryArchiveService({
        repository,
        build: async () => assert.fail('builder must not run for an empty cached snapshot'),
        clock: () => new Date('2026-09-18T00:00:00.000Z'),
    });

    assert.deepEqual(await service.get('2026-08'), {
        data: { individual: [], group: [] },
        period: {
            month: '2026-08',
            start: '2026-08-01T00:00:00.000Z',
            end: '2026-09-01T00:00:00.000Z',
            complete: true,
        },
        generatedAt: '2026-09-01T00:00:03.000Z',
        source: 'snapshot',
        aggregationVersion: 2,
    });
    assert.deepEqual(repository.calls, { find: 1, upsert: 0 });
});

test('old capped v1 archive remains immutable while complete v2 archive is created', async () => {
    const legacyId = 'leaderboard:v1:2026-08:Asia/Ho_Chi_Minh:2026-08-01T00:00:00.000Z:2026-09-01T00:00:00.000Z';
    const old = { ...completedSnapshot('2026-08'), _id: legacyId, aggregationVersion: 1 };
    const repository = createFakeRepository([old]);
    const full = { individual: Array.from({ length: 71 }, (_, i) => ({ id: String(i), name: `Idol ${i}`, value: i })), group: [] };
    const service = createHistoryArchiveService({ repository, build: async () => full, clock: () => new Date('2026-09-18T00:00:00Z') });
    const result = await service.get('2026-08');
    assert.equal(result.data.individual.length, 71);
    assert.equal(result.aggregationVersion, 2);
    assert.deepEqual(repository.documents.get(legacyId), old);
    assert.equal(repository.documents.size, 2);
});

test('completed rebuild is atomically persisted and reused on the next request', async () => {
    const repository = createFakeRepository();
    let builds = 0;
    const service = createHistoryArchiveService({
        repository,
        build: async () => {
            builds++;
            return {
                individual: [{ id: 'idol-1', name: 'Idol One', value: 42, avatar: '', groupId: 'g1', locationId: 'hcm' }],
                group: [{ id: 'g1', name: 'Group One', value: 42, avatar: '', groupId: 'g1', locationId: 'hcm' }],
            };
        },
        clock: () => new Date('2026-09-18T00:00:00.000Z'),
    });

    const first = await service.get('2026-08');
    const second = await service.get('2026-08');

    assert.equal(first.source, 'rebuilt');
    assert.equal(second.source, 'snapshot');
    assert.deepEqual(second.data, first.data);
    assert.equal(builds, 1);
    assert.equal(repository.calls.upsert, 1);
    const stored = [...repository.documents.values()][0];
    assert.equal(stored.complete, true);
    assert.equal(stored.periodStart, '2026-08-01T00:00:00.000Z');
    assert.equal(stored.periodEnd, '2026-09-01T00:00:00.000Z');
});

test('concurrent requests for one month share one cache lookup and one build', async () => {
    const repository = createFakeRepository();
    let releaseBuild;
    let builds = 0;
    const buildGate = new Promise(resolve => { releaseBuild = resolve; });
    const service = createHistoryArchiveService({
        repository,
        build: async () => {
            builds++;
            await buildGate;
            return { individual: [], group: [] };
        },
        clock: () => new Date('2026-09-18T00:00:00.000Z'),
    });

    const first = service.get('2026-08');
    const second = service.get('2026-08');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(builds, 1);
    assert.equal(repository.calls.find, 1);
    releaseBuild();
    assert.deepEqual(await first, await second);
});

test('failed build leaves persistence unchanged and a later call retries', async () => {
    const unrelated = completedSnapshot('2026-07');
    const repository = createFakeRepository([unrelated]);
    let builds = 0;
    const service = createHistoryArchiveService({
        repository,
        build: async () => {
            builds++;
            if (builds === 1) throw new Error('strict profile read failed');
            return { individual: [], group: [] };
        },
        clock: () => new Date('2026-09-18T00:00:00.000Z'),
    });

    await assert.rejects(service.get('2026-08'), /strict profile read failed/);
    assert.equal(repository.calls.upsert, 0);
    assert.deepEqual([...repository.documents.values()], [unrelated]);

    const retry = await service.get('2026-08');
    assert.equal(retry.source, 'rebuilt');
    assert.equal(builds, 2);
    assert.equal(repository.calls.upsert, 1);
});

test('provisional previous calendar month is rebuilt without reading or writing snapshots', async () => {
    const repository = createFakeRepository();
    const service = createHistoryArchiveService({
        repository,
        build: async period => {
            assert.equal(period.complete, false);
            return { individual: [], group: [] };
        },
        clock: () => new Date('2026-08-31T23:59:59.999Z'),
    });

    const result = await service.get('2026-08');
    assert.equal(result.period.complete, false);
    assert.equal(result.source, 'rebuilt');
    assert.deepEqual(repository.calls, { find: 0, upsert: 0 });
});

test('a closing-boundary request does not share an older provisional in-flight result', async () => {
    const repository = createFakeRepository();
    let releaseProvisional;
    let builds = 0;
    const service = createHistoryArchiveService({
        repository,
        build: async period => {
            builds++;
            if (!period.complete) {
                await new Promise(resolve => { releaseProvisional = resolve; });
            }
            return { individual: [], group: [] };
        },
        clock: () => new Date('2026-09-01T00:00:01.000Z'),
    });

    const provisional = service.get('2026-08', new Date('2026-08-31T23:59:59.999Z'));
    await new Promise(resolve => setImmediate(resolve));
    const completedPromise = service.get('2026-08', new Date('2026-09-01T00:00:00.000Z'));
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(builds, 2);
    releaseProvisional();
    const completed = await completedPromise;
    assert.equal(completed.period.complete, true);
    assert.equal(repository.calls.upsert, 1);
    assert.equal((await provisional).period.complete, false);
});

test('context builder shares identical work and serializes different contexts without stale results', async () => {
    const events = [];
    const releases = [];
    const build = createSerializedContextBuilder(async context => {
        events.push(`start:${context}`);
        await new Promise(resolve => releases.push(resolve));
        events.push(`end:${context}`);
        return `data:${context}`;
    });

    const first = build('0|09:00');
    const same = build('0|09:00');
    const different = build('7|');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(events, ['start:0|09:00']);

    releases.shift()();
    assert.equal(await first, 'data:0|09:00');
    assert.equal(await same, 'data:0|09:00');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(events, ['start:0|09:00', 'end:0|09:00', 'start:7|']);

    releases.shift()();
    assert.equal(await different, 'data:7|');
});

test('fresh context accepts only reset hours 0..23 and empty or exact HH:mm freeze time', () => {
    assert.deepEqual(parseFreshContext({ resetHour: '0', freezeUntil: '09:00' }), {
        resetHour: 0,
        freezeUntil: '09:00',
        key: '0|09:00',
    });
    assert.deepEqual(parseFreshContext({}), { resetHour: 0, freezeUntil: '', key: '0|' });
    assert.deepEqual(parseFreshContext({ resetHour: '23', freezeUntil: '' }), {
        resetHour: 23,
        freezeUntil: '',
        key: '23|',
    });

    for (const resetHour of ['-1', '24', '3oops', '']) {
        assert.throws(() => parseFreshContext({ resetHour }), /resetHour/);
    }
    for (const freezeUntil of ['9:00', '24:00', '09:60', 'later']) {
        assert.throws(() => parseFreshContext({ freezeUntil }), /freezeUntil/);
    }
});

test('strict dependency loading rejects every required read while permissive loading keeps legacy fallbacks', async () => {
    const healthy = {
        profiles: [{ _id: 'p1', name: 'Group One' }],
        sessionProfileMap: { s1: 'p1' },
        locations: [{ id: 'hcm', name: 'HCM' }],
    };

    for (const failedKey of ['profiles', 'sessionProfileMap', 'locations']) {
        const failure = new Error(`${failedKey} unavailable`);
        const repository = {
            readProfiles: async () => failedKey === 'profiles' ? Promise.reject(failure) : healthy.profiles,
            readSessionProfileMap: async () => failedKey === 'sessionProfileMap' ? Promise.reject(failure) : healthy.sessionProfileMap,
            readLocations: async () => failedKey === 'locations' ? Promise.reject(failure) : healthy.locations,
        };

        const permissive = await loadLeaderboardDependencies(repository, { strict: false });
        assert.deepEqual(permissive[failedKey], failedKey === 'sessionProfileMap' ? {} : []);
        await assert.rejects(
            loadLeaderboardDependencies(repository, { strict: true }),
            error => error === failure
        );
    }
});

test('strict fresh work cannot share a permissive in-flight build for the same reset and freeze context', async () => {
    const locationFailure = new Error('locations unavailable');
    let locationReads = 0;
    const repository = {
        readProfiles: async () => [],
        readSessionProfileMap: async () => ({}),
        readLocations: async () => {
            locationReads++;
            throw locationFailure;
        },
    };
    const run = createSerializedContextBuilder((_key, strict) =>
        loadLeaderboardDependencies(repository, { strict })
    );

    const legacy = run(leaderboardBuildContextKey(0, '09:00', false), false);
    const forced = run(leaderboardBuildContextKey(0, '09:00', true), true);

    assert.deepEqual((await legacy).locations, []);
    await assert.rejects(forced, error => error === locationFailure);
    assert.equal(locationReads, 2);
});
