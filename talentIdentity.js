'use strict';
// One person = one row on the idol rankings (switch RANKING_IDENTITY, default 'old').
//
// HeliosControl profiles are not only groups: an event profile (e.g. CROWN WAR II,
// made when a competition is set up) copies members of real groups under event
// nicknames, and a disbanded group can still list members who moved on. With
// 'old', every name in every profile is a row and the last profile read decides a
// talent's group label. With 'new':
//   * talents sharing a TikTok uid (or @uniqueId when the uid is missing), or
//     named in CONFIRMED_SAME_PERSON, are one person, shown under the entry of a
//     real group (not an event profile, not disbanded, then most recently updated);
//   * event profiles create no person and change no label: their names, uids and
//     @uniqueIds lead to the real person;
//   * group accounts (TEAM A, nexar, a talent with its group's own host uid) are no
//     person: their row is hidden, their diamonds stay with the group;
//   * a talent of a disbanded group, or listed in inactiveTalents, is hidden while
//     it has 0 diamonds in the period.
// Group totals are not built here: they keep the old maps unchanged.
const A = require('./leaderboardAggregation');

const MODES = ['old', 'new'];
function identityMode(value = process.env.RANKING_IDENTITY) {
    return String(value || '').trim().toLowerCase() === 'new' ? 'new' : 'old';
}

// Profiles that are events, not groups. Also detected from the data: a profile a
// competition was converted from (competitions.convertedFrom.profileId, marked
// `convertedToCompetition` by the reader), or one with no TikTok host uid whose
// members all belong to another profile too (a new group still being set up,
// with members of its own, stays a group).
const EVENT_PROFILE_IDS = Object.freeze(['1793099207175']); // CROWN WAR II (27/10)
// Disbanded groups (Backstage, 19/11). A profile whose `status` says so counts too.
const DISBANDED_PROFILE_IDS = Object.freeze(['1775469403434', '1784445344024']); // KAYZEN, VELORA
const DISBANDED_STATUSES = new Set(['disbanded', 'inactive', 'closed', 'dissolved', 'ended']);
// Group accounts kept in a group's talent list (their own uid, not the host's).
const GROUP_ACCOUNT_UIDS = Object.freeze({
    '7521819032229446663': 'TEAM A (VENYXIS)',
    '7524754348673336327': 'TEAM B (VENYXIS)',
});
// Other accounts / names of one person, confirmed 2026-11-19. Name -> the person's uid.
// These win over the gift's uid, like CONFIRMED_TALENT_NAME_ALIASES.
const CONFIRMED_SAME_PERSON = Object.freeze({
    'Andee-J ☘️': '6775064023412671489',             // @andeej.htnexar -> Andee-J (NEXAR)
    'mimiibakhitrentunghatbi': '7014456012867290138', // old TikTok of mimi🐿️ (VELIX)
    'TTS-Anthonyyyy 🦋': '7341033020629992456',       // renamed -> 🐦‍🔥🐺Z A NH (NEXAR)
    'Anthonyyyy 🦋': '7341033020629992456',
});
// Other @uniqueIds of one person -> the person's uid.
const CONFIRMED_SAME_PERSON_UNIQUE_IDS = Object.freeze({
    'andeej.htnexar': '6775064023412671489',
    'mimiibakhitrentunghatbi': '7014456012867290138',
});

const str = value => (value === undefined || value === null ? '' : String(value).trim());
const updatedAtOf = p => (p.updatedAt ? new Date(p.updatedAt).getTime() || 0 : 0);

function classifyProfile(profile, { eventProfileIds = EVENT_PROFILE_IDS, disbandedProfileIds = DISBANDED_PROFILE_IDS } = {}) {
    const id = String(profile._id);
    const event = eventProfileIds.map(String).includes(id) || profile.convertedToCompetition === true;
    const disbanded = disbandedProfileIds.map(String).includes(id) || DISBANDED_STATUSES.has(str(profile.status).toLowerCase());
    return { event, noHost: !str(profile.uid), disbanded };
}

