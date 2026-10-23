const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../leaderboardAggregation');

const profiles = [
    { _id: 'aura', name: 'HT - AURA', talents: { Wina: { id: '1', uniqueId: 'wina' }, Dori: { id: '3', uniqueId: 'dori' } } },
    { _id: 'venyxis', name: 'HT - VENYXIS', talents: { SooAe: { id: '2', uniqueId: 'sooae' } } },
    { _id: 'levelx', name: 'HT - LEVELX', talents: { 'Lapin 🐰': { id: null, uniqueId: 'hoithanh115' } } },
    { _id: 'vvg', name: 'HT - VELVET GRACE', talents: { 'Eliana_🐰': { id: '7030251781209146395', uniqueId: 'eliana1011204' } } },
];

function maps() {
    const { uidToTalent, uidToProfile } = A.buildUidMaps(profiles);
    return {
        avatars: A.buildTalentAvatars(profiles), profileMap: A.buildProfileMap(profiles),
        talentToProfile: A.buildTalentToProfileMap(profiles), names: A.buildProfileNameToIdMap(profiles),
        uidToTalent, uidToProfile,
    };
}
const totals = rows => Object.fromEntries(rows.map(r => [r.name || r._id, r.totalDiamonds]));

test("a talent alone in another group's live counts for that live's group", () => {
    const m = maps();
    // SooAe now belongs to VENYXIS but streamed in an AURA live.
    const gifts = [
        { sessionId: 's-aura', receivedTalents: [{ name: 'SooAe', uid: '2' }], cost: 100, count: 2 },
        { sessionId: 's-aura', receivedTalents: [{ name: 'Wina', uid: '1' }], cost: 500 },
        { sessionId: 's-aura', receivedTalents: [{ name: 'Dori', uid: '3' }], cost: 300 },
        { sessionId: 's-ven', receivedTalents: [{ name: 'SooAe', uid: '2' }], cost: 40 },
    ];
    const group = totals(A.aggregateGroup(gifts, m.talentToProfile, m.profileMap, m.names, m.uidToTalent, m.uidToProfile, { 's-aura': 'aura', 's-ven': 'venyxis' }));
    assert.equal(group['HT - AURA'], 1000);
    assert.equal(group['HT - VENYXIS'], 40);
    const individual = totals(A.aggregateIndividual(gifts, m.avatars, m.names, m.uidToTalent, m.talentToProfile, m.profileMap, m.uidToProfile));
    assert.equal(individual.SooAe, 240, 'the talent keeps their own points');
});

test("a multi-group live (battle) or another group's profile does not move points", () => {
    const m = maps();
    const gifts = [
        { sessionId: 'battle', receivedTalent: 'Wina', receivedTalentUid: '1', cost: 900 },
        { sessionId: 'battle', receivedTalent: 'Dori', receivedTalentUid: '3', cost: 900 },
        { sessionId: 'battle', receivedTalent: 'Lapin 🐰', cost: 50 },
        { sessionId: 'borrowed', receivedTalent: 'Lapin 🐰', cost: 70 },
    ];
    const group = totals(A.aggregateGroup(gifts, m.talentToProfile, m.profileMap, m.names, m.uidToTalent, m.uidToProfile, { battle: 'vvg', borrowed: 'aura' }));
    assert.equal(group['HT - AURA'], 1850, "a lone guest in AURA's live counts for AURA");
    assert.equal(group['HT - LEVELX'], 70, "LevelX streaming from AURA's profile keeps its live");
});

test("competition points always go to each member's own group", () => {
    const m = maps();
    const gifts = [
        { sessionId: 'battle', competitionId: 'c1', receivedTalent: 'Wina', receivedTalentUid: '1', cost: 900 },
        { sessionId: 'battle', competitionId: 'c1', receivedTalent: 'Dori', receivedTalentUid: '3', cost: 900 },
        { sessionId: 'battle', competitionId: 'c1', receivedTalent: 'Lapin 🐰', cost: 50 },
        { sessionId: 'battle', competitionId: 'c1', receivedTalent: 'SooAe', receivedTalentUid: '2', cost: 30 },
    ];
    const group = totals(A.aggregateGroup(gifts, m.talentToProfile, m.profileMap, m.names, m.uidToTalent, m.uidToProfile, { battle: 'aura' }));
    assert.deepEqual([group['HT - AURA'], group['HT - LEVELX'], group['HT - VENYXIS']], [1800, 50, 30]);
});

test('a live with two groups of several talents does not move lone talents', () => {
    const m = maps();
    const profiles2 = [
        { _id: 'aura', name: 'HT - AURA', talents: { Wina: { id: '1' }, Dori: { id: '3' } } },
        { _id: 'venyxis', name: 'HT - VENYXIS', talents: { SooAe: { id: '2' }, Soya: { id: '4' } } },
        { _id: 'levelx', name: 'HT - LEVELX', talents: { Lapin: { id: '5' } } },
    ];
    const { uidToTalent, uidToProfile } = A.buildUidMaps(profiles2);
    const gifts = ['1', '3', '2', '4', '5'].map(uid => ({ sessionId: 'joint', receivedTalents: [{ name: 'x', uid }], cost: 10 }));
    const group = totals(A.aggregateGroup(gifts, A.buildTalentToProfileMap(profiles2), A.buildProfileMap(profiles2), A.buildProfileNameToIdMap(profiles2), uidToTalent, uidToProfile, {}));
    assert.deepEqual([group['HT - AURA'], group['HT - VENYXIS'], group['HT - LEVELX']], [20, 20, 10]);
});

