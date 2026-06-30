const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeMonthlyWindows, MONTHLY_RESET_HOUR, computeDailyWindows } = require('../monthlyWindows');

// Helper: build a server-local Date (same construction the module uses → TZ-independent)
const d = (y, m, day, h = 0, min = 0) => new Date(y, m, day, h, min, 0, 0);

test('constant is 7', () => {
    assert.equal(MONTHLY_RESET_HOUR, 7);
});

test('before 07:00 on the 1st: active window is last month, not in grace', () => {
    const w = computeMonthlyWindows(d(2026, 2, 1, 3), 7); // Mar 1 2026 03:00
    assert.deepEqual(w.monthlyStart, d(2026, 1, 1, 7));    // Feb 1 07:00
    assert.deepEqual(w.prevMonthlyStart, d(2026, 0, 1, 7)); // Jan 1 07:00
    assert.equal(w.inGrace, false);
    assert.deepEqual(w.displayStart, d(2026, 1, 1, 7));
    assert.equal(w.displayEnd, null);
});

test('07:00 exactly on the 1st: in grace, display previous month', () => {
    const w = computeMonthlyWindows(d(2026, 2, 1, 7), 7); // Mar 1 2026 07:00
    assert.deepEqual(w.monthlyStart, d(2026, 2, 1, 7));     // Mar 1 07:00
    assert.equal(w.inGrace, true);
    assert.deepEqual(w.displayStart, d(2026, 1, 1, 7));     // Feb 1 07:00
    assert.deepEqual(w.displayEnd, d(2026, 2, 1, 7));       // Mar 1 07:00
});

test('mid-first-day (10:00): in grace, display previous month', () => {
    const w = computeMonthlyWindows(d(2026, 2, 1, 10), 7);
    assert.equal(w.inGrace, true);
    assert.deepEqual(w.displayStart, d(2026, 1, 1, 7));
    assert.deepEqual(w.displayEnd, d(2026, 2, 1, 7));
});

test('1st at 23:59: still in grace', () => {
    const w = computeMonthlyWindows(d(2026, 2, 1, 23, 59), 7);
    assert.equal(w.inGrace, true);
});

test('00:00 on the 2nd: grace ends, display current month', () => {
    const w = computeMonthlyWindows(d(2026, 2, 2, 0, 0), 7); // Mar 2 00:00
    assert.equal(w.inGrace, false);
    assert.deepEqual(w.displayStart, d(2026, 2, 1, 7));      // Mar 1 07:00
    assert.equal(w.displayEnd, null);
});

test('mid-month: not in grace, display current month', () => {
    const w = computeMonthlyWindows(d(2026, 2, 15, 12), 7);
    assert.equal(w.inGrace, false);
    assert.deepEqual(w.displayStart, d(2026, 2, 1, 7));
    assert.equal(w.displayEnd, null);
});

test('Dec->Jan rollover: previous window is last December', () => {
    const w = computeMonthlyWindows(d(2026, 0, 1, 10), 7); // Jan 1 2026 10:00
    assert.deepEqual(w.monthlyStart, d(2026, 0, 1, 7));     // Jan 1 2026 07:00
    assert.deepEqual(w.prevMonthlyStart, d(2025, 11, 1, 7)); // Dec 1 2025 07:00
    assert.equal(w.inGrace, true);
    assert.deepEqual(w.displayStart, d(2025, 11, 1, 7));
    assert.deepEqual(w.displayEnd, d(2026, 0, 1, 7));
});

test('computeDailyWindows: yesterday is the 24h before dailyStart', () => {
    const dw = computeDailyWindows(d(2026, 6, 15, 10), 0); // Jul 15 10:00, reset 0
    assert.deepEqual(dw.dailyStart, d(2026, 6, 15, 0));
    assert.deepEqual(dw.yesterdayStart, d(2026, 6, 14, 0));
    assert.deepEqual(dw.yesterdayEnd, d(2026, 6, 15, 0));
});

test('computeDailyWindows: before reset hour rolls dailyStart back a day', () => {
    const dw = computeDailyWindows(d(2026, 6, 15, 3), 9); // 03:00, reset 09:00
    assert.deepEqual(dw.dailyStart, d(2026, 6, 14, 9));
    assert.deepEqual(dw.yesterdayStart, d(2026, 6, 13, 9));
});

test('C1 regression: on the 2nd at 00:00 (resetHour 0), displayStart-alone would drop yesterday', () => {
    const now = d(2026, 6, 2, 0, 0); // Jul 2 00:00
    const mw = computeMonthlyWindows(now, 7);
    const dw = computeDailyWindows(now, 0);
    // Precondition: the OLD buggy bound (displayStart alone) is AFTER yesterdayStart.
    assert.ok(mw.displayStart.getTime() > dw.yesterdayStart.getTime(),
        'displayStart should be after yesterdayStart — this is the bug being guarded');
    // The fixed bound is the 3-way min and MUST cover every window.
    const loadStart = Math.min(mw.displayStart.getTime(), dw.dailyStart.getTime(), dw.yesterdayStart.getTime());
    assert.ok(loadStart <= dw.yesterdayStart.getTime(), 'load must cover yesterday');
    assert.ok(loadStart <= dw.dailyStart.getTime(), 'load must cover today');
    assert.ok(loadStart <= mw.displayStart.getTime(), 'load must cover displayed monthly');
});

test('C1 regression: load bound covers all windows for every daily resetHour on the 2nd', () => {
    const now = d(2026, 6, 2, 8, 0); // Jul 2 08:00
    const mw = computeMonthlyWindows(now, 7);
    for (let rh = 0; rh < 24; rh++) {
        const dw = computeDailyWindows(now, rh);
        const loadStart = Math.min(mw.displayStart.getTime(), dw.dailyStart.getTime(), dw.yesterdayStart.getTime());
        assert.ok(loadStart <= dw.yesterdayStart.getTime(), `resetHour ${rh}: must cover yesterday`);
        assert.ok(loadStart <= dw.dailyStart.getTime(), `resetHour ${rh}: must cover today`);
        assert.ok(loadStart <= mw.displayStart.getTime(), `resetHour ${rh}: must cover monthly`);
    }
});
