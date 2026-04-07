require('dotenv').config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { MongoClient } = require('mongodb');

async function main() {
    const c = new MongoClient(process.env.MONGODB_URI);
    await c.connect();
    const db = c.db('helioscontrol');

    const resetHour = 6;
    const now = new Date();

    const dailyStart = new Date(now);
    dailyStart.setHours(resetHour, 0, 0, 0);
    if (now < dailyStart) dailyStart.setDate(dailyStart.getDate() - 1);

    const monthlyStart = new Date(now.getFullYear(), now.getMonth(), 1, resetHour, 0, 0, 0);

    const totalGifts = await db.collection('gifts').countDocuments();
    const dailyGifts = await db.collection('gifts').countDocuments({ timeStamp: { $gte: dailyStart.getTime() } });
    const monthlyGifts = await db.collection('gifts').countDocuments({ timeStamp: { $gte: monthlyStart.getTime() } });

    console.log('=== DEBUG INFO ===');
    console.log('Timezone:', Intl.DateTimeFormat().resolvedOptions().timeZone);
    console.log('Now:', now.toString());
    console.log('Daily start:', dailyStart.toString(), '| ms:', dailyStart.getTime());
    console.log('Monthly start:', monthlyStart.toString(), '| ms:', monthlyStart.getTime());
    console.log('Gift counts:', { total: totalGifts, daily: dailyGifts, monthly: monthlyGifts });

    // Check earliest gift timestamp
    const earliest = await db.collection('gifts').find().sort({ timeStamp: 1 }).limit(1).toArray();
    if (earliest.length) {
        console.log('Earliest gift:', new Date(earliest[0].timeStamp).toString(), '| ms:', earliest[0].timeStamp);
    }

    await c.close();
}
main().catch(e => console.error(e.message));
