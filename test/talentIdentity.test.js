'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../leaderboardAggregation');
const T = require('../talentIdentity');
const { scoreRows } = require('../rankingNext');

// Mirrors HeliosControl profiles on 2026-11-19 (uids shortened).
const profiles = () => [
    { _id: 'dpm', name: 'HT - DPM', uid: 'h-dpm', updatedAt: '2026-11-17', inactiveTalents: ['MOON 🌙✨'], talents: {
        'MOON 🌙✨': { id: 'u-moon', uniqueId: 'silvercrystal888' }, 'LILY 🍉': { id: 'u-lily', uniqueId: 'linhnhi2903' } } },
    { _id: 'venyxis', name: 'HT - VENYXIS', uid: 'h-ven', updatedAt: '2026-11-17', talents: {
        'LAYLA 🐷✨': { id: 'u-layla', uniqueId: 'laylaizme' }, 'SooAe 🐋🐳': { id: 'u-sooae', uniqueId: '__12thg03__' },
        'TEAM A': { id: '7521819032229446663', uniqueId: 'teama.venyxis' }, 'TEAM B': { id: '7524754348673336327', uniqueId: 'teamb.venyxis' } } },
    { _id: '1775469403434', name: 'HT - KAYZEN', uid: 'h-kz', updatedAt: '2026-09-19', talents: {
        '💠KZ_Pudy.fwfw💠': { id: 'u-pudy', uniqueId: 'kz_pudy.fwfw' }, '💠 KZ_Mikeyyy 💪🏻 💠': { id: 'u-mikey', uniqueId: 'kz_mikeyyy' } } },
    { _id: 'levelx', name: 'HT - LEVELX', uid: 'h-lx', updatedAt: '2026-11-16', talents: {
        'MIKEY 🗝️💠': { id: 'u-mikey', uniqueId: 'immanh17' }, 'Lapin 🐰': { id: null, uniqueId: 'hoithanh115' } } },
    { _id: 'velix', name: 'HT-VELIX', uid: 'h-velix', updatedAt: '2026-11-18', talents: {
        'Hana🐰': { id: 'u-hana', uniqueId: 'hanacute099' }, 'bobo🌻': { id: 'u-bobo', uniqueId: 'bobodayy' },
        'mimi🐿️': { id: '7014456012867290138', uniqueId: 'mimiiu_08' } } },
    { _id: 'nexar', name: 'HT - NEXAR', uid: 'h-nexar', updatedAt: '2026-11-19', talents: {
        'Andee-J': { id: '6775064023412671489', uniqueId: 'nguyducquocthai' }, 'Henry 🖤🪽': { id: 'u-henry', uniqueId: 'khoabo02' },
        '🐦‍🔥🐺Z A NH': { id: '7341033020629992456', uniqueId: 'ch.danh50' }, '👑DYLAN-T🦧': { id: 'u-dylan', uniqueId: 'dylan.t2588' } } },
    { _id: '1793099207175', name: 'CROWN WAR II', uid: '', updatedAt: '2026-10-27', talents: {
        'TTS-Anthonyyyy 🦋': { id: '7341033020629992456', uniqueId: 'ch.danh50' }, Henry: { id: 'u-henry', uniqueId: 'khoabo02' },
        '👑DYLAN-T🦧': { id: 'u-dylan', uniqueId: 'dylan.t2588' }, 'Andee-J ☘️': { id: '6775064023412671489', uniqueId: 'andeej.htnexar' },
        'Hana🐰🥕': { id: 'u-hana', uniqueId: 'hanacute099' }, 'bobo🌻': { id: 'u-bobo', uniqueId: 'bobodayy' },
        mimiibakhitrentunghatbi: { id: '7014456012867290138', uniqueId: 'mimiibakhitrentunghatbi' },
        velix: { id: null, uniqueId: null }, nexar: { id: null, uniqueId: null } } },
    { _id: '1784445344024', name: 'HT-VELORA', uid: 'h-velix', updatedAt: '2026-11-13', talents: {} },
];
// As in production, CROWN WAR II has no lives of its own (one test adds one).
const homeSessions = { 'nx-1': 'nexar', 'vx-1': 'velix', 'ven-1': 'venyxis', 'lx-1': 'levelx', 'dpm-1': 'dpm' };
let sessions = homeSessions;

