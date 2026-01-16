require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
// Note: In Node v18+, fetch is built-in. If using older Node, uncomment the line below:
// const fetch = require('node-fetch'); 
const app = express();
const PORT = 5000;

app.use(cors());

// Serve static files from the React build folder (for production/Docker deployment)
if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, 'build')));
}

// --- HELPER: Get Avatar Path (checks JPEG first, falls back to SVG) ---
const getAvatarPath = (displayId) => {
    const baseName = displayId.replace('.ht', '');
    const jpegPath = `/avatars/${baseName}.jpeg`;
    const svgPath = `/avatars/${baseName}.svg`;

    // Check if JPEG exists on disk (in public folder for dev, build folder for prod)
    const publicDir = process.env.NODE_ENV === 'production'
        ? path.join(__dirname, 'build')
        : path.join(__dirname, 'public');

    const jpegFullPath = path.join(publicDir, 'avatars', `${baseName}.jpeg`);

    if (fs.existsSync(jpegFullPath)) {
        return jpegPath;
    }
    return svgPath; // Fallback to SVG
};

// --- HELPER: Download and Save Avatar to disk ---
const downloadAndSaveAvatar = async (displayId, avatarUrl) => {
    if (!avatarUrl) return false;

    const baseName = displayId.replace('.ht', '');
    const publicDir = path.join(__dirname, 'public');
    const jpegFullPath = path.join(publicDir, 'avatars', `${baseName}.jpeg`);

    try {
        console.log(`[INFO] Downloading avatar for ${displayId}...`);

        const response = await fetch(avatarUrl);
        if (!response.ok) {
            console.error(`[ERROR] Failed to download avatar for ${displayId}: ${response.status}`);
            return false;
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Ensure avatars directory exists
        const avatarsDir = path.join(publicDir, 'avatars');
        if (!fs.existsSync(avatarsDir)) {
            fs.mkdirSync(avatarsDir, { recursive: true });
        }

        // Save the avatar as JPEG
        fs.writeFileSync(jpegFullPath, buffer);
        console.log(`[INFO] ✅ Avatar saved for ${displayId} -> ${jpegFullPath}`);
        return true;
    } catch (e) {
        console.error(`[ERROR] Failed to save avatar for ${displayId}:`, e.message);
        return false;
    }
};

// --- CONFIGURATION ---
const ALLOWED_CREATOR_IDS = {
    'novix.ht2': '7592510945700806673',
    'dopamine.ht': '7539826902857515009',
    'lunarknight.ht': '7514557708314542081',
    'huntera.ht': '7529074048186220545',
    'moonsiren.ht': '7514527995919646737',
    'kayzen.ht': '7484173710891679761'
};

// Default creator info with capitalized names
// Avatar paths are now resolved dynamically via getAvatarPath()
const DEFAULT_CREATOR_INFO = {
    'novix.ht2': { name: 'NOVIX' },
    'dopamine.ht': { name: 'DOPAMINE' },
    'lunarknight.ht': { name: 'LUNARKNIGHT' },
    'huntera.ht': { name: 'HUNTERA' },
    'moonsiren.ht': { name: 'MOONSIREN' },
    'kayzen.ht': { name: 'KAYZEN' }
};

const CREATOR_URLS = {
    // 'novix.ht': [
    //     // Page 1 (Offset 0)
    //     "https://live-backstage.tiktok.com/creators/live/union_platform_api/union/anchor/v2/get_room_list/?DisplayID=novix.ht&Offset=0&Limit=20&HostID=7441833017436308501&msToken=yl8ipGjDJdb8LFgS6JfZj-OhPMvBjHGxAFKE2yBUrH8MkSgauwmLd3D-BBdMy6EJfYvu2E439s7PtuNNM7CBPhFnDqhwMHwH2gVqwJUBfTdI_atRURML9JdxbSC_hQE=&X-Bogus=DFSzswVLY1XANjMQCFdMBvpJlh0V&X-Gnarly=M5J8g9Hbouf8PsJp1skym-SbvvXJmve06nqDwaxoe67Clm4qFPRYOH3JqFQmRKAyrISamuJut7rL/Bb8T7FBKsP1Jh02O6TW-ZdK50jOUYf9aNMGqqNJC0SqoiF1hWxm88TlitdjVD3XbKGZz6fcPWd-mv/QNaEZB3zaHt3HP6iMOWPxm5A99mrdtyM75/P4a5L/4lUe7UgJQiRivei41sFMGALmoGg2bYusUbHwoa7O80Vj/UhHRCs26-Cwu2WGDa/lwBX0B0Smd1p1O-Hjx9pQJryZxsuwyjoXsULdMFEk",
    //     // Page 2 (Offset 20)
    //     "https://live-backstage.tiktok.com/creators/live/union_platform_api/union/anchor/v2/get_room_list/?DisplayID=novix.ht&Offset=20&Limit=20&HostID=7441833017436308501&msToken=U6IEjudyVW59xiwEfSkEAMasIk6ePYcUsIQx7G_qFda8oz-gdlf4txx4NJPc00B-6fPWgLOg1IzkRRvdviiF6MW9k73dtYMdJMdjFSxlZSv7OUBxmQrtHe8jNxdY4uQ=&X-Bogus=DFSzswVLaYxANjMQCFdK9ipJlh8e&X-Gnarly=MJyDIPYMuxES009xmvNbfKFTaWFbnFuzL-Ve/FAgyJznbY8e3XmXRAfmYrUv2nDoPuP2UfYxQmigxpckqC2z7UJAf2NgBfua2b4iBFk9DFqifoMmZb-vYmFbpKuBGSJ-L98sfqCwNdbwjO8-cfy7LHBiGM-wTmi5hAjZKHHxIIEpZnKrsRVa7gBS5Z5IaU7xJprCRo9q6MfDMko4O0ew9CoIPeE0pu74gKxml1RHE5F899YpLfM5JUQcdm8KCmvZxIVEQPz/Vl8ZSuF/plPrHGIezG-f/AtCZCTjZodk8-Yz",
    //     // Page 3 (Offset 40)
    //     "https://live-backstage.tiktok.com/creators/live/union_platform_api/union/anchor/v2/get_room_list/?DisplayID=novix.ht&Offset=40&Limit=20&HostID=7441833017436308501&msToken=8yVQwNriDYfdmmd_w4dcxi-AtaxBLQvRDjWpxbyhqBgg1FKruokd9TCssxiS9w2NtIwjHiai77bNA6xRji_wKUZeZM-39Oh9Q0RfSa3Utx_ksIb1cQihDXMWMG7Ik8o=&X-Bogus=DFSzswVLa00ANjMQCFdKuvpJlh8K&X-Gnarly=MxDZnFeCaP9kf6C7AmcdLePNU/ZwFCFdbKJKiEmqdBY/oF05mN0G4ZLPcu9az9QjwUG6QBwEBeathXiA02RB7saTvDGSQ98EHMLjs0JccduO6qjMBBOAWpwyniGokTnUMLO6Ptrf3ejtTIbUAesC2F--C4g94IHRB/kAtbU7Nat-mJb2EfMAIJGq19WMYl/0t8wgO/dZq6ZL-mF0oW7lpd5Dfx6IELbGVXx1ns00r6sIjEfUNLZB1UKFIeAT5EgkpZXz43mIQ099/vtj7DKsLDtoe8kHnWsJ78d3tzbOs3op"
    // ],
    'novix.ht2': [
        // Page 1 (Offset 0)
        "https://live-backstage.tiktok.com/creators/live/union_platform_api/union/anchor/v2/get_room_list/?DisplayID=novix.ht2&Offset=0&Limit=20&HostID=7588012144228533249&msToken=SgDio30exhByQ8Zw-h7R4EwlFyfLOn_QhnYQnLk2U47j-58TDPTXsMVhhJtrDurmRUpkmZZkpNoQ5s4eMAuHaLIeMqoZGoXGrhO3OXF022hqCysbmNqwnw8k1zAO5gc=&X-Bogus=DFSzswVuIh6dUvHpCza3ZGVpMgh9&X-Gnarly=MHu2d-dichJkDLasscI/AlJhLocSWrLgWE657GVXe7Z4sD8fwXo47AHAtfUC6W5dWHkgqHOcEXLCSFmy8RWMiuDYHBXLu0ncuFPdhdobbl1q-wGuSHu3y2TSkeHrbeGAi0pz3uLRJ0MQEHG-F3tu4gRIucY8ndnnSMdhn4D0E4wxYmI2b2EVFAQoELB78N1IoNxbgw-/mKl8s38QAyoNNzQVPfctiTcWVsvKX3FFr/ZAnedI7HBR5zBU7qAPT0mL9Esk59bmxX9iPgCAp6Xiahm1vrXDJtRCPO9P/ApTIUdD",
        // Page 2 (Offset 20)
        "",
        // Page 3 (Offset 40)
        ""
    ],
    'huntera.ht': [
        // Page 1
        "https://live-backstage.tiktok.com/creators/live/union_platform_api/union/anchor/v2/get_room_list/?DisplayID=huntera.ht&Offset=0&Limit=20&HostID=7528287601460823048&msToken=4xXEY3UuhKRqxiCDvvxmP8BB4wVpFvhGVeHLPAv3wpmvO5LBT3xM27KUEuI_c73DHBFqnp_WfiE7aGlazqwg3k2X_PyoyIlnErA1IbM8M5jaq0asH9UWThUmcSptiuR8zoVP9-0Dyg==&X-Bogus=DFSzswVLY6TANjMQCFd3aJpJlh/2&X-Gnarly=MF5dJcoji5g89fIVkuhhmJgTOQJqLkjY6a8scywCy0dw3YiqWWhJNenQu30GGXKalKAs4gYu2WtTL/9FvBRe1BjsSWIvjP3l8wElAjJt2JPAyUBfolFkJrzrfVT6Eh75B53y3KP3CL1eHlnBp3Wssyov0ypg4oezmbWTfA/RCsVbIjNUjAThoXKwNmgQg85mBwxOyUF1KGs8r7HGT5a4sjMZU6nXi3V3qXfH0IRlZfJ9M9MR7qYOER8YAdqITFk/w/DCDpLKDrIKGHPhO8A7jTBob3gItduzPa8OfYc0Lgw5",
        // Page 2
        "https://live-backstage.tiktok.com/creators/live/union_platform_api/union/anchor/v2/get_room_list/?DisplayID=huntera.ht&Offset=20&Limit=20&HostID=7528287601460823048&msToken=UjbitqljrRZrpYQNpNNbSflKu_o6mLnPcMts7tCqmRJ2GWqwXrVFOmvcRKE6VW3HcDWuAZOXT4FC5zzt693fzy6SZMzevTHbluCG-rPepjeXPVl1Uk9eMc3BdR7L5_qNvtnWepWaIA==&X-Bogus=DFSzswVLPpiANjMQCFd3tkpJlhMt&X-Gnarly=MxBL3PupWpWGygGrIQ42ND0L6Df7nSfWR0AkCRf2VIsGlG7WfqnQ8t7GxMCnId4gZjCLoiW0jEpw4lBinD0VGVOCd3YWw-/WJ56fnHEZE7lQDihFnYtOuyHm0LdVoMtCZFWqzB48kabKgQCGY2pD9rYb5RX0PmHirCusWiPgchjlRDjBGR7FuJpYgeBoLxBoVAETm83VgN9pqnVayVpxYXEJN9Z7tZMd5-r1q3cQIv4rx2K69d452bz1uw/NCMEQ9-DsomsKwClA/Tksl4zAi16JvzIe05ck3yb7SCQ0vyy9",
        // Page 3
        "https://live-backstage.tiktok.com/creators/live/union_platform_api/union/anchor/v2/get_room_list/?DisplayID=huntera.ht&Offset=40&Limit=20&HostID=7528287601460823048&msToken=mJGgajzGJTnAPMrHtAwLs4dCa0Ww41YaS7p-JxZe1VGTnkbF5gMCDC4LgPvoKnMh61UOqGy40I_Axb1oTXvFuysdw1RiyyR2NRoQRULm_UeTGfr6mMUTTfmd4-FO-IDX2RL8wZotQw==&X-Bogus=DFSzswVLCazANjMQCFd3jJpJlh8A&X-Gnarly=MaAxYlRzsbfy4y8HGmxioLro64H-a0iYDn2DO0C5lMK/HxKfi5OmFJQ2Nw7fbx89JwfV5c-iOk6WIUBQIse43I8SV9iXCnnIQpZ5c9FKjS97JWGwsZHv0zgusu2MzbJ4FHrUAEtNcpgqo8B0ykO7cXQbpVWQ7j8z3ANTDieDWO5XhaGE0n5i32nz0Zt6f6onX9HkMVDUSM7hypd1XfztMqc6Rr2wJq6CjYFEWw/zRmNJOZvhNu0QVzbYpA7d2YYVt0PB81DaB8-ol77SBSElvQ4HG2PiGA8O96qEShA4IR01"
    ],
    'moonsiren.ht': [
        // Page 1
        "https://live-backstage.tiktok.com/creators/live/union_platform_api/union/anchor/v2/get_room_list/?DisplayID=moonsiren.ht&Offset=0&Limit=20&HostID=7504516581285004309&msToken=oCEvfj-UfsknewozHA2gRTEqvTRvVB6RO2WexrfYBPEfasRocrvDQl6KzwfOckNoy70_XgV3rAYkKtmKxK5cvlwqRu-cVlUM8gtpHoZd66N1cpRNb4NRF2r0HUvX-tRQXICa6enSYQ==&X-Bogus=DFSzswVLWSJANjMQCFdW1kpJlh0J&X-Gnarly=MwyA5WHXedOUoba8-/irJEy86vKR8EopH2-99mM6n9x-auApSmQYjNlDk4TJg7mEPU1ch3rkBwh8hpC/OCyW5hGJzBvSMnBA8Ef9D22v-xuePS7kr6x67VowFT6plTG4YOXzY4gvYsrpwwUF7j/lTCBAC6QSFI99mTyWv744OivkgP5wtcaLmL4IRMjSlDvegviFuqXb0E93Ca/4yLsiDNIVuHwnKjIkPOV3QW-SaLIqYT0sdfP81bnugqkA2942N0Idg5CnllR/fhG9fKAFuo9nAzJS0UYVG/x6mi/DpKvy",
        // Page 2
        "https://live-backstage.tiktok.com/creators/live/union_platform_api/union/anchor/v2/get_room_list/?DisplayID=moonsiren.ht&Offset=20&Limit=20&HostID=7504516581285004309&msToken=pCRvV0i5PMIHinwzYorn_BpBKYaR2E1_AdEpypOX0Pg1uPfYg9pgQINN6p3yZdihmMuotKtIL_jUrjyMrG5VdgWuypFnJlKL6XLkah6P7JhUeyH8q2emwzU8Jnej_fi2Faix9EPNhQ==&X-Bogus=DFSzswVLeBbANjMQCFdWXipJlh/k&X-Gnarly=MFdEC9gwHXxg0SOfKJPYQxtHtpmOVVsjcpknxYjV/HzhFdJZFSzw9PVfTMwU4xSLYl0P-lahg70tV2y6aqkf0HufTONziTxCH8atk8LQ2m8DAoof8Cn69ccVzKJnMITyRn6L15kHvqfOyceRPvhx3Ez0WMoH9kJ2svSPWmPFyeW4p9B18HbkuXtbVByfVvF2t1-P33TO/mYfNbyz9VR9efEFgGNppHSu3ncwud1hE/owqIUPF9W9jBJtoNjxQA5N40NXXkgL-WaIcyyX5piPGEooxqp54U5c3Rtsebde2-cW",
        // Page 3
        "https://live-backstage.tiktok.com/creators/live/union_platform_api/union/anchor/v2/get_room_list/?DisplayID=moonsiren.ht&Offset=40&Limit=20&HostID=7504516581285004309&msToken=Ijcd2BdGBvtUOndAnECVJzSQF3kExk8iv47khjuHLFNCZ_1j_qg2M84739IlgPVaCqQyC7qL-SPLiNmOddV9iRJePjstqcOAaMkuhfzZ32l_DctZ_VMsr8xQLIzoOFecFgtdvdlDTw==&X-Bogus=DFSzswVLZJiANjMQCFdWMipJlh/P&X-Gnarly=M5fV8U98wlZNdAyEo3vzwo4dDkUSoelUAXJ9-XQuYeZsdrZr8RTWDRESbiO0mXQLSuYZ5RFq7T6gnL5wdqHFmm/yHV7s0GFUj4nKAyt-aGfSLFTKY7AKp6Uv2-rFST0jTquZ3xrq1XgFwrpYHJxyVlXxWyHUVxEVANLNvvTRV51AdZrHynNDsBeKq29VHsC3yyAw-2XK-Mw2ZMp1ZIO0EV2jOVfq4CI9dBbnkMdi3YUDGLqEzqIoTo1BvcU2tiTvjx-dd/Y3W2-CY4DQPB7to9DR5uJPhInAsuqF1twAKdM9"
    ],
    'lunarknight.ht': [
        // Page 1
        "https://live-backstage.tiktok.com/creators/live/union_platform_api/union/anchor/v2/get_room_list/?DisplayID=lunarknight.ht&Offset=0&Limit=20&HostID=7514528621319783441&msToken=5WWH0Uu6Kuvf1yVB7eiyCG2iCP5IhnEDwAk3nP7zSPBSZWJ1maXL4idLQll4znkPdaL0p8H6p9QJQNLpis3YGDyU32tMbEjv0a7z_YiyC4dR8NllkWq7i7I83yXKxpelLX_Mm7tsEQ==&X-Bogus=DFSzswVL32UANjMQCFd32kpJlh8N&X-Gnarly=MxSdZ5heLL2VEwDPnPoCI820eJyrAdGtorKrgZJ/7yUWK9hNU7dQ0jA7JljNNraYbtz01-48HxD7LtCLpJlzVkMnF/1iw/v2OtN39IJkWMvovmysO9mDQCrSVTVotHcjHMGakIOkYBvyATf65PPZ-BYYoWCTsl3Puvnb-pws90u7dv32KJyacMhn46r8Wmfdo9rqvu33LVXm5SbwxkeqNgsUKoZlaqDeZNiZfGM7C1EerfBIpxvg8Wx9ir4uITKqDMR/jWgijq4pP2zn3S5NrfxzHE6O5OPR0JNoEXXRE051",
        // Page 2
        "https://live-backstage.tiktok.com/creators/live/union_platform_api/union/anchor/v2/get_room_list/?DisplayID=lunarknight.ht&Offset=20&Limit=20&HostID=7514528621319783441&msToken=g7YTRYiIE4Abqcxk5AJZUx9-xuADKK-CPHuvHofd9VzUI8QbbKUUE355BdWD7vvGh3FJdWRshtbjznO2r4m1zgpw-f39kEt-RKrja6RsVO7GvFTc7vEGzvXMDks_iJU228wb46klug==&X-Bogus=DFSzswVL3ybANjMQCFd3fipJlhM2&X-Gnarly=Mxg15RjCuOFnTJGM0J3z--14HU0PMti3WVa0iphJ-gebi-Tr1RAReFHX95neA6ERiqDOnpzolBqtTp1s7kcbZO9X7ojm5qXDEl2/7NTbiAZImTJq1HKkf8k8nn3NO4d-kIjsEMq8BIJ4BJsW/sbZgY8UYZFjGX-GuZtM/Pg0uD5IGyUY8l2ff1IWj463zwhOCMZfULS/m3XSNn7ZZyAioT2tpRTVtUtGFgi9mHQnz3RtdmYm1mXqBOo70CVnL3l5HXxDhNa1uO0OySsyC4aMZvV7AGnGkYDK787OtnUHOrXb",
        // Page 3
        "https://live-backstage.tiktok.com/creators/live/union_platform_api/union/anchor/v2/get_room_list/?DisplayID=lunarknight.ht&Offset=40&Limit=20&HostID=7514528621319783441&msToken=diUX3Y4sR6CdFciL0Iyh9kpVV2XjVNyToKeeu2bXMue07rHzvpuAJi9gx7ushZvWEw0mez0V_sBPJlGil4qcto_Dc_s5U2GrlImh6_cqJrbeP7gS7BlBWE_Kn0u4jbEo7ALyx7WD5w==&X-Bogus=DFSzswVL0GXANjMQCFd3KipJlh8U&X-Gnarly=MaEJDvhOcOqYM484R4RJJ-96wwaBtN7b6/l0e2Cn/GtwQtQmTVdygo99cr/Aty0ghOm083Ca/knRJ-Z88-JtZ8w5PJ3XmTCvgHc8/fL0SvjRRI/yDfQIX8YB49qq2g2plNlHB4GRJGT5-DT3hY/9bAhnpWjUfeVak-k01FY0a1wXANKmDpzZhB-kzp7uilvIPb859u7SLMzqsA9vD3riF6em/fGIzcThCwFzDGHPSKEhbao6KntZye5kbEgGtEZ-CRggGJ1C66DmDATSzOeIE8Uj060qF7iBu7qayWTqU/Rb"
    ],
    'kayzen.ht': [
        // Page 1
        "https://live-backstage.tiktok.com/creators/live/union_platform_api/union/anchor/v2/get_room_list/?DisplayID=kayzen.ht&Offset=0&Limit=20&HostID=7483391252383581205&msToken=IchJODzjpQq-JOao1i_DfGdqDqX2wTRqFqEvYsiXoV6rAC1S7Mfzfr_QqtLqGJEJnf9l0-SncmTdq0ck4Zi66msGrpPVzpHG7xxI454_Lov9ETwS2ogC3UClh1gW9vu4k2H3P1OL4w==&X-Bogus=DFSzswVLOlzANjMQCFd3zkpJlh0a&X-Gnarly=MP3g-9P/sb6puXixmtyM24V1hom70JkJJuON0CDrRl8krQyzd9BVb7IeiUeSZqjZJI2-hWoRU401wPiHknAzPSg3TN0-wXhe8UwcRELz3Ea3cNxcIUx8XLEKUH9LaFaA48v4jIpzEV2aHHpkKtlVNpxMlqh-O/3a-42NT5ImItNfYvm0EokuH2tL2DS/em29UJcJc0n4MRgzs5u8v-idqQpnV4/yms/H6qRtonZjOvj-oBbmhQPkzaxBB0EdPTfvLP7kho1ILnHaXKpTC/cZ5oalc8XIIRwvzojkaSPz6S0o",
        // Page 2
        "https://live-backstage.tiktok.com/creators/live/union_platform_api/union/anchor/v2/get_room_list/?DisplayID=kayzen.ht&Offset=20&Limit=20&HostID=7483391252383581205&msToken=rR-UbasvHymQhcO7eqMxWthN3XmwUgGaRIhcUW6d9MFkRZlRqNJ99Wc4xtkbvdic_MUEdIFBCLYAkcLvy5GdKhxxqoPPfVM3RdCIeuWQFCLUhnXzmEPE5mnf2d3jd19wunXkD4jkwQ==&X-Bogus=DFSzswVLEvhANjMQCFd3NipJlh/p&X-Gnarly=M88zj8wSMYNgun6QUfK4mmlXTEA19ANtc24FjzoTSgKIcFK856ubPIJoVNdO2gqL9Nit6vUNtc9UWzY34gWhcrUFM37auRzlbwxE1M5/Tor512iV69v65x0m22sH6bnnp-lKJ-LU/5sUTX8K6K-8pX-PyW61rkLuw5/RbM83N8ek0me3/td/f2uq8ub0vJS8JTIBX01gT5mf1u/iXxB2h3eWizcHQ9qho6V-mBzPgaqf1RXuZBMtco9xafiC-TQIcPD7QXEabYMR/S/O0wp/9E25SBIQUDg85lNghGrnH7ga",
        // Page 3
        "https://live-backstage.tiktok.com/creators/live/union_platform_api/union/anchor/v2/get_room_list/?DisplayID=kayzen.ht&Offset=40&Limit=20&HostID=7483391252383581205&msToken=YtKUEtC6lHEq-CF0b2FsjaXiZIA0hU6dyBfGOCFXtokJwyaXryFDHuD9xUwVWezLzl7xtmEagjs3fc0_pFJskzKmPbdo6pcOEXlKBHdB06VEKGGU3ENTbhO46G-jk8YB8C_lRFrPbw==&X-Bogus=DFSzswVLFKkANjMQCFd3bJpJlh89&X-Gnarly=Mkqcj27PldoemT9pHJfU57rJOMADyzx4kBMdb6QFtUxw9IX7jbDjj4YpYLX-tSH4MjFMEqh/2xC73TR5rcRLRfIWlAGgZMmFI5yI8OzBA2qt-rDX-85459oLjNnQhXMh712RD9cGG15O5oMLK9Ixe8dYgscijFl5LhnJ4CKN8k0blclq/vR/HP0lMK/-WBaKFs6uKqkazQG2hAuzUq/MwODJaV8xZVzOC1dCDVF0f/FAybEDhlGwPHkCrcFbc5EFJhYJpe/vQ/WeFAJ4OJhAkIb4FK5x8bQNlLrKVqu3pvLsO"
    ],
    'dopamine.ht': [
        // Page 1
        "https://live-backstage.tiktok.com/creators/live/union_platform_api/union/anchor/v2/get_room_list/?DisplayID=dopamine.ht&Offset=0&Limit=20&HostID=7539782769997530132&msToken=jPDtYjWRQNbIpi5_Wxu44IPNuYlL2LmDZnSqBu8FjAad8OuD7YJmbZI6vGjRlYgBGTTxmpmwBLxZxQOmGUEygiPYM_OzltKYsm9NYlehra28TCXBKx10tKVjuV6VPxQ=&X-Bogus=DFSzswVLxhXANjMQCFdvnvpJlhM1&X-Gnarly=MOrPYT1rPp63hoE3acqVwAfLm85x0xWCxj9loE6D4wXEXJCXRNphj35AbtqrIsFGpBx7RI-UWm2cX7BdnHvskPKP1ofoCAmSBY37/bX9Y-/pbo4eUQ8QIocdw0OdE79hkM2UrClILIfwWRYWlfW-0GT8iIPzSbiGfFGEi3LFHddVXrq8em6wzLuwfBqsh7J-U3Y071PlYmg0QKeaaoOpgoDq6iHNCWdYfm1ViE9Oii9Oo95amuoqRgSw7Zbj0sfWOKyJqB282Jzd8vikuarjLzHd/WMW/oXlhu5M2SMm7j1v",
        // Page 2
        "https://live-backstage.tiktok.com/creators/live/union_platform_api/union/anchor/v2/get_room_list/?DisplayID=dopamine.ht&Offset=20&Limit=20&HostID=7539782769997530132&msToken=1F8cqWlTwrN8RuzXh_KMuLK98wFBwo94OqljVkHtJeSycWbjagFACI_YlgSViNndy1YqZ18HUpZ6YuBxmjGCGap_-WP61Uf04QrxbOP63mgLYSaUXv-xv1Fj4uek3Gg=&X-Bogus=DFSzswVLtlXANjMQCFdwakpJlh0j&X-Gnarly=MkNL6kk74IyCF7JaRpjlgR6OuuP3Dlt-C4vHm9yolC-6PT0c/3xTwqtf5/9qAcaUn716gT8hlW9G7Had1aN1ZrnalqaQG/pw3DV85isKB-k662/SNEooQws5vCEoAGoT5OnlGeTAlnyMt44Sh9uBYsN6XxOZ5-Uy44hdElkguI14roWS4xQkG-x3wXBaD7Vhv1I5wBUc8M1n3TLslGqwjnsCOo8PhL6n1y-EFcv29LEQzddEfNh0eaUSeazqagiqhDxcURYZ3dC6fSD8eAPUuBJBluw-QIoKy9c3D-xGuOxa",
        // Page 3
        "https://live-backstage.tiktok.com/creators/live/union_platform_api/union/anchor/v2/get_room_list/?DisplayID=dopamine.ht&Offset=40&Limit=20&HostID=7539782769997530132&msToken=PLLXp3-Ck2D8vtXdNqXLVG0v6Rma9VEnzAJc8bXAd-fEkgPlVcnlW9tBEbmJtaQUvzTPeK7JfBaYFaUUDEwp4SIagGV57UPB0R5DPt6hrgEcPzFQ8OQgARz7BZBqftQ=&X-Bogus=DFSzswVLrlzANjMQCFdwjipJlh0Y&X-Gnarly=McaA-bG2DoYYaUfo9BwbHp4al-KdrHSbBIn6ynjD2Ws6IzPuP5jvbJFtOFLw/QK3RpDYif3EJlYPFWmoplG70bBwxmU/A-QWF5RGPBId4Fcr23I5TqRP/4zLYR8rtgZW8KM6opdm5srRE7NDaf1BxSBJHb0-zVb8uzmbOvR4/bA4VJ67pYVTNzeCzYBT01q0rOD3PKQ-mWb4T/PgVvEnJL-QS64R/zyeLlO0KuQ8tb2qJJuL-rFJ7SRHvBdXLXFGNl1J3ZaSU9stXENNIVWb1A2zWHIxwnh7RxCZfQQbGOPb"
    ]
};

const HEADERS = {
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'en-US,en;q=0.9,vi;q=0.8,ko;q=0.7',
    'content-type': 'application/json',
    'faction-id': '100579',
    'priority': 'u=1, i',
    // 'referer': 'https://live-backstage.tiktok.com/portal/anchor/detail?activeTab=videos&enter_from=anchor_list_page&username=novix.ht',
    'sec-ch-ua': '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
    'x-appid': '1180',
    'x-csrf-token': 'undefined',
    'x-language': 'en',
    'Cookie': '_tt_enable_cookie=1; d_ticket_backstage=9eeea309e3d084424d282c62453a49c1ad737; living_device_id=53974713026; _ga_LWWPCY99PB=GS1.1.1745711106.4.0.1745711106.0.0.468963034; ttcsid=1757152821896::dGYUuRGwSFZ6Au3HBaIz.3.1757153161666; ttcsid_CQ6FR3RC77U6L0AM21H0=1757152821895::LcyqtFwwYCe4AzSTg31j.3.1757153161880; _ga_GZB380RXJX=GS2.1.s1757152821$o4$g1$t1757154275$j60$l0$h1146909479; _ga=GA1.1.GA1.1.1579992134.1737330652; _ga_GR6VLNH8D4=GS1.1.1758019820.2.1.1758019890.0.0.842071688; _ttp=33NmYLgRM2umpIAazOGsbA7U0QU; ttwid=1%7CKpigazRsSJg_axGf_WUHx6yJUS5mxacBtoqD095joCA%7C1761965283%7C04b5c1c018115a478a29e210137e033677dc707f59acae42ef08a6c31e40198b; uid_tt_backstage=0e95dd739a276318b0ffd6e5f6a82a5f86d57448a6cf0b8dc8e9a14e5160299b; uid_tt_ss_backstage=0e95dd739a276318b0ffd6e5f6a82a5f86d57448a6cf0b8dc8e9a14e5160299b; sid_tt_backstage=de82f03f829b2fc4ac0eb136f7bb6e80; sessionid_backstage=de82f03f829b2fc4ac0eb136f7bb6e80; sessionid_ss_backstage=de82f03f829b2fc4ac0eb136f7bb6e80; xgplayer_device_id=45741515781; xgplayer_user_id=39768053983; passport_csrf_token=69c77c1a55c1b0428395b27db74b0a92; passport_csrf_token_default=69c77c1a55c1b0428395b27db74b0a92; sid_guard_backstage=de82f03f829b2fc4ac0eb136f7bb6e80%7C1764917928%7C5184000%7CTue%2C+03-Feb-2026+06%3A58%3A48+GMT; tt_session_tlb_tag_backstage=sttt%7C3%7C3oLwP4KbL8SsDrE297tugP_________kkU9vZWHyZaTww883BV0QHKg246K9WSsnc_d1G6aMAnM%3D; sid_ucp_v1_backstage=1.0.1-KGFhMTdhN2RhMTc3YmE1MTEzOWMyZTI3ZmU1ZWIwYzVlZTA2NjJkYWQKIAiCiKuotPSYzmEQqIXKyQYYwTUgDDD9u-LHBjgCQO8HEAMaAm15IiBkZTgyZjAzZjgyOWIyZmM0YWMwZWIxMzZmN2JiNmU4MDJOCiD7nfgvwxfHUowqUJgL0uYZqNKOG6mEDe-3HM5-iiVhixIgnAHuSNxG3T_5qNVC9dG8oJgQE6G-Ogg8VwrQpSLosvUYAyIGdGlrdG9r; ssid_ucp_v1_backstage=1.0.1-KGFhMTdhN2RhMTc3YmE1MTEzOWMyZTI3ZmU1ZWIwYzVlZTA2NjJkYWQKIAiCiKuotPSYzmEQqIXKyQYYwTUgDDD9u-LHBjgCQO8HEAMaAm15IiBkZTgyZjAzZjgyOWIyZmM0YWMwZWIxMzZmN2JiNmU4MDJOCiD7nfgvwxfHUowqUJgL0uYZqNKOG6mEDe-3HM5-iiVhixIgnAHuSNxG3T_5qNVC9dG8oJgQE6G-Ogg8VwrQpSLosvUYAyIGdGlrdG9r; tt_chain_token=2jll77Jy0QQFNSpHHxR+EA==; multi_sids=7400790728513307666%3Adbbd730b5e17766956bfa22ced794c84; cmpl_token=AgQYAPOF_hfkTtK2ig1TVjidK_21gnQlCz-WDmCij08; sid_guard=dbbd730b5e17766956bfa22ced794c84%7C1765904372%7C15551999%7CSun%2C+14-Jun-2026+16%3A59%3A31+GMT; uid_tt=0b2b3553c0b1bfaa28d5dab7cbd0b381da111ee10ff78a9d2c5a97aa2a38a39e; uid_tt_ss=0b2b3553c0b1bfaa28d5dab7cbd0b381da111ee10ff78a9d2c5a97aa2a38a39e; sid_tt=dbbd730b5e17766956bfa22ced794c84; sessionid=dbbd730b5e17766956bfa22ced794c84; sessionid_ss=dbbd730b5e17766956bfa22ced794c84; tt_session_tlb_tag=sttt%7C5%7C271zC14XdmlWv6Is7XlMhP_________xlXaCQ5jTG8Tsbr7bR7qSHwxEkzqDt8r7zaoIpkYRjxA%3D; sid_ucp_v1=1.0.1-KDhjMTg3Y2ZjZTVhMGVkNWExZTIwNTQ0OTE3ZWM2ZTBlNDM5OTlhZmIKIgiSiKnwzf642mYQ9J-GygYYswsgDDDsyNO1BjgHQPQHSAQQAxoGbWFsaXZhIiBkYmJkNzMwYjVlMTc3NjY5NTZiZmEyMmNlZDc5NGM4NDJOCiBHNWH8-OWD5R3lHaL5CwF4hnp0nMN8fZ_URlIV0YvusBIg7O3tgXuhO6gGphtOP63EQyQG0dTvwyVepWUUNwgYgd0YAiIGdGlrdG9r; ssid_ucp_v1=1.0.1-KDhjMTg3Y2ZjZTVhMGVkNWExZTIwNTQ0OTE3ZWM2ZTBlNDM5OTlhZmIKIgiSiKnwzf642mYQ9J-GygYYswsgDDDsyNO1BjgHQPQHSAQQAxoGbWFsaXZhIiBkYmJkNzMwYjVlMTc3NjY5NTZiZmEyMmNlZDc5NGM4NDJOCiBHNWH8-OWD5R3lHaL5CwF4hnp0nMN8fZ_URlIV0YvusBIg7O3tgXuhO6gGphtOP63EQyQG0dTvwyVepWUUNwgYgd0YAiIGdGlrdG9r; store-idc=alisg; store-country-code=vn; store-country-code-src=uid; tt-target-idc=alisg; tt-target-idc-sign=FfysjRNNGhb2QnCbXOTYGND5dVuo23gPJztwgOrPAnWm4zqRp2UoBnzjrOx86VCWTekbdNdCdXmOFrxqzVMO5LyyhxQ4XvdomnKtOG0XgNMFkwpQD9yxCIWY0ntWCSxZCt8Blx-UWVmdgdBEdFSxP5ZGeb5Z9AyRsza0O_-N_0icZiVZcgVLAeQHKZKaWcsX4kuuWMb90CmaBL11q30u-LAwLY6hpWZXGqlRxWlqMjTfUcj9VcF5kkk5UbrLt-XV52IYqiYxpqtXnxFHCtaYQ6UQ53gl6US_XPTxMnZnACqitMLu0Ert58HPMZfxpy-T9OwdScsw3bLJiLgrrqd3nvgogpr6ADBn1IeMtuqVd1RSIdZChroR0M4hZm4xzBWi7qwPdb3ubo0-k_LpVzuvZddgpwKw_zoqGg9G8pkKjE84yKvv4Nhzs23yXq8i_DlG3zOMk2_DYkrsqFimftv3dWQVTWHiFwxYnuFFkzQ_wKKlB5MpicOCLnXym40N6BgL; store-country-sign=MEIEDHDsvhQxJ8-s4_2X3wQgz5LyTBM71UHtbBQwIHKCcvw2j9b6GM8ZnF1pt-3xvzUEECxq9Nxm1aKUOYQBjOvYHzE; odin_tt=fbd86986b06447d07266a168b5b3e2baa5a7c51ba53e004aec15dec498c40c2e12348e6e8b0b47919bb78052be6d94b569892cf15f1a1fd8da34f44f2868ff82; s_v_web_id=verify_mj9ora8v_xHHNImus_TLsw_4xMC_AjEo_qajhcbxYJ4xN; tcn-target-idc=alisg; csrf_session_id=59d12384e8e417d791f00d7bef6ceb0b; passport_fe_beating_status=true; msToken=yl8ipGjDJdb8LFgS6JfZj-OhPMvBjHGxAFKE2yBUrH8MkSgauwmLd3D-BBdMy6EJfYvu2E439s7PtuNNM7CBPhFnDqhwMHwH2gVqwJUBfTdI_atRURML9JdxbSC_hQE=; msToken=yl8ipGjDJdb8LFgS6JfZj-OhPMvBjHGxAFKE2yBUrH8MkSgauwmLd3D-BBdMy6EJfYvu2E439s7PtuNNM7CBPhFnDqhwMHwH2gVqwJUBfTdI_atRURML9JdxbSC_hQE=; msToken=mu912rpHCbJsKXVwV4-q-HUCqkUhy3qVz8hza6UEcpoAZM7nTFzTZUR-B7OXeiP_wWsIYo3WqtgOyzG_3GVcspKTc2Xf4U8GEC4kSsxC9lXcc87zrOWZWhi9slISHps='
};

// --- CACHE & TIMERS ---
// GLOBAL_CACHE stores the data for all creators to serve requests instantly.
// Structure: { [displayId]: { id, name, username, avatar, monthlyScore, dailyScore } }
const GLOBAL_CACHE = {};

const REFRESH_SCORES_INTERVAL = 30 * 60 * 1000; // 30 minutes
const REFRESH_PROFILES_INTERVAL = 12 * 60 * 60 * 1000; // 12 hours

// --- IN-MEMORY STATE FOR DAILY ENDPOINT ---
// We use a global object to persist daily data across different requests/devices.
let dailyState = {
    history: {}, // { [CreatorID]: { profile: {name, username, avatar}, rooms: { [RoomID]: maxScore } } }
    lastDate: null // Initialize as null, will be set in init or process
};

// --- HELPER FUNCTIONS ---

// --- HELPER: Get Timestamps in GMT+7 with Custom Offset ---
// Returns:
// monthStart: First day of current month at 00:00 (Standard)
// dayStart: Current "Daily" start at {resetHour}:00 today (or yesterday if currently before {resetHour})
const getTimestampsGMT7 = (resetHour = 6) => {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));

    // Start of Month (For Monthly) - Stays standard 1st of month 00:00
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);

    // Start of Day (For Daily) - Resets at resetHour:00 AM
    let startOfDay = new Date(now);
    startOfDay.setHours(resetHour, 0, 0, 0);

    // If current time is before reset hour, the "day" started yesterday
    if (now < startOfDay) {
        startOfDay.setDate(startOfDay.getDate() - 1);
    }

    return {
        monthStart: Math.floor(startOfMonth.getTime() / 1000),
        dayStart: Math.floor(startOfDay.getTime() / 1000),
        todayDateStr: now.toLocaleDateString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' })
    };
};

