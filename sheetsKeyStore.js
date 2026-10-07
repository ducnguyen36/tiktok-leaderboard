const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function persistentSheetsKey(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(directory).isSymbolicLink()) throw Error('Invalid Sheets key directory');
  const filename = path.join(directory, 'sheets-token.key');
  try {
    fs.writeFileSync(filename, crypto.randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const info = fs.lstatSync(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.size !== 64) throw Error('Invalid Sheets key file');
  if (process.platform !== 'win32' && (info.mode & 0o077)) throw Error('Unsafe Sheets key permissions');
  const value = fs.readFileSync(filename, 'utf8');
  if (!/^[a-f0-9]{64}$/.test(value)) throw Error('Invalid Sheets key');
  return value;
}
module.exports = { persistentSheetsKey };
