const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../public/access-guard.js'), 'utf8');

function fixture() {
  let allowed = true, navigation, lateResolve;
  const intervals = [], events = new Map();
  const localStorage = {
    helios_leaderboard_v2_history_2026_08: 'private history', helios_leaderboard_v2_current: 'private names',
    helios_leaderboard_v2_default: 'private names', leaderboard_config: 'old private data', unrelated: 'keep',
    removeItem(key) { delete this[key]; }
  };
  const document = { hidden: false, documentElement: { style: {} }, body: { textContent: 'Private rankings', replaceChildren() { this.textContent = ''; } }, addEventListener(name, fn) { events.set(name, fn); } };
  const context = { document, localStorage, AbortController, setTimeout, clearTimeout,
    setInterval(fn) { intervals.push(fn); }, addEventListener(name, fn) { events.set(name, fn); },
    location: { replace(url) { navigation = url; } },
    async fetch(url) {
      if (url === '/auth/status') return { ok: true, json: async () => ({ authorized: allowed }) };
      return { ok: true, json: () => new Promise(resolve => { lateResolve = resolve; }) };
    }
  };
  context.window = context; vm.runInNewContext(source, context);
  return { context, intervals, events, deny() { allowed = false; }, navigation: () => navigation, release() { lateResolve({ names: 'late secret' }); } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('access-loss guard clears sensitive stored settings/history and visible rows, then redirects', async () => {
  const f = fixture(); await flush(); assert.equal(f.context.document.body.textContent, 'Private rankings');
  f.deny(); await f.intervals[0]();
  assert.equal(f.context.document.body.textContent, ''); assert.equal(f.context.document.documentElement.style.visibility, 'hidden');
  assert.equal(f.navigation(), '/auth');
  assert.deepEqual(Object.keys(f.context.localStorage).filter(key => typeof f.context.localStorage[key] === 'string'), ['unrelated']);
});

test('access-loss guard blocks late JSON completion and future requests from restoring history', async () => {
  const f = fixture(); await flush();
  const response = await f.context.fetch('/api/leaderboard/history'); const pending = response.json();
  f.deny(); await f.intervals[0](); f.release();
  await assert.rejects(pending, /Access lost/); await assert.rejects(f.context.fetch('/api/leaderboard/current'), /Access lost/);
  assert.equal(f.context.document.body.textContent, ''); assert.equal(f.navigation(), '/auth');
});
