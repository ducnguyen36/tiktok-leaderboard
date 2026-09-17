# Private Access and Mobile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict confidential leaderboard data to Google administrators and explicitly approved browsers, with a usable phone layout.

**Architecture:** A focused Express authentication module precedes every protected handler. MongoDB persists opaque credentials; a dedicated public access shell supports Google login and pairing. Existing leaderboard UI gains mobile tab presentation and access-loss handling without changing aggregation.

**Tech Stack:** Node 22, Express 5, MongoDB 6, google-auth-library, vanilla browser JS/CSS, node:test and Playwright.

**Spec:** docs/superpowers/specs/2026-09-18-private-access-mobile.md

## Global Constraints
- Administrators: ducnguyen36@gmail.com, heliostalentofficial@gmail.com, kimlinh727@gmail.com only by default.
- Default new server is locked, even when OAuth configuration is missing. No production deployment, no disabling TLS validation, no secrets in source or reports.
- Existing running localhost:57022 stays available until configured replacement is verified; do not restart it during development.
- Preserve .claude and unrelated user changes. Work on existing feat/helios-command-center branch as requested; no main branch edits.
- English/Vietnamese; five columns by default; optional history column; no aggregation or talent identity changes.

### Task 1: Server access control and pairing/admin UI

**Files:** Create `leaderboardAuth.js`, `authStore.js`, `public/access.html`, `public/access.js`, `public/access.css`, `public/access-guard.js`, `test/leaderboardAuth.test.js`, `docs/private-access.md`; modify `server.js`, `public/index.html`, `public/overlay.html`, `package.json`, `package-lock.json`, `.env.example`, `Dockerfile`, both compose files.

**Interfaces:** Export a factory `createLeaderboardAuth({getDb, config, googleClient})` returning a middleware/router plus a stream authorization guard; injectable provider and store dependencies only for tests, not HTTP-controlled bypasses. Public auth endpoints under `/auth`, protected app endpoints unchanged. `/auth/status` supplies current authorization and admin capability; `/auth` serves pairing/admin shell. `public/access-guard.js` regularly checks status, clears leaderboard content/history cache and redirects to `/auth` on denial; app responses remain blocked server-side independently.

- [ ] Write failing request tests using a temporary Express app, in-memory test store and injected provider. Require unknown `/api/leaderboard/current`, `/api/leaderboard/history`, `/userdata/avatars/x.jpg`, `/overlay.html`, `/index.html`, `/api/debug`, and SSE to deny. Assert no-cache and no permissive CORS. Example assertion:
```js
assert.equal((await fetch(base + '/api/leaderboard/current')).status, 401);
```
- [ ] Test valid allowlisted verified Google claims, invalid email/verification/state/nonce, replayed callback, one-time pair-code approval tied to requester cookie, expired code/session, non-admin mutations, bad Origin/CSRF, bounded requests and fail-closed store errors. Use real middleware requests rather than asserting mocked functions.
- [ ] Run `node --test test/leaderboardAuth.test.js` and record expected failures.
- [ ] Implement server-side auth with official Google verifier, hashed credentials and explicit expiry checks, same-origin protections, rate limits, no-store headers, exact public route allowlist. Connect Mongo store via existing DB getter without exposing DB to shell. Register middleware BEFORE static/root/API handlers. Guard existing SSE connection lifetime (including periodic reauthorization).
- [ ] Implement bilingual pairing/admin shell, named device approval/list/revoke/logout, error and setup-required state. Implement client access-loss guard for app and overlay. Allow public logo assets only by exact path where necessary; confidential avatars stay protected. Serve access shell even without OAuth config, never leaderboard data.
- [ ] Add environment variables `PUBLIC_ORIGIN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ADMIN_EMAILS`; official callback `${PUBLIC_ORIGIN}/auth/google/callback`. Document Google Cloud web client setup, test-user list if app remains in testing, Google account 2-step recommendation, staging/cutover/recovery and limitations. Remove compose TLS=0; include new server modules in Docker.
- [ ] Patch existing vulnerable request-parser/router transitive packages in their allowed version ranges using `npm update body-parser path-to-regexp qs` with TLS verification enabled; run `npm audit --omit=dev`. Do not force major upgrades. Add avatar basename/image-extension validation to keep authorized viewers inside avatar roots.
- [ ] Run auth tests and full `npm test`, self-review and commit only task files. Report RED/GREEN evidence and remaining live-configuration requirements.

### Task 2: Phone layout preserving TV

**Files:** Modify `public/index.html`, `public/style.css`, `public/app.js`, `public/i18n.js`; create `test/mobileLayout.test.js`; adjust `test/headerResponsive.test.js` only where phone behavior intentionally changes.

**Interfaces:** Existing `.board[data-column]` indices 0..5 and `config.lastMonth` remain authoritative. Add an accessible mobile tablist selecting visible board; switching tabs never refetches the same loaded payload. `/auth` is access management destination from settings for administrators/paired devices, not a bypass.

- [ ] Add Playwright tests at 390x844, 844x390, 1920x1080: mobile one visible board, 5 tabs by default, optional history sixth, no horizontal page overflow, readable full list reachable by vertical scroll, logo/KPI nonoverlap, all settings reachable, resize restores TV five equal columns. Example:
```js
assert.equal(await page.locator('.mobile-board-tabs [role=tab]').count(), 5);
```
- [ ] Run `node --test test/mobileLayout.test.js` and record failures.
- [ ] Implement media-query mobile layout, live tab selection with translated labels and ARIA selected state, normal vertical list scrolling and disabled automatic vertical animation while narrow. Reconfigure animations when resizing back. Keep TV viewport fixed. Include access-management link in settings.
- [ ] Run focused mobile/header/language tests then `npm test`; capture and inspect phone plus desktop screenshots; commit task files and report evidence.

### Task 3: Integration/security review and staged verification

**Files:** Tests and documentation touched only if review exposes concrete gaps.
- [ ] Review Task 1 and Task 2 changes for server protection ordering, caching, Google identity binding, approval/revocation, mobile/TV behavior and preservation of existing config.
- [ ] Run complete suite once on final code. Verify actual integrated server on a separate loopback port denies all confidential routes without OAuth configuration. Never point tests at production or modify real device approvals.
- [ ] Record implemented features, tests, and exact outstanding Google configuration steps in `docs/private-access.md`; tell user explicitly whether production is still unlocked.
