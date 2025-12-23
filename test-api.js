// Run: node test-api.js
// This script iterates through all 6 creators, calculates daily income since 6 AM VN,
// and returns a final JSON response similar to what the frontend expects.

const https = require('https');

// --- 1. CONFIGURATION (Sync with server.js) ---
const ALLOWED_CREATOR_IDS = {
    'novix.ht': '7444395575895719953',
    'dopamine.ht': '7539826902857515009',
    'lunarknight.ht': '7514557708314542081',
    'huntera.ht': '7529074048186220545',
    'moonsiren.ht': '7514527995919646737',
    'kayzen.ht': '7484173710891679761'
};

// Use the Room List API for each creator to get total daily scores accurately
const CREATOR_URLS = {
    'novix.ht': ["https://live-backstage.tiktok.com/creators/live/union_platform_api/union/anchor/v2/get_room_list/?DisplayID=novix.ht&Offset=0&Limit=20&HostID=7441833017436308501"],
    'huntera.ht': ["https://live-backstage.tiktok.com/creators/live/union_platform_api/union/anchor/v2/get_room_list/?DisplayID=huntera.ht&Offset=0&Limit=20&HostID=7528287601460823048"],
    'moonsiren.ht': ["https://live-backstage.tiktok.com/creators/live/union_platform_api/union/anchor/v2/get_room_list/?DisplayID=moonsiren.ht&Offset=0&Limit=20&HostID=7504516581285004309"],
    'lunarknight.ht': ["https://live-backstage.tiktok.com/creators/live/union_platform_api/union/anchor/v2/get_room_list/?DisplayID=lunarknight.ht&Offset=0&Limit=20&HostID=7514528621319783441"],
    'kayzen.ht': ["https://live-backstage.tiktok.com/creators/live/union_platform_api/union/anchor/v2/get_room_list/?DisplayID=kayzen.ht&Offset=0&Limit=20&HostID=7483391252383581205"],
    'dopamine.ht': ["https://live-backstage.tiktok.com/creators/live/union_platform_api/union/anchor/v2/get_room_list/?DisplayID=dopamine.ht&Offset=0&Limit=20&HostID=7539782769997530132"]
};

