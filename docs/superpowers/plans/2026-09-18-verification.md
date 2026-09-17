# Command Center verification and local handoff

## Scope

The production public client and server integration are implemented on `feat/helios-command-center`. Fresh/migrated settings show five equal columns; Last Month Ranking starts hidden. This work has not been pushed, merged or deployed.

The local fixture preview is started with `npm run preview:test` at `http://localhost:57021/`. It serves the actual production HTML/CSS/JavaScript against explicitly labeled TEST data. It does not connect to MongoDB and must not be treated as a live leaderboard.

## Repeatable checks

- `npm test`: pure core/month-window/history tests and browser regression tests.
- `npm run test:unit`: no browser required.
- `npm run test:browser`: Playwright uses installed Google Chrome by default; `PLAYWRIGHT_CHANNEL` can select another installed supported channel.
- `node --check server.js`, `leaderboardHistory.js`, `public/app.js`, `public/leaderboard-core.js`, and `public/keep-awake.js`.
- `git diff --check`.

Browser checks use the actual renderer at 1920×1080, 1366×768, 1440×900, 1280×720 and 2560×1080. Coverage includes equal-width five/six layouts, viewport and Settings bounds, genuine avatar loading, full numbers, centered gear, persistence/migration/defaults, keyboard/input isolation, remote navigation, long hold, idle fade, scoped refresh, retained data on failure, and history scrolling.

## Review-driven regressions

- Back cancels an input edit, including native input change events; OK commits it.
- Tab while editing must remain inside the Settings dialog.
- Scoped monthly refresh must not relabel retained frozen daily snapshots as live.
- Yesterday comparison hints require actual comparison data; missing values are not invented as zero.
- Exact historical month and provisional status are visible without hovering.
- Authoritative refresh rejects failed profile/session/location reads and cannot reuse permissive legacy work.

## Backend boundary checks

Injected archive persistence tests cover month/year/leap boundaries, 06:59/07:00 Vietnam closing, provisional versus complete requests in flight, empty cache hits, deduplication, strict failures and retry. Complete snapshots use an immutable atomic upsert; provisional results are not persisted.

Unavailable-database HTTP smoke used only a deliberately unreachable localhost Mongo URI. Valid fresh/history/legacy-history requests returned 503, and malformed contexts/months returned 400. No configured remote database was accessed for this smoke.

## Limits

- No physical TV/remote hardware test; browser keyboard and viewport behavior were tested.
- Initial verification did not access MongoDB. The later user-authorized live local run is recorded below; no remote production deployment was performed.
- Docker is unavailable on this host, so no container build was run. Dockerfile includes the new history module and excludes fixture/test artifacts.
- The dependency audit reports three existing transitive production vulnerabilities (one low, one moderate, one high). Dependencies were not force-upgraded as part of this UI change.

## Final execution result

- `npm test`: 39 passed, 0 failed (35 unit/service checks and 4 browser regression cases), fresh run on 2026-09-18 after final fixes.
- All five JavaScript syntax checks passed; `git diff --check` passed (only Git's Windows line-ending conversion notices).
- Independent scoped rereview confirmed the backend and four frontend findings resolved; no remaining confirmed findings in that scope.
- The final 1920×1080 screenshot was visually inspected: five equal columns, full rows, transparent Asset 23, visible full point values and no page overflow.

## User-authorized live local run

- On 2026-09-18, started the actual server at `http://localhost:57022/`, separate from fixture origin/cache at 57021, using the configured MongoDB. TLS certificate verification is enabled for this process.
- Health returned 200/ok; Mongo gift change-stream events were received.
- Actual browser verification returned five visible columns, 72 rows, total 723,615, LIVE connection, no TEST DATA marker and no viewport overflow. At verification time, the configured 09:00 freeze correctly labeled daily values as yesterday.
- History API returned HTTP 200, source `snapshot`, complete August 2026 period, with 50 idols. Normal application cache/snapshot writes occurred during this authorized run.
- Real remote aggregation took approximately four minutes per build. The client's former 45-second abort prevented initial rendering; changed its bounded wait to ten minutes with a red/green regression. This accommodates slow aggregation, not a claim that aggregation performance is optimized.
- Production avatar strings use relative `userdata/avatars/...` paths. Added normalization with a red/green renderer regression; a real avatar request returned 200/image/jpeg.
- Final suite after these live integration fixes: 40 passed, 0 failed. Physical TV hardware remains untested.
