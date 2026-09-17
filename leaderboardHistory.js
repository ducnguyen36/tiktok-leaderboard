'use strict';

const TIMEZONE = 'Asia/Ho_Chi_Minh';
const AGGREGATION_VERSION = 1;
const VIETNAM_OFFSET_HOURS = 7;
const MONTH_CLOSE_HOUR = 7;

function parseMonth(month) {
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month || '');
    if (!match) throw new RangeError('month must use YYYY-MM');
    return { year: Number(match[1]), monthIndex: Number(match[2]) - 1 };
}

function vietnamCalendarParts(now) {
    const shifted = new Date(now.getTime() + VIETNAM_OFFSET_HOURS * 60 * 60 * 1000);
    return { year: shifted.getUTCFullYear(), monthIndex: shifted.getUTCMonth() };
}

function formatMonth(year, monthIndex) {
    const normalized = new Date(Date.UTC(year, monthIndex, 1));
    return `${normalized.getUTCFullYear()}-${String(normalized.getUTCMonth() + 1).padStart(2, '0')}`;
}

function previousCalendarMonth(now = new Date()) {
    const current = vietnamCalendarParts(now);
    return formatMonth(current.year, current.monthIndex - 1);
}

function historyPeriodForMonth(month, now = new Date()) {
    const parsed = parseMonth(month);
    // Vietnam is UTC+7 without DST, so 07:00 local is 00:00 UTC.
    const boundaryUtcHour = MONTH_CLOSE_HOUR - VIETNAM_OFFSET_HOURS;
    const start = new Date(Date.UTC(parsed.year, parsed.monthIndex, 1, boundaryUtcHour));
    const end = new Date(Date.UTC(parsed.year, parsed.monthIndex + 1, 1, boundaryUtcHour));
    return {
        month,
        start: start.toISOString(),
        end: end.toISOString(),
        complete: now.getTime() >= end.getTime(),
    };
}

function validateRequestedHistoryMonth(month, now = new Date()) {
    parseMonth(month);
    if (month > previousCalendarMonth(now)) {
        throw new RangeError('future history month is not available');
    }
    return historyPeriodForMonth(month, now);
}

function latestClosedHistoryMonth(now = new Date()) {
    const candidate = previousCalendarMonth(now);
    if (historyPeriodForMonth(candidate, now).complete) return candidate;
    const parsed = parseMonth(candidate);
    return formatMonth(parsed.year, parsed.monthIndex - 1);
}

function archiveIdForPeriod(period) {
    return `leaderboard:v${AGGREGATION_VERSION}:${period.month}:${TIMEZONE}:${period.start}:${period.end}`;
}

function responseFromSnapshot(document, period) {
    return {
        data: {
            individual: document.individual,
            group: document.group,
        },
        period,
        generatedAt: document.generatedAt,
        source: 'snapshot',
        aggregationVersion: AGGREGATION_VERSION,
    };
}

function createHistoryArchiveService({ repository, build, clock = () => new Date() }) {
    const inFlight = new Map();

    function get(month, requestedAt = clock()) {
        const period = validateRequestedHistoryMonth(month, requestedAt);
        const id = archiveIdForPeriod(period);
        // The deterministic snapshot id stays stable, but provisional and complete
        // requests must not share work across the exact closing boundary.
        const inFlightKey = `${id}|${period.complete ? 'complete' : 'provisional'}`;
        const existingWork = inFlight.get(inFlightKey);
        if (existingWork) return existingWork;

        const work = (async () => {
            if (period.complete) {
                const snapshot = await repository.findById(id);
                if (snapshot) return responseFromSnapshot(snapshot, period);
            }

            const data = await build(period);
            const generatedAt = clock().toISOString();
            const response = {
                data,
                period,
                generatedAt,
                source: 'rebuilt',
                aggregationVersion: AGGREGATION_VERSION,
            };

            if (period.complete) {
                await repository.upsertComplete({
                    _id: id,
                    aggregationVersion: AGGREGATION_VERSION,
                    timezone: TIMEZONE,
                    month: period.month,
                    periodStart: period.start,
                    periodEnd: period.end,
                    generatedAt,
                    complete: true,
                    individual: data.individual,
                    group: data.group,
                });
            }
            return response;
        })();

        inFlight.set(inFlightKey, work);
        work.finally(() => {
            if (inFlight.get(inFlightKey) === work) inFlight.delete(inFlightKey);
        }).catch(() => {});
        return work;
    }

    return { get };
}

function createSerializedContextBuilder(build) {
    const inFlight = new Map();
    let tail = Promise.resolve();

    return function buildForContext(contextKey, ...args) {
        const existing = inFlight.get(contextKey);
        if (existing) return existing;

        const work = tail.catch(() => {}).then(() => build(contextKey, ...args));
        tail = work;
        inFlight.set(contextKey, work);
        work.finally(() => {
            if (inFlight.get(contextKey) === work) inFlight.delete(contextKey);
        }).catch(() => {});
        return work;
    };
}

function parseFreshContext(query = {}) {
    const rawResetHour = query.resetHour === undefined ? '0' : query.resetHour;
    if (typeof rawResetHour !== 'string' || !/^\d{1,2}$/.test(rawResetHour)) {
        throw new RangeError('resetHour must be an integer from 0 to 23');
    }
    const resetHour = Number(rawResetHour);
    if (resetHour < 0 || resetHour > 23) {
        throw new RangeError('resetHour must be an integer from 0 to 23');
    }

    const freezeUntil = query.freezeUntil === undefined ? '' : query.freezeUntil;
    if (typeof freezeUntil !== 'string' || (freezeUntil !== '' && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(freezeUntil))) {
        throw new RangeError('freezeUntil must be empty or use HH:mm');
    }
    return { resetHour, freezeUntil, key: `${resetHour}|${freezeUntil}` };
}

function leaderboardBuildContextKey(resetHour, freezeUntil, strictDependencies = false) {
    return `${resetHour}|${freezeUntil || ''}|${strictDependencies ? 'strict' : 'permissive'}`;
}

async function loadLeaderboardDependencies(repository, { strict = false, onOptionalError = () => {} } = {}) {
    async function read(name, fallback) {
        try {
            return await repository[name]();
        } catch (error) {
            if (strict) throw error;
            onOptionalError(name, error);
            return fallback();
        }
    }

    return {
        profiles: await read('readProfiles', () => []),
        sessionProfileMap: await read('readSessionProfileMap', () => ({})),
        locations: await read('readLocations', () => []),
    };
}

module.exports = {
    AGGREGATION_VERSION,
    MONTH_CLOSE_HOUR,
    TIMEZONE,
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
};
