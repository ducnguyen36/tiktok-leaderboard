const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { persistentSheetsKey } = require('../sheetsKeyStore');
test('persistent key is reused and is not regenerated when corrupt', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'helios-sheets-key-'));
  t.after(() => { fs.unlinkSync(path.join(directory, 'sheets-token.key')); fs.rmdirSync(directory); });
  const first = persistentSheetsKey(directory);
  assert.match(first, /^[a-f0-9]{64}$/); assert.equal(persistentSheetsKey(directory), first);
  fs.writeFileSync(path.join(directory, 'sheets-token.key'), 'broken');
  assert.throws(() => persistentSheetsKey(directory));
  assert.equal(fs.readFileSync(path.join(directory, 'sheets-token.key'), 'utf8'), 'broken');
});
