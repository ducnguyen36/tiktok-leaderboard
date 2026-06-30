# Monthly Reset at 07:00 + Grace-Period Display — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the monthly leaderboard reset boundary to 07:00 on the 1st (Vietnam time, decoupled from the daily reset) and keep the monthly tab displaying the previous month's totals until 00:00 on the 2nd, while new-month gifts accumulate silently from 07:00 on the 1st.

**Architecture:** Extract all month-window math into a pure, requireable module (`monthlyWindows.js`) so it is unit-testable with an injected `now`. Wire it into the existing server-side build (`_buildLeaderboardDataInner`) and the `/api/leaderboard/lastmonth` endpoint. The grace display is entirely server-side — the server emits last month's totals in the `monthly` arrays during grace, so the client renders it transparently with no client changes.

**Tech Stack:** Node 22 (CommonJS), Express 5, MongoDB driver, Node built-in test runner (`node --test`) — no new dependencies.

## Global Constraints

- `MONTHLY_RESET_HOUR = 7` — hardcoded; decoupled from the daily `resetHour`. (Dashboard-configurable + cross-client sync is a deferred future feature.)
- All server-side `new Date(...)` is Vietnam local time; container sets `TZ=Asia/Ho_Chi_Minh`. Do not introduce UTC conversions.
- Daily reset behavior (`resetHour`, freeze logic) is unchanged.
- Switchover from previous→current month display is at **00:00:00 on the 2nd**.
- Vietnam observes no DST — no fold/gap handling.
- No DB schema changes, no new scheduled jobs.

---

### Task 1: Pure month-window module + unit tests

**Files:**
- Create: `monthlyWindows.js`
- Create: `test/monthlyWindows.test.js`
- Modify: `package.json` (add `test` script)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `MONTHLY_RESET_HOUR` — number, `7`.
  - `computeMonthlyWindows(now, resetHour)` → object `{ monthlyStart: Date, prevMonthlyStart: Date, graceEnd: Date, inGrace: boolean, displayStart: Date, displayEnd: Date|null }`.
    - `monthlyStart`: most recent "1st of month @ resetHour" that is `<= now` (active accumulating window start).
    - `prevMonthlyStart`: the "1st @ resetHour" one month before `monthlyStart`.
    - `graceEnd`: 00:00:00 on the 2nd of `monthlyStart`'s calendar month.
    - `inGrace`: `now < graceEnd`.
    - `displayStart`/`displayEnd`: `inGrace ? [prevMonthlyStart, monthlyStart) : [monthlyStart, null)`.

- [ ] **Step 1: Write the failing tests**

Create `test/monthlyWindows.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeMonthlyWindows, MONTHLY_RESET_HOUR } = require('../monthlyWindows');

// Helper: build a server-local Date (same construction the module uses → TZ-independent)
const d = (y, m, day, h = 0, min = 0) => new Date(y, m, day, h, min, 0, 0);

test('constant is 7', () => {
    assert.equal(MONTHLY_RESET_HOUR, 7);
});

test('before 07:00 on the 1st: active window is last month, not in grace', () => {
    const w = computeMonthlyWindows(d(2026, 2, 1, 3), 7); // Mar 1 2026 03:00
    assert.deepEqual(w.monthlyStart, d(2026, 1, 1, 7));    // Feb 1 07:00
    assert.deepEqual(w.prevMonthlyStart, d(2026, 0, 1, 7)); // Jan 1 07:00
    assert.equal(w.inGrace, false);
    assert.deepEqual(w.displayStart, d(2026, 1, 1, 7));
    assert.equal(w.displayEnd, null);
});

test('07:00 exactly on the 1st: in grace, display previous month', () => {
    const w = computeMonthlyWindows(d(2026, 2, 1, 7), 7); // Mar 1 2026 07:00
    assert.deepEqual(w.monthlyStart, d(2026, 2, 1, 7));     // Mar 1 07:00
    assert.equal(w.inGrace, true);
    assert.deepEqual(w.displayStart, d(2026, 1, 1, 7));     // Feb 1 07:00
    assert.deepEqual(w.displayEnd, d(2026, 2, 1, 7));       // Mar 1 07:00
});

test('mid-first-day (10:00): in grace, display previous month', () => {
    const w = computeMonthlyWindows(d(2026, 2, 1, 10), 7);
    assert.equal(w.inGrace, true);
    assert.deepEqual(w.displayStart, d(2026, 1, 1, 7));
    assert.deepEqual(w.displayEnd, d(2026, 2, 1, 7));
});

test('1st at 23:59: still in grace', () => {
    const w = computeMonthlyWindows(d(2026, 2, 1, 23, 59), 7);
    assert.equal(w.inGrace, true);
});

test('00:00 on the 2nd: grace ends, display current month', () => {
    const w = computeMonthlyWindows(d(2026, 2, 2, 0, 0), 7); // Mar 2 00:00
    assert.equal(w.inGrace, false);
    assert.deepEqual(w.displayStart, d(2026, 2, 1, 7));      // Mar 1 07:00
    assert.equal(w.displayEnd, null);
});

test('mid-month: not in grace, display current month', () => {
    const w = computeMonthlyWindows(d(2026, 2, 15, 12), 7);
    assert.equal(w.inGrace, false);
    assert.deepEqual(w.displayStart, d(2026, 2, 1, 7));
    assert.equal(w.displayEnd, null);
});

test('Dec->Jan rollover: previous window is last December', () => {
    const w = computeMonthlyWindows(d(2026, 0, 1, 10), 7); // Jan 1 2026 10:00
    assert.deepEqual(w.monthlyStart, d(2026, 0, 1, 7));     // Jan 1 2026 07:00
    assert.deepEqual(w.prevMonthlyStart, d(2025, 11, 1, 7)); // Dec 1 2025 07:00
    assert.equal(w.inGrace, true);
    assert.deepEqual(w.displayStart, d(2025, 11, 1, 7));
    assert.deepEqual(w.displayEnd, d(2026, 0, 1, 7));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test`