function oldBoards(list, gifts) {
    const owned = A.orderForOwnership(list, sessions), u = A.buildUidMaps(owned), tp = A.buildTalentToProfileMap(owned);
    const pm = A.buildProfileMap(list), pn = A.buildProfileNameToIdMap(list);
    return {
        individual: A.aggregateIndividual(gifts, A.buildTalentAvatars(list), pn, u.uidToTalent, tp, pm, u.uidToProfile),
        group: A.aggregateGroup(gifts, tp, pm, pn, u.uidToTalent, u.uidToProfile, sessions),
    };
}
function boards(list, gifts, mode = 'new') {
    const im = T.buildIndividualMaps(list, sessions, { mode });
    const owned = A.orderForOwnership(list, sessions), u = A.buildUidMaps(owned), tp = A.buildTalentToProfileMap(owned);
    const pm = A.buildProfileMap(list), pn = A.buildProfileNameToIdMap(list);
    const individual = im.visible(A.aggregateIndividual(gifts, im.talentAvatarMap, im.profileNameToId, im.uidToTalent, im.talentToProfile, im.profileMap, im.uidToProfile));
    const group = A.aggregateGroup(gifts, im.groupTalentToProfile(tp), pm, pn, u.uidToTalent, u.uidToProfile, sessions);
    return { im, individual, group, idol: Object.fromEntries(individual.map(r => [r._id, r.totalDiamonds])), groups: Object.fromEntries(group.map(r => [r.name, r.totalDiamonds])) };
}
const gift = (sessionId, cost, ...talents) => ({ sessionId, cost, count: 1, receivedTalents: talents.map(t => (typeof t === 'string' ? t : { name: t[0], uid: t[1] })) });

// Normal days of normal talents: nothing here touches an event, a duplicate or a group account.
const normalGifts = [
    gift('dpm-1', 500, ['LILY 🍉', 'u-lily']), gift('dpm-1', 90, 'HT - DPM'),
    gift('ven-1', 300, ['LAYLA 🐷✨', 'u-layla'], ['SooAe 🐋🐳', 'u-sooae']), gift('ven-1', 41, 'HT - VENYXIS'),
    gift('lx-1', 77, 'Lapin 🐰'), gift('lx-1', 20, 'hoithanh115'),
    gift('vx-1', 1000, ['Hana🐰', 'u-hana']), gift('vx-1', 30, 'bobo🌻'),
    gift('nx-1', 640, ['Andee-J', '6775064023412671489'], ['Henry 🖤🪽', 'u-henry']), gift('nx-1', 8, 'HT - NEXAR'),
];

test("mode 'old' builds exactly the maps used before", () => {
    const list = profiles();
    const owned = A.orderForOwnership(list, sessions);
    const im = T.buildIndividualMaps(list, sessions, { mode: 'old' });
    assert.deepEqual(im.uidToTalent, A.buildUidMaps(owned).uidToTalent);
    assert.deepEqual(im.talentToProfile, A.buildTalentToProfileMap(owned));
    assert.deepEqual(im.talentAvatarMap, A.buildTalentAvatars(list));
    assert.equal(im.groupOf, null);
    const rows = [{ _id: 'TEAM A', totalDiamonds: 0 }];
    assert.equal(im.visible(rows), rows);
    const tp = A.buildTalentToProfileMap(owned);
    assert.equal(im.groupTalentToProfile(tp), tp);
    assert.equal(T.identityMode(''), 'new', 'one person one row by default since 28/11');
    assert.equal(T.identityMode('NEW'), 'new');
    assert.equal(T.identityMode('OLD'), 'old');
    assert.equal(T.identityMode('yes'), 'new');
});

