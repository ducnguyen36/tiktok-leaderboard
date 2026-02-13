const fs = require('fs');

const usernames = [
    "silvercrystal888", "linhnhi2903", "channe0306", "tqi.04", "selene2410",
    "phwnthuy", "nyn2f", "kz_carooo", "kz_krys", "kz_pudy.fwfw",
    "kzblue_52", "kz_mikeyyy", "bunboholic247", "hissin25", "dlee10109999",
    "minluong89", "__bintran99", "shin.nosukee", "hoithanh83", "soyaaaa.ah",
    "wina.here", "laylaizme", "la.isyne", "ni3tui", "jyan.52hz",
    "nellrrel", "zii.zuu20.03", "htr_lucia", "katie.0712", "eddie.ht"
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchAvatar(username) {
    if (!username) return;

    // Clean the username
    const cleanUsername = username.toString().replace('@', '').trim();
    const url = `https://www.tiktok.com/@${cleanUsername}`;

    try {
        console.log(`Fetching ${cleanUsername}...`);
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5'
            },
        });

        if (!response.ok) {
            console.log(`Failed to fetch ${cleanUsername}: ${response.status}`);
            return null;
        }

        const html = await response.text();

        // Strategy: Look for the 'avatarLarger' key in the universal state JSON
        // The URL in the JSON might use Unicode escapes (e.g., \u002F for /)
        const regex = /"avatarLarger":"([^"]+)"/;
        const match = html.match(regex);

        if (match && match[1]) {
            // Decode the JSON string to handle escapes like \u002F
            try {
                const rawUrl = JSON.parse(`"${match[1]}"`);
                console.log(`Found URL for ${cleanUsername}`);
                return rawUrl;
            } catch (e) {
                console.log(`Error parsing JSON for ${cleanUsername}: ${e.message}`);
                return null;
            }
        } else {
            console.log(`Avatar not found for ${cleanUsername}`);
            return null;
        }

    } catch (err) {
        console.log(`Error processing ${cleanUsername}: ${err.message}`);
        return null;
    }
}

(async () => {
    // Clear the file individually first if you want fresh results, or just append
    fs.writeFileSync('avatar_urls.csv', 'Username,Avatar URL\n');

    for (const user of usernames) {
        const avatarUrl = await fetchAvatar(user);
        if (avatarUrl) {
            fs.appendFileSync('avatar_urls.csv', `${user},${avatarUrl}\n`);
        } else {
            fs.appendFileSync('avatar_urls.csv', `${user},NOT_FOUND\n`);
        }

        // Random delay between 1 and 3 seconds to be polite
        const delay = Math.floor(Math.random() * 2000) + 1000;
        await sleep(delay);
    }
    console.log("Done! Check avatar_urls.csv");
})();