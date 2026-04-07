require('dotenv').config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { MongoClient } = require('mongodb');

async function main() {
    const c = new MongoClient(process.env.MONGODB_URI);
    await c.connect();
    const db = c.db('helioscontrol');

    const profiles = await db.collection('profiles').find().toArray();
    profiles.forEach(p => {
        console.log(`\n=== Profile: ${p.name} ===`);
        console.log('talents type:', typeof p.talents, Array.isArray(p.talents) ? 'array' : '');
        // Show raw structure
        if (p.talents) {
            const entries = Array.isArray(p.talents) ? p.talents : Object.entries(p.talents);
            console.log('talents sample:', JSON.stringify(entries.slice ? entries.slice(0, 2) : entries, null, 2));
        }
    });

    await c.close();
}
main().catch(e => console.error(e.message));
