# Monthly Reset at 07:00 + Grace-Period Display

**Date:** 2026-06-30
**Status:** Approved (design)
**Branch:** `feature/monthly-reset-7am-grace`

## Problem

The monthly leaderboard (group and individual) currently "resets to 0" at **00:00:00** on the 1st
of each month, Vietnam local time. The reset is abrupt: at midnight everyone's monthly score
instantly drops to zero and last month's standings disappear from the default view, leaving no
window for talents to view or screenshot their final monthly placement.

Two changes are wanted:

1. Move the monthly reset boundary from **00:00:00** to **07:00:00** on the 1st.
2. Keep the monthly tab **displaying the previous month's totals until 00:00:00 on the 2nd**, so
   everyone has the whole of the 1st to look at and screenshot their final scores.

## Background / Current Architecture

There is **no scheduled reset job**. The "reset" is purely a computed query boundary:

- `server.js` → `_buildLeaderboardDataInner(resetHour, freezeUntil)` computes
  `monthlyStart = new Date(now.getFullYear(), now.getMonth(), 1, resetHour, 0, 0, 0)` and the
  monthly leaderboard is every gift with `timeStamp >= monthlyStart`.
- `resetHour` is **shared** between the daily and monthly boundaries. It comes from the client
  (`config.resetHour`, default `0`) as a query param on `/api/leaderboard`.
- A manual **"last month"** toggle already exists client-side (`viewingLastMonth` in
  `public/app.js`) backed by `GET /api/leaderboard/lastmonth`, which computes
  `[lastMonthStart, monthlyStart)` using the same shared `resetHour`.
- The container runs in Vietnam time: `TZ=Asia/Ho_Chi_Minh` is set in both `docker-compose.yml`
  and `docker-compose.nas.yml`, so all server-side `new Date(...)` calls are Vietnam local time.
  **This feature depends on that TZ being set.**

## Requirements

### Functional

- **R1 — 07:00 monthly boundary.** The monthly window starts at 07:00:00 on the 1st of the month
  (Vietnam time), independent of the daily `resetHour`.
- **R2 — Silent accumulation.** Gifts received from 07:00 on the 1st onward count toward the new
  month immediately, in the background, even while the previous month is still displayed.
- **R3 — Grace-period display.** The monthly tab (group + individual) displays the **previous**
  month's final totals from the moment of reset until **00:00:00 on the 2nd**. At 00:00:00 on the
  2nd it flips to the current (already-accumulating) month.
- **R4 — Consistent "last month" button.** The existing `/api/leaderboard/lastmonth` endpoint uses
  the same 07:00 boundary. It always returns the window **immediately before** whatever the main
  monthly tab is currently displaying. (During grace that means the month before last.)

### Non-functional / constraints

- `MONTHLY_RESET_HOUR` is **hardcoded to `7`** for now. A synced, dashboard-configurable version
  (one client sets it → saved to server → pushed to all clients) is explicitly deferred to a
  **future feature**.
- Daily reset behavior (`resetHour`, the freeze logic) is unchanged.
- No new scheduled jobs, no DB schema changes.

## Design

### Constant

```js
const MONTHLY_RESET_HOUR = 7; // 07:00 Vietnam time on the 1st; decoupled from daily resetHour
```

### Boundary math — extract to a pure, testable function

All the month-window logic moves into one pure function so it can be unit-tested by passing an
explicit `now` (no reliance on a cron or the real clock):

```js
/**
 * Given the current instant, return the monthly leaderboard windows.
 * All Date construction is server-local (Vietnam) time.
 *
 * @param {Date} now
 * @param {number} resetHour - MONTHLY_RESET_HOUR (07)
 * @returns {{
 *   monthlyStart: Date,      // active accumulating-month start (most recent 1st @ resetHour <= now)
 *   prevMonthlyStart: Date,  // the 1st @ resetHour one month before monthlyStart
 *   graceEnd: Date,          // 00:00:00 on the 2nd of monthlyStart's calendar month
 *   inGrace: boolean,        // now < graceEnd  -> display prevMonthly window
 *   displayStart: Date,      // window start to show on the monthly tab
 *   displayEnd: Date|null,   // window end to show (null = open-ended "now")
 * }}
 */
function computeMonthlyWindows(now, resetHour) {
    let monthlyStart = new Date(now.getFullYear(), now.getMonth(), 1, resetHour, 0, 0, 0);
    if (now < monthlyStart) {
        // 00:00–07:00 on the 1st: new month hasn't started; active window is still last month
        monthlyStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, resetHour, 0, 0, 0);
    }
    const prevMonthlyStart = new Date(
        monthlyStart.getFullYear(), monthlyStart.getMonth() - 1, 1, resetHour, 0, 0, 0
    );
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
        displayEnd:   inGrace ? monthlyStart   : null,
    };
}
```

