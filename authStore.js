function createAuthStore(getDb) {
  let indexedDb, indexPromise;
  async function collection() {
    const db = getDb();
    if (!db) throw new Error('Authentication store unavailable');
    if (db !== indexedDb) {
      indexedDb = db;
      indexPromise = db.collection('leaderboard_access').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
        .catch(error => { indexedDb = null; throw error; });
    }
    await indexPromise;
    return db.collection('leaderboard_access');
  }
  return {
    async get(id) { return (await collection()).findOne({ _id: id }); },
    async put(record) { await (await collection()).replaceOne({ _id: record._id }, record, { upsert: true }); },
    async consume(id, now) { return (await collection()).findOneAndDelete({ _id: id, expiresAt: { $gt: now } }); },
    async approve(id, now, values, pairId) {
      const result = await (await collection()).updateOne({ _id: id, kind: 'pending', pairId, expiresAt: { $gt: now } }, { $set: values });
      return result.modifiedCount === 1;
    },
    async setPair(id, pairId, now, previousPairId) {
      const result = await (await collection()).updateOne({ _id: id, kind: 'pending', pairId: previousPairId ?? { $exists: false }, expiresAt: { $gt: now } }, { $set: { pairId } });
      return result.modifiedCount === 1;
    },
    async remove(id) { await (await collection()).deleteOne({ _id: id }); },
    async devices(now) { return (await collection()).find({ kind: 'device', expiresAt: { $gt: now } }).sort({ lastSeen: -1 }).toArray(); },
    async touch(id, now) { await (await collection()).updateOne({ _id: id }, { $set: { lastSeen: now } }); },
    async limit(id, max, now) {
      const window = Math.floor(+now / 60000);
      const record = await (await collection()).findOneAndUpdate(
        { _id: `${id}:${window}` },
        { $inc: { count: 1 }, $setOnInsert: { kind: 'rate', expiresAt: new Date((window + 2) * 60000) } },
        { upsert: true, returnDocument: 'after' }
      );
      return record.count <= max;
    }
  };
}
module.exports = { createAuthStore };