// Headers used for Daily/Monthly (Update msToken if you see 0 results)
const HEADERS = {
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'vi,en-US;q=0.9,en;q=0.8,ko;q=0.7',
    'content-type': 'application/json',
    'faction-id': '100579',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    'Cookie': '_fbp=fb.1.1737330652527.1598096788; tt_chain_token=oSDY4fPhccrhwY02U78MNQ==; _tt_enable_cookie=1; d_ticket_backstage=9eeea309e3d084424d282c62453a49c1ad737; living_device_id=53974713026; _ga_LWWPCY99PB=GS1.1.1745711106.4.0.1745711106.0.0.468963034; _gtmeec=e30%3D; ttcsid=1757152821896::dGYUuRGwSFZ6Au3HBaIz.3.1757153161666; ttcsid_CQ6FR3RC77U6L0AM21H0=1757152821895::LcyqtFwwYCe4AzSTg31j.3.1757153161880; _ga_GZB380RXJX=GS2.1.s1757152821$o4$g1$t1757154275$j60$l0$h1146909479; _ga=GA1.1.GA1.1.1579992134.1737330652; _ga_GR6VLNH8D4=GS1.1.1758019820.2.1.1758019890.0.0.842071688; sid_tt=4b43ea6880409bf9cd3fbe5ad4d6ba76; sessionid=4b43ea6880409bf9cd3fbe5ad4d6ba76; sessionid_ss=4b43ea6880409bf9cd3fbe5ad4d6ba76; store-idc=alisg; store-country-code=vn; store-country-code-src=uid; tt-target-idc=alisg; tt-target-idc-sign=Qr17CbD3A0XKZlqcSw5EgUqgT855EXtInEluEaT1vg1hI_tho7___JZRIV8GzcrR0uEh9KtwrR0jR-vzpe9DpeItPpEJVlkacZNy7ddfZPGWHV2bCFBm0N525FBraKlVdwd49g0fRmiW1wET0SLo8Km2g4DQU59ipSXhq39st4hJ5sEIwzvPC8qkJnWG95lXYD40prs2TtT5Krqzks_2nKtD7ej4xRtbvp3l5OR0_x5HxgBvBKp4JwOx36hkIWBKPcTpNvh2HNlshIMusWIBiyqkheVxCOGoWLAeEtc2s7DtBlfDPIFGXcwQKtU2rfR2vhQKQhke84xXA0BRPiytNsOs-b_khgbnPwBE7lVbzLEzg8GcWaUP3BlWT_vWOpTrx_wqJu8dUNTPbw78wya5WThrtHNPO3uYdFlfcOjCMs4zFA1ZD62_JPSCRxGSOW3eA_Zws8c1J-SqbffRHQWCJedZzmMbOXu9f6NEtRGAZwbvMqgZuHojpF1bEQj9z4Iv; passport_csrf_token=0dd3dacd1b32bf5356aa1f197d4072e1; passport_csrf_token_default=0dd3dacd1b32bf5356aa1f197d4072e1; _ttp=33NmYLgRM2umpIAazOGsbA7U0QU; cmpl_token=AgQQAPOFF-RO0rh2GVAgd10o_bWCdCULP5YOYKOOBA; sid_guard=4b43ea6880409bf9cd3fbe5ad4d6ba76%7C1761960037%7C15552000%7CThu%2C+30-Apr-2026+01%3A20%3A37+GMT; uid_tt=b51f890c31c265c37e87d35cc45766d82df6372043872265cdcc1743f26114fe; uid_tt_ss=b51f890c31c265c37e87d35cc45766d82df6372043872265cdcc1743f26114fe; tt_session_tlb_tag=sttt%7C2%7CS0PqaIBAm_nNP75a1Na6dv_________Mc9ZWpf2hVoy8I271USf8VTx995lJo7fsQWTO-kz1Too%3D; sid_ucp_v1=1.0.0-KDdhNjg2M2FmOTk4OTlhZDc5YTA1NzkzZTk0Yjk1ODllMzNhZWZkYTQKIgiRiJbC-v69pGgQ5cCVyAYYswsgDDDT8KPCBjgGQO8HSAQQAxoGbWFsaXZhIiA0YjQzZWE2ODgwNDA5YmY5Y2QzZmJlNWFkNGQ2YmE3Ng; ssid_ucp_v1=1.0.0-KDdhNjg2M2FmOTk4OTlhZDc5YTA1NzkzZTk0Yjk1ODllMzNhZWZkYTQKIgiRiJbC-v69pGgQ5cCVyAYYswsgDDDT8KPCBjgGQO8HSAQQAxoGbWFsaXZhIiA0YjQzZWE2ODgwNDA5YmY5Y2QzZmJlNWFkNGQ2YmE3Ng; ttwid=1%7CKpigazRsSJg_axGf_WUHx6yJUS5mxacBtoqD095joCA%7C1761965283%7C04b5c1c018115a478a29e210137e033677dc707f59acae42ef08a6c31e40198b; store-country-sign=MEIEDMPT3UQRwfCQmFV44gQg6K98ySekkHiriEEtlYNcZbxSilvjO9EnVXh-6tn9JjIEEGmrsZNuUmDyHY-Uioj-nHc; odin_tt=d554e06849533fcd19db39b1155eebbcfe16a19d5a9ac45f66085e046a1ca923a9fd8a48226d8ef38ce333e09e4b9c47c595435160e122fd723bc18e4aefc544; sid_guard_backstage=de82f03f829b2fc4ac0eb136f7bb6e80%7C1762855752%7C5184000%7CSat%2C+10-Jan-2026+10%3A09%3A12+GMT; uid_tt_backstage=0e95dd739a276318b0ffd6e5f6a82a5f86d57448a6cf0b8dc8e9a14e5160299b; uid_tt_ss_backstage=0e95dd739a276318b0ffd6e5f6a82a5f86d57448a6cf0b8dc8e9a14e5160299b; sid_tt_backstage=de82f03f829b2fc4ac0eb136f7bb6e80; sessionid_backstage=de82f03f829b2fc4ac0eb136f7bb6e80; sessionid_ss_backstage=de82f03f829b2fc4ac0eb136f7bb6e80; tt_session_tlb_tag_backstage=sttt%7C1%7C3oLwP4KbL8SsDrE297tugP_________jvFN0WttrlpRo2yxTW7xLuwV_UC0s259bXp-kVZa6YuU%3D; sid_ucp_v1_backstage=1.0.0-KGQ0ODM5Njk4MzUyNDExNTk5MWVkYzdlYmYzYThlYjYzOTQxZjI1YzQKIAiCiKuotPSYzmEQyJbMyAYYwTUgDDD9u-LHBjgCQO8HEAMaA215MiIgZGU4MmYwM2Y4MjliMmZjNGFjMGViMTM2ZjdiYjZlODA; ssid_ucp_v1_backstage=1.0.0-KGQ0ODM5Njk4MzUyNDExNTk5MWVkYzdlYmYzYThlYjYzOTQxZjI1YzQKIAiCiKuotPSYzmEQyJbMyAYYwTUgDDD9u-LHBjgCQO8HEAMaA215MiIgZGU4MmYwM2Y4MjliMmZjNGFjMGViMTM2ZjdiYjZlODA; tcn-target-idc=alisg; s_v_web_id=verify_mih29qzg_tM5vn5ZY_JvM0_4vgG_Bqc7_FS8HSYfMs4h2; csrf_session_id=59d12384e8e417d791f00d7bef6ceb0b; xgplayer_device_id=45741515781; xgplayer_user_id=39768053983; msToken=0FLUfydPUcNoA07GcECz8ibij-6WF4MesEUNrIn6ZPT_DWegOK9e5vmvYRWo5--eDxZOOE2jiQfRgkosQ2uJi6bM-EUzHYqLfzrQ-mOCN7H2PFBmQ-LwAEdJnLcK0y9ixoD5A56pgw==; passport_fe_beating_status=true; msToken=WFnD9teEDjGZtv30cX-10BgNDpNwJseNeQX4O282ulVT68UCMgGYJkE9yz4zLTgv6G5zgCDaqUsUTHQ6fVjKLAjJeFRg1jkUjZuNV9gt7xJqM_6RqKFAk9fk9XVEfv7LZFlVmIg2YQ==; msToken=z97OJcRTQeWrsxEfDsIUDTdLiYv0uXb9O9r70Q1cwCgPO9-BYJ3HXlL4GdXYx0AB5pnfGJvLXTfDVquwFawsHoNTseSu0JiDCe1vaNX4JpVJXpaLR8TK_qAfTc7ITwogESh9O53aNg=='
};