// Returns { profiles, talentProfile, groupAccounts, hiddenWhenZero, aliases }:
//   profiles: copies where each person is listed once (event profiles keep their
//     roster mapped to the real names, for splitting a gift to the event itself);
//   talentProfile: shown name -> profile id of the person's group (label);
//   aliases: other names of a person -> shown name (used only when the gift's uid
//     and @uniqueId do not decide).
function normalizeProfiles(profiles, options = {}) {
    const info = new Map(profiles.map(p => [String(p._id), classifyProfile(p, options)]));
    const entries = [];
    profiles.forEach((profile, order) => {
        for (const [name, talent] of Object.entries(profile.talents || {})) {
            entries.push({ profile, order, name, talent: talent || {}, uid: str(talent && talent.id), uniqueId: str(talent && talent.uniqueId).toLowerCase(), ...info.get(String(profile._id)) });
        }
    });

    // Person key: confirmed name, uid, confirmed or shared @uniqueId, else the name in its profile.
    const uidOfUniqueId = new Map(Object.entries(CONFIRMED_SAME_PERSON_UNIQUE_IDS));
    for (const e of entries) if (e.uid && e.uniqueId && !uidOfUniqueId.has(e.uniqueId)) uidOfUniqueId.set(e.uniqueId, e.uid);
    for (const e of entries) {
        const uid = CONFIRMED_SAME_PERSON[e.name] || e.uid || uidOfUniqueId.get(e.uniqueId) || '';
        e.key = uid ? 'u:' + uid : e.uniqueId ? '@' + e.uniqueId : 'n:' + String(e.profile._id) + ':' + e.name;
    }
    const profilesOfKey = new Map();
    for (const e of entries) (profilesOfKey.get(e.key) || profilesOfKey.set(e.key, new Set()).get(e.key)).add(String(e.profile._id));
    for (const [pid, c] of info) {
        if (c.event || !c.noHost) continue;
        const own = entries.filter(e => String(e.profile._id) === pid && (e.uid || e.uniqueId));
        if (own.length && own.every(e => profilesOfKey.get(e.key).size > 1)) c.event = true;
    }
    for (const e of entries) {
        e.event = info.get(String(e.profile._id)).event;
        e.groupAccount = Boolean((e.uid && (e.uid === str(e.profile.uid) || GROUP_ACCOUNT_UIDS[e.uid])) || (e.event && !e.uid && !e.uniqueId));
    }

    const people = new Map();
    for (const e of entries) (people.get(e.key) || people.set(e.key, []).get(e.key)).push(e);
    const rank = e => [e.event ? 1 : 0, e.disbanded ? 1 : 0, -updatedAtOf(e.profile), -e.order];
    const better = (a, b) => { const x = rank(a), y = rank(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i]; return false; };

    const keep = new Map(); // profile id -> { name: talent }
    const eventRoster = new Map();
    const talentProfile = {}, aliases = {}, eventAliases = {}, groupAccounts = new Set(), hiddenWhenZero = new Set();
    for (const list of people.values()) {
        let head = list[0];
        for (const e of list) if (better(e, head)) head = e;
        for (const e of list) if (e.event && !head.event) (eventRoster.get(String(e.profile._id)) || eventRoster.set(String(e.profile._id), []).get(String(e.profile._id))).push(head.name);
        // A person known only from an event profile, or an event's group account, is nobody.
        if (head.event) continue;
        const pid = String(head.profile._id);
        (keep.get(pid) || keep.set(pid, {}).get(pid))[head.name] = head.talent;
        talentProfile[head.name] = head.profile._id;
        if (head.groupAccount) groupAccounts.add(head.name);
        const inactive = Array.isArray(head.profile.inactiveTalents) && head.profile.inactiveTalents.map(String).includes(head.name);
        if (head.disbanded || inactive) hiddenWhenZero.add(head.name);
        for (const e of list) if (e.name !== head.name) aliases[e.name] = head.name;
        for (const e of list) if (e.event && e.name !== head.name) eventAliases[e.name] = head.name;
    }

    const normalized = profiles.map(p => {
        const pid = String(p._id);
        if (info.get(pid).event) {
            const roster = [...new Set(eventRoster.get(pid) || [])].filter(name => !groupAccounts.has(name));
            return { ...p, talents: {}, eventRoster: roster };
        }
        return { ...p, talents: keep.get(pid) || {} };
    });
    return { profiles: normalized, talentProfile, groupAccounts, hiddenWhenZero, aliases, eventAliases, info };
}

