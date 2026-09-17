'use strict';

function buildTalentAvatars(profiles) {
    // Returns { talentName: { avatarUrl, uniqueId } }
    const map = {};
    for (const profile of profiles) {
        if (profile.talents) {
            for (const [name, info] of Object.entries(profile.talents)) {
                map[name] = {
                    id: info.id || info.uniqueId || name,
                    avatarUrl: info.avatarUrl || '',
                    uniqueId: info.uniqueId || ''
                };
            }
        }
    }
    return map;
}

function buildProfileMap(profiles) {
    // Returns { profileId: { name, avatar, username, talentNames[], updatedAt, locationId } }
    const map = {};
    for (const profile of profiles) {
        const pid = profile._id;
        map[pid] = {
            name: profile.name || pid.toString(),
            avatar: profile.avatar || '',
            username: profile.username || '',
            talentNames: profile.talents ? Object.keys(profile.talents) : [],
            updatedAt: profile.updatedAt ? new Date(profile.updatedAt).getTime() : 0,
            locationId: profile.locationId || ''
        };
    }
    return map;
}

function buildTalentToProfileMap(profiles) {
    const map = {};
    for (const profile of profiles) {
        const profileId = profile._id;
        const profileName = profile.name || profileId.toString();
        if (profile.talents) {
            for (const talentName of Object.keys(profile.talents)) {
                map[talentName] = { profileId, profileName };
            }
        }
    }
    return map;
}

// Maps profile display name -> profileId (for new helioscontrol format
// where group gifts are saved with receivedTalent = profile name)
function buildProfileNameToIdMap(profiles) {
    const map = {};
    for (const profile of profiles) {
        const pid = profile._id;
        const name = profile.name || pid.toString();
        map[name] = pid;
    }
    return map;
}

// Maps talent UID -> { talentName, profileId, profileName }
// Used to resolve gifts by UID instead of nickname
function buildUidMaps(profiles) {
    const uidToTalent = {};   // uid -> talentName
    const uidToProfile = {};  // uid -> profileId
    for (const profile of profiles) {
        const pid = profile._id;
        const pName = profile.name || pid.toString();
        if (profile.talents) {
            for (const [talentName, info] of Object.entries(profile.talents)) {
                if (info.id) {
                    uidToTalent[info.id] = talentName;
                    uidToProfile[info.id] = { profileId: pid, profileName: pName };
                }
            }
        }
    }
    return { uidToTalent, uidToProfile };
}

// ==========================================
// GIFT ENTRY RESOLVER
// Extracts talent names from a gift, handling all formats:
// - New: receivedTalents: [{name, uid}, ...] (objects with UIDs)
// - Old: receivedTalents: ["name", ...] (plain strings)
// - Legacy: receivedTalent: "name" (single string, no array)
// Returns: [{ name, uid }]
// ==========================================
function resolveGiftTalents(gift, uidToTalent) {
    const results = [];

    // Prefer receivedTalents array (new format)
    if (gift.receivedTalents && Array.isArray(gift.receivedTalents) && gift.receivedTalents.length > 0) {
        for (const entry of gift.receivedTalents) {
            if (typeof entry === 'object' && entry.name) {
                // {name, uid} format — resolve name by UID if possible
                const resolvedName = (entry.uid && uidToTalent[entry.uid]) || entry.name;
                results.push({ name: resolvedName, uid: entry.uid || '' });
            } else {
                // Plain string
                results.push({ name: String(entry), uid: '' });
            }
        }
        return results;
    }

    // Fallback: single receivedTalent string
    if (gift.receivedTalent) {
        // Try to resolve by UID if available
        const uid = gift.receivedTalentUid || gift.toMemberUid || '';
        const resolvedName = (uid && uidToTalent[uid]) || gift.receivedTalent;
        results.push({ name: resolvedName, uid });
    }

    return results;
}

// ==========================================
// AGGREGATION — INDIVIDUAL
// Fetches raw gifts and processes in JS to handle multi-talent splitting + UID resolution
// ==========================================
function aggregateIndividual(gifts, talentAvatarMap, profileNameToId, uidToTalent, talentToProfile, profileMap, uidToProfile) {
    const allProfileNames = Object.keys(profileNameToId);
    const allTalentNames = Object.keys(talentAvatarMap);

    // Accumulate diamonds per talent (individual gifts)
    const talentTotals = {};
    // Accumulate group/profile gifts per profileId for later splitting
    const profileGroupTotals = {};

    for (const gift of gifts) {
        const talents = resolveGiftTalents(gift, uidToTalent);
        if (talents.length === 0) continue;

        // Separate individual talents vs group-level entries
        const individualTalents = [];
        const groupEntries = [];

        for (const t of talents) {
            if (t.name === 'Group' || t.name === 'Unassigned' || allProfileNames.includes(t.name)) {
                groupEntries.push(t);
            } else {
                individualTalents.push(t);
            }
        }

        // Process individual talents — each gets cost / total_talents_in_gift
        if (individualTalents.length > 0) {
            const perTalentCost = Math.floor(gift.cost / talents.length) * (gift.count || 1);
            for (const t of individualTalents) {
                talentTotals[t.name] = (talentTotals[t.name] || 0) + perTalentCost;
            }
        }

        // Process group-level entries — accumulate for later splitting among members
        if (groupEntries.length > 0) {
            const perEntryCost = Math.floor(gift.cost / talents.length) * (gift.count || 1);

            for (const t of groupEntries) {
                // Resolve which profile this group gift belongs to
                let pid = null;

                // Try UID first
                const uid = t.uid || gift.toMemberUid || '';
                if (uid && uidToProfile[uid]) {
                    pid = uidToProfile[uid].profileId;
                }

                // Try profile name match
                if (!pid && allProfileNames.includes(t.name)) {
                    pid = profileNameToId[t.name];
                }

                // Try talent → profile mapping (shouldn't normally hit here, but safety)
                if (!pid && talentToProfile[t.name]) {
                    pid = talentToProfile[t.name].profileId;
                }

                if (pid) {
                    profileGroupTotals[pid] = (profileGroupTotals[pid] || 0) + perEntryCost;
                }
            }
        }
    }

    // Split accumulated group gifts evenly among each profile's talent members
    for (const [pid, groupTotal] of Object.entries(profileGroupTotals)) {
        const pInfo = profileMap[pid];
        if (!pInfo || !pInfo.talentNames || pInfo.talentNames.length === 0) continue;

        const perMember = Math.floor(groupTotal / pInfo.talentNames.length);
        for (const talentName of pInfo.talentNames) {
            talentTotals[talentName] = (talentTotals[talentName] || 0) + perMember;
        }
    }

    // Merge with all known talents (ensure 0-diamond entries appear)
    // Only include talents registered in profiles — old/renamed nicknames are excluded
    const results = allTalentNames.map(name => ({
        _id: name,
        totalDiamonds: talentTotals[name] || 0
    }));

    results.sort((a, b) => b.totalDiamonds - a.totalDiamonds || a._id.localeCompare(b._id));
    return results;
}

