'use strict';
// Daily read-only reconciliation report (sheet vs database), following the
// "Kế hoạch đối soát điểm hằng ngày" plan: four statuses, one record per
// difference, a monthly bridge per group and talent, and changes since the
// previous report. It only reads gifts/sessions/sheets and writes its own
// report documents; it never edits scores, sessions or sheets.
const { GROUP_SHEETS, findMonthTab } = require('./groupSheets');
const { dayKey, dayStart, shiftStarts, scoreRows, sessionGiftPipeline, liveGroups } = require('./rankingNext');
const { decodeGiftBuckets } = require('./leaderboardPerformance');
const { parseSheet, matchingProfile } = require('./sheetReconciliation');
const { sheetsReadError } = require('./sheetsConnection');
const KNOWN_ISSUES = require('./reconciliationKnownIssues');

const WORKDAY_HOUR = 6, DAY = 86400000, VN_OFFSET = 7 * 3600000;
const workday = value => dayKey(value, WORKDAY_HOUR);
const STATUS = Object.freeze({ exact: 'khop_chinh_xac', explained: 'lech_da_giai_thich', unexplained: 'lech_chua_giai_thich', pending: 'cho_du_lieu' });
const STATUS_LABEL = { khop_chinh_xac: 'Khớp chính xác', lech_da_giai_thich: 'Lệch đã giải thích', lech_chua_giai_thich: 'Lệch chưa giải thích', cho_du_lieu: 'Chờ / thiếu dữ liệu' };
const DEFAULT_GROUPS = GROUP_SHEETS.map(s => s.group); // all eight group sheets
const SMALL_DIFF = 100; // markdown only: below this, unexplained rows go to a compact table
const calendarDate = time => new Date(time + VN_OFFSET).toISOString().slice(0, 10);
const round = value => Math.round(Number(value) || 0);

function knownIssue(known, group, date, talent) {
  return known.find(issue => issue.group === group && issue.date === date && (issue.talent === null || issue.talent === talent)) || null;
}

function monthDays(month, today) {
  const days = [];
  for (let t = Date.parse(month + '-01T12:00:00Z'); ; t += DAY) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (!d.startsWith(month) || d > today) break;
    days.push(d);
  }
  return days;
}

// Classify one sheet-vs-database cell.
function classify({ sheetValue, dbValue, filled, comparable, noSession, isPast, known }) {
  if (!isPast) return null;
  if (!filled) return dbValue ? { status: STATUS.pending, note: 'Sheet chưa điền ngày này' } : null;
  const diff = round(dbValue) - round(sheetValue);
  if (!comparable && !noSession) return { status: STATUS.pending, note: 'Phiên chưa đóng hoặc thiếu tín hiệu live từ HeliosControl', diff };
  if (Math.abs(diff) <= 1) return { status: STATUS.exact, diff };
  if (known) return { status: STATUS.explained, diff, note: known.reason, knownIssue: known.id };
  return { status: STATUS.unexplained, diff, note: noSession ? 'Database không có phiên nào của nhóm trong ngày công này' : '' };
}

