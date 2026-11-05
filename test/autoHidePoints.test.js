'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../public/next-core');
const at = iso => new Date(iso).getTime();
const config = autoHide => N.normalize({ scores: [true, true, true, true, true], autoHide });
test('auto-hide follows the Vietnam calendar: points on days 1-14, hidden from day 15', () => {
    const c = config({ group: true });
    assert.deepEqual(N.visibleScores(c, [], at('2026-11-14T16:59:00Z')), [true, true, true, true, true]);
    assert.deepEqual(N.visibleScores(c, [], at('2026-11-14T17:00:00Z')), [false, true, false, true, true]);
    assert.deepEqual(N.visibleScores(c, [], at('2026-11-30T16:59:00Z')), [false, true, false, true, true]);
    assert.deepEqual(N.visibleScores(c, [], at('2026-11-30T17:00:00Z')), [true, true, true, true, true]);
    assert.deepEqual(N.visibleScores(config({ individual: true }), [], at('2026-11-20T03:00:00Z')), [true, false, true, false, false]);
});
test('a manual flip under auto-hide only lasts until it expires; without auto-hide the saved choice wins', () => {
    const c = config({ group: true, individual: true }), now = at('2026-11-20T03:00:00Z');
    const overrides = [{ value: true, until: now + N.OVERRIDE_MS }];
    assert.equal(N.visibleScores(c, overrides, now + N.OVERRIDE_MS - 1)[0], true);
    assert.equal(N.visibleScores(c, overrides, now + N.OVERRIDE_MS)[0], false);
    const early = at('2026-11-03T03:00:00Z');
    assert.equal(N.visibleScores(c, [, { value: false, until: early + N.OVERRIDE_MS }], early)[1], false);
    const manual = N.normalize({ scores: [false, true, true, true, true] });
    assert.deepEqual(N.visibleScores(manual, [{ value: true, until: Infinity }], now), [false, true, true, true, true]);
    assert.deepEqual(N.normalize({}).autoHide, { group: false, individual: false });
});
