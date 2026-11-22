const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createLeaderboardAuth } = require('../leaderboardAuth');

const memory = () => {
  const records = new Map();
  return {
    async get(id) { return records.get(id) || null; }, async put(r) { records.set(r._id, r); }, async remove(id) { records.delete(id); },
    async consume(id) { const v = records.get(id); records.delete(id); return v || null; }, async limit() { return true; },
    async devices() { return []; }, async touch() {}, async approve() { return false; }, async setPair() { return false; }
  };
};

async function app(t, extraOrigins) {
  const provider = { generateAuthUrl: p => 'https://accounts.google.com/auth?' + new URLSearchParams(p) };
  const auth = createLeaderboardAuth({ getDb: () => null, googleClient: provider, store: memory(),
    config: { publicOrigin: 'https://ranking.heliostalent.online', extraOrigins, googleClientId: 'c', googleClientSecret: 's', adminEmails: ['a@b.c'] } });
  const a = express(); a.use(auth.middleware);
  const server = a.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(() => server.close());
  const redirectFor = headers => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: '/auth/google', headers }, res => {
      res.resume(); resolve(new URL(res.headers.location).searchParams.get('redirect_uri'));
    }).on('error', reject);
  });
  return { auth, redirectFor };
}

test('Google sign-in comes back to the name the browser used, if it is an allowed one', async t => {
  const { redirectFor } = await app(t, ['https://heliostalent.dscloud.biz:45050']);
  assert.equal(await redirectFor({ host: 'heliostalent.dscloud.biz:45050' }), 'https://heliostalent.dscloud.biz:45050/auth/google/callback');
  assert.equal(await redirectFor({ host: 'ranking.heliostalent.online' }), 'https://ranking.heliostalent.online/auth/google/callback');
  // a reverse proxy that rewrites Host but forwards the original name
  assert.equal(await redirectFor({ host: '192.168.1.20:5050', 'x-forwarded-host': 'heliostalent.dscloud.biz:45050' }), 'https://heliostalent.dscloud.biz:45050/auth/google/callback');
  // any other name falls back to the main origin
  assert.equal(await redirectFor({ host: 'evil.example' }), 'https://ranking.heliostalent.online/auth/google/callback');
});

test('no extra origins: everything uses the main origin', async t => {
  const { auth, redirectFor } = await app(t, []);
  assert.equal(await redirectFor({ host: 'heliostalent.dscloud.biz:45050' }), 'https://ranking.heliostalent.online/auth/google/callback');
  assert.equal(auth.origin, 'https://ranking.heliostalent.online');
});