test('regression: normal talents keep their rows, totals and group totals', () => {
    const before = oldBoards(profiles(), normalGifts), after = boards(profiles(), normalGifts);
    const normal = ['LILY 🍉', 'LAYLA 🐷✨', 'SooAe 🐋🐳', 'Lapin 🐰', 'Hana🐰', 'bobo🌻', 'mimi🐿️', 'Andee-J', 'Henry 🖤🪽', '🐦‍🔥🐺Z A NH', '👑DYLAN-T🦧', 'MIKEY 🗝️💠', '💠KZ_Pudy.fwfw💠'];
    const old = Object.fromEntries(before.individual.map(r => [r._id, r.totalDiamonds]));
    for (const name of normal) if (name !== '💠KZ_Pudy.fwfw💠') assert.equal(after.idol[name], old[name], name);
    assert.equal(after.idol['LILY 🍉'], 590, 'her gifts and the group gift of the live she was alone in');
    assert.equal(after.idol['Lapin 🐰'], 97, 'a gift under the @uniqueId still reaches the talent');
    assert.deepEqual(after.group, before.group, 'group board unchanged');
});

test('CROWN WAR II creates nobody: its nicknames count for the real person', () => {
    const gifts = [
        gift('nx-1', 100, 'Henry'), gift('nx-1', 50, 'Andee-J ☘️'), gift('vx-1', 40, 'Hana🐰🥕'),
        gift('vx-1', 10, ['bobo🌻', 'u-bobo']), gift('nx-1', 7, ['👑DYLAN-T🦧', 'u-dylan']),
    ];
    const before = Object.fromEntries(oldBoards(profiles(), gifts).individual.map(r => [r._id, r.totalDiamonds]));
    assert.equal(before.Henry, 100, 'old: a ghost row');
    const { idol, im } = boards(profiles(), gifts);
    for (const ghost of ['Henry', 'Andee-J ☘️', 'Hana🐰🥕', 'TTS-Anthonyyyy 🦋', 'mimiibakhitrentunghatbi', 'velix', 'nexar']) assert.equal(ghost in idol, false, ghost);
    assert.equal(idol['Henry 🖤🪽'], 100);
    assert.equal(idol['Andee-J'], 50);
    assert.equal(idol['Hana🐰'], 40);
    assert.equal(idol['bobo🌻'], 10);
    assert.equal(im.groupOf('bobo🌻').groupId, 'velix', 'label stays VELIX');
    assert.equal(im.groupOf('👑DYLAN-T🦧').groupId, 'nexar', 'label stays NEXAR');
    assert.equal(im.groupOf('Henry'), null);
});

test("CROWN WAR II nicknames count for the person's group, except in the event's own live", t => {
    sessions = { ...homeSessions, 'cw-1': '1793099207175' };
    t.after(() => { sessions = homeSessions; });
    const gifts = [gift('vx-1', 228, 'Hana🐰🥕'), gift('cw-1', 33, 'Henry')];
    const before = oldBoards(profiles(), gifts).group, after = boards(profiles(), gifts);
    const old = Object.fromEntries(before.map(r => [r.name, r.totalDiamonds]));
    assert.equal(old['CROWN WAR II'], 261);
    assert.equal(after.groups['HT-VELIX'], 228);
    assert.equal(after.groups['CROWN WAR II'], 33, "the event's own live keeps its gift");
    assert.equal(after.idol['Henry 🖤🪽'], 33, 'the person still gets it on the idol board');
});

test('confirmed other accounts and names reach the same person', () => {
    const gifts = [
        gift('nx-1', 11, 'Anthonyyyy 🦋'), gift('nx-1', 12, 'TTS-Anthonyyyy 🦋'), gift('nx-1', 13, 'andeej.htnexar'),
        gift('vx-1', 14, 'mimiibakhitrentunghatbi'), gift('vx-1', 15, ['mimiibakhitrentunghatbi', '7014456012867290138']),
    ];
    const { idol } = boards(profiles(), gifts);
    assert.equal(idol['🐦‍🔥🐺Z A NH'], 23);
    assert.equal(idol['Andee-J'], 13);
    assert.equal(idol['mimi🐿️'], 29);
    assert.equal('Anthonyyyy 🦋' in idol, false);
});

