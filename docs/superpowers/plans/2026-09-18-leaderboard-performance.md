# Leaderboard performance implementation plan

> Execute with subagent-driven-development and verification-before-completion. User approved all four performance changes; no further design questions. Keep the existing feature checkout and local live origin.

**Goal:** Fast context-correct first paint and low-transfer updates without changing point attribution.
**Architecture:** MongoDB preaggregation replaces raw gift downloads; a versioned context cache serves warm reads and background revalidation. Incremental invalidation refreshes affected gift subsets where safely identifiable; unsafe changes recover through a complete authoritative rebuild. Manual fresh requests remain authoritative and scoped.
**Tech:** Existing Node/Express/MongoDB and vanilla browser client, node:test/Playwright.
**Spec:** User-approved diagnosis in this conversation: cache-first, minimal projected data, database aggregation, incremental realtime updates. Existing monthly windows and ranking rules remain binding.

## Global constraints

- Preserve manual inclusion for groups/exclusion for idols, per-gift floor splitting, UID/name/session fallback, full-cost single-group attribution, month grace and Vietnam 07:00 close, daily reset/freeze.
- Five equal columns and all current Settings remain unchanged. No remote deploy, secret output, destructive DB operations or new paid dependencies.
- Cache key includes reset/freeze and date-window identity; wrong-context or expired-window snapshots must not be served. Cold errors must be explicit. Failed refresh retains previous data with stale/error metadata, never false fresh success.
- History is immutable complete exact-month archive; reuse already completed archive. Performance implementation must not silently change points.
- Read-only real Mongo comparisons authorized; startup normal application cache writes already authorized. No diagnostic source-data edits.

## Task 1: Backend aggregation/cache/realtime

Files: server.js, new performance modules, backend tests, Dockerfile as needed. Agent owns these; root owns browser files/docs.

Contract: `GET /api/leaderboard/current?resetHour=0&freezeUntil=09:00` returns `{status:'ok',data,meta:{source,stale,computedAt,contextKey}}`, warm cache immediately; cold awaits authoritative result. `source` is exactly `computed`, `cache` or `snapshot`; `computedAt` is computation-start ISO time. `GET /fresh` remains forced authoritative with the same metadata. A successful read raced by newer source events may truthfully have `stale:true`; do not require a quiet database to publish. Context key serialization is opaque to the client. Do not persist per-column filter choices. Existing SSE can carry invalidation; browser revalidates through `/current`, never creates `/fresh` loops.

History compatibility amendment: removing inherited top-50 truncation requires aggregationVersion2 archives. Preserve immutable version1 documents, create version2 identities, and reject version1 device cache before refetching; point attribution math remains unchanged.

- [x] Write failing parity tests exercising the real old and new aggregators: multi-recipient unequal cost, duplicate recipients, group pool floor after accumulation, manual values, group/session fallback, renamed UID, multi-profile, zero rows, daily/month boundary.
- [x] Implement server-side compact preaggregation using only necessary fields; preserve exact floor timing. Mongo can emit weighted recipient/cost/session/time-window buckets and JS resolve profile attribution, if this avoids full gift transfer and parity holds. Export/reference old calculation for differential tests rather than copy inconsistent rules.
- [x] Test/implement context-correct warm cache, dedup, explicit forced errors, stale metadata and window rollover; durable cache must include identity/version/computation time.
- [x] Test/implement incremental refresh for safe changed subsets; inserts/updates with known sessions should not scan the full month. Unsafe deletes/session reassignment/stream gaps must invalidate and recover correctly, not accumulate drift. Bound memory/cache eviction and in-flight races.
- [x] Integrate live + history reads and minimal projection, preserve compatibility, Docker packaging. Run focused tests/syntax and commit owned files.
- [x] Report exported benchmark/parity interfaces for root to run read-only actual Mongo comparisons, and exact incremental fallback conditions.

## Task 2: Cache-first frontend

Files: public/app.js, public/keep-awake.js if necessary, test/commandCenterBrowser.test.js, test/support/command-center-server.js.

- [x] Write failing tests proving initial/automatic/SSE loads use `/current`, manual column/global refresh `/fresh`, pending automatic calls cannot cancel/override manual results, stale/computation timestamp presented honestly, old data retained on failure.
- [x] Split in-flight identity by context and forced flag; ignore automatic refresh while manual is pending; maintain existing per-column response guards.
- [x] Use server computedAt for data timestamp rather than fetch time; mark cached/stale explicitly. Preserve rows while background revalidation runs.
- [x] Keep TV periodic refresh from interrupting a pending data fetch; use tested behavior, not global private test hooks.
- [x] Run full browser/core suite, retain responsive checks and commit owned files.

## Task 3: Integrated verification and review

- [x] Compare real optimized output against legacy calculations on read-only fixtures or actual bounded database dataset; record transfer sizes, cold/warm durations and exact point equality.
- [x] Run all tests, syntax checks and independent review; address confirmed findings with scoped regression tests.
- [x] Restart only the local live server at 57022 with TLS validation enabled, verify real first paint/history/manual refresh and warm reload, leave production deployment unchanged.
- [x] Record measured results and remaining caveats; no unsupported performance promises.
