const test = require('node:test');
const assert = require('node:assert/strict');
const { createSheetsConnection, SHEETS_SCOPE } = require('../sheetsConnection');
const { GROUP_SHEETS, findMonthTab } = require('../groupSheets');
test('eight groups remain explicit; month tab matching handles accents and Vietnam boundary', () => {
  assert.equal(GROUP_SHEETS.length,8);assert.equal(GROUP_SHEETS.filter(source=>source.spreadsheetId).length,8);
  const metadata={sheets:[{properties:{title:'THANG 10.2026'}},{properties:{title:'THÁNG 09.2026'}}]};
  assert.equal(findMonthTab(metadata,new Date('2026-09-30T17:00:00Z')).title,'THANG 10.2026');
  assert.equal(findMonthTab(metadata,new Date('2026-09-30T16:59:59Z')).title,'THÁNG 09.2026');
  assert.equal(findMonthTab(metadata,new Date('2026-11-01')),undefined);
});
function setup(overrides = {}) {
  const records = new Map(), calls = [];
  const store = { get: async id => structuredClone(records.get(id)), put: async record => records.set(record._id, structuredClone(record)), remove: async id => records.delete(id) };
  const config = { googleClientId: 'test', googleClientSecret: 'test', sheetsTokenEncryptionKey: 'ab'.repeat(32), ...overrides };
  const sheets = createSheetsConnection({ store, config, clientFactory: () => ({ setCredentials(value) { assert.deepEqual(value, {refresh_token:'private-refresh'}); }, async request(options) { calls.push(options); return {data:{values:[['header']]}}; } }) });
  return { records, calls, store, config, sheets };
}
test('refresh token is encrypted; status does not disclose credential; reader uses GET only', async () => {
  const h = setup();
  await h.sheets.save({scope:SHEETS_SCOPE,refresh_token:'private-refresh'}, {email:'ADMIN@example.com',sub:'owner'});
  assert.ok(!JSON.stringify([...h.records.values()]).includes('private-refresh'));
  assert.deepEqual(Object.keys(await h.sheets.status()).sort(), ['configured','connected','connectedAt','email','lastCheck']);
  const data = await h.sheets.read({spreadsheetId:'valid_spreadsheet_identifier',range:"'THÁNG 10.2026'!A1:L3"});
  assert.equal(data.values.length,1); assert.equal(h.calls[0].method,'GET'); assert.equal(h.calls[0].params.valueRenderOption,'UNFORMATTED_VALUE');
  await h.sheets.disconnect(); assert.equal((await h.sheets.status()).connected,false);
});
test('last check persists only for the current connection and cannot resurrect a disconnect', async () => {
  const h=setup();await h.sheets.save({scope:SHEETS_SCOPE,refresh_token:'private-refresh'},{email:'a',sub:'b'});
  const version=await h.sheets.version();await h.sheets.recordCheck({ok:true,readable:8,total:8},version);
  assert.equal((await h.sheets.status()).lastCheck.readable,8);
  await h.sheets.save({scope:SHEETS_SCOPE,refresh_token:'private-refresh'},{email:'a',sub:'b'});
  assert.equal((await h.sheets.status()).lastCheck,undefined);
  await h.sheets.disconnect();await h.sheets.recordCheck({ok:true},version);
  assert.equal((await h.sheets.status()).connected,false);
  assert.equal((await h.sheets.status()).lastCheck,undefined);
});
test('read errors expose safe categories only', () => {
  const {sheetsReadError}=require('../sheetsConnection');
  for(const [status,expected] of [[401,'reconnect_required'],[403,'permission_denied'],[404,'sheet_not_found'],[400,'invalid_range'],[429,'rate_limited'],[500,'read_failed']])assert.equal(sheetsReadError({response:{status,data:{private:'secret'}}}),expected);
  assert.equal(sheetsReadError({response:{status:400,data:{error:'invalid_grant'}}}),'reconnect_required');
});
test('setup, missing consent, bad ID, wrong encryption key and ciphertext tampering fail closed', async () => {
  const disabled = setup({sheetsTokenEncryptionKey:''}); assert.equal(disabled.sheets.configured,false);
  await assert.rejects(disabled.sheets.save({scope:SHEETS_SCOPE,refresh_token:'x'},{email:'a',sub:'b'}));
  const h=setup();
  await assert.rejects(h.sheets.save({scope:'openid email',refresh_token:'x'},{email:'a',sub:'b'}));
  await assert.rejects(h.sheets.save({scope:SHEETS_SCOPE},{email:'a',sub:'b'}));
  await h.sheets.save({scope:SHEETS_SCOPE,refresh_token:'private-refresh'},{email:'a',sub:'b'});
  await assert.rejects(h.sheets.read({spreadsheetId:'../../other'}));
  const rotated=createSheetsConnection({store:h.store,config:{...h.config,sheetsTokenEncryptionKey:'cd'.repeat(32)}});
  assert.equal((await rotated.status()).connected,false);
  const record=[...h.records.values()][0];record.credential.tag=Buffer.alloc(16).toString('base64');
  assert.equal((await h.sheets.status()).connected,false);
  await assert.rejects(h.sheets.read({spreadsheetId:'valid_spreadsheet_identifier',range:'A1:B2'}));
});