// ==========================================
// AGGREGATION — GROUP
// Accumulates total income per profile using the sessions collection to
// map gifts to their owning profile. Includes ALL gifts (manual + auto).
// Each gift's FULL cost goes to the owning profile — no splitting when
// all talents belong to the same profile. Unmatched/unknown talents and
// Group/Unassigned labels fall back to session-based profile lookup.
// ==========================================
function aggregateGroup(gifts, talentToProfile, profileMap, profileNameToId, uidToTalent, uidToProfile, sessionProfileMap) {
    // Start with ALL profiles at 0
    const profileTotals = {};
    for (const [pid, pInfo] of Object.entries(profileMap)) {
        profileTotals[pid] = { name: pInfo.name, totalDiamonds: 0 };
    }

    // Helper: resolve a single talent entry to a profileId
    function resolveToProfile(t) {
        // 1. Check by UID
        if (t.uid && uidToProfile[t.uid]) {
            return uidToProfile[t.uid].profileId;
        }
        // 2. Check by talent name -> profile
        const talentMapping = talentToProfile[t.name];
        if (talentMapping) {
            return talentMapping.profileId;
        }
        // 3. Check if it's a profile name directly
        const profileId = profileNameToId[t.name];
        if (profileId) {
            return profileId;
        }
        return null;
    }

    // Helper: get the owning profile from the sessions collection
    function getSessionProfile(gift) {
        const sid = gift.sessionId ? gift.sessionId.toString() : '';
        return sessionProfileMap[sid] || null;
    }

    for (const gift of gifts) {
        const talents = resolveGiftTalents(gift, uidToTalent);
        const cost = gift.cost || 0;
        const count = gift.count || 1;

        // If no talent info at all, fall back to session
        if (talents.length === 0) {
            const sessionPid = getSessionProfile(gift);
            if (sessionPid && profileTotals[sessionPid]) {
                profileTotals[sessionPid].totalDiamonds += cost * count;
            }
            continue;
        }

        // Resolve all talent entries to profiles
        const resolvedPids = new Set();

        for (const t of talents) {
            // "Group" and "Unassigned" labels — try UID first
            if (t.name === 'Group' || t.name === 'Unassigned') {
                const uid = t.uid || gift.toMemberUid || '';
                if (uid && uidToProfile[uid]) {
                    resolvedPids.add(uidToProfile[uid].profileId);
                }
                continue;
            }

            const pid = resolveToProfile(t);
            if (pid) {
                resolvedPids.add(pid);
            }
        }

        // If resolved to exactly one profile → credit FULL cost (no splitting)
        if (resolvedPids.size === 1) {
            const pid = [...resolvedPids][0];
            if (profileTotals[pid]) {
                profileTotals[pid].totalDiamonds += cost * count;
            }
            continue;
        }

        // If resolved to multiple profiles → split evenly among distinct profiles
        if (resolvedPids.size > 1) {
            const share = Math.floor(cost / resolvedPids.size) * count;
            for (const pid of resolvedPids) {
                if (profileTotals[pid]) {
                    profileTotals[pid].totalDiamonds += share;
                }
            }
            continue;
        }

        // Nothing resolved via talent/UID → use sessions collection
        const sessionPid = getSessionProfile(gift);
        if (sessionPid) {
            if (!profileTotals[sessionPid]) {
                const pInfo = profileMap[sessionPid];
                profileTotals[sessionPid] = { name: pInfo ? pInfo.name : sessionPid, totalDiamonds: 0 };
            }
            profileTotals[sessionPid].totalDiamonds += cost * count;
        }
    }

    return Object.entries(profileTotals)
        .map(([id, data]) => ({ _id: id, name: data.name, totalDiamonds: data.totalDiamonds }))
        .sort((a, b) => b.totalDiamonds - a.totalDiamonds || a.name.localeCompare(b.name));
}


module.exports = { buildTalentAvatars, buildProfileMap, buildTalentToProfileMap, buildProfileNameToIdMap, buildUidMaps, resolveGiftTalents, aggregateIndividual, aggregateGroup };