async function buildReport({ db, sheets, profiles, monthly, now = Date.now(), groups = DEFAULT_GROUPS, previous = null, known = KNOWN_ISSUES, appVersion = 'dev' }) {
  const today = workday(now), month = today.slice(0, 7);
  const from = new Date(dayStart(month + '-01', WORKDAY_HOUR) - DAY);
  const sessions = await db.collection('sessions').find({ createdAt: { $gte: from } }, { projection: { createdAt: 1, sessionStartedAt: 1, profileId: 1, sessionName: 1, updatedAt: 1 } }).toArray();
  const gifts = sessions.length ? decodeGiftBuckets(await db.collection('gifts').aggregate(sessionGiftPipeline(sessions.map(s => s._id)), { allowDiskUse: true, maxTimeMS: 60000 }).toArray()) : [];
  const live = await db.collection('leaderboard_live').find({ source: 'helioscontrol', liveSince: { $gte: from } }).toArray();
  const knownSessionIds = new Set(live.map(s => String(s.sessionId)));
  const liveSessionIds = new Set(live.filter(s => liveGroups([s], now).size).map(s => String(s.sessionId)));
  const starts = shiftStarts(sessions), dayOf = s => workday(starts.get(String(s._id)));
  const sessionDay = new Map(sessions.map(s => [String(s._id), dayOf(s)]));
  const days = monthDays(month, today);
  // Database scores per workday (all sessions of the day: battles and borrowed accounts included).
  const scores = new Map(days.map(d => [d, scoreRows(profiles, gifts.filter(g => sessionDay.get(String(g.sessionId)) === d), sessions)]));
  // Groups that earned points in each session: a group's live may run on another
  // group's account/profile (e.g. LevelX on KAYZEN), so sessions are matched by points.
  const giftsBySession = new Map();
  for (const g of gifts) { const id = String(g.sessionId); if (!giftsBySession.has(id)) giftsBySession.set(id, []); giftsBySession.get(id).push(g); }
  const sessionGroups = new Map([...giftsBySession].map(([id, list]) => [id, new Set(scoreRows(profiles, list, sessions).group.filter(g => g.value > 0).map(g => g.groupId))]));
  const SETTLED = 6 * 3600000;
  // A day is comparable when none of its sessions is live and each is either seen
  // closed by the HeliosControl heartbeat or has not been saved for 6 hours
  // (sessions from before the heartbeat existed).
  const closed = s => !liveSessionIds.has(String(s._id)) && (knownSessionIds.has(String(s._id)) || now - (+new Date(s.updatedAt) || 0) > SETTLED);

  const report = { _id: calendarDate(now), runId: `recon-${new Date(now).toISOString()}`, createdAt: new Date(now).toISOString(), month, workdayToday: today, appVersion, rules: 'workday 06:00; restart ≤30 min = same shift; group gifts shared among live members; Chung added only when not spread in the sheet', groups: [] };
  for (const source of GROUP_SHEETS.filter(s => groups.includes(s.group))) {
    const entry = { group: source.group, coverage: { state: 'checked', comparedDays: [], pendingDays: [], unmatchedTalents: [] }, rows: [], bridge: [] };
    report.groups.push(entry);
    const profile = matchingProfile(profiles, source.group);
    if (!profile) { entry.coverage.state = 'profile_unmatched'; continue; }
    const groupId = String(profile._id), talentNames = Object.keys(profile.talents || {});
    entry.profile = profile.name;
    let parsed, sheetUrl;
    try {
      const metadata = await sheets.read({ spreadsheetId: source.spreadsheetId, metadata: true });
      const tab = findMonthTab(metadata, new Date(dayStart(today, WORKDAY_HOUR)));
      if (!tab) { entry.coverage.state = 'month_tab_missing'; continue; }
      sheetUrl = `https://docs.google.com/spreadsheets/d/${source.spreadsheetId}/edit#gid=${tab.sheetId}`;
      const data = await sheets.read({ spreadsheetId: source.spreadsheetId, range: `'${tab.title.replace(/'/g, "''")}'!A1:U${Math.min(100, tab.gridProperties.rowCount)}` });
      parsed = parseSheet(data.values || [], month, talentNames);
    } catch (error) { entry.coverage.state = sheetsReadError(error); continue; }
    if (parsed.error) { entry.coverage.state = parsed.error; continue; }
    entry.sheetUrl = sheetUrl;
    entry.coverage.unmatchedTalents = talentNames.filter(n => !parsed.names.includes(n));
    const sheetDays = new Map(parsed.days.map(d => [d.date, d]));
    const compared = new Set();

    for (const date of days) {
      const isPast = date < today, sheetDay = sheetDays.get(date);
      const own = sessions.filter(s => sessionDay.get(String(s._id)) === date && (String(s.profileId) === groupId || sessionGroups.get(String(s._id))?.has(groupId)));
      const dayScores = scores.get(date);
      const dbGroup = dayScores.group.find(g => g.groupId === groupId)?.value || 0;
      const noSession = own.length === 0 && dbGroup === 0;
      const comparable = own.length > 0 && own.every(closed);
      const sessionNames = own.map(s => s.sessionName + (String(s.profileId) === groupId ? '' : ' (profile khác)'));
      const push = (kind, target, sheetValue, dbValue, filled) => {
        const result = classify({ sheetValue, dbValue, filled, comparable, noSession, isPast, known: knownIssue(known, source.group, date, kind === 'group' ? null : target) });
        if (!result) return;
        entry.rows.push({ id: `${source.group}–${date}–${target}–${kind}`, kind, target, date, sheet: filled ? round(sheetValue) : null, db: round(dbValue), diff: result.diff ?? null, status: result.status, note: result.note || '', knownIssue: result.knownIssue || null, sessions: sessionNames });
        if (kind === 'group' && result.status !== STATUS.pending) compared.add(date);
      };
      push('group', profile.name, sheetDay?.group, dbGroup, Boolean(sheetDay));
      for (const name of parsed.names) {
        const dbTalent = dayScores.individual.find(e => e.name === name && e.groupId === groupId)?.value || 0;
        push('individual', name, sheetDay?.individual[name], dbTalent, Boolean(sheetDay && sheetDay.provided[name]));
      }
      if (sheetDay && isPast && !compared.has(date) && entry.rows.some(r => r.date === date && r.status === STATUS.pending)) entry.coverage.pendingDays.push(date);
    }
    entry.coverage.comparedDays = [...compared].sort();

    // Monthly bridge: board monthly = compared days (database) + other days
    // (database, not compared: open, unfilled or pending) + month-edge/allocation
    // adjustment (what the month window counts differently from workdays).
    const targets = [{ kind: 'group', name: profile.name, monthly: monthly?.group?.monthly?.find(g => String(g.groupId) === groupId)?.value }]
      .concat(parsed.names.map(name => ({ kind: 'individual', name, monthly: monthly?.individual?.monthly?.find(e => e.name === name && String(e.groupId) === groupId)?.value })));
    for (const t of targets) {
      const valueOn = date => t.kind === 'group' ? (scores.get(date).group.find(g => g.groupId === groupId)?.value || 0) : (scores.get(date).individual.find(e => e.name === t.name && e.groupId === groupId)?.value || 0);
      const comparedRows = entry.rows.filter(r => r.kind === t.kind && r.target === t.name && r.status !== STATUS.pending);
      const comparedDb = comparedRows.reduce((n, r) => n + r.db, 0), comparedSheet = comparedRows.reduce((n, r) => n + r.sheet, 0);
      const comparedDates = new Set(comparedRows.map(r => r.date));
      const otherDb = days.filter(d => !comparedDates.has(d)).reduce((n, d) => n + valueOn(d), 0);
      const boardMonthly = t.monthly === undefined ? null : round(t.monthly);
      entry.bridge.push({ kind: t.kind, target: t.name, boardMonthly, comparedDb, comparedSheet, comparedDiff: comparedDb - comparedSheet, notComparedDb: otherDb, edgeAdjustment: boardMonthly === null ? null : boardMonthly - comparedDb - otherDb });
    }
  }

  // Changes since the previous report (same month only).
  const issues = report.groups.flatMap(g => g.rows.filter(r => r.status === STATUS.unexplained || r.status === STATUS.explained));
  const before = new Map((previous && previous.month === month ? previous.groups.flatMap(g => g.rows) : []).map(r => [r.id, r]));
  const now_ = new Map(report.groups.flatMap(g => g.rows).map(r => [r.id, r]));
  report.changes = {
    previousReport: previous?._id || null,
    newIssues: issues.filter(r => { const p = before.get(r.id); return !p || p.status === STATUS.exact || p.status === STATUS.pending; }).map(r => r.id),
    resolved: [...before.values()].filter(p => (p.status === STATUS.unexplained || p.status === STATUS.explained) && now_.get(p.id)?.status === STATUS.exact).map(p => p.id),
    changedDiff: issues.filter(r => { const p = before.get(r.id); return p && p.diff !== null && r.diff !== null && Math.abs(p.diff - r.diff) > 1; }).map(r => ({ id: r.id, before: before.get(r.id).diff, now: r.diff })),
  };
  report.summary = Object.fromEntries(Object.values(STATUS).map(s => [s, report.groups.reduce((n, g) => n + g.rows.filter(r => r.status === s).length, 0)]));
  return report;
}