// --- HELPER: Get Logical Date String for Daily Reset (Custom cutoff) ---
const getLogicalDailyDate = (resetHour = 6) => {
    // Current time in VN
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));

    // If before resetHour, count as previous date string
    if (now.getHours() < resetHour) {
        now.setDate(now.getDate() - 1);
    }
    return now.toLocaleDateString('en-US');
};

// --- HELPER: Initialize Daily History with 0 scores ---
// Ensures all allowed creators appear on the list even if they haven't streamed yet today
const initializeDailyHistory = () => {
    console.log(`[${new Date().toLocaleTimeString()}] 🧹 Initializing/Resetting Daily History...`);
    dailyState.history = {}; // Clear old data

    // Loop through all configured creators
    for (const [displayId, creatorId] of Object.entries(ALLOWED_CREATOR_IDS)) {
        // Try to grab existing profile info from global cache if available
        const cachedProfile = GLOBAL_CACHE[displayId];
        // Get default info (capitalized name)
        const defaultInfo = DEFAULT_CREATOR_INFO[displayId] || {
            name: displayId.replace('.ht', '').toUpperCase()
        };

        dailyState.history[creatorId] = {
            profile: {
                id: creatorId,
                username: displayId, // Default to config key
                name: cachedProfile?.name || defaultInfo.name, // Use cached name or default capitalized
                avatar: cachedProfile?.avatar || getAvatarPath(displayId) // Use cached avatar or dynamic fallback (JPEG -> SVG)
            },
            rooms: {} // Empty rooms = 0 score
        };
    }
};

