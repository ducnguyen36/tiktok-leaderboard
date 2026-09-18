const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const QRCode = require('qrcode');
const { createAuthStore } = require('./authStore');
const TEN_MINUTES = 600000, ADMIN_LIFETIME = 12 * 3600000, DEVICE_LIFETIME = 180 * 86400000;
const COOKIE = 'helios_access', FLOW_COOKIE = 'helios_oauth';
const DEFAULT_ADMIN_EMAILS = 'ducnguyen36@gmail.com,heliostalentofficial@gmail.com,kimlinh727@gmail.com';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const random = () => crypto.randomBytes(32).toString('base64url');
const csrfFor = secret => hash(`csrf:${secret}`);
const verifierFor = secret => crypto.createHash('sha256').update(`pkce:${secret}`).digest('base64url');
const pairingCode = value => {
  if (typeof value !== 'string' || !/^[A-Fa-f0-9\s-]{10,14}$/.test(value)) return '';
  const normalized = value.replace(/[-\s]/g, '').toUpperCase();
  return /^[A-F0-9]{10}$/.test(normalized) ? normalized : '';
};
function cookies(req) {
  const values = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) values[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return values;
}
function validSecret(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value); }
function configFromEnv() {
  return { publicOrigin: process.env.PUBLIC_ORIGIN, googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET, adminEmails: (process.env.ADMIN_EMAILS ?? DEFAULT_ADMIN_EMAILS).split(',') };
}
function createLeaderboardAuth({ getDb, config = configFromEnv(), googleClient, store = createAuthStore(getDb), now = () => new Date(), streamCheckMs = 5000 }) {
  let origin;
  try {
    const parsed = new URL(config.publicOrigin);
    if (parsed.origin === config.publicOrigin && (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)))) origin = parsed.origin;
  } catch { /* Invalid configuration remains locked. */ }
  const emails = new Set((config.adminEmails || []).map(email => email.trim().toLowerCase()).filter(Boolean));
  const configured = Boolean(origin && config.googleClientId && config.googleClientSecret && emails.size);
  const secure = Boolean(origin?.startsWith('https:')), callback = `${origin}/auth/google/callback`;
  const provider = googleClient || new OAuth2Client(config.googleClientId, config.googleClientSecret, callback);
  const router = express.Router({ strict: true, caseSensitive: true });
  const fail = (res, code, error) => res.status(code).json({ authorized: false, error });
  function setCookie(res, name, value, age) { res.cookie(name, value, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: age }); }
  function secureHeaders(req, res, next) {
    // Enforce after sendFile/route handlers, which may replace caching headers.
    const original = res.writeHead;
    res.writeHead = function(...args) {
      for (const arg of [args[1], args[2]]) if (arg && typeof arg === 'object') for (const key of Object.keys(arg)) if (/^(cache-control|access-control-allow-origin)$/i.test(key)) delete arg[key];
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      res.setHeader('Pragma', 'no-cache'); res.setHeader('Expires', '0'); res.removeHeader('Access-Control-Allow-Origin');
      return original.apply(this, args);
    };
    res.set('Cache-Control', 'private, no-store, max-age=0');
    res.set('Referrer-Policy', 'no-referrer'); res.set('X-Content-Type-Options', 'nosniff'); res.set('X-Frame-Options', 'DENY'); next();
  }
  async function identity(req) {
    if (!configured) return null;
    const secret = cookies(req)[COOKIE];
    if (!validSecret(secret)) return null;
    const record = await store.get(`session:${hash(secret)}`);
    if (!record || +record.expiresAt <= +now()) return null;
    if (record.kind === 'admin' && !emails.has(record.email)) return null;
    return record;
  }
  function authorized(record) { return record && ['admin', 'device'].includes(record.kind); }
  async function bounded(req, action, max) {
    // Forwarding headers are untrusted; a tunnel shares this conservative IP budget.
    return store.limit(`rate:${action}:${hash(req.socket.remoteAddress || 'unknown')}`, max, now());
  }
  const endpoint = handler => async (req, res) => {
    try { await handler(req, res); } catch { if (!res.headersSent) fail(res, 503, 'access_unavailable'); else res.end(); }
  };
  async function mutation(req, res, adminOnly = false) {
    if (!configured) { fail(res, 503, 'setup_required'); return null; }
    if (req.get('origin') !== origin || req.get('sec-fetch-site') === 'cross-site') { fail(res, 403, 'same_origin_required'); return null; }
    const record = await identity(req), secret = cookies(req)[COOKIE];
    if (!record || !validSecret(secret) || req.get('x-csrf-token') !== csrfFor(secret)) { fail(res, 403, 'csrf_required'); return null; }
    if (adminOnly && record.kind !== 'admin') { fail(res, 403, 'admin_required'); return null; }
    if (!await bounded(req, 'mutation', 30)) { fail(res, 429, 'rate_limited'); return null; }
    return record;
  }
  router.use(secureHeaders);
  router.get(['/auth', '/auth/'], (req, res) => {
    res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.sendFile(path.join(__dirname, 'public/access.html'));
  });
  for (const file of ['access.js', 'access.css']) router.get(`/auth/${file}`, (req, res) => res.sendFile(path.join(__dirname, 'public', file)));
  router.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  router.get('/auth/status', endpoint(async (req, res) => {
    if (!configured) return res.json({ authorized: false, admin: false, setupRequired: true });
    if (!await bounded(req, 'status', 1200)) return fail(res, 429, 'rate_limited');
    let record = await identity(req), secret = cookies(req)[COOKIE];
    if (!record) {
      secret = random(); record = { _id: `session:${hash(secret)}`, kind: 'pending', expiresAt: new Date(+now() + TEN_MINUTES) };
      await store.put(record); setCookie(res, COOKIE, secret, DEVICE_LIFETIME);
    }
    res.json({ authorized: Boolean(authorized(record)), admin: record.kind === 'admin', email: record.kind === 'admin' ? record.email : undefined,
      setupRequired: false, csrf: csrfFor(secret), expiresAt: record.expiresAt });
  }));
  router.get('/auth/google', endpoint(async (req, res) => {
    if (!configured) return fail(res, 503, 'setup_required');
    if (!await bounded(req, 'login', 20)) return fail(res, 429, 'rate_limited');
    const secret = random(), state = random(), nonce = random();
    const pair = pairingCode(req.query.pair);
    await store.put({ _id: `oauth:${hash(state)}`, binding: hash(secret), nonce: hash(nonce), pair: pair || undefined, expiresAt: new Date(+now() + TEN_MINUTES) });
    setCookie(res, FLOW_COOKIE, secret, TEN_MINUTES);
    res.redirect(provider.generateAuthUrl({ scope: 'openid email', state, nonce, code_challenge_method: 'S256',
      code_challenge: crypto.createHash('sha256').update(verifierFor(secret)).digest('base64url'), redirect_uri: callback, prompt: 'select_account' }));
  }));
  router.get('/auth/google/callback', endpoint(async (req, res) => {
    if (!configured) return fail(res, 503, 'setup_required');
    const secret = cookies(req)[FLOW_COOKIE];
    if (!validSecret(secret) || !validSecret(req.query.state) || typeof req.query.code !== 'string' || req.query.code.length > 4096) return fail(res, 400, 'invalid_callback');
    const transaction = await store.consume(`oauth:${hash(req.query.state)}`, now()); setCookie(res, FLOW_COOKIE, '', 0);
    if (!transaction || transaction.binding !== hash(secret)) return fail(res, 400, 'invalid_callback');
    let claims;
    try {
      const { tokens } = await provider.getToken({ code: req.query.code, codeVerifier: verifierFor(secret), redirect_uri: callback });
      const ticket = await provider.verifyIdToken({ idToken: tokens.id_token, audience: config.googleClientId }); claims = ticket.getPayload();
    } catch { return fail(res, 403, 'identity_denied'); }
    const email = typeof claims?.email === 'string' ? claims.email.toLowerCase() : '';
    if (claims?.email_verified !== true || !emails.has(email) || typeof claims.nonce !== 'string' || hash(claims.nonce) !== transaction.nonce || !claims.sub) return fail(res, 403, 'identity_denied');
    const old = cookies(req)[COOKIE]; if (validSecret(old)) await store.remove(`session:${hash(old)}`);
    const session = random();
    await store.put({ _id: `session:${hash(session)}`, kind: 'admin', email, subject: claims.sub, expiresAt: new Date(+now() + ADMIN_LIFETIME) });
    setCookie(res, COOKIE, session, ADMIN_LIFETIME); res.redirect(transaction.pair ? `/auth?pair=${encodeURIComponent(transaction.pair)}` : '/auth');
  }));
  router.use(['/auth/pair', '/auth/approve', '/auth/revoke', '/auth/logout'], express.json({ limit: '4kb' }));
  router.post('/auth/pair', endpoint(async (req, res) => {
    const record = await mutation(req, res); if (!record) return;
    if (record.kind !== 'pending') return fail(res, 400, 'already_authorized');
    const code = crypto.randomBytes(5).toString('hex').toUpperCase(), pairId = `pair:${hash(code)}`;
    const expiresAt = new Date(Math.min(+record.expiresAt, +now() + TEN_MINUTES));
    const pairingUrl = `${origin}/auth?pair=${encodeURIComponent(code)}`;
    const qrSvg = await QRCode.toString(pairingUrl, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, width: 320, color: { dark: '#171614', light: '#FFF6ED' } });
    await store.put({ _id: pairId, browserId: record._id, expiresAt, qrSvg });
    if (!await store.setPair(record._id, pairId, now(), record.pairId)) { await store.remove(pairId); return fail(res, 409, 'pairing_changed'); }
    if (record.pairId) await store.remove(record.pairId);
    res.json({ code, expiresAt, pairingUrl });
  }));
  router.get('/auth/pair-qr', endpoint(async (req, res) => {
    const code = pairingCode(req.query.code), record = await identity(req);
    const pairId = code ? `pair:${hash(code)}` : '';
    const pair = pairId ? await store.get(pairId) : null;
    if (!record || record.kind !== 'pending' || record.pairId !== pairId || !pair || pair.browserId !== record._id || +pair.expiresAt <= +now() || typeof pair.qrSvg !== 'string') return fail(res, 401, 'pairing_required');
    res.type('image/svg+xml').send(pair.qrSvg);
  }));
  router.post('/auth/approve', endpoint(async (req, res) => {
    if (!await mutation(req, res, true)) return;
    const code = typeof req.body?.code === 'string' ? req.body.code.replace(/[-\s]/g, '').toUpperCase() : '';
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!/^[A-F0-9]{10}$/.test(code) || !name || name.length > 80) return fail(res, 400, 'invalid_pairing');
    const pair = await store.consume(`pair:${hash(code)}`, now());
    if (!pair || !await store.approve(pair.browserId, now(), { kind: 'device', name, approvedAt: now(), lastSeen: now(), expiresAt: new Date(+now() + DEVICE_LIFETIME) }, pair._id)) return fail(res, 400, 'expired_or_used_code');
    res.json({ ok: true });
  }));
  router.get('/auth/devices', endpoint(async (req, res) => {
    const record = await identity(req); if (record?.kind !== 'admin') return fail(res, 403, 'admin_required');
    res.json({ devices: (await store.devices(now())).map(item => ({ id: item._id, name: item.name, lastSeen: item.lastSeen, approvedAt: item.approvedAt, expiresAt: item.expiresAt })) });
  }));
  router.post('/auth/revoke', endpoint(async (req, res) => {
    if (!await mutation(req, res, true)) return;
    const id = req.body?.id;
    if (typeof id !== 'string' || !/^session:[a-f0-9]{64}$/.test(id)) return fail(res, 400, 'invalid_device');
    const record = await store.get(id); if (record?.kind === 'device') await store.remove(id); res.json({ ok: true });
  }));
  router.post('/auth/logout', endpoint(async (req, res) => {
    const record = await mutation(req, res); if (!record) return;
    await store.remove(record._id); setCookie(res, COOKIE, '', 0); res.set('Clear-Site-Data', '"cache", "storage"'); res.json({ ok: true });
  }));
  router.use(async (req, res, next) => {
    try {
      const record = await identity(req);
      if (!authorized(record)) {
        if (req.method === 'GET' && ['/', '/index.html', '/overlay.html'].includes(req.path.toLowerCase())) return res.status(401).sendFile(path.join(__dirname, 'public/access.html'));
        return fail(res, 401, 'access_required');
      }
      if (record.kind === 'device' && (!record.lastSeen || +now() - +record.lastSeen >= 60000)) await store.touch(record._id, now());
      next();
    } catch { fail(res, 503, 'access_unavailable'); }
  });
  function guardStream(req, res) {
    let closed = false;
    const close = () => { if (!closed) { closed = true; clearInterval(timer); res.end(); } };
    async function check() {
      if (closed) return false;
      try { if (!authorized(await identity(req))) { close(); return false; } return !closed; } catch { close(); return false; }
    }
    const timer = setInterval(() => { void check(); }, streamCheckMs); timer.unref?.();
    res.on('close', () => { closed = true; clearInterval(timer); });
    return { async send(message) { if (await check()) res.write(message); }, close };
  }
  return { middleware: router, guardStream };
}
module.exports = { createLeaderboardAuth };
