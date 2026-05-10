/**
 * Test tikwm.com API for avatar fetching
 * Tests a mix of usernames that failed + succeeded in production logs
 */

const testUsernames = [
    // ✅ These worked in production
    'channe0306',
    'linhnhi2903',
    // ❌ These all failed — "No avatar found"
    'venyxis.ht',
    'velvetgrace.ht',
    'kayzen.ht',
    'novix.ht',
    'dopamine.ht',
    'velix.ht',
    'tqi.04',
    'zii.zuu20.03',
    'soyaaaa.ah',
    'wina.here',
    'jyan.52hz',
    'laylaizme',
    'shin.nosukee',
    '__bintran99',
    'minluong89',
    'kz_mikeyyy',
    'silvercrystal888',
    'katie.0712',
];

async function testTikwm(username) {
    try {
        const url = `https://www.tikwm.com/api/user/info?unique_id=${username}`;
        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });

        if (!res.ok) {
            return { username, status: 'HTTP_ERROR', httpStatus: res.status };
        }

        const data = await res.json();

        if (data.code === -1 || data.code !== 0) {
            return { username, status: 'API_ERROR', code: data.code, msg: data.msg };
        }

        if (!data.data || !data.data.user) {
            return { username, status: 'NO_USER_DATA', rawKeys: Object.keys(data.data || {}) };
        }

        const u = data.data.user;
        const avatar = u.avatarLarger || u.avatarMedium || u.avatarThumb || '';
        return {
            username,
            status: avatar ? '✅ FOUND' : '❌ NO_AVATAR',
            uniqueId: u.uniqueId,
            nickname: u.nickname,
            avatarUrl: avatar ? avatar.substring(0, 80) + '...' : '',
        };
    } catch (err) {
        return { username, status: 'FETCH_ERROR', error: err.message };
    }
}

async function main() {
    console.log('=== Testing tikwm.com API ===\n');
    console.log(`Testing ${testUsernames.length} usernames...\n`);

    const results = [];
    for (const username of testUsernames) {
        const result = await testTikwm(username);
        results.push(result);

        const icon = result.status.includes('FOUND') ? '✅' : '❌';
        console.log(`${icon} ${username.padEnd(22)} → ${result.status}${result.nickname ? ` (${result.nickname})` : ''}${result.msg ? ` [${result.msg}]` : ''}${result.error ? ` [${result.error}]` : ''}`);

        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 300));
    }

    // Summary
    const found = results.filter(r => r.status.includes('FOUND')).length;
    const failed = results.length - found;
    console.log(`\n=== Summary ===`);
    console.log(`✅ Found: ${found}/${results.length}`);
    console.log(`❌ Failed: ${failed}/${results.length}`);

    // Show full response for first failed one (for debugging)
    const firstFail = results.find(r => !r.status.includes('FOUND'));
    if (firstFail) {
        console.log(`\n=== Debug: Full response for first failure (${firstFail.username}) ===`);
        console.log(JSON.stringify(firstFail, null, 2));

        // Re-fetch to show raw response
        console.log(`\n=== Raw API response for ${firstFail.username} ===`);
        const res = await fetch(`https://www.tikwm.com/api/user/info?unique_id=${firstFail.username}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        const raw = await res.json();
        console.log(JSON.stringify(raw, null, 2).substring(0, 2000));
    }
}

main().catch(console.error);
