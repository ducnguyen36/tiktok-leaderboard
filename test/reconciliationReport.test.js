const test = require('node:test');
const assert = require('node:assert/strict');
const { STATUS, classify, buildReport, renderMarkdown } = require('../reconciliationReport');

const at = s => new Date(s);
const profiles = [{ _id: 'g', name: 'HT - LEVELX', talents: { Alice: { id: 'a' }, Bob: { id: 'b' } } }];
const sessions = [
    { _id: 's1', profileId: 'g', sessionName: '20261001_200000', createdAt: at('2026-10-01T20:00:00+07:00'), updatedAt: at('2026-10-01T23:00:00+07:00') },
    { _id: 's2', profileId: 'g', sessionName: '20261002_200000', createdAt: at('2026-10-02T20:00:00+07:00'), updatedAt: at('2026-10-02T23:00:00+07:00') },
];
const buckets = [
    { gift: { sessionId: 's1', cost: 100, receivedTalent: 'Alice', receivedTalentUid: 'a' }, count: 1 },
    { gift: { sessionId: 's1', cost: 50, receivedTalent: 'Bob', receivedTalentUid: 'b' }, count: 1 },
    { gift: { sessionId: 's2', cost: 300, receivedTalent: 'Alice', receivedTalentUid: 'a' }, count: 1 },
];
const live = sessions.map(s => ({ source: 'helioscontrol', sessionId: s._id, profileId: 'g', live: false, liveSince: s.createdAt, heartbeatAt: s.updatedAt }));
const db = { collection: name => ({
    find: () => ({ toArray: async () => name === 'sessions' ? sessions : name === 'leaderboard_live' ? live : [] }),
    aggregate: () => ({ toArray: async () => buckets }),
}) };
// 46296 = 2026-10-01 (sheet serial date)
const values = [['Date', 'Alice', 'Bob', 'Chung', 'TỔNG', 'TOTAL'], [],
    [46296, 100, 50, 0, 150, 150],
    [46297, 280, null, 0, 280, 280],
    [46298, 500, null, 0, 500, 500]];
const sheets = { read: async ({ metadata }) => metadata ? { sheets: [{ properties: { title: 'THÁNG 10.2026', sheetId: 7, gridProperties: { rowCount: 40, columnCount: 20 } } }] } : { values } };
const monthly = { group: { monthly: [{ groupId: 'g', value: 470 }] }, individual: { monthly: [{ name: 'Alice', groupId: 'g', value: 420 }, { name: 'Bob', groupId: 'g', value: 50 }] } };

test('classify uses the four plan statuses and never turns missing data into zero', () => {
    assert.equal(classify({ sheetValue: 100, dbValue: 101, filled: true, comparable: true, isPast: true }).status, STATUS.exact);
    assert.equal(classify({ sheetValue: 100, dbValue: 140, filled: true, comparable: true, isPast: true }).status, STATUS.unexplained);
    assert.equal(classify({ sheetValue: 100, dbValue: 140, filled: true, comparable: true, isPast: true, known: { id: 'k', reason: 'r' } }).status, STATUS.explained);
    assert.equal(classify({ sheetValue: 100, dbValue: 140, filled: true, comparable: false, isPast: true }).status, STATUS.pending);
    assert.equal(classify({ sheetValue: null, dbValue: 140, filled: false, comparable: true, isPast: true }).status, STATUS.pending);
    assert.equal(classify({ sheetValue: null, dbValue: 0, filled: false, comparable: true, isPast: true }), null);
    assert.equal(classify({ sheetValue: 1, dbValue: 9, filled: true, comparable: true, isPast: false }), null, 'today is not reconciled');
});

test('daily report classifies each day, explains known issues and bridges the monthly board', async () => {
    const known = [{ id: 'LX-03-missing', group: 'LEVEL X', date: '2026-10-03', talent: null, reason: 'live not captured' }];
    const report = await buildReport({ db, sheets, profiles, monthly, now: Date.parse('2026-10-04T10:00:00+07:00'), groups: ['LEVEL X'], known });
    const g = report.groups[0];
    assert.equal(g.coverage.state, 'checked');
    const row = (date, target) => g.rows.find(r => r.date === date && r.target === target);
    assert.equal(row('2026-10-01', 'HT - LEVELX').status, STATUS.exact);
    assert.equal(row('2026-10-02', 'Alice').status, STATUS.unexplained);
    assert.equal(row('2026-10-02', 'Alice').diff, 20);
    assert.equal(row('2026-10-03', 'HT - LEVELX').status, STATUS.explained, 'no session that day, but a known issue');
    assert.equal(row('2026-10-03', 'HT - LEVELX').diff, -500);
    const bridge = g.bridge.find(b => b.target === 'Alice');
    assert.equal(bridge.boardMonthly, 420);
    assert.equal(bridge.comparedDb, 400);
    assert.equal(bridge.comparedSheet, 880);
    assert.equal(bridge.notComparedDb, 0);
    assert.equal(bridge.edgeAdjustment, 20, 'board vs workday sums is shown, never hidden');
    assert.deepEqual(report.changes.newIssues.sort(), report.groups[0].rows.filter(r => r.status === STATUS.unexplained || r.status === STATUS.explained).map(r => r.id).sort());
    const md = renderMarkdown(report);
    assert.match(md, /Lệch chưa giải thích/);
    assert.match(md, /Cầu nối điểm tháng/);
});

test('a resolved issue is reported once against the previous report', async () => {
    const first = await buildReport({ db, sheets, profiles, monthly, now: Date.parse('2026-10-04T10:00:00+07:00'), groups: ['LEVEL X'] });
    const id = first.groups[0].rows.find(r => r.date === '2026-10-02' && r.target === 'Alice').id;
    const fixed = values.map(r => r.slice()); fixed[3][1] = 300; fixed[3][4] = 300; fixed[3][5] = 300;
    const sheetsFixed = { read: async ({ metadata }) => metadata ? sheets.read({ metadata }) : { values: fixed } };
    const second = await buildReport({ db, sheets: sheetsFixed, profiles, monthly, now: Date.parse('2026-10-05T10:00:00+07:00'), groups: ['LEVEL X'], previous: first });
    assert.ok(second.changes.resolved.includes(id));
    assert.ok(!second.changes.newIssues.includes(id));
});
