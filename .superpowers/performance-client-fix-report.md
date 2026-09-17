# Performance client fix report

## Scope and outcome

- Client metadata now follows each of the five current leaderboard column snapshots. Scoped refreshes produce an honest aggregate `MIXED` state, retain cached/stale indicators, and show the oldest visible computation time until an all-column read reconciles them.
- Only `cache` and `snapshot` are presented as cached. Unknown sources remain neutral, and `computed` with `stale: true` remains visibly stale without being mislabeled as cached.
- Stream errors use the unified renderer, so reconnecting transport state cannot erase cached/stale metadata or a retained-data refresh failure.
- Successful manual stale responses say `Snapshot refreshed · newer updates pending`.
- Complete history cache validation now requires `aggregationVersion: 2`; device v1 data is rejected and refetched.

## TDD evidence

Red:

- `node --test test/leaderboardCore.test.js` — 6 passed, 1 failed because a valid v2 history snapshot was rejected.
- `node --test --test-name-pattern="scoped refresh keeps|source enum" test/commandCenterBrowser.test.js` — 0 passed, 2 failed: a scoped refresh incorrectly showed `LIVE`, and an unknown source incorrectly showed `CACHED`.
- `node --test --test-name-pattern="source enum" test/commandCenterBrowser.test.js` — 0 passed, 1 failed because `computedAt: null` rendered as 1 January 1970 instead of unknown.

Green:

- `node --test --test-name-pattern="scoped refresh keeps|source enum" test/commandCenterBrowser.test.js` — 2 passed, 0 failed.
- `node --test --test-name-pattern="aggregation v1 device history" test/commandCenterBrowser.test.js` — 1 passed, 0 failed.
- `node --test test/leaderboardCore.test.js test/commandCenterBrowser.test.js` — 17 passed, 0 failed.
- `npm test` — 61 passed, 0 failed.
- `node --check` for the changed JavaScript files — exit 0.
- `git diff --check` — no whitespace errors in scoped changes; only existing line-ending warnings were emitted.

## Files and commit

- `public/app.js`
- `public/leaderboard-core.js`
- `test/leaderboardCore.test.js`
- `test/commandCenterBrowser.test.js`
- `test/support/command-center-server.js`
- `.superpowers/performance-client-fix-report.md`

Commit: the `fix: preserve truthful client cache metadata` commit containing this report.

## Remaining concerns

- This scoped pass did not deploy, connect to real MongoDB, or alter backend behavior. Integrated live-origin verification and final independent review remain with the root task as assigned.