### How `_buildLeaderboardDataInner` uses it

- Replace the inline `monthlyStart` computation with `computeMonthlyWindows(now, MONTHLY_RESET_HOUR)`.
- Load gifts for the **active** window (`monthlyStart … now`) as today — silent accumulation (R2)
  always uses the true `monthlyStart` so the new month is being tallied in the background.
- For the **displayed** monthly aggregations, filter to `[displayStart, displayEnd)`:
  - When `inGrace` is false, `displayStart === monthlyStart` and `displayEnd === null` → identical
    to today's behavior.
  - When `inGrace` is true, the monthly aggregations use `[prevMonthlyStart, monthlyStart)` →
    last month's frozen totals.
- Expose `monthlyGrace: inGrace` in the build output (alongside the existing `frozen` flag) so the
  client/UI can optionally badge that it is showing last month. (Badge UI itself is optional; the
  flag is cheap and useful.)

Note: the gift DB query currently loads `timeStamp >= monthlyStartMs` and derives daily/yesterday
as subsets. During grace we must also have the previous-month gifts available. Implementation will
widen the single load to `timeStamp >= displayStart` (= `prevMonthlyStart` during grace) so both
the displayed previous month and the silently-accumulating current month can be computed from one
query, preserving the existing "load once" optimization. Daily/yesterday subsets continue to be
filtered from this set (their boundaries are always within it).

### `/api/leaderboard/lastmonth` (R4)

- Use `MONTHLY_RESET_HOUR` instead of the request's `resetHour` for the monthly boundaries.
- Compute via the same `computeMonthlyWindows`. The "last month" the button shows is the window
  immediately **before the currently displayed** window:
  - Normal: `[prevMonthlyStart, monthlyStart)`.
  - During grace (main tab already shows `prevMonthly`): one month earlier still —
    `[prevPrevStart, prevMonthlyStart)`.
- Keep the existing 1-hour cache, but include the grace state in the cache key (e.g. cache key =
  `currentMonth + ':' + inGrace`) so the button doesn't serve a stale window across the grace flip.

## Edge cases

| Instant (Vietnam)        | `monthlyStart` | `inGrace` | Monthly tab shows                  |
|--------------------------|----------------|-----------|------------------------------------|
| 1st, 03:00 (before 7am)  | (M-1) 1st 07:00 | false    | last month's window (active = M-1) |
| 1st, 07:00 exactly       | M 1st 07:00     | true     | last month (M-1) — frozen          |
| 1st, 10:00               | M 1st 07:00     | true     | last month (M-1) — frozen          |
| 1st, 23:59               | M 1st 07:00     | true     | last month (M-1) — frozen          |
| 2nd, 00:00 exactly       | M 1st 07:00     | false    | current month M (≈1 day of gifts)  |
| 2nd, 00:30               | M 1st 07:00     | false    | current month M                    |
| mid-month, any time      | M 1st 07:00     | false    | current month M                    |

- **Dec→Jan rollover:** `new Date(year, 0 - 1, ...)` correctly yields December of the prior year;
  same for `getMonth() - 1` wrapping. Verified by the JS `Date` constructor's month-overflow
  normalization — covered by a unit test.
- **DST:** Vietnam does not observe DST, so no fold/gap concerns.

## Testing

Pure-function unit tests for `computeMonthlyWindows(now, 7)` asserting `monthlyStart`,
`prevMonthlyStart`, `graceEnd`, `inGrace`, and `displayStart/End` at each row of the edge-case
table above, plus the Dec→Jan year rollover. No clock mocking needed — `now` is an argument.

A light integration check on `_buildLeaderboardDataInner` (or its window selection) confirming the
displayed monthly window equals the previous window during grace and the current window otherwise.

## Out of scope (future feature)

- Making `MONTHLY_RESET_HOUR` configurable from the settings dashboard with cross-client sync
  (set on one client → persist to server → push to all clients).
- Any visual redesign of the monthly tab beyond optionally surfacing the `monthlyGrace` flag.
