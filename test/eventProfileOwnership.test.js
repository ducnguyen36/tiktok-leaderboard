'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const a = require('../leaderboardAggregation');

// Mirrors production on 2026-11-04: CROWN WAR II lists VELIX members under event nicknames.
const profiles = [
    { _id: 'velix', name: 'VELIX', talents: { 'Hana🐰': { id: 'u-hana' }, 'bobo🌻': { id: 'u-bobo' } } },
    { _id: 'crown', name: 'CROWN WAR II', talents: { 'Hana🐰🥕': { id: 'u-hana' }, 'bobo🌻': { id: 'u-bobo' }, velix: {} } },
];
function scores(gifts, sessions) {
    const owned = a.orderForOwnership(profiles, sessions);
    const u = a.buildUidMaps(owned), tp = a.buildTalentToProfileMap(owned), pm = a.buildProfileMap(profiles), pn = a.buildProfileNameToIdMap(profiles);
    const value = (rows, id) => rows.find(row => row._id === id).totalDiamonds;
    const group = a.aggregateGroup(gifts, tp, pm, pn, u.uidToTalent, u.uidToProfile, sessions);
    const individual = a.aggregateIndividual(gifts, a.buildTalentAvatars(profiles), pn, u.uidToTalent, tp, pm, u.uidToProfile);
    return { velix: value(group, 'velix'), crown: value(group, 'crown'), hana: value(individual, 'Hana🐰'), owner: tp['bobo🌻'].profileId };
}

test('an event profile with no lives does not take its members from their home group', () => {
    const gifts = [
        { cost: 100, receivedTalents: [{ name: 'Hana', uid: 'u-hana' }], sessionId: 'v1' },
        { cost: 30, receivedTalent: 'bobo🌻', sessionId: 'v1' },
    ];
    assert.deepEqual(scores(gifts, { v1: 'velix' }), { velix: 130, crown: 0, hana: 100, owner: 'velix' });
});

test('while the event runs its own live, each live keeps its own gifts', () => {
    const gifts = [
        { cost: 100, receivedTalents: [{ name: 'Hana', uid: 'u-hana' }], sessionId: 'v1' },
        { cost: 40, receivedTalents: [{ name: 'Hana', uid: 'u-hana' }, { name: 'bobo🌻', uid: 'u-bobo' }], sessionId: 'c1' },
    ];
    const result = scores(gifts, { v1: 'velix', c1: 'crown' });
    assert.equal(result.velix, 100);
    assert.equal(result.crown, 40);
});

test('a talent moved between two live groups still belongs to the last profile listed', () => {
    const moved = [
        { _id: 'kayzen', name: 'KAYZEN', talents: { 'KZ_Mikey': { id: 'u-mikey' } } },
        { _id: 'levelx', name: 'LEVELX', talents: { 'MIKEY': { id: 'u-mikey' } } },
    ];
    const owned = a.orderForOwnership(moved, { k1: 'kayzen', l1: 'levelx' });
    assert.equal(a.buildUidMaps(owned).uidToProfile['u-mikey'].profileId, 'levelx');
    assert.equal(a.buildUidMaps(owned).uidToTalent['u-mikey'], 'MIKEY');
});
