# Helios Command Center: reviewed settings and integration design

Status: V19 design approved; application integration implemented locally on feat/helios-command-center. Final regression: 39 tests passed, scoped independent rereview passed. Not deployed; physical TV and live MongoDB verification remain pending.
Prototype: .superpowers/brainstorm/257-1789668290/content/tv-v19-remote9-gear.html.

## Latest user amendments (override earlier conflicts below)

- Implementation authorized without further confirmation. Initial and migrated configurations show five columns; Last Month Ranking is hidden by default. An explicit saved production preference may enable it; preview localStorage is never migrated.

- V19: replace font glyph gear with a centered 24px SVG matching the toolbar icons. Use key 9 (not T) to toggle today's total; update Display label and shortcut help. Browser verification: 9 toggles off then on; SVG center offset is 0px on both axes. Physical TV remote verification remains pending.

- V18: user requested Asset 23 or 22; selected the original Asset 23.png (Drive ID 14ZvFCaKnDMM0I27Otoks49swk2oZ38a0). Transparent PNG with white interlocking square and colored gradient; 196px native width. Use helios-asset-23.png unmodified, replacing the earlier dark-square PDF variant. Retain centered placement and no tile. Browser folder listing exposed the asset even though connector search omitted it; direct fetch succeeded.

- V17: center the transparent logo and Helios Talent text together within the left header region, matching the reference placement. Keep the KPI region and all other dimensions unchanged.

- V16: remove the white logo tile and background. Use helios-brand-transparent.svg converted from the original PDF vector artwork with a symbol-only viewBox. Keep original colors, including black elements; do not recolor or redraw. This supersedes the V15 white-tile choice below.

- V15 branding: selected the full-color interlocking-squares mark from LOGO HELIOS Talent.pdf, Drive file 1zNOzVYoyuOFgwP6NsWODLWck2lcaP0R6 in the supplied folder. PNG subfolder was empty (connector and browser checked). Render the original PDF symbol region without recoloring; use a white tile to preserve its black elements against the dark dashboard. Preserve the source PDF locally at .tmp-brand/helios-original.pdf. Header wordmark is interface text, not a claim to reproduce the custom logo typography.
- Brand-derived UI palette (design approximations, not an official brand guide): charcoal #171614 / #1d1d1b, warm gold #ffcf5b, coral #f17965, rose #d85495, warm white #fff6ed. Replace competitor rainbow headers with muted amber-to-rose family, warm neutral sixth column; unify row dividers. KPI gold, ticker warm gradient with dark text, Settings/toolbar/focus states use the same palette. No selectable theme added. Geometry, controls, cached mock preferences and scroll behavior remain unchanged.

- Top-right toolbar contains three adjacent icon buttons: Last Month Ranking toggle, Refresh All, Settings. Last Month button shows active state synchronized with key 6 and Settings. Keep shortcuts and Settings controls. Toolbar shares a 3-second idle fade; keyboard focus keeps controls visible. Per-column refresh remains separate.

- Header activation is reveal-only: every click or Enter/Space shows its refresh button and restarts the 3-second idle timer. Repeated activation never toggles the button off.

- Each column refresh control fades out over 250ms after 3 seconds without interaction within its header/control. Pointer movement, pointer down, focus entry or key interaction resets its timer. Hidden controls are removed from tab order and pointer hit-testing; focus returns to the header when needed. Click or Enter/Space on the header reveals it again.

- Remove theme selector and theme behavior from the new design; do not migrate or expose the old theme choice.
- Last Month Ranking (column 6) always shows scores. Remove its score switch and Shift+6 shortcut; 6 still toggles the column.
- Footer: crossed-out camera icon plus NO PHOTOS OR VIDEOS ALLOWED.
- Gear fades out after 3 seconds without mouse movement; pointer activity restores it, keyboard focus keeps it available, and hold/7/S still work while hidden.
- Settings navigation has three levels: section sidebar, options, input editing. Up/Down in sidebar selects sections; Right/OK enters options. Up/Down traverses controls; OK toggles checkbox, activates button, or enters editing. OK commits an input; Back cancels edit and returns to the control; Left/Back from controls returns to sidebar; Back from sidebar closes. Arrow keys retain native input behavior while editing. TV Back/OK keycodes require actual-device verification.
The prototype deliberately uses sample data, including the sixth column. Refresh, yesterday/live request buttons demonstrate interactions and explicitly identify server integration as pending.