const fmt = value => value === null || value === undefined ? '—' : Number(value).toLocaleString('vi-VN');
function renderMarkdown(report) {
  const lines = [`# Báo cáo đối soát ${report._id}`, '', `- Run: \`${report.runId}\` • Phiên bản app: \`${report.appVersion}\` • Tháng: ${report.month} • Ngày công hiện tại: ${report.workdayToday}`,
    `- Quy tắc: ${report.rules}`,
    `- Tổng số dòng: ${Object.entries(report.summary).map(([s, n]) => `${STATUS_LABEL[s]} ${n}`).join(' • ')}`,
    `- Thay đổi so với ${report.changes.previousReport || '(chưa có báo cáo trước)'}: mới ${report.changes.newIssues.length}, đã hết ${report.changes.resolved.length}, đổi số ${report.changes.changedDiff.length}`, ''];
  if (report.changes.newIssues.length) lines.push('**Vấn đề mới:** ' + report.changes.newIssues.join('; '), '');
  if (report.changes.resolved.length) lines.push('**Đã hết lệch:** ' + report.changes.resolved.join('; '), '');
  for (const g of report.groups) {
    lines.push(`## ${g.group}${g.profile ? ` (${g.profile})` : ''}`, '');
    lines.push(`- Trạng thái nguồn: \`${g.coverage.state}\`${g.sheetUrl ? ` • [Sheet](${g.sheetUrl})` : ''}`);
    if (g.coverage.state !== 'checked') { lines.push(''); continue; }
    lines.push(`- Ngày đã so: ${g.coverage.comparedDays.join(', ') || '—'}`, `- Ngày chờ: ${g.coverage.pendingDays.join(', ') || '—'}`, `- Idol không có cột trên sheet: ${g.coverage.unmatchedTalents.join(', ') || '—'}`, '');
    lines.push('### Cầu nối điểm tháng', '', '| | Bảng tháng | DB ngày đã so | Sheet ngày đã so | Lệch (DB−Sheet) | DB ngày chưa so | Điều chỉnh ranh giới |', '|---|---|---|---|---|---|---|');
    for (const b of g.bridge) lines.push(`| ${b.kind === 'group' ? '**' + b.target + '**' : b.target} | ${fmt(b.boardMonthly)} | ${fmt(b.comparedDb)} | ${fmt(b.comparedSheet)} | ${fmt(b.comparedDiff)} | ${fmt(b.notComparedDb)} | ${fmt(b.edgeAdjustment)} |`);
    const issues = g.rows.filter(r => r.status !== STATUS.exact);
    // Small unexplained differences stay recorded (plan: never drop them), but
    // are listed compactly so the large ones stand out.
    const small = issues.filter(r => r.status === STATUS.unexplained && Math.abs(r.diff) < SMALL_DIFF);
    const detailed = issues.filter(r => !small.includes(r));
    lines.push('', '### Hồ sơ sai lệch và ngày chờ', '');
    if (!issues.length) lines.push('Không có — mọi ngày đã so đều khớp chính xác (±1).');
    for (const r of detailed) {
      lines.push(`- **${r.id}** — ${STATUS_LABEL[r.status]}: Sheet ${fmt(r.sheet)} | DB ${fmt(r.db)} | Chênh DB−Sheet ${fmt(r.diff)}`);
      lines.push(`  - Phiên: ${r.sessions.join(', ') || '(không có)'}${r.note ? ` • Ghi chú: ${r.note}` : ''}`);
    }
    if (small.length) {
      lines.push('', `**Lệch nhỏ chưa giải thích (|chênh| < ${SMALL_DIFF}, ${small.length} dòng)** — thường do làm tròn khi chia quà; cần đối chiếu nếu lặp lại:`, '', '| Ngày | Đối tượng | Sheet | DB | Chênh |', '|---|---|---|---|---|');
      for (const r of small) lines.push(`| ${r.date} | ${r.target} | ${fmt(r.sheet)} | ${fmt(r.db)} | ${fmt(r.diff)} |`);
    }
    lines.push('');
  }
  lines.push('> Báo cáo chỉ đọc. Ảnh Messenger/Backstage chưa được đối chiếu trong báo cáo này; dùng hồ sơ sai lệch để kiểm tra bước 4 của kế hoạch.');
  return lines.join('\n');
}

