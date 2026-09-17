# Task 2 report — phone layout preserving TV

## Result

Implemented a single-board phone view for portrait widths up to 767px and landscape phones up to 950px wide / 500px high. The existing five/six-column TV presentation remains the desktop path.

- Mobile uses an accessible tablist derived from the live board headings, including frozen/yesterday and English/Vietnamese labels.
- The history tab exists only when column six is enabled. Disabling it while selected falls back to a valid current-month board.
- Mobile long rankings use normal page scrolling with no Web Animation. Switching tabs does not refetch data.
- Sticky tabs stay clear of the always-visible phone toolbar. Explicit tab activation resets the selected board to its header/first row; background label synchronization preserves the current scroll position.
- Hidden phone panels are inert and cannot receive focus.
- Phone settings fill the viewport, scroll vertically, and keep every pane/action reachable without horizontal overflow.
- Added a localized **Device access / Quản lý quyền truy cập** link to `/auth` inside the existing Shortcuts settings pane.
- Resizing back to TV restores equal columns, fixed-viewport layout, and ranking animation.

## TDD evidence

Initial RED:

```text
node --test test/mobileLayout.test.js
tests 3, pass 0, fail 3
expected 5 mobile tabs, actual 0
```

Sticky-toolbar regression RED:

```text
node --test test/mobileLayout.test.js
tests 3, pass 2, fail 1
touch tabs remain visible while manually scrolling a long board: false !== true
```

Final focused GREEN:

```text
node --test test/mobileLayout.test.js test/headerResponsive.test.js test/languageSettings.test.js
tests 6, pass 6, fail 0
```

Final complete suite:

```text
npm test
tests 96, pass 96, fail 0
duration 35.0s
```

`git diff --check` completed with no whitespace errors (Git emitted only the repository's LF-to-CRLF working-copy notices).

## Visual verification

- `mobile-phone.png` — 390×844, Monthly Ranking selected. Inspected: stacked brand/KPI do not overlap; toolbar is visible; five touch tabs fit; scores remain fully formatted and rows are readable.
- `mobile-tv.png` — 1920×1080 after phone-to-TV resize. Inspected: five equal columns, fixed viewport, complete footer, no vertical page overflow.

Both captures use the local fixture server and Chrome headless with `--disable-gpu`; no production endpoint was contacted.

## Scope and concerns

- No authentication backend, access UI, credential, deployment, or running port 57022 was changed.
- `public/index.html` does not statically include `access-guard.js`; server injection remains authoritative.
- No known implementation blocker remains. Live Google sign-in and production deployment were intentionally outside Task 2.
