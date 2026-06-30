const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeMonthlyWindows, MONTHLY_RESET_HOUR } = require('../monthlyWindows');

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