const COLLECTION = 'reconciliation_reports';
function createDailyReport({ getDb, sheets, readProfiles, current, clock = Date.now, groups = DEFAULT_GROUPS, runHour = 9, appVersion = 'dev' }) {
  let running = null;
  async function build() {
    const db = getDb(); if (!db) throw new Error('Database unavailable');
    if (!(await sheets.status()).connected) throw new Error('Sheets not connected');
    const now = clock(), [profiles, monthlyResult] = await Promise.all([readProfiles(), current(0, '')]);
    const previous = await db.collection(COLLECTION).find({ _id: { $lt: calendarDate(now) } }).sort({ _id: -1 }).limit(1).next();
    const report = await buildReport({ db, sheets, profiles, monthly: monthlyResult?.data, now, groups, previous, appVersion });
    await db.collection(COLLECTION).replaceOne({ _id: report._id }, report, { upsert: true });
    return report;
  }
  return {
    async run() { if (!running) running = build().finally(() => { running = null; }); return running; },
    // Called periodically: builds today's report once, from runHour Vietnam time.
    async runIfDue() {
      const db = getDb(); if (!db) return null;
      const now = clock(), hour = new Date(now + VN_OFFSET).getUTCHours();
      if (hour < runHour) return null;
      // A report made earlier today before runHour (e.g. on demand at night) is
      // replaced by the scheduled run.
      const existing = await db.collection(COLLECTION).findOne({ _id: calendarDate(now) }, { projection: { createdAt: 1 } });
      if (existing && new Date(Date.parse(existing.createdAt) + VN_OFFSET).getUTCHours() >= runHour) return null;
      return this.run();
    },
    async get(date) { const db = getDb(); if (!db) return null; return date ? db.collection(COLLECTION).findOne({ _id: date }) : db.collection(COLLECTION).find().sort({ _id: -1 }).limit(1).next(); },
  };
}

module.exports = { STATUS, DEFAULT_GROUPS, classify, knownIssue, buildReport, renderMarkdown, createDailyReport };