test('a talent listed in a disbanded group and a live group is one row, in the live group', () => {
    const gifts = [gift('lx-1', 70, ['MIKEY 🗝️💠', 'u-mikey']), gift('lx-1', 5, '💠 KZ_Mikeyyy 💪🏻 💠')];
    const { idol, im } = boards(profiles(), gifts);
    assert.equal(idol['MIKEY 🗝️💠'], 75);
    assert.equal('💠 KZ_Mikeyyy 💪🏻 💠' in idol, false);
    assert.equal(im.groupOf('MIKEY 🗝️💠').groupId, 'levelx');
});

test('group accounts are not idols; their diamonds stay with the group', () => {
    const list = profiles();
    list[1].talents['VENYXIS host'] = { id: 'h-ven', uniqueId: 'venyxis.ht' };
    const gifts = [gift('ven-1', 60, ['TEAM A', '7521819032229446663']), gift('ven-1', 9, ['VENYXIS host', 'h-ven']), gift('ven-1', 100, ['LAYLA 🐷✨', 'u-layla'])];
    const before = oldBoards(list, gifts), after = boards(list, gifts);
    for (const account of ['TEAM A', 'TEAM B', 'VENYXIS host']) assert.equal(account in after.idol, false, account);
    assert.equal(after.idol['LAYLA 🐷✨'], 100);
    assert.deepEqual(after.group, before.group);
    assert.equal(after.groups['HT - VENYXIS'], 169);
});

test('inactive and disbanded talents show only with diamonds in the period', () => {
    assert.equal('MOON 🌙✨' in boards(profiles(), normalGifts).idol, false);
    assert.equal('💠KZ_Pudy.fwfw💠' in boards(profiles(), normalGifts).idol, false);
    const { idol } = boards(profiles(), [gift('dpm-1', 5, ['MOON 🌙✨', 'u-moon']), gift('dpm-1', 6, ['💠KZ_Pudy.fwfw💠', 'u-pudy'])]);
    assert.equal(idol['MOON 🌙✨'], 5);
    assert.equal(idol['💠KZ_Pudy.fwfw💠'], 6);
    assert.equal(idol['LILY 🍉'], 0, 'an active talent with 0 stays');
});

test('telling an event profile from a group', () => {
    const base = { name: 'X', uid: 'h-x', talents: {} };
    assert.equal(T.classifyProfile({ ...base, _id: '1793099207175' }).event, true, 'listed');
    assert.equal(T.classifyProfile({ ...base, _id: 'e2', convertedToCompetition: true }).event, true, 'a competition was made from it');
    assert.equal(T.classifyProfile({ ...base, _id: 'g' }).event, false);
    assert.equal(T.classifyProfile({ ...base, _id: '1775469403434' }).disbanded, true);
    assert.equal(T.classifyProfile({ ...base, _id: 'g', status: 'disbanded' }).disbanded, true);
    assert.equal(T.classifyProfile({ ...base, _id: 'g', status: 'active' }).disbanded, false);
    // No host uid: an event only when all its members are copies of other profiles' members.
    const copy = [{ _id: 'g1', name: 'G1', uid: 'h1', talents: { A: { id: 'u-a' } } }, { _id: 'e', name: 'EVENT', uid: '', talents: { 'A 🎉': { id: 'u-a' } } }];
    assert.equal(T.normalizeProfiles(copy, { eventProfileIds: [] }).info.get('e').event, true);
    const fresh = [{ _id: 'g1', name: 'G1', uid: 'h1', talents: { A: { id: 'u-a' } } }, { _id: 'new', name: 'NEW GROUP', uid: '', talents: { B: { id: 'u-b' } } }];
    const n = T.normalizeProfiles(fresh, { eventProfileIds: [] });
    assert.equal(n.info.get('new').event, false, 'a new group without its host account yet stays a group');
    assert.equal(n.talentProfile.B, 'new');
});

