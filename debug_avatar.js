const fs = require('fs');

try {
    const html = fs.readFileSync('tiktok_response.html', 'utf8');
    const index = html.indexOf('avatarLarger');
    if (index !== -1) {
        console.log("Found 'avatarLarger' at index:", index);
        // Print 100 chars before and after
        const start = Math.max(0, index - 50);
        const end = Math.min(html.length, index + 200);
        console.log("Context:");
        console.log(html.substring(start, end));
    } else {
        console.log("'avatarLarger' not found in file.");
    }
} catch (err) {
    console.error("Error reading file:", err);
}