test('sessions without a known owner keep talent-based attribution', () => {
    const m = maps();
    const gifts = [
        { sessionId: 'orphan', receivedTalent: 'SooAe', receivedTalentUid: '2', cost: 50 },
        { sessionId: 's-gone', receivedTalent: 'Wina', receivedTalentUid: '1', cost: 30 },
    ];
    const group = totals(A.aggregateGroup(gifts, m.talentToProfile, m.profileMap, m.names, m.uidToTalent, m.uidToProfile, { 's-gone': 'deleted-profile' }));
    assert.equal(group['HT - VENYXIS'], 50);
    assert.equal(group['HT - AURA'], 30);
});

test('gifts recorded under the TikTok @uniqueId reach the talent when the profile has no UID', () => {
    const m = maps();
    const gifts = [
        { receivedTalents: [{ name: 'hoithanh115', uid: '7588012144228533249' }], cost: 32367 },
        { receivedTalent: 'HoiThanh115', cost: 3 },
    ];
    const individual = totals(A.aggregateIndividual(gifts, m.avatars, m.names, m.uidToTalent, m.talentToProfile, m.profileMap, m.uidToProfile));
    assert.equal(individual['Lapin 🐰'], 32370);
});

test('a confirmed extra account UID resolves to the talent and their group', () => {
    const m = maps();
    const gifts = [{ receivedTalents: [{ name: 'AMI', uid: '7292870510973862920' }], cost: 26624 }];
    const individual = totals(A.aggregateIndividual(gifts, m.avatars, m.names, m.uidToTalent, m.talentToProfile, m.profileMap, m.uidToProfile));
    assert.equal(individual['Eliana_🐰'], 26624);
    const group = totals(A.aggregateGroup(gifts, m.talentToProfile, m.profileMap, m.names, m.uidToTalent, m.uidToProfile, {}));
    assert.equal(group['HT - VELVET GRACE'], 26624);
});

test('an @uniqueId shared by two talents is not guessed', () => {
    const shared = [
        { _id: 'a', name: 'A', talents: { One: { uniqueId: 'same' } } },
        { _id: 'b', name: 'B', talents: { Two: { uniqueId: 'same' } } },
    ];
    const { uidToTalent } = A.buildUidMaps(shared);
    assert.deepEqual(A.resolveGiftTalents({ receivedTalent: 'same', cost: 1 }, uidToTalent), [{ name: 'same', uid: '' }]);
});
test('a group gift is shared among the members live in that session, not the whole roster', () => {
    const team = [{ _id: 'v', name: 'HT - VELIX', talents: { Hana: { id: 'h' }, Hani: { id: 'i' }, Kem: { id: 'k' }, Luna: { id: 'l' } } }];
    const { uidToTalent, uidToProfile } = A.buildUidMaps(team);
    const gifts = [
        { sessionId: 's1', receivedTalent: 'Hana', receivedTalentUid: 'h', cost: 10 },
        { sessionId: 's1', receivedTalent: 'Hani', receivedTalentUid: 'i', cost: 10 },
        { sessionId: 's1', receivedTalent: 'HT - VELIX', cost: 100 },
        { sessionId: 's2', receivedTalent: 'HT - VELIX', cost: 40 },
    ];
    const rows = Object.fromEntries(A.aggregateIndividual(gifts, A.buildTalentAvatars(team), A.buildProfileNameToIdMap(team), uidToTalent, A.buildTalentToProfileMap(team), A.buildProfileMap(team), uidToProfile).map(e => [e._id, e.totalDiamonds]));
    assert.deepEqual(rows, { Hana: 70, Hani: 70, Kem: 10, Luna: 10 }, 's1 splits between the two live members; s2 had no member gifts, so the whole roster');
});

test('confirmed alternate accounts and display names resolve to the talent', () => {
    const team = [
        { _id: 'i', name: 'HT - ICONZ', talents: { TOMMY: { id: '7659364795258536981' } } },
        { _id: 'g', name: 'HT - VELVET GRACE', talents: { 'Yunii🦄': { id: '7692300337487774740' } } },
    ];
    const { uidToTalent } = A.buildUidMaps(team);
    assert.equal(A.resolveGiftTalents({ receivedTalents: [{ name: 'TOMMY 🍦', uid: '7668576062439392272' }], cost: 1 }, uidToTalent)[0].name, 'TOMMY');
    // The same host UID on a group gift stays a group gift, not Tommy's.
    assert.equal(A.resolveGiftTalents({ receivedTalents: [{ name: 'HT - ICONZ', uid: '7668576062439392272' }], cost: 1 }, uidToTalent)[0].name, 'HT - ICONZ');
    assert.equal(A.resolveGiftTalents({ receivedTalents: [{ name: 'Yunii🐝🦄✨', uid: '7611078269802267668' }], cost: 1 }, uidToTalent)[0].name, 'Yunii🦄');
});