test('markEventProfiles reads competitions.convertedFrom.profileId and survives errors', async () => {
    const db = ok => ({ collection: () => ({ distinct: async () => { if (!ok) throw new Error('down'); return ['e1', 42]; } }) });
    const list = [{ _id: 'e1' }, { _id: 42 }, { _id: 'g' }];
    await T.markEventProfiles(db(true), list);
    assert.deepEqual(list.map(p => p.convertedToCompetition === true), [true, true, false]);
    const other = [{ _id: 'e1' }];
    await T.markEventProfiles(db(false), other);
    assert.equal(other[0].convertedToCompetition, undefined);
});

test('another name never takes a real person\'s own name', () => {
    const list = [
        { _id: 'g1', name: 'G1', uid: 'h1', updatedAt: '2026-11-10', talents: { 'Henry 🖤🪽': { id: 'u-henry' }, Henry: { id: 'u-other' } } },
        { _id: 'e', name: 'EVENT', uid: '', talents: { Henry: { id: 'u-henry' } } },
    ];
    const { idol } = boards(list, [gift('nx-1', 9, 'Henry'), gift('nx-1', 4, ['Henry', 'u-henry'])]);
    assert.equal(idol.Henry, 9, 'the real Henry keeps gifts under his name');
    assert.equal(idol['Henry 🖤🪽'], 4, 'the uid decides');
});

test("the next ranking's daily rows use the switch; sheet checks keep 'old'", () => {
    const list = profiles(), sessionDocs = Object.entries(sessions).map(([_id, profileId]) => ({ _id, profileId }));
    const gifts = [gift('nx-1', 100, 'Henry'), gift('vx-1', 3, ['bobo🌻', 'u-bobo'])];
    const old = scoreRows(list, gifts, sessionDocs), next = scoreRows(list, gifts, sessionDocs, v => v || '', 'new');
    assert.equal(old.individual.find(r => r.name === 'Henry').value, 100);
    assert.equal(next.individual.some(r => r.name === 'Henry'), false);
    assert.equal(next.individual.find(r => r.name === 'Henry 🖤🪽').value, 100);
    assert.equal(next.individual.find(r => r.name === 'bobo🌻').groupId, 'velix');
    assert.equal(next.individual.length, old.individual.length - 12);
});

test('members Backstage lists but the group profile lacks join their group; event names lead to them', () => {
    const nexar = { _id: '1786863896299', name: 'HT - NEXAR', uid: '7670886150074106898', talents: { 'Henry 🖤🪽': { id: '6811453679113225218' } } };
    const crown = { _id: '1793099207175', name: 'CROWN WAR II', talents: { 'TTS-Anthonyyyy 🦋': { id: '7341033020629992456', uniqueId: 'ch.danh50' }, Henry: { id: '6811453679113225218' } } };
    const n = T.normalizeProfiles([nexar, crown]);
    assert.equal(String(n.talentProfile['Anthonyyyy 🦋']), '1786863896299');
    assert.equal(String(n.talentProfile.Note), '1786863896299');
    assert.equal(n.aliases['TTS-Anthonyyyy 🦋'], 'Anthonyyyy 🦋');
    assert.equal(n.talentProfile['TTS-Anthonyyyy 🦋'], undefined, 'no row of its own under the event');
    const im = T.buildIndividualMaps([nexar, crown], {}, { mode: 'new' });
    assert.equal(im.uidToTalent['7341033020629992456'], 'Anthonyyyy 🦋');
    assert.equal(im.uidToTalent[A.nameAliasKey('🐦‍🔥🐺Z A NH')], 'Anthonyyyy 🦋', 'the renamed account too');
    const listed = T.withConfirmedMembers([{ ...nexar, talents: { Antony: { id: '7341033020629992456' } } }]);
    assert.deepEqual(Object.keys(listed[0].talents).sort(), ['Antony', 'Note', 'TTS-HT Cryo'], 'a uid the profile already has is not added twice');
});
