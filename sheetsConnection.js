const crypto = require('node:crypto');
const { OAuth2Client } = require('google-auth-library');
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const CONNECTION_ID = 'integration:google-sheets';
const versionOf = record => record?.credential ? crypto.createHash('sha256').update(JSON.stringify(record.credential)).digest('hex') : '';
function sheetsReadError(error) {
  if (error?.response?.data?.error === 'invalid_grant') return 'reconnect_required';
  const code = Number(error?.response?.status || error?.status || error?.code);
  if (code === 401) return 'reconnect_required';
  if (code === 403) return 'permission_denied';
  if (code === 404) return 'sheet_not_found';
  if (code === 400) return 'invalid_range';
  if (code === 429) return 'rate_limited';
  return 'read_failed';
}

// No plaintext refresh tokens in MongoDB, responses, or logs.
function createSheetsConnection({ store, config, now = () => new Date(), clientFactory }) {
  const keyText = config.sheetsTokenEncryptionKey || '';
  const key = /^[a-fA-F0-9]{64}$/.test(keyText) ? Buffer.from(keyText, 'hex') : null;
  const configured = Boolean(key && config.googleClientId && config.googleClientSecret);
  let cachedClient, cachedVersion;
  function seal(value) {
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(CONNECTION_ID));
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
  }
  function open(value) {
    if (value?.version !== 1) throw Error('Invalid credential format');
    const cipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
    cipher.setAAD(Buffer.from(CONNECTION_ID));
    cipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    return Buffer.concat([cipher.update(Buffer.from(value.data, 'base64')), cipher.final()]).toString('utf8');
  }
  async function save(tokens, claims) {
    if (!configured) throw Error('Sheets setup required');
    if (!(tokens.scope || '').split(/\s+/).includes(SHEETS_SCOPE)) throw Error('Sheets permission missing');
    if (typeof tokens.refresh_token !== 'string' || !tokens.refresh_token) throw Error('Offline permission missing');
    await store.put({ _id: CONNECTION_ID, kind: 'sheets', email: claims.email.toLowerCase(), subject: claims.sub,
      connectedAt: now(), credential: seal(tokens.refresh_token) });
  }
  async function status() {
    const record = await store.get(CONNECTION_ID);
    // Also detect a rotated/missing key, without returning token material.
    let connected = false;
    if (configured && record) { try { open(record.credential); connected = true; } catch {} }
    const check = connected ? await store.get('integration:google-sheets-check') : null;
    return { configured, connected, email: record?.email, connectedAt: record?.connectedAt,
      lastCheck: check?.credentialVersion === versionOf(record) ? check.result : undefined };
  }
  async function read({ spreadsheetId, range, metadata = false }) {
    if (!configured || !/^[A-Za-z0-9_-]{20,200}$/.test(spreadsheetId || '')) throw Error('Invalid Sheets request');
    const record = await store.get(CONNECTION_ID);
    if (!record) throw Error('Sheets not connected');
    const version = versionOf(record);
    // Share Google's in-flight refresh promise; don't refresh 16 times for an eight-sheet test.
    if (!cachedClient || cachedVersion !== version) {
      const client = clientFactory ? clientFactory() : new OAuth2Client(config.googleClientId, config.googleClientSecret);
      client.setCredentials({ refresh_token: open(record.credential) });
      cachedClient = client; cachedVersion = version;
    }
    const client = cachedClient;
    const root = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
    const response = await client.request({ method: 'GET', timeout: 15000,
      url: metadata ? root : `${root}/values/${encodeURIComponent(range)}`,
      params: metadata ? { fields: 'spreadsheetId,properties(title),sheets(properties)' } : { valueRenderOption: 'UNFORMATTED_VALUE' } });
    return response.data;
  }
  async function recordCheck(result, version) {
    if (!version) return;
    // A separate record cannot resurrect credentials after a concurrent disconnect.
    await store.put({ _id: 'integration:google-sheets-check', kind: 'sheets-check', credentialVersion: version,
      result: { ...result, checkedAt: now() } });
  }
  return { configured, save, status, read, recordCheck, version: async () => versionOf(await store.get(CONNECTION_ID)),
    async disconnect() { cachedClient = null; cachedVersion = null; await store.remove(CONNECTION_ID); } };
}
module.exports = { createSheetsConnection, SHEETS_SCOPE, sheetsReadError };