// Maps for the idol rankings. mode 'old' returns exactly the maps used before.
// sessionProfileMap: session id -> profile id (lives own their members).
function buildIndividualMaps(profiles, sessionProfileMap = {}, { mode = 'old', ...options } = {}) {
    if (mode !== 'new') {
        const owned = A.orderForOwnership(profiles, sessionProfileMap);
        const { uidToTalent, uidToProfile } = A.buildUidMaps(owned);
        return {
            mode: 'old', talentAvatarMap: A.buildTalentAvatars(profiles), profileMap: A.buildProfileMap(profiles),
            talentToProfile: A.buildTalentToProfileMap(owned), profileNameToId: A.buildProfileNameToIdMap(profiles),
            uidToTalent, uidToProfile, groupOf: null, visible: rows => rows, groupTalentToProfile: tp => tp,
        };
    }
    const n = normalizeProfiles(profiles, options);
    const owned = A.orderForOwnership(n.profiles, sessionProfileMap);
    const { uidToTalent, uidToProfile } = A.buildUidMaps(owned);
    const byId = Object.fromEntries(profiles.map(p => [String(p._id), p]));
    // Other uids / @uniqueIds of a person (only the kept entry is in the maps).
    for (const p of profiles) {
        for (const [name, t] of Object.entries(p.talents || {})) {
            const shown = n.talentProfile[name] !== undefined ? name : n.aliases[name];
            if (!shown || n.talentProfile[shown] === undefined) continue;
            const uid = str(t && t.id), uniqueId = str(t && t.uniqueId);
            const pid = n.talentProfile[shown];
            if (uid && !uidToTalent[uid]) { uidToTalent[uid] = shown; uidToProfile[uid] = { profileId: pid, profileName: (byId[String(pid)] || {}).name || String(pid), profileIds: [pid] }; }
            if (uniqueId && !uidToTalent[A.uniqueIdKey(uniqueId)]) uidToTalent[A.uniqueIdKey(uniqueId)] = shown;
        }
    }
    for (const [name, uid] of Object.entries(CONFIRMED_SAME_PERSON)) if (uidToTalent[uid]) uidToTalent[A.nameAliasKey(name)] = uidToTalent[uid];
    for (const [uniqueId, uid] of Object.entries(CONFIRMED_SAME_PERSON_UNIQUE_IDS)) if (uidToTalent[uid]) uidToTalent[A.uniqueIdKey(uniqueId)] = uidToTalent[uid];
    // A name that is also someone's shown name stays that person's.
    for (const [name, shown] of Object.entries(n.aliases)) if (n.talentProfile[name] === undefined) uidToTalent[A.weakAliasKey(name)] = shown;

    const profileMap = A.buildProfileMap(n.profiles);
    // A gift to the event itself is shared by the real people of its roster.
    for (const p of n.profiles) if (p.eventRoster) profileMap[p._id].talentNames = p.eventRoster;
    const talentToProfile = {};
    for (const [name, pid] of Object.entries(n.talentProfile)) {
        const p = byId[String(pid)];
        talentToProfile[name] = { profileId: pid, profileName: p.name || String(pid), profileIds: [pid] };
    }
    return {
        mode: 'new',
        talentAvatarMap: A.buildTalentAvatars(n.profiles), profileMap, talentToProfile,
        profileNameToId: A.buildProfileNameToIdMap(profiles), uidToTalent, uidToProfile,
        groupOf: name => {
            const pid = n.talentProfile[name];
            if (pid === undefined) return null;
            return { groupId: String(pid), locationId: (byId[String(pid)] && byId[String(pid)].locationId) || '' };
        },
        // rows: [{ _id | name, totalDiamonds | value }]
        visible: rows => rows.filter(row => {
            const name = row._id !== undefined ? row._id : row.name;
            const value = row.totalDiamonds !== undefined ? row.totalDiamonds : row.value;
            if (n.groupAccounts.has(name)) return false;
            return !(n.hiddenWhenZero.has(name) && !value);
        }),
        // Group totals keep the old maps, except that an event nickname (e.g. "Henry" in
        // CROWN WAR II) counts for the person's own group, like the person's other names;
        // the event's own lives still keep their gifts (the event stays in profileIds).
        groupTalentToProfile: tp => {
            const out = { ...tp };
            for (const [name, shown] of Object.entries(n.eventAliases)) {
                const pid = n.talentProfile[shown], before = tp[name];
                if (pid === undefined || !before || n.talentProfile[name] !== undefined) continue;
                out[name] = { profileId: pid, profileName: (byId[String(pid)] || {}).name || String(pid), profileIds: [...new Set([...(before.profileIds || []), pid])] };
            }
            return out;
        },
        normalized: n,
    };
}

// Marks profiles a competition was converted from (HeliosControl writes
// competitions.convertedFrom.profileId). Best effort: on error the uid rule and
// EVENT_PROFILE_IDS still apply.
async function markEventProfiles(db, profiles) {
    try {
        const ids = new Set((await db.collection('competitions').distinct('convertedFrom.profileId')).map(String));
        for (const p of profiles) if (ids.has(String(p._id))) p.convertedToCompetition = true;
    } catch (error) { /* keep the other rules */ }
    return profiles;
}

module.exports = {
    MODES, identityMode, EVENT_PROFILE_IDS, DISBANDED_PROFILE_IDS, GROUP_ACCOUNT_UIDS, CONFIRMED_SAME_PERSON,
    CONFIRMED_SAME_PERSON_UNIQUE_IDS, classifyProfile, normalizeProfiles, buildIndividualMaps, markEventProfiles,
};
