# Helios Command Center Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans or superpowers:subagent-driven-development for task execution with verification.

**Goal:** Replace the old rotating leaderboard with the approved V19 command center, connected to real data, defaulting to five columns.
**Architecture:** Preserve existing gift aggregation and overlay; replace presentation with the approved DOM/CSS and isolate validated settings, data selection, history cache and animation math in testable helpers. Add an explicit context-aware fresh-data endpoint and a persistent exact-period monthly archive.
**Tech Stack:** Express, MongoDB, vanilla JavaScript/CSS, node:test, browser verification.
**Spec:** docs/superpowers/specs/2026-09-18-command-center-settings-design.md

## Global Constraints

- Five equal-width columns by default. Column 6 is hidden by default, including migration from old preview keys; explicit production settings may opt in.
- No rotation, theme, podium, avatar visibility or tab cycling. All UI English. Asset 23 transparent, centered lockup.
- Keys 1–5 scores, 6 last month, 7 settings, 8 refresh, 9 total; last-month scores always visible.
- No public deployment, secret output, unrelated edits or raw database writes in tests.
- Last month closes at 07:00 Vietnam on day 1; cache the unfiltered complete month, not grace display data.
- Keep real aggregation, overlay and wake behavior. Never substitute fixtures in the production API.

### Task 1: Server refresh and history

Files: server.js, leaderboardHistory.js, test/leaderboardHistory.test.js.
Interface: GET /api/leaderboard/fresh?resetHour=0&freezeUntil=09:00 returns {status:'ok',data}; GET /api/leaderboard/history?month=YYYY-MM returns {status:'ok',data:{individual,group},period:{month,start,end,complete},generatedAt,source,aggregationVersion:1}.
- [x] Write failing tests for exact Vietnam period boundaries, leap year/year rollover, empty snapshot cache hits, concurrent builds, failure-not-cached, provisional month.
- [x] Implement pure period helpers and injected archive service; upsert complete documents atomically with deterministic _id.
- [x] Adapt existing aggregation for historical rows with groupId/locationId. Deduplicate serialized fresh builds by reset/freeze context, never return unrelated stale data as a successful refresh.
- [x] Check latest closed month on startup and every minute; no source data changes; retain existing routes/overlay.
- [x] Run focused tests and node --check server.js; review errors and cache semantics.

### Task 2: Settings, renderer and live integration

Files: public/index.html, public/style.css, public/app.js, public/leaderboard-core.js, public/keep-awake.js, public/helios-asset-23.png, test/leaderboardCore.test.js.
Interfaces: UMD HeliosCore exports defaults/normalize/migrate/selectRows/total/historyMonth/historyValid/scrollFrames; public app consumes Task 1 endpoints.
- [x] Test five-column default, independent score flags, strict field/number validation, legacy migrations, exclusion filters, top10 versus all, full numbers, previous calendar-month selection and endpoint pauses.
- [x] Extract approved V19 layout without sample rows; use empty/loading/error states and safe DOM text. Preserve overlay files untouched.
- [x] Connect real avatars, daily/monthly rows, frozen/yesterday labels, group-based total and real milestone banner.
- [x] Persist current/default separately; ignore prototype settings. Dynamic location selection and paginated groups, all Settings menus accessible without scroll.
- [x] Wire context-aware fetch with stale-response guards, SSE invalidation with polling fallback, exact-month browser cache, per-column refresh and global deduplication.
- [x] Preserve remote navigation, long hold, three-second fade, pause/reverse motion, and wake strategies without recording or rotation.

### Task 3: Regression verification and handoff

Files: test/commandCenterBrowser.test.js, test/support/command-center-server.js, docs/superpowers/plans/2026-09-18-verification.md.
- [x] Run node --test test/*.test.js and syntax checks. Serve actual public files against a localhost fixture API only for repeatable UI tests.
- [x] Verify viewports 1920x1080, 1366x768, 1440x900, 1280x720, 2560x1080; equal columns, no page/Settings overflow, genuine images, full values.
- [x] Exercise save/restore/reload, 1–9 hotkeys, keyboard hierarchy, input isolation, five/six, refresh success/failure, idle fade and empty data.
- [x] Independent code review, fix confirmed issues, rerun covering checks. Keep local implementation available; report physical TV and real database verification limits accurately.

## Execution ledger

- Baseline: 12 monthly-window tests pass. Existing branch had only unrelated/untracked local material; new feature branch feat/helios-command-center in the same checkout, avoiding moving local assets or configuration. No deploy.
- Latest user approval authorizes implementation without further design questions. Supersede stale spec mentions of themes, T and Shift+6 with latest amendments.