Expected: FAIL — `Cannot find module '../monthlyWindows'`.

- [ ] **Step 3: Write the module**

Create `monthlyWindows.js`:

```js
// Pure month-window math for the monthly leaderboard reset + grace-period display.
// All Date construction is server-local (Vietnam, TZ=Asia/Ho_Chi_Minh) time.

const MONTHLY_RESET_HOUR = 7; // 07:00 on the 1st; decoupled from the daily resetHour

/**
 * @param {Date} now
 * @param {number} resetHour - hour-of-day the monthly window starts on the 1st (e.g. 7)
 * @returns {{monthlyStart: Date, prevMonthlyStart: Date, graceEnd: Date,
 *            inGrace: boolean, displayStart: Date, displayEnd: Date|null}}
 */
function computeMonthlyWindows(now, resetHour) {
    // Active accumulating-month start: most recent "1st @ resetHour" that is <= now.
    let monthlyStart = new Date(now.getFullYear(), now.getMonth(), 1, resetHour, 0, 0, 0);
    if (now < monthlyStart) {
        // 00:00–resetHour on the 1st: new month hasn't started; active window is still last month.
        monthlyStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, resetHour, 0, 0, 0);
    }

    const prevMonthlyStart = new Date(
        monthlyStart.getFullYear(), monthlyStart.getMonth() - 1, 1, resetHour, 0, 0, 0
    );

    // Display grace ends at 00:00:00 on the 2nd of monthlyStart's calendar month.
    const graceEnd = new Date(
        monthlyStart.getFullYear(), monthlyStart.getMonth(), 2, 0, 0, 0, 0
    );
    const inGrace = now < graceEnd;

    return {
        monthlyStart,
        prevMonthlyStart,
        graceEnd,
        inGrace,
        displayStart: inGrace ? prevMonthlyStart : monthlyStart,
        displayEnd: inGrace ? monthlyStart : null,
    };
}

module.exports = { MONTHLY_RESET_HOUR, computeMonthlyWindows };
```

- [ ] **Step 4: Add the test script**

In `package.json`, add to `scripts`:

```json
    "test": "node --test"
```