// --- 2. HELPER: Get Daily Start Timestamp (6 AM GMT+7) ---
const getDailyStartTimestamp = () => {
    // Current time in VN
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));

    let startOfDay = new Date(now);
    startOfDay.setHours(6, 0, 0, 0);

    // If current time is before reset hour, the "day" started yesterday 6 AM
    if (now < startOfDay) {
        startOfDay.setDate(startOfDay.getDate() - 1);
    }

    return Math.floor(startOfDay.getTime() / 1000);
};

// --- 3. FETCH FUNCTION ---
const fetchWithTimeout = (url, headers) => {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    });
};

// --- 4. MAIN EXECUTION ---
const main = async () => {
    const dailyStart = getDailyStartTimestamp();
    console.log(`\n🚀 Starting Multi-Room Daily Test...`);
    console.log(`📅 Reset Time: 6:00 AM VN (Timestamp: ${dailyStart})`);
    console.log(`==================================================`);

    let results = [];

    for (const [displayId, urls] of Object.entries(CREATOR_URLS)) {
        process.stdout.write(`📡 Fetching ${displayId}... `);
        let dailyTotal = 0;
        let profile = { name: displayId, username: displayId, avatar: null };

        try {
            // We use the first URL for testing (Page 1)
            const resp = await fetchWithTimeout(urls[0], HEADERS);

            if (resp.status !== 200) {
                console.log(`❌ Error ${resp.status}`);
                continue;
            }

            const json = JSON.parse(resp.body);

            if (json.message === 'error' || !json.data) {
                console.log(`❌ API Error: ${json.message || 'No Data'}`);
                continue;
            }

            const rooms = json.data?.RoomIndicatorInfo || [];

            // Extract Profile Info if available in HostBaseInfoMap
            if (json.data?.HostBaseInfoMap) {
                const firstKey = Object.keys(json.data.HostBaseInfoMap)[0];
                if (firstKey) {
                    const info = json.data.HostBaseInfoMap[firstKey];
                    profile.name = info.nickname || profile.name;
                    profile.avatar = info.avatar || null;
                }
            }

            // Calculate total income from all rooms started after 'dailyStart'
            rooms.forEach(room => {
                const startTime = parseInt(room.StartTime, 10);
                if (startTime >= dailyStart) {
                    const diamonds = parseInt(room.room_live_income_diamond_1d?.Value || '0', 10);
                    dailyTotal += diamonds;
                }
            });

            results.push({
                id: ALLOWED_CREATOR_IDS[displayId],
                name: profile.name,
                username: profile.username,
                avatar: profile.avatar,
                score: dailyTotal,
                trend: 'flat'
            });

            console.log(`✅ [${dailyTotal} Diamonds]`);

        } catch (e) {
            console.log(`❌ Failed: ${e.message}`);
        }
    }

    // Sort by score descending and print JSON
    const sortedResults = results.sort((a, b) => b.score - a.score);
    const finalJSON = { data: sortedResults };

    console.log(`\n==================================================`);
    console.log(`📊 FINAL PROCESSED DAILY RESPONSE:`);
    console.log(`==================================================`);
    console.log(JSON.stringify(finalJSON, null, 2));
    console.log(`==================================================`);
    console.log(`\n📝 Note: If scores are 0, check your 'HEADERS.Cookie' in this file.`);
    console.log(`📝 Also check for syntax errors in server.js (Line 647 fixed).`);
};

main();