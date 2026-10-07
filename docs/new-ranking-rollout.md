# New ranking opt-in rollout

The existing `/` leaderboard, its API and settings are unchanged. `/auth` offers
an explicit old link and `/new` link. No default switch or automatic promotion.
The new frontend stores settings under `helios_leaderboard_next_current`, initially
copying existing language/visibility/point preferences. Daily timing is fixed at
06:00 Vietnam time with no freeze, separately from existing monthly 07:00 windows
and first-day grace. Keep the four existing top boards; replace the wide monthly
ranking area with one monthly talent column and one stacked Today talent/group
column. Last Month replaces that side column; Today can be hidden in settings.

## Daily attribution

`rankingNext.js` queries session IDs and counts all gifts of sessions that started
in today's/yesterday's 06:00 windows, not gift timestamps. A live crossing reset
remains assigned to its start day. No session means no daily manual points.
Existing monthly scores/history continue using the original scoring/window API.
Monthly/today scores refresh through authenticated SSE invalidation plus 5-second
frontend polling. Server builds are single-flight with a 15-second cached result;
stale/error state is displayed, not silently described as fresh.

## HeliosControl producer

`helioscontrol/modules/leaderboardLive.js` writes a `leaderboard_live` document
per connection publisher, with profileId, sessionId, live, liveSince, heartbeatAt,
liveEndedAt and source. Its actual TikTok connection decides `live`, never gift
activity. Heartbeat interval is 30s; leaderboard expires leases at 90s, including
cached/browser results. Stop on explicit disconnect, socket loss or stream end.
Independent publisher IDs prevent one controller from clearing another.
Lease writes stay in the database selected at connect (Test DB isolation).
Profile talents inherit that group's connection status; history never shows live.

On reconnect on a different 06:00 day, HeliosControl flushes pending gifts before
creating a new session. It does not split or reset an ongoing live at 06:00.
The producer must be installed on the machines running HeliosControl. Editing
source alone does not establish that production controllers are reporting live.

## Sheet discrepancy safety

Fixed eight-sheet allowlist; read-only existing encrypted connection. Refresh at
most once per five minutes, single-flight. Inspect exact month metadata, then read
bounded A1:U100. Support merged-date continuation rows (two shifts). Match talent
names case/accent/whitespace normalized, not speculative aliases; fail closed on
unmatched/duplicate columns or wrong-month copied dates. Empty formula zeros are
not filled data. Ignore open/current days and sessions with an active live lease.
Compare full group totals once, add shared points evenly to talent scores without
double counting. Warnings compare exactly the same subset of filled, completed
session days; details show those dates, both values, difference and source link.
Strict threshold: absolute difference >1000. The warning is not a comparison of
an unfinished live/month total against a sheet that has not been filled yet.

The inspected VELIX October tab contains September dates, so it is excluded with
`date_month_mismatch` until corrected by its owner. Other unrecognized layouts
or roster/header differences are shown as unavailable, not false discrepancies.

## Deploy / rollback

- Include rankingNext.js and sheetReconciliation.js in Docker COPY.
- Authentication guards `/new`, HTML aliases, its assets and API just like `/`.
- Content hashes version new runtime assets; private HTML remains no-store.
- Verify old/new links, Today/Yesterday, Last Month upper/lower sources, hidden
  Today + Last Month override, reload persistence, mobile widths, warning dialog,
  heartbeat timeout and disconnected source behavior.
- Production smoke: existing `/auth`, `/api/health`, old ranking and new ranking.
- If the new view misbehaves, open old from `/auth` or the new view's old link.
  No data migration or deletion is required; do not remove the avatar/key volume.
- A controller patch changes no credentials. Back up server.js before installation
  and restart the controller only between live sessions. Restore the backup and
  remove the optional new module to roll back; preserve .env and user data.

Local synthetic tests are not proof of an actual live heartbeat or reconciled
production scores. Record those verification levels separately.