## Evidence from existing application

- public/app.js config, saveSettings, saveAsDefault, loadSavedSettings: both automatic save and Save as Default write the SAME localStorage leaderboard_config and leaderboard_theme keys. There is no separate saved baseline and no server-side settings persistence. V9 prototype used a separate mock key and did not migrate production preferences.
- Existing controls: two themes, group/individual presets, enabled tabs, per-tab score visibility, per-tab avatar visibility, yesterday points for two daily categories, location filtering, per-location group filtering, podium slots, list columns, force-horizontal, rotation, cycle duration, daily reset hour, freeze time, Save as Default, shortcuts. Toolbar also supports yesterday/live and last-month views.
- SSE with polling fallback; anti-sleep strategies; periodic 4-minute reload. Preserve operational behavior during UI integration, and test saved settings across reload.
- server.js /api/leaderboard/lastmonth has a process-memory cache with a 1-hour TTL. Browser lastMonthData is also process/page memory only. leaderboard_cache is a different persistent current-board snapshot, not a permanent monthly archive.
- monthlyWindows.js: business monthly boundary 07:00 on the first in Asia/Ho_Chi_Minh. Display grace keeps the prior month visible until 00:00 on the second. Existing lastmonth route returns the period preceding displayStart, so it may return an extra month back during grace. It does not return explicit period metadata or groupId for individual historical rows.
- /api/leaderboard returns cached data immediately and may rebuild in the background. A random cache-busting URL alone does not force an authoritative refresh.

## Retain, remove, and migrate

Retain daily/yesterday and temporary live controls, daily reset/freeze, location/group filters, score toggles, persistence, live connection, and wake behavior. Remove themes.
Remove rotation everywhere: config, UI, hotkeys, TV auto-rotation and old saved rotation values. Remove avatar toggles (avatars always visible), podium, layout column count, portrait and force-horizontal, tab visibility and tab cycling. Old group/individual presets depend on those removed concepts, so retire rather than execute their hidden side effects.

Five default equal-width columns: Daily Top Groups, Daily Top Idols, Monthly Top Groups, Monthly Top Idols, Monthly Ranking. Four Top columns cap at 10; Monthly Ranking contains all filtered idols. Optional sixth equal-width Last Month Ranking contains all filtered idols for the explicitly labelled previous calendar month/business window.
Keep avatar/name/score arrangement, crowns for ranks 1/2/3, full numeric scores, English text, and centered crossed-out camera icon.

Responsive canvas fills viewport width AND height: CSS grid, 100vw/100vh with minmax(0,1fr), min-width:0 and min-height:0. No fixed aspect-ratio letterboxing; no body scrollbar. Retain reference proportions at 1920x1080. Derive each row from available list height / 10. For 6 columns reduce horizontal spacing and title size while keeping equal widths. Test 1920x1080, 1366x768, 1440x900, 1280x720 and 2560x1080.

## Settings and input

Six navigation sections remain visible: Display, Timing, Locations & Groups, History & Refresh, Defaults, Shortcuts. Each panel fits viewport; groups and locations paginate when needed. Do not use hidden overflow to conceal required controls. Inputs remain keyboard editable.
Small icon-only gear, top right, clear focus ring. Hold left pointer/touch or remote OK for 1.2s to open; movement >12px, pointer cancel/release, blur and remote keyup cancel pending hold. Ignore holds inside interactive controls. Escape/TV Back closes. Trap focus and support arrows/Enter; verify actual Tizen/webOS keycodes on device. Pause rank animations while Settings is open; resume without resetting position.
Disable user-select / touch callout on the presentation. Do not intercept native input editing keys.

Keyboard: 1-5 score visibility by screen column order; 6 sixth-column visibility (scores always visible); 7/S Settings; 8 refresh all; 9 daily total; Escape/Back close. Ignore leaderboard hotkeys while editing settings.

