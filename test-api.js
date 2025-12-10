// Run this script in your terminal using: node test-api.js
// This mimics Postman by making a direct server-to-server request, bypassing CORS.

// Ensure you have a modern Node.js version (v18+) for built-in 'fetch'.
// If using older Node, install node-fetch: npm install node-fetch

const https = require('https');

const runTest = async () => {
    console.log("🚀 Starting TikTok API Test...");

    const baseUrl = 'https://live-backstage.tiktok.com/creators/live/union_platform_api/union/anchor/get_anchor_data/';
    
    // We use a raw string here instead of URLSearchParams to prevent auto-encoding.
    // The msToken ends with '=', and URLSearchParams would change it to '%3D',
    // which breaks the X-Bogus signature verification on the server.
    const queryString = "startTime=1761955200&endTime=1764201599&sortTagEnum=1&descOrAsc=desc&offset=0&limit=20&FactionID=100579&compareType=0&timeType=4&msToken=762wve8taApgjo-lRoyFkxjQ2aSTNSmBMgsg1JA86QBCV06UinwNZXoIrfEgTwKfncizIHFd6J34TA06KPGS4OSPrUxskIp247pTQ2VxPXmWgYNDPpxwvZ-fyrZo_ig=&X-Bogus=DFSzswVEahVdUUO1CTrvwJpJlh0u&X-Gnarly=MR3fChul2pOI/HkXkp3PW4ltwVe8tQyhZ49uzs42t09iFoEb6fxiSz2qvnNN/mCQ2DdkdPI3Ona/EeRVLRLY6r86pLt2GscXlHFmzZLljLprRU8bGiVO0EpPdaDfUZk21nZhB8UE7m9b70ZbPUqXWs9djqiU8GJku64sWI/jYCJQD0DiCcdLLHq0VToI/UDXoMDUqHKCkkSerW/-swlTkxTRpUIHp8eK6McYJNOHzgiz43JtiHJ-biWDWrGERTn9aPkpZNA5QVDCGoNycuhIcDi9/oBVdZ5qYCA-82L8OoJ3";

    const fullUrl = `${baseUrl}?${queryString}`;

    // Define headers separately so we can use them in both fetch and curl generation
    const headers = {
        // Generic headers
        'accept': 'application/json, text/plain, */*',
        'accept-language': 'en-US,en;q=0.9',
        'content-type': 'application/json',
        'connection': 'keep-alive', 
        
        // TikTok specific headers
        'faction-id': '100579',
        'x-appid': '1180',
        'x-csrf-token': 'undefined',
        'x-language': 'en',
        
        // IMPORTANT: The User-Agent MUST match what was used to generate X-Bogus
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        
        // Authentication
        'cookie': '_fbp=fb.1.1737330652527.1598096788; tt_chain_token=oSDY4fPhccrhwY02U78MNQ==; _tt_enable_cookie=1; d_ticket_backstage=9eeea309e3d084424d282c62453a49c1ad737; living_device_id=53974713026; _ga_LWWPCY99PB=GS1.1.1745711106.4.0.1745711106.0.0.468963034; _gtmeec=e30%3D; ttcsid=1757152821896::dGYUuRGwSFZ6Au3HBaIz.3.1757153161666; ttcsid_CQ6FR3RC77U6L0AM21H0=1757152821895::LcyqtFwwYCe4AzSTg31j.3.1757153161880; _ga_GZB380RXJX=GS2.1.s1757152821$o4$g1$t1757154275$j60$l0$h1146909479; _ga=GA1.1.GA1.1.1579992134.1737330652; _ga_GR6VLNH8D4=GS1.1.1758019820.2.1.1758019890.0.0.842071688; sid_tt=4b43ea6880409bf9cd3fbe5ad4d6ba76; sessionid=4b43ea6880409bf9cd3fbe5ad4d6ba76; sessionid_ss=4b43ea6880409bf9cd3fbe5ad4d6ba76; store-idc=alisg; store-country-code=vn; store-country-code-src=uid; tt-target-idc=alisg; tt-target-idc-sign=Qr17CbD3A0XKZlqcSw5EgUqgT855EXtInEluEaT1vg1hI_tho7___JZRIV8GzcrR0uEh9KtwrR0jR-vzpe9DpeItPpEJVlkacZNy7ddfZPGWHV2bCFBm0N525FBraKlVdwd49g0fRmiW1wET0SLo8Km2g4DQU59ipSXhq39st4hJ5sEIwzvPC8qkJnWG95lXYD40prs2TtT5Krqzks_2nKtD7ej4xRtbvp3l5OR0_x5HxgBvBKp4JwOx36hkIWBKPcTpNvh2HNlshIMusWIBiyqkheVxCOGoWLAeEtc2s7DtBlfDPIFGXcwQKtU2rfR2vhQKQhke84xXA0BRPiytNsOs-b_khgbnPwBE7lVbzLEzg8GcWaUP3BlWT_vWOpTrx_wqJu8dUNTPbw78wya5WThrtHNPO3uYdFlfcOjCMs4zFA1ZD62_JPSCRxGSOW3eA_Zws8c1J-SqbffRHQWCJedZzmMbOXu9f6NEtRGAZwbvMqgZuHojpF1bEQj9z4Iv; passport_csrf_token=0dd3dacd1b32bf5356aa1f197d4072e1; passport_csrf_token_default=0dd3dacd1b32bf5356aa1f197d4072e1; _ttp=33NmYLgRM2umpIAazOGsbA7U0QU; cmpl_token=AgQQAPOFF-RO0rh2GVAgd10o_bWCdCULP5YOYKOOBA; sid_guard=4b43ea6880409bf9cd3fbe5ad4d6ba76%7C1761960037%7C15552000%7CThu%2C+30-Apr-2026+01%3A20%3A37+GMT; uid_tt=b51f890c31c265c37e87d35cc45766d82df6372043872265cdcc1743f26114fe; uid_tt_ss=b51f890c31c265c37e87d35cc45766d82df6372043872265cdcc1743f26114fe; tt_session_tlb_tag=sttt%7C2%7CS0PqaIBAm_nNP75a1Na6dv_________Mc9ZWpf2hVoy8I271USf8VTx995lJo7fsQWTO-kz1Too%3D; sid_ucp_v1=1.0.0-KDdhNjg2M2FmOTk4OTlhZDc5YTA1NzkzZTk0Yjk1ODllMzNhZWZkYTQKIgiRiJbC-v69pGgQ5cCVyAYYswsgDDDT8KPCBjgGQO8HSAQQAxoGbWFsaXZhIiA0YjQzZWE2ODgwNDA5YmY5Y2QzZmJlNWFkNGQ2YmE3Ng; ssid_ucp_v1=1.0.0-KDdhNjg2M2FmOTk4OTlhZDc5YTA1NzkzZTk0Yjk1ODllMzNhZWZkYTQKIgiRiJbC-v69pGgQ5cCVyAYYswsgDDDT8KPCBjgGQO8HSAQQAxoGbWFsaXZhIiA0YjQzZWE2ODgwNDA5YmY5Y2QzZmJlNWFkNGQ2YmE3Ng; ttwid=1%7CKpigazRsSJg_axGf_WUHx6yJUS5mxacBtoqD095joCA%7C1761965283%7C04b5c1c018115a478a29e210137e033677dc707f59acae42ef08a6c31e40198b; store-country-sign=MEIEDMPT3UQRwfCQmFV44gQg6K98ySekkHiriEEtlYNcZbxSilvjO9EnVXh-6tn9JjIEEGmrsZNuUmDyHY-Uioj-nHc; odin_tt=d554e06849533fcd19db39b1155eebbcfe16a19d5a9ac45f66085e046a1ca923a9fd8a48226d8ef38ce333e09e4b9c47c595435160e122fd723bc18e4aefc544; sid_guard_backstage=de82f03f829b2fc4ac0eb136f7bb6e80%7C1762855752%7C5184000%7CSat%2C+10-Jan-2026+10%3A09%3A12+GMT; uid_tt_backstage=0e95dd739a276318b0ffd6e5f6a82a5f86d57448a6cf0b8dc8e9a14e5160299b; uid_tt_ss_backstage=0e95dd739a276318b0ffd6e5f6a82a5f86d57448a6cf0b8dc8e9a14e5160299b; sid_tt_backstage=de82f03f829b2fc4ac0eb136f7bb6e80; sessionid_backstage=de82f03f829b2fc4ac0eb136f7bb6e80; sessionid_ss_backstage=de82f03f829b2fc4ac0eb136f7bb6e80; tt_session_tlb_tag_backstage=sttt%7C1%7C3oLwP4KbL8SsDrE297tugP_________jvFN0WttrlpRo2yxTW7xLuwV_UC0s259bXp-kVZa6YuU%3D; sid_ucp_v1_backstage=1.0.0-KGQ0ODM5Njk4MzUyNDExNTk5MWVkYzdlYmYzYThlYjYzOTQxZjI1YzQKIAiCiKuotPSYzmEQyJbMyAYYwTUgDDD9u-LHBjgCQO8HEAMaA215MiIgZGU4MmYwM2Y4MjliMmZjNGFjMGViMTM2ZjdiYjZlODA; ssid_ucp_v1_backstage=1.0.0-KGQ0ODM5Njk4MzUyNDExNTk5MWVkYzdlYmYzYThlYjYzOTQxZjI1YzQKIAiCiKuotPSYzmEQyJbMyAYYwTUgDDD9u-LHBjgCQO8HEAMaA215MiIgZGU4MmYwM2Y4MjliMmZjNGFjMGViMTM2ZjdiYjZlODA; tcn-target-idc=alisg; s_v_web_id=verify_mih29qzg_tM5vn5ZY_JvM0_4vgG_Bqc7_FS8HSYfMs4h2; csrf_session_id=59d12384e8e417d791f00d7bef6ceb0b; msToken=zHgRUvo97eSqufdMqlvmLj1GMWT76e07qr32aKcXklHCLUuLOn59WxIDBBMIHgjtrd_L46czMx6RXyhBMJpfDx0ObwZyXU9DrME-a8pXI0S7bD4q0IjbuGPoNCXi7nE=; passport_fe_beating_status=true; msToken=DV0mviT44mhWHAoiLRF2t-4Eq6wSf0hDt5amM2e5fgEfaZ4hIj2lLsrch3vTuP1e8iijloszF2guQ7XXfY1WBbLLcqcsHObPAri8THdkmFxEqHYKePuIA-w7Cg4rvAY='
    };

    // GENERATE CURL COMMAND
    console.log("📋 Equivalent CURL Command (Import to Postman):");
    let curlCmd = `curl '${fullUrl}' \\\n`;
    for (const [key, value] of Object.entries(headers)) {
        // Escape single quotes in header values if necessary
        const safeValue = value.replace(/'/g, "'\\''");
        curlCmd += `  -H '${key}: ${safeValue}' \\\n`;
    }
    console.log(curlCmd);
    console.log("--------------------------------------------------\n");

    try {
        const response = await fetch(fullUrl, {
            method: 'GET',
            headers: headers
        });

        console.log("📡 Status Code:", response.status);

        // Read raw text first to avoid JSON parse error on empty response
        const text = await response.text();
        console.log("📄 Raw Response Body:", text);

        if (!response.ok) {
            console.error(`❌ HTTP Error: ${response.status}. The tokens/cookies might be invalid.`);
            return;
        }

        if (!text) {
            console.error("❌ Error: Response body is empty (0 bytes). Your tokens/signature (msToken/X-Bogus) are likely invalid or expired.");
            return;
        }

        const data = JSON.parse(text);
        console.log("✅ Success! Response Data:");
        console.log(JSON.stringify(data, null, 2));

    } catch (error) {
        console.error("❌ Network or Parsing Error:", error.message);
    }
};

runTest();