// Initialize lastDate on startup with default 6 AM
dailyState.lastDate = getLogicalDailyDate(6);



// --- HELPER: Scrape User Profile using Fetch (Public Page) ---
const scrapeUserProfile = async (username) => {
    const cleanUsername = username.replace('@', '');
    const profileUrl = `https://www.tiktok.com/@${cleanUsername}`;

    try {
        console.log(`[DEBUG] Fetching profile for ${cleanUsername} at ${profileUrl}...`);

        const response = await fetch(profileUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Cookie': `sessionid=${process.env.TIKTOK_SESSION_ID || ''}`
            }
        });

        if (!response.ok) {
            console.error(`[ERROR] TikTok responded with ${response.status} for ${cleanUsername}`);
            return null;
        }

        const html = await response.text();
        let targetUser = null;

        // Strategy 1: Try to parse from __UNIVERSAL_DATA_FOR_REHYDRATION__ script
        const rehydrationMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.*?)<\/script>/s);
        if (rehydrationMatch && rehydrationMatch[1]) {
            try {
                const rehydrationData = JSON.parse(rehydrationMatch[1]);
                const defaultScope = rehydrationData["__DEFAULT_SCOPE__"];
                if (defaultScope) {
                    const userDetail = defaultScope["webapp.user-detail"];
                    if (userDetail && userDetail.userInfo && userDetail.userInfo.user) {
                        targetUser = userDetail.userInfo.user;
                    }
                }
            } catch (e) {
                console.log('[TikTokAPI] Failed to parse __UNIVERSAL_DATA_FOR_REHYDRATION__', e.message);
            }
        }

        // Strategy 2: Try SIGI_STATE script
        if (!targetUser) {
            const sigiMatch = html.match(/<script id="SIGI_STATE" type="application\/json">(.*?)<\/script>/s);
            if (sigiMatch && sigiMatch[1]) {
                try {
                    const sigiData = JSON.parse(sigiMatch[1]);
                    const userModule = sigiData.UserModule;
                    if (userModule && userModule.users && userModule.users[cleanUsername]) {
                        targetUser = userModule.users[cleanUsername];
                    }
                } catch (e) {
                    console.log('[TikTokAPI] Failed to parse SIGI_STATE', e.message);
                }
            }
        }

        // Strategy 3: Regex search for userInfo structure
        if (!targetUser) {
            const userMatch = html.match(/"userInfo"\s*:\s*\{\s*"user"\s*:\s*(\{.+?\})\s*,\s*"stats"/s);
            if (userMatch && userMatch[1]) {
                try {
                    targetUser = JSON.parse(userMatch[1]);
                } catch (e) {
                    console.log('[TikTokAPI] Failed to parse userInfo regex match', e.message);
                }
            }
        }

        // Strategy 4: Try webapp.user-detail pattern
        if (!targetUser) {
            const hydrationMatch = html.match(/"webapp\.user-detail"\s*:\s*(\{.+?"userInfo".+?\})(?=,\s*"webapp)/s);
            if (hydrationMatch && hydrationMatch[1]) {
                try {
                    const detail = JSON.parse(hydrationMatch[1]);
                    if (detail.userInfo && detail.userInfo.user) {
                        targetUser = detail.userInfo.user;
                    }
                } catch (e) {
                    console.log('[TikTokAPI] Failed to parse webapp.user-detail', e.message);
                }
            }
        }

        if (!targetUser) {
            console.warn(`[WARN] Failed to extract profile data for ${cleanUsername}`);
            return null;
        }

        // Extract info - prioritize avatarLarger for high resolution
        const { uniqueId, nickname, avatarLarger, avatarMedium, avatarThumb } = targetUser;
        const avatar = avatarLarger || avatarMedium || avatarThumb;

        console.log(`[INFO] Scrape Success ${cleanUsername} -> Name: ${nickname}`);
        return {
            name: nickname,
            username: uniqueId || cleanUsername,
            avatar: avatar
        };

    } catch (e) {
        console.error(`[ERROR] Error scraping profile for ${username}:`, e.message);
        return null;
    }
};

// --- HELPER: Fetch Data for Single Creator (API Only) ---
// This function now ONLY fetches stats and basic info. It does NOT call scraping.
const fetchCreatorStats = async (displayId, urls, resetHour = 6) => {
    const { monthStart, dayStart } = getTimestampsGMT7(resetHour);
    console.log(`[DEBUG] Fetching stats for ${displayId} (Reset Hour: ${resetHour})...`);

    let monthlyTotal = 0;
    let dailyTotal = 0;

    // Initialize profile placeholder with default info
    const defaultInfo = DEFAULT_CREATOR_INFO[displayId] || {
        name: displayId.replace('.ht', '').toUpperCase()
    };
    let profile = {
        id: ALLOWED_CREATOR_IDS[displayId] || 'unknown-id',
        username: displayId,
        name: defaultInfo.name,
        avatar: getAvatarPath(displayId) // Dynamic fallback: JPEG if exists, else SVG
    };

    // Iterate through pre-configured URLs (Page 1, 2, 3)
    for (const [index, url] of urls.entries()) {
        if (!url) continue;

        try {
            const response = await fetch(url, { method: 'GET', headers: HEADERS });

            if (!response.ok) {
                console.error(`[ERROR] Failed to fetch ${displayId} Page ${index + 1}: ${response.status}`);
                continue;
            }

            const text = await response.text();
            if (!text) continue;

            let json;
            try {
                json = JSON.parse(text);
            } catch (e) {
                console.error(`[ERROR] Failed to parse JSON for ${displayId}: ${text.substring(0, 100)}...`);
                continue;
            }

            // 1. Extract Profile from API (Basic Info only)
            if (json.data?.HostBaseInfoMap) {
                const firstKey = Object.keys(json.data.HostBaseInfoMap)[0];
                if (firstKey) {
                    const info = json.data.HostBaseInfoMap[firstKey];
                    // Update basic info, but DO NOT touch avatar (we want high-res only)
                    profile.id = info.CreatorID || profile.id;
                    profile.name = info.nickname || profile.name;
                }
            }

            // 2. Process Rooms
            const rooms = json.data?.RoomIndicatorInfo || [];

            for (const room of rooms) {
                const startTime = parseInt(room.StartTime, 10);
                const diamonds = parseInt(room.room_live_income_diamond_1d?.Value || '0', 10);

                // Accumulate Monthly
                if (startTime >= monthStart) {
                    monthlyTotal += diamonds;
                }

                // Accumulate Daily using the passed resetHour logic (dayStart)
                if (startTime >= dayStart) {
                    dailyTotal += diamonds;
                }
            }

        } catch (e) {
            console.error(`[ERROR] Error processing URL for ${displayId}:`, e.message);
        }
    }

    return {
        profile,
        monthlyScore: monthlyTotal,
        dailyScore: dailyTotal
    };
};

// --- SCHEDULED TASKS ---

// 1. Update Scores (Runs every 30 mins) with DEFAULT reset hour (6)
const updateAllScores = async () => {
    console.log(`[${new Date().toLocaleTimeString()}] 🔄 Starting Scheduled Score Update...`);

    // We can run these in parallel as they are lightweight API calls
    const promises = Object.entries(CREATOR_URLS).map(async ([displayId, urls]) => {
        const data = await fetchCreatorStats(displayId, urls, 6); // Default 6 AM reset for cache

        // Initialize cache entry if needed with default values
        const defaultInfo = DEFAULT_CREATOR_INFO[displayId] || { name: displayId.toUpperCase().replace('.HT', ''), avatar: null };
        if (!GLOBAL_CACHE[displayId]) {
            GLOBAL_CACHE[displayId] = {
                id: data.profile.id,
                username: data.profile.username,
                name: defaultInfo.name,
                avatar: defaultInfo.avatar
            };
        }

        // Update stats
        GLOBAL_CACHE[displayId].monthlyScore = data.monthlyScore;
        GLOBAL_CACHE[displayId].dailyScore = data.dailyScore;

        // Update id/username if missing
        if (!GLOBAL_CACHE[displayId].id) {
            GLOBAL_CACHE[displayId].id = data.profile.id;
            GLOBAL_CACHE[displayId].username = data.profile.username;
        }
        // Name stays as default unless Puppeteer updates it later
        // Avatar stays as local default unless Puppeteer scrapes high-res
    });

    await Promise.all(promises);
    console.log(`[${new Date().toLocaleTimeString()}] ✅ Score Update Complete.`);
};

// 2. Update Profiles (Runs every 12 hours)
const updateAllProfiles = async () => {
    console.log(`[${new Date().toLocaleTimeString()}] 📸 Starting Scheduled Profile Scrape...`);
    const creators = Object.keys(CREATOR_URLS);

    // Process sequentially to save memory/CPU since Puppeteer is heavy
    for (const displayId of creators) {
        try {
            const profileData = await scrapeUserProfile(displayId);

            if (profileData) {
                if (!GLOBAL_CACHE[displayId]) GLOBAL_CACHE[displayId] = {};

                // Save scraped profile data to cache
                if (profileData.name) GLOBAL_CACHE[displayId].name = profileData.name;
                if (profileData.username) GLOBAL_CACHE[displayId].username = profileData.username;

                // Download and save the scraped avatar to disk as JPEG
                // This replaces the default avatar with the high-res scraped one
                if (profileData.avatar) {
                    const saved = await downloadAndSaveAvatar(displayId, profileData.avatar);
                    if (saved) {
                        // Update cache to use local path (not the CDN URL which expires)
                        const baseName = displayId.replace('.ht', '');
                        GLOBAL_CACHE[displayId].avatar = `/avatars/${baseName}.jpeg`;
                    }
                }

                // Ensure ID is present (fallback to config if API update hasn't run)
                if (!GLOBAL_CACHE[displayId].id) GLOBAL_CACHE[displayId].id = ALLOWED_CREATOR_IDS[displayId];

                // --- ALSO UPDATE dailyState.history immediately ---
                const creatorId = ALLOWED_CREATOR_IDS[displayId];
                if (creatorId && dailyState.history[creatorId]) {
                    if (profileData.name) dailyState.history[creatorId].profile.name = profileData.name;
                    // Use local avatar path (already downloaded)
                    if (GLOBAL_CACHE[displayId].avatar) {
                        dailyState.history[creatorId].profile.avatar = GLOBAL_CACHE[displayId].avatar;
                    }
                }

                console.log(`[INFO] Cache updated for ${displayId} (Name: ${profileData.name}, Avatar: ${GLOBAL_CACHE[displayId].avatar || 'None'})`);
            }
        } catch (e) {
            console.error(`[ERROR] Failed to scrape ${displayId}:`, e.message);
        }

        // Small delay between scrapes to be polite
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    console.log(`[${new Date().toLocaleTimeString()}] ✅ Profile Scrape Complete.`);
};

// 2. Process Daily Data (Accumulation Logic for 'daily' type endpoint)
const processDailyData = (rawData, resetHour = 6) => {
    // Check for Day Reset using passed Reset Hour Logic
    const currentLogicalDate = getLogicalDailyDate(resetHour);

    // If it's a new "logical" day (past resetHour), reset history
    // NOTE: This global reset might affect other users if multiple people use different hours.
    // For single-user deployment, this is acceptable.
    if (currentLogicalDate !== dailyState.lastDate) {
        console.log(`[${new Date().toLocaleTimeString()}] 🌅 Reset time (${resetHour}h) passed! Resetting daily history.`);
        initializeDailyHistory();
        dailyState.lastDate = currentLogicalDate;
    }

    // Safety check: if history is empty (e.g. first run), fill it
    if (Object.keys(dailyState.history).length === 0) {
        initializeDailyHistory();
    }

    if (!rawData?.data?.LiveAnchorInfos || !rawData?.data?.HostBaseInfoMap) {
        return generateDailyListFromHistory();
    }

    const { LiveAnchorInfos, HostBaseInfoMap } = rawData.data;

    // Update History with new data
    LiveAnchorInfos.forEach(info => {
        const hostInfo = HostBaseInfoMap[info.HostID];
        if (!hostInfo) return;

        const creatorId = hostInfo.CreatorID;
        // Correct check for Object values
        if (!Object.values(ALLOWED_CREATOR_IDS).includes(creatorId)) return;

        // Initialize Creator in History if new (shouldn't happen if init ran, but safe to keep)
        if (!dailyState.history[creatorId]) {
            const configDisplayId = Object.keys(ALLOWED_CREATOR_IDS).find(key => ALLOWED_CREATOR_IDS[key] === creatorId);
            dailyState.history[creatorId] = {
                profile: {
                    name: hostInfo.nickname,
                    username: hostInfo.display_id,
                    avatar: null // Will be filled below
                },
                rooms: {}
            };
        }

        // Update Profile logic: Prefer Cached High-Res Avatar
        const configDisplayId = Object.keys(ALLOWED_CREATOR_IDS).find(key => ALLOWED_CREATOR_IDS[key] === creatorId);
        let avatarToUse = null;

        // 1. Try High-Res Scraped Avatar from Cache
        if (configDisplayId && GLOBAL_CACHE[configDisplayId] && GLOBAL_CACHE[configDisplayId].avatar) {
            avatarToUse = GLOBAL_CACHE[configDisplayId].avatar;
        }

        // 2. Fallback to local default avatar if cache is empty
        if (!avatarToUse && configDisplayId) {
            // Use dynamic getAvatarPath() to check JPEG first, then SVG
            avatarToUse = getAvatarPath(configDisplayId);
        }

        dailyState.history[creatorId].profile = {
            name: hostInfo.nickname,
            username: hostInfo.display_id,
            avatar: avatarToUse
        };

        // Parse Diamond Score
        const diamondIndicator = info.RoomIndicators.find(ind => ind.IndicatorName === "room_live_send_gift_diamond_cnt_f0d0htn");
        const currentDiamonds = diamondIndicator ? parseInt(diamondIndicator.Value, 10) : 0;

        // Update Room Score
        dailyState.history[creatorId].rooms[info.RoomID] = currentDiamonds;
    });

    return generateDailyListFromHistory();
};

const generateDailyListFromHistory = () => {
    const list = Object.keys(dailyState.history).map(creatorId => {
        const entry = dailyState.history[creatorId];

        // Calculate total across all rooms seen today
        const totalScore = Object.values(entry.rooms).reduce((sum, val) => sum + val, 0);

        // --- FIX: LOOKUP CACHE FOR AVATAR ---
        // We check GLOBAL_CACHE using the username (displayId) to see if a high-res avatar 
        // has been found since the server started/initialized.
        const cachedProfile = GLOBAL_CACHE[entry.profile.username];

        // Get default info as ultimate fallback
        const defaultInfo = DEFAULT_CREATOR_INFO[entry.profile.username] || {
            name: entry.profile.username.toUpperCase().replace('.HT', '')
        };

        // Priority for Avatar: 
        // 1. Cached High-Res Avatar (from Scraper)
        // 2. Existing History Avatar (from API/Init)
        // 3. Dynamic fallback via getAvatarPath() (JPEG if exists, else SVG)
        const finalAvatar = cachedProfile?.avatar || entry.profile.avatar || getAvatarPath(entry.profile.username);

        // Priority for Name:
        // 1. Cached name (from Scraper)
        // 2. Existing History name
        // 3. Default capitalized name (e.g., NOVIX)
        const finalName = cachedProfile?.name || entry.profile.name || defaultInfo.name;

        return {
            id: creatorId,
            name: finalName,
            username: entry.profile.username,
            avatar: finalAvatar,
            score: totalScore,
            trend: 'flat'
        };
    });

    // Sort by score descending
    return list.sort((a, b) => b.score - a.score);
};


// --- ROUTE HANDLER ---
app.get('/api/leaderboard', async (req, res) => {
    const type = req.query.type || 'monthly';
    // Get optional resetHour from query, default to 6
    const resetHour = parseInt(req.query.resetHour) || 6;

    // --- NEW MONTHLY LOGIC (SERVED FROM CACHE OR FETCH IF CUSTOM HOUR) ---
    if (type === 'monthly') {
        try {
            // If the requested resetHour matches our default cache interval (6), serve from cache
            if (resetHour === 6) {
                const processedData = Object.entries(ALLOWED_CREATOR_IDS)
                    .map(([displayId, creatorId]) => {
                        const cached = GLOBAL_CACHE[displayId] || {};
                        const defaultInfo = DEFAULT_CREATOR_INFO[displayId] || {
                            name: displayId.toUpperCase().replace('.HT', '')
                        };
                        return {
                            id: creatorId,
                            name: cached.name || defaultInfo.name,
                            username: displayId,
                            avatar: cached.avatar || getAvatarPath(displayId),
                            score: cached.monthlyScore || 0,
                            trend: 'flat'
                        };
                    })
                    .sort((a, b) => b.score - a.score);
                return res.json({ data: processedData });
            } else {
                // If custom hour, we must recalculate daily scores for the monthly endpoint 
                // (Note: Monthly score itself doesn't change based on daily reset, but dailyScore field does)
                // Since user asked for "Refresh daily leaderboard", they might be looking at daily tab.
                // But for completeness, let's fetch fresh stats if needed.
                const promises = Object.entries(CREATOR_URLS).map(([displayId, urls]) =>
                    fetchCreatorStats(displayId, urls, resetHour)
                );

                const results = await Promise.all(promises);

                // Merge with profile info from cache to get avatars
                const processedData = results
                    .filter(item => item && item.profile)
                    .map(item => {
                        const cached = GLOBAL_CACHE[item.profile.username] || {};
                        const defaultInfo = DEFAULT_CREATOR_INFO[item.profile.username] || {
                            name: item.profile.username.toUpperCase().replace('.HT', '')
                        };
                        return {
                            id: item.profile.id,
                            name: cached.name || item.profile.name || defaultInfo.name,
                            username: item.profile.username,
                            avatar: cached.avatar || item.profile.avatar || getAvatarPath(item.profile.username),
                            score: item.monthlyScore, // This logic returns monthlyScore
                            trend: 'flat'
                        };
                    })
                    .sort((a, b) => b.score - a.score);

                return res.json({ data: processedData });
            }


        } catch (error) {
            console.error('Monthly Data Error:', error.message);
            return res.status(500).json({ error: 'Internal Server Error', message: error.message });
        }
    }

    // --- EXISTING DAILY LOGIC ---
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
    };
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

        const json = JSON.parse(text);
        let processedData = [];

        if (type === 'daily') {
            processedData = processDailyData(json, resetHour);
        }

        res.json({ data: processedData });

    } catch (error) {
        console.error('Server Error:', error.message);
        res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
});

// --- SERVER STARTUP ---
// Trigger initial updates immediately so cache is populated on start
console.log(`[${new Date().toLocaleTimeString()}] 🚀 Server Starting... Initializing Cache.`);
initializeDailyHistory(); // Ensure initial daily list is populated
updateAllScores().then(() => console.log('✅ Initial Score Update Done.'));
// Profile scrape takes longer, run it in background
updateAllProfiles();

// Set Intervals for Periodic Updates
setInterval(updateAllScores, REFRESH_SCORES_INTERVAL); // Every 30 mins
setInterval(updateAllProfiles, REFRESH_PROFILES_INTERVAL); // Every 12 hours

// Catch-all route for React app (must be after API routes)
if (process.env.NODE_ENV === 'production') {
    app.get(/.*/, (req, res) => {
        res.sendFile(path.join(__dirname, 'build', 'index.html'));
    });
}

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Backend Server running at http://0.0.0.0:${PORT}`);
    if (process.env.NODE_ENV === 'production') {
        console.log(`📦 Serving React build from /build folder`);
    }
});