User changes automatically persist current settings in V10, matching the existing app. Save as Default additionally creates an explicit baseline; Restore Saved Default restores that baseline. Both behaviors must be retained in production integration.
Use schemaVersion 2, separate current/default keys, store only allowed fields, validate numbers, deep-merge defaults, and handle storage failure visibly. Migrate existing showIncome, showYesterday, visibleLocations, visibleGroups, resetHour and freezeUntil on the SAME production origin. Ignore old theme/rotation/avatar/tab settings. Map old individual-monthly visibility initially to both current monthly idol columns; then allow independent choices. Never read other origins' localStorage or overwrite old keys.

## Last-month durable snapshots

Preserve existing monthly 07:00 closing boundary. On the first at 07:00 Vietnam time, compute the just-closed month from original records and save an atomic server-side snapshot. Do not capture the UI display buffer because grace may show a different period.
Persistent collection: leaderboard_monthly_snapshots; unique key period YYYY-MM + aggregationVersion + timezone + start/end. Store generatedAt, periodStart, periodEnd, group/individual entries, stable ids, groupId, locationId, name, avatar, value. Cache is unfiltered; apply device filters after retrieval. Empty completed months are valid cached results.
Server startup and periodic scheduler check for missing closed months and backfill the latest required period if it was offline at the deadline. Multiple requests share one in-flight build; unique keys prevent duplicate publications. Partial failures never mark a snapshot complete. Device need not be open at the deadline.
Explicit API proposal: GET /api/leaderboard/history?month=YYYY-MM. Validate month, return period metadata and source (snapshot/rebuilt). This is a new interface, not currently implemented.
Browser: cache historical payload keyed by exact month, boundaries and schema. Try valid browser cache, then server snapshot, then server rebuild. On month rollover select the new period and invalidate pointers to the previous request, not unrelated archives. Before 07:00 on day 1, previous calendar month is still accumulating: label provisional, do not save a completed archive; revalidate at close.
Refresh Last Month bypasses browser cache, revalidates server snapshot; if an explicit source recomputation is desired, implement a separate controlled force-rebuild behavior. Do not silently recalculate every frozen archive on global refresh.

## Refresh semantics

Click a header to reveal an accessible refresh button. Refresh updates that column only with a loading indicator and its own completion/error state. Keep old rows on failure; do not display a success timestamp until fresh data is received.
Add backend capability for a forced, scoped recomputation (whitelisted category/period) or reuse a shared authoritative aggregate then apply only the requested column; document its cost. Current GET endpoint is cache-first and cannot satisfy force-refresh by itself.
Refresh All in History & Refresh and key 8 deduplicates common queries; refresh current board data once, and historical data once only when the sixth column is shown. Prevent stale responses from replacing newer data; respect device filters/reset/freeze context. Monthly Top Idols and Monthly Ranking share the same aggregate in normal full refreshes. A scoped refresh deliberately updates only the selected column; remaining columns catch up at the next live refresh.
Daily total must be computed from one authoritative source, never by adding both group and idol totals (double counting). Label frozen/yesterday periods accurately; define source and filter scope explicitly in implementation.

## Motion

Ticker ~165 design px/s to the left, animate only on overflow, continuous equal-width repeated segments.
Monthly and Last Month rankings ~60 design px/s, stop 2s at EACH endpoint and reverse with linear motion. Only animate overflow; use measured content height, not a fixed percentage. Re-measure after resize/filter/data changes. Preserve scroll anchor/phase for score-only updates when possible.

## Verification and integration sequence

1. Isolate feature branch/worktree and preserve user's unrelated .claude files. Inspect current production origin and deployment workflow.
2. Integrate versioned settings/state migration with persistence checks; retire all rotation/tab/podium/avatar controls.
3. Replace renderer with shared equal-width rank panels, responsive Settings, keyboard/remote gestures, camera icon and score visibility.
4. Build durable period-specific archive and startup/scheduled catch-up. Test month/year rollovers, leap years, grace period, 06:59/07:00 and restart.
5. Connect per-column/global refresh with server error/loading behavior and request deduplication.
6. Validate DOM dimensions at listed viewports, settings pages without overflow, five/six columns, score hides, keyboard focus, long hold cancel, default save/reload, no text selection, empty/long lists and end pauses. Test on actual TV for remote/wake/fullscreen restrictions.
7. Review integrated UI and deploy only after production change authorization. Prototype screenshots and sample values must never become live leaderboard data.