(Place it alongside `start` and `dev`.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all 8 tests pass, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add monthlyWindows.js test/monthlyWindows.test.js package.json
git commit -m "feat: pure month-window module with 07:00 reset + grace logic"
```

---

### Task 2: Wire window math into the live build

**Files:**
- Modify: `server.js` — `require` at top (near line 1-7); `_buildLeaderboardDataInner` (monthly boundary ~802-803, gift load ~833-849, monthly aggregations ~854-861, return object ~948-957).

**Interfaces:**
- Consumes: `computeMonthlyWindows`, `MONTHLY_RESET_HOUR` from `./monthlyWindows`.
- Produces: build output gains `monthlyGrace: boolean`. The `monthly` arrays (`individual.monthly`, `group.monthly`) hold the **displayed** window (previous month during grace, current month otherwise). Daily/yesterday arrays are unchanged.

- [ ] **Step 1: Add the require**

At the top of `server.js` (after the existing `require` block, around line 7), add:

```js
const { computeMonthlyWindows, MONTHLY_RESET_HOUR } = require('./monthlyWindows');
```

- [ ] **Step 2: Replace the inline monthly boundary**

In `_buildLeaderboardDataInner`, replace the existing monthly boundary block:

```js
    // Monthly boundary
    const monthlyStart = new Date(now.getFullYear(), now.getMonth(), 1, resetHour, 0, 0, 0);
    const monthlyStartMs = monthlyStart.getTime();
```

with:

```js
    // Monthly boundary + grace-period display (decoupled from daily resetHour).
    // monthlyStart = active accumulating window (gifts count from 07:00 on the 1st).
    // During grace, the DISPLAYED monthly window is the previous month [displayStart, displayEnd).
    const mw = computeMonthlyWindows(now, MONTHLY_RESET_HOUR);
    const monthlyStartMs = mw.monthlyStart.getTime();
    const displayStartMs = mw.displayStart.getTime();
    const displayEndMs = mw.displayEnd ? mw.displayEnd.getTime() : null;
```

- [ ] **Step 3: Widen the gift load to the displayed window start**

Replace the gift-load query (currently `{ timeStamp: { $gte: monthlyStartMs } }`):

```js
    const allMonthlyGifts = await db.collection('gifts').find(
        { timeStamp: { $gte: monthlyStartMs } },
        giftProjection
    ).toArray();
```

with (load from the earliest needed boundary so the displayed previous month is available during grace):

```js
    // Load from displayStart so the displayed window (previous month during grace) is covered.
    // displayStart <= monthlyStart always, so daily/yesterday subsets remain within the set.
    const allMonthlyGifts = await db.collection('gifts').find(
        { timeStamp: { $gte: displayStartMs } },
        giftProjection
    ).toArray();
```

- [ ] **Step 4: Derive the displayed-monthly subset**

Immediately after the daily/yesterday subset lines:

```js
    const allDailyGifts = allMonthlyGifts.filter(g => g.timeStamp >= dailyStartMs);
    const allYesterdayGifts = allMonthlyGifts.filter(g => g.timeStamp >= yesterdayStartMs && g.timeStamp < yesterdayEndMs);
```

add:

```js
    // Displayed monthly window: previous month during grace, current month otherwise.
    const inDisplayWindow = g => g.timeStamp >= displayStartMs && (displayEndMs === null || g.timeStamp < displayEndMs);
    const allDisplayedMonthlyGifts = allMonthlyGifts.filter(inDisplayWindow);
```

- [ ] **Step 5: Point the monthly aggregations at the displayed subset**

Change the `monthlyGifts` definition:

```js
    const monthlyGifts = allMonthlyGifts.filter(isNotManual);
```

to:

```js
    const monthlyGifts = allDisplayedMonthlyGifts.filter(isNotManual);
```

and in the `Promise.all([...])` aggregation block, change the group monthly call argument from `allMonthlyGifts` to `allDisplayedMonthlyGifts`:

```js
        aggregateGroup(allDisplayedMonthlyGifts, talentToProfile, profileMap, profileNameToId, uidToTalent, uidToProfile, sessionProfileMap)
```

(Leave the daily and yesterday aggregation calls using `allDailyGifts` / `allYesterdayGifts` unchanged.)

- [ ] **Step 6: Expose the grace flag in the return object**

In the return object, add `monthlyGrace` next to `frozen`:

```js
        frozen: isFrozen,
        monthlyGrace: mw.inGrace,
        locations
```

- [ ] **Step 7: Smoke-test the server boots and builds**

Run: `node -e "require('./server.js')"` is not viable (it starts listening + connects Mongo). Instead verify the module loads without syntax errors:

Run: `node --check server.js`
Expected: no output, exit code 0 (syntax OK).

- [ ] **Step 8: Re-run the unit suite (unchanged, must still pass)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add server.js
git commit -m "feat: server build shows previous month during 07:00 reset grace window"
```

---

### Task 3: Make the "last month" endpoint consistent

**Files:**
- Modify: `server.js` — `/api/leaderboard/lastmonth` handler (~1154-1235), and its cache vars (~1149-1152).

**Interfaces:**
- Consumes: `computeMonthlyWindows`, `MONTHLY_RESET_HOUR`.
- Produces: endpoint returns the window immediately **before** the currently displayed monthly window, using the 07:00 boundary. Cache key includes grace state.

- [ ] **Step 1: Add grace to the cache key**

Replace the cache-tracking variable:

```js
let lastMonthCacheMonth = -1; // track which month was cached
```

with a key that also captures the grace flip:

```js
let lastMonthCacheKey = ''; // e.g. "2:false" — monthIndex + ':' + inGrace
```

- [ ] **Step 2: Replace boundary computation + cache check in the handler**

Replace this block:

```js
    const parsed = parseInt(req.query.resetHour);
    const resetHour = isNaN(parsed) ? 0 : parsed;
    const now = new Date();
    const currentMonth = now.getMonth();

    // Return cached if same month and not expired
    if (lastMonthCache && lastMonthCacheMonth === currentMonth &&
        Date.now() - lastMonthCacheTimestamp < LAST_MONTH_CACHE_TTL) {
        return res.json({ status: 'ok', data: lastMonthCache });
    }
```

with:

```js
    const now = new Date();
    const mw = computeMonthlyWindows(now, MONTHLY_RESET_HOUR);
    const cacheKey = `${mw.monthlyStart.getMonth()}:${mw.inGrace}`;

    // Return cached if same window and not expired
    if (lastMonthCache && lastMonthCacheKey === cacheKey &&
        Date.now() - lastMonthCacheTimestamp < LAST_MONTH_CACHE_TTL) {
        return res.json({ status: 'ok', data: lastMonthCache });
    }
```

- [ ] **Step 3: Use the displayed window's start as the "last month" upper bound**

Replace the boundary block inside the `try`:

```js
        const monthlyStart = new Date(now.getFullYear(), now.getMonth(), 1, resetHour, 0, 0, 0);
        const monthlyStartMs = monthlyStart.getTime();
        const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, resetHour, 0, 0, 0);
        const lastMonthStartMs = lastMonthStart.getTime();
        const lastMonthEndMs = monthlyStartMs;
```

with (the "last month" button shows the window immediately before what the main tab displays — during grace `displayStart` is already the previous month, so this naturally steps one further back):

```js
        // The button shows the window immediately BEFORE the currently displayed monthly window.
        const lastMonthEndMs = mw.displayStart.getTime();
        const lastMonthStart = new Date(
            mw.displayStart.getFullYear(), mw.displayStart.getMonth() - 1, 1, MONTHLY_RESET_HOUR, 0, 0, 0
        );
        const lastMonthStartMs = lastMonthStart.getTime();
```

- [ ] **Step 4: Update the cache write**

Replace:

```js
        lastMonthCacheMonth = currentMonth;
```

with:

```js
        lastMonthCacheKey = cacheKey;
```

- [ ] **Step 5: Verify syntax**

Run: `node --check server.js`
Expected: no output, exit code 0.

- [ ] **Step 6: Re-run unit suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server.js
git commit -m "feat: lastmonth endpoint uses 07:00 boundary, consistent with grace display"
```

---

## Self-Review

**Spec coverage:**
- R1 (07:00 boundary) → Task 1 `computeMonthlyWindows` + Task 2 wiring. ✓
- R2 (silent accumulation) → Task 2 Step 2-3: gifts always load/accumulate from true `monthlyStart`; display subset is separate. ✓
- R3 (grace display until 00:00 on the 2nd) → Task 1 `graceEnd` + `inGrace`, Task 2 Step 4-5 displayed subset. ✓
- R4 (consistent lastmonth button) → Task 3. ✓
- `MONTHLY_RESET_HOUR` hardcoded + decoupled → Task 1 constant, used in Tasks 2-3 (passes `MONTHLY_RESET_HOUR`, not request `resetHour`). ✓
- `monthlyGrace` flag exposed → Task 2 Step 6. ✓
- No client changes required (server emits last month in `monthly` arrays) — confirmed, no UI task. ✓
- Configurable-from-dashboard explicitly out of scope → no task. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `computeMonthlyWindows` return shape (`monthlyStart`, `prevMonthlyStart`, `graceEnd`, `inGrace`, `displayStart`, `displayEnd`) is identical across Task 1 definition, Task 2 (`mw.*`), and Task 3 (`mw.*`). Constant name `MONTHLY_RESET_HOUR` consistent. ✓
