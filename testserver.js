const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch'); // Make sure to npm install node-fetch if using older Node
const app = express();
const PORT = 5000;

app.use(cors());

app.get('/api/leaderboard', async (req, res) => {
    const type = req.query.type || 'monthly';
    console.log(`[${new Date().toLocaleTimeString()}] Fetching ${type} data...`);

    let baseUrl, queryString, headers;

    if (type === 'daily') {
        baseUrl = 'https://live-backstage.tiktok.com/creators/live/union_platform_api/union/anchor/live/live_room_list/';
        queryString = "SortTag=1&IsIncreasing=false&CreatorID=&RookieGraduationStatusList=%5B%5D&Offset=0&Limit=12&UniqueID=&AgencyID=&AgentID=&msToken=ecS_tzXK5IXp4U9BdZs994C41XoN-bIcLFPlsAL6AsPZ2xCjDl6N6mfFH3fhn_bow9gq3HiyU24ZbMfNOdFw3M1ehjcX79HRzWjbjvVXoJuy0kVnIUKl4RT5hAyME2xBiUOoDLlnPQ==&X-Bogus=DFSzswVEKjjdUUO1CTnY8vpJlhMn&X-Gnarly=MFgxE3f-xUScdhLySGJ5lQ0Ngecw7ubOGC-4fTsQuNI6IAFJFEKWkd0fGAHEuOEZRUp0EsNvwzus/OOKVzkDu3DfdLGkJTJqN44hD/q1xAdxleDKOMDc-w3u9mCXORhSkNQ8oc/TxjtJRrPi9dRNwC/6BDEbjcNg0HbmAvJfKEFYqn4iY4L2WYXsFbdFTEdzOl0f/dpAKXEyVvW2PLfkpCkB4gCSfWrf0BOJvpx6TOoTc6LUNDY5t96S9D3yOZtLW2c73FxPeHMbwZnDoGtiwnskJ6uaj0bPrvyuoOi4wnLK";
        headers = {
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'vi,en-US;q=0.9,en;q=0.8,ko;q=0.7',
            'content-type': 'application/json',
            'faction-id': '100579',
            'priority': 'u=1, i',
            'referer': 'https://live-backstage.tiktok.com/portal/anchor/live?sortBy=1&sortOrder=descend&tab=liveRoom',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
            'x-appid': '1180',
            'x-language': 'en',
            'cookie': '_fbp=fb.1.1737330652527.1598096788; tt_chain_token=oSDY4fPhccrhwY02U78MNQ==; _tt_enable_cookie=1; d_ticket_backstage=9eeea309e3d084424d282c62453a49c1ad737; living_device_id=53974713026; _ga_LWWPCY99PB=GS1.1.1745711106.4.0.1745711106.0.0.468963034; _gtmeec=e30%3D; ttcsid=1757152821896::dGYUuRGwSFZ6Au3HBaIz.3.1757153161666; ttcsid_CQ6FR3RC77U6L0AM21H0=1757152821895::LcyqtFwwYCe4AzSTg31j.3.1757153161880; _ga_GZB380RXJX=GS2.1.s1757152821$o4$g1$t1757154275$j60$l0$h1146909479; _ga=GA1.1.GA1.1.1579992134.1737330652; _ga_GR6VLNH8D4=GS1.1.1758019820.2.1.1758019890.0.0.842071688; sid_tt=4b43ea6880409bf9cd3fbe5ad4d6ba76; sessionid=4b43ea6880409bf9cd3fbe5ad4d6ba76; sessionid_ss=4b43ea6880409bf9cd3fbe5ad4d6ba76; store-idc=alisg; store-country-code=vn; store-country-code-src=uid; tt-target-idc=alisg; tt-target-idc-sign=Qr17CbD3A0XKZlqcSw5EgUqgT855EXtInEluEaT1vg1hI_tho7___JZRIV8GzcrR0uEh9KtwrR0jR-vzpe9DpeItPpEJVlkacZNy7ddfZPGWHV2bCFBm0N525FBraKlVdwd49g0fRmiW1wET0SLo8Km2g4DQU59ipSXhq39st4hJ5sEIwzvPC8qkJnWG95lXYD40prs2TtT5Krqzks_2nKtD7ej4xRtbvp3l5OR0_x5HxgBvBKp4JwOx36hkIWBKPcTpNvh2HNlshIMusWIBiyqkheVxCOGoWLAeEtc2s7DtBlfDPIFGXcwQKtU2rfR2vhQKQhke84xXA0BRPiytNsOs-b_khgbnPwBE7lVbzLEzg8GcWaUP3BlWT_vWOpTrx_wqJu8dUNTPbw78wya5WThrtHNPO3uYdFlfcOjCMs4zFA1ZD62_JPSCRxGSOW3eA_Zws8c1J-SqbffRHQWCJedZzmMbOXu9f6NEtRGAZwbvMqgZuHojpF1bEQj9z4Iv; passport_csrf_token=0dd3dacd1b32bf5356aa1f197d4072e1; passport_csrf_token_default=0dd3dacd1b32bf5356aa1f197d4072e1; _ttp=33NmYLgRM2umpIAazOGsbA7U0QU; cmpl_token=AgQQAPOFF-RO0rh2GVAgd10o_bWCdCULP5YOYKOOBA; sid_guard=4b43ea6880409bf9cd3fbe5ad4d6ba76%7C1761960037%7C15552000%7CThu%2C+30-Apr-2026+01%3A20%3A37+GMT; uid_tt=b51f890c31c265c37e87d35cc45766d82df6372043872265cdcc1743f26114fe; uid_tt_ss=b51f890c31c265c37e87d35cc45766d82df6372043872265cdcc1743f26114fe; tt_session_tlb_tag=sttt%7C2%7CS0PqaIBAm_nNP75a1Na6dv_________Mc9ZWpf2hVoy8I271USf8VTx995lJo7fsQWTO-kz1Too%3D; sid_ucp_v1=1.0.0-KDdhNjg2M2FmOTk4OTlhZDc5YTA1NzkzZTk0Yjk1ODllMzNhZWZkYTQKIgiRiJbC-v69pGgQ5cCVyAYYswsgDDDT8KPCBjgGQO8HSAQQAxoGbWFsaXZhIiA0YjQzZWE2ODgwNDA5YmY5Y2QzZmJlNWFkNGQ2YmE3Ng; ssid_ucp_v1=1.0.0-KDdhNjg2M2FmOTk4OTlhZDc5YTA1NzkzZTk0Yjk1ODllMzNhZWZkYTQKIgiRiJbC-v69pGgQ5cCVyAYYswsgDDDT8KPCBjgGQO8HSAQQAxoGbWFsaXZhIiA0YjQzZWE2ODgwNDA5YmY5Y2QzZmJlNWFkNGQ2YmE3Ng; ttwid=1%7CKpigazRsSJg_axGf_WUHx6yJUS5mxacBtoqD095joCA%7C1761965283%7C04b5c1c018115a478a29e210137e033677dc707f59acae42ef08a6c31e40198b; store-country-sign=MEIEDMPT3UQRwfCQmFV44gQg6K98ySekkHiriEEtlYNcZbxSilvjO9EnVXh-6tn9JjIEEGmrsZNuUmDyHY-Uioj-nHc; odin_tt=d554e06849533fcd19db39b1155eebbcfe16a19d5a9ac45f66085e046a1ca923a9fd8a48226d8ef38ce333e09e4b9c47c595435160e122fd723bc18e4aefc544; sid_guard_backstage=de82f03f829b2fc4ac0eb136f7bb6e80%7C1762855752%7C5184000%7CSat%2C+10-Jan-2026+10%3A09%3A12+GMT; uid_tt_backstage=0e95dd739a276318b0ffd6e5f6a82a5f86d57448a6cf0b8dc8e9a14e5160299b; uid_tt_ss_backstage=0e95dd739a276318b0ffd6e5f6a82a5f86d57448a6cf0b8dc8e9a14e5160299b; sid_tt_backstage=de82f03f829b2fc4ac0eb136f7bb6e80; sessionid_backstage=de82f03f829b2fc4ac0eb136f7bb6e80; sessionid_ss_backstage=de82f03f829b2fc4ac0eb136f7bb6e80; tt_session_tlb_tag_backstage=sttt%7C1%7C3oLwP4KbL8SsDrE297tugP_________jvFN0WttrlpRo2yxTW7xLuwV_UC0s259bXp-kVZa6YuU%3D; sid_ucp_v1_backstage=1.0.0-KGQ0ODM5Njk4MzUyNDExNTk5MWVkYzdlYmYzYThlYjYzOTQxZjI1YzQKIAiCiKuotPSYzmEQyJbMyAYYwTUgDDD9u-LHBjgCQO8HEAMaA215MiIgZGU4MmYwM2Y4MjliMmZjNGFjMGViMTM2ZjdiYjZlODA; ssid_ucp_v1_backstage=1.0.0-KGQ0ODM5Njk4MzUyNDExNTk5MWVkYzdlYmYzYThlYjYzOTQxZjI1YzQKIAiCiKuotPSYzmEQyJbMyAYYwTUgDDD9u-LHBjgCQO8HEAMaA215MiIgZGU4MmYwM2Y4MjliMmZjNGFjMGViMTM2ZjdiYjZlODA; tcn-target-idc=alisg; s_v_web_id=verify_mih29qzg_tM5vn5ZY_JvM0_4vgG_Bqc7_FS8HSYfMs4h2; csrf_session_id=59d12384e8e417d791f00d7bef6ceb0b; xgplayer_device_id=45741515781; xgplayer_user_id=39768053983; msToken=0FLUfydPUcNoA07GcECz8ibij-6WF4MesEUNrIn6ZPT_DWegOK9e5vmvYRWo5--eDxZOOE2jiQfRgkosQ2uJi6bM-EUzHYqLfzrQ-mOCN7H2PFBmQ-LwAEdJnLcK0y9ixoD5A56pgw==; passport_fe_beating_status=true; msToken=WFnD9teEDjGZtv30cX-10BgNDpNwJseNeQX4O282ulVT68UCMgGYJkE9yz4zLTgv6G5zgCDaqUsUTHQ6fVjKLAjJeFRg1jkUjZuNV9gt7xJqM_6RqKFAk9fk9XVEfv7LZFlVmIg2YQ=='
        };
    } else {
        // Monthly Endpoint (Original)
        baseUrl = 'https://live-backstage.tiktok.com/creators/live/union_platform_api/union/anchor/get_anchor_data/';
        queryString = "startTime=1761955200&endTime=1764201599&sortTagEnum=1&descOrAsc=desc&offset=0&limit=20&FactionID=100579&compareType=0&timeType=4&msToken=762wve8taApgjo-lRoyFkxjQ2aSTNSmBMgsg1JA86QBCV06UinwNZXoIrfEgTwKfncizIHFd6J34TA06KPGS4OSPrUxskIp247pTQ2VxPXmWgYNDPpxwvZ-fyrZo_ig=&X-Bogus=DFSzswVEahVdUUO1CTrvwJpJlh0u&X-Gnarly=MR3fChul2pOI/HkXkp3PW4ltwVe8tQyhZ49uzs42t09iFoEb6fxiSz2qvnNN/mCQ2DdkdPI3Ona/EeRVLRLY6r86pLt2GscXlHFmzZLljLprRU8bGiVO0EpPdaDfUZk21nZhB8UE7m9b70ZbPUqXWs9djqiU8GJku64sWI/jYCJQD0DiCcdLLHq0VToI/UDXoMDUqHKCkkSerW/-swlTkxTRpUIHp8eK6McYJNOHzgiz43JtiHJ-biWDWrGERTn9aPkpZNA5QVDCGoNycuhIcDi9/oBVdZ5qYCA-82L8OoJ3";
        headers = {
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'en-US,en;q=0.9',
            'content-type': 'application/json',
            'faction-id': '100579',
            'priority': 'u=1, i',
            'referer': 'https://live-backstage.tiktok.com/portal/data/data?anchorID=&endTime=1764201599&startTime=1761955200',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
            'x-appid': '1180',
            'x-language': 'en',
            'cookie': '_fbp=fb.1.1737330652527.1598096788; tt_chain_token=oSDY4fPhccrhwY02U78MNQ==; _tt_enable_cookie=1; d_ticket_backstage=9eeea309e3d084424d282c62453a49c1ad737; living_device_id=53974713026; _ga_LWWPCY99PB=GS1.1.1745711106.4.0.1745711106.0.0.468963034; _gtmeec=e30%3D; ttcsid=1757152821896::dGYUuRGwSFZ6Au3HBaIz.3.1757153161666; ttcsid_CQ6FR3RC77U6L0AM21H0=1757152821895::LcyqtFwwYCe4AzSTg31j.3.1757153161880; _ga_GZB380RXJX=GS2.1.s1757152821$o4$g1$t1757154275$j60$l0$h1146909479; _ga=GA1.1.GA1.1.1579992134.1737330652; _ga_GR6VLNH8D4=GS1.1.1758019820.2.1.1758019890.0.0.842071688; sid_tt=4b43ea6880409bf9cd3fbe5ad4d6ba76; sessionid=4b43ea6880409bf9cd3fbe5ad4d6ba76; sessionid_ss=4b43ea6880409bf9cd3fbe5ad4d6ba76; store-idc=alisg; store-country-code=vn; store-country-code-src=uid; tt-target-idc=alisg; tt-target-idc-sign=Qr17CbD3A0XKZlqcSw5EgUqgT855EXtInEluEaT1vg1hI_tho7___JZRIV8GzcrR0uEh9KtwrR0jR-vzpe9DpeItPpEJVlkacZNy7ddfZPGWHV2bCFBm0N525FBraKlVdwd49g0fRmiW1wET0SLo8Km2g4DQU59ipSXhq39st4hJ5sEIwzvPC8qkJnWG95lXYD40prs2TtT5Krqzks_2nKtD7ej4xRtbvp3l5OR0_x5HxgBvBKp4JwOx36hkIWBKPcTpNvh2HNlshIMusWIBiyqkheVxCOGoWLAeEtc2s7DtBlfDPIFGXcwQKtU2rfR2vhQKQhke84xXA0BRPiytNsOs-b_khgbnPwBE7lVbzLEzg8GcWaUP3BlWT_vWOpTrx_wqJu8dUNTPbw78wya5WThrtHNPO3uYdFlfcOjCMs4zFA1ZD62_JPSCRxGSOW3eA_Zws8c1J-SqbffRHQWCJedZzmMbOXu9f6NEtRGAZwbvMqgZuHojpF1bEQj9z4Iv; passport_csrf_token=0dd3dacd1b32bf5356aa1f197d4072e1; passport_csrf_token_default=0dd3dacd1b32bf5356aa1f197d4072e1; _ttp=33NmYLgRM2umpIAazOGsbA7U0QU; cmpl_token=AgQQAPOFF-RO0rh2GVAgd10o_bWCdCULP5YOYKOOBA; sid_guard=4b43ea6880409bf9cd3fbe5ad4d6ba76%7C1761960037%7C15552000%7CThu%2C+30-Apr-2026+01%3A20%3A37+GMT; uid_tt=b51f890c31c265c37e87d35cc45766d82df6372043872265cdcc1743f26114fe; uid_tt_ss=b51f890c31c265c37e87d35cc45766d82df6372043872265cdcc1743f26114fe; tt_session_tlb_tag=sttt%7C2%7CS0PqaIBAm_nNP75a1Na6dv_________Mc9ZWpf2hVoy8I271USf8VTx995lJo7fsQWTO-kz1Too%3D; sid_ucp_v1=1.0.0-KDdhNjg2M2FmOTk4OTlhZDc5YTA1NzkzZTk0Yjk1ODllMzNhZWZkYTQKIgiRiJbC-v69pGgQ5cCVyAYYswsgDDDT8KPCBjgGQO8HSAQQAxoGbWFsaXZhIiA0YjQzZWE2ODgwNDA5YmY5Y2QzZmJlNWFkNGQ2YmE3Ng; ssid_ucp_v1=1.0.0-KDdhNjg2M2FmOTk4OTlhZDc5YTA1NzkzZTk0Yjk1ODllMzNhZWZkYTQKIgiRiJbC-v69pGgQ5cCVyAYYswsgDDDT8KPCBjgGQO8HSAQQAxoGbWFsaXZhIiA0YjQzZWE2ODgwNDA5YmY5Y2QzZmJlNWFkNGQ2YmE3Ng; ttwid=1%7CKpigazRsSJg_axGf_WUHx6yJUS5mxacBtoqD095joCA%7C1761965283%7C04b5c1c018115a478a29e210137e033677dc707f59acae42ef08a6c31e40198b; store-country-sign=MEIEDMPT3UQRwfCQmFV44gQg6K98ySekkHiriEEtlYNcZbxSilvjO9EnVXh-6tn9JjIEEGmrsZNuUmDyHY-Uioj-nHc; odin_tt=d554e06849533fcd19db39b1155eebbcfe16a19d5a9ac45f66085e046a1ca923a9fd8a48226d8ef38ce333e09e4b9c47c595435160e122fd723bc18e4aefc544; sid_guard_backstage=de82f03f829b2fc4ac0eb136f7bb6e80%7C1762855752%7C5184000%7CSat%2C+10-Jan-2026+10%3A09%3A12+GMT; uid_tt_backstage=0e95dd739a276318b0ffd6e5f6a82a5f86d57448a6cf0b8dc8e9a14e5160299b; uid_tt_ss_backstage=0e95dd739a276318b0ffd6e5f6a82a5f86d57448a6cf0b8dc8e9a14e5160299b; sid_tt_backstage=de82f03f829b2fc4ac0eb136f7bb6e80; sessionid_backstage=de82f03f829b2fc4ac0eb136f7bb6e80; sessionid_ss_backstage=de82f03f829b2fc4ac0eb136f7bb6e80; tt_session_tlb_tag_backstage=sttt%7C1%7C3oLwP4KbL8SsDrE297tugP_________jvFN0WttrlpRo2yxTW7xLuwV_UC0s259bXp-kVZa6YuU%3D; sid_ucp_v1_backstage=1.0.0-KGQ0ODM5Njk4MzUyNDExNTk5MWVkYzdlYmYzYThlYjYzOTQxZjI1YzQKIAiCiKuotPSYzmEQyJbMyAYYwTUgDDD9u-LHBjgCQO8HEAMaA215MiIgZGU4MmYwM2Y4MjliMmZjNGFjMGViMTM2ZjdiYjZlODA; ssid_ucp_v1_backstage=1.0.0-KGQ0ODM5Njk4MzUyNDExNTk5MWVkYzdlYmYzYThlYjYzOTQxZjI1YzQKIAiCiKuotPSYzmEQyJbMyAYYwTUgDDD9u-LHBjgCQO8HEAMaA215MiIgZGU4MmYwM2Y4MjliMmZjNGFjMGViMTM2ZjdiYjZlODA; tcn-target-idc=alisg; s_v_web_id=verify_mih29qzg_tM5vn5ZY_JvM0_4vgG_Bqc7_FS8HSYfMs4h2; csrf_session_id=59d12384e8e417d791f00d7bef6ceb0b; msToken=zHgRUvo97eSqufdMqlvmLj1GMWT76e07qr32aKcXklHCLUuLOn59WxIDBBMIHgjtrd_L46czMx6RXyhBMJpfDx0ObwZyXU9DrME-a8pXI0S7bD4q0IjbuGPoNCXi7nE=; passport_fe_beating_status=true; msToken=DV0mviT44mhWHAoiLRF2t-4Eq6wSf0hDt5amM2e5fgEfaZ4hIj2lLsrch3vTuP1e8iijloszF2guQ7XXfY1WBbLLcqcsHObPAri8THdkmFxEqHYKePuIA-w7Cg4rvAY='
        };
    }

    try {
        const response = await fetch(`${baseUrl}?${queryString}`, {
            method: 'GET',
            headers: headers
        });

        const text = await response.text();
        
        if (!response.ok) {
            console.error(`TikTok API Error (${type}):`, response.status);
            return res.status(response.status).json({ error: 'Upstream API Error', details: text });
        }

        if (!text) {
            console.error(`TikTok API Empty Response (${type})`);
            return res.status(500).json({ error: 'Empty Response from TikTok' });
        }

        const data = JSON.parse(text);
        res.json(data);

    } catch (error) {
        console.error('Server Error:', error.message);
        res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`✅ Backend Server running at http://localhost:${PORT}`);
});