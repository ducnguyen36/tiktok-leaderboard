# Private leaderboard access and mobile view

Approved: Google administrator sign-in plus individually approved browsers. User confirmed three administrators: ducnguyen36@gmail.com, heliostalentofficial@gmail.com, kimlinh727@gmail.com. These are the only allowed admin emails; compare verified Google identity, never a client-supplied email.

## Security boundary
- Unknown browsers receive only a pairing/login shell, never scores, avatars, debug data, history or SSE events. Protect at the server, including direct static/overlay URLs.
- Google authorization-code flow uses state bound to an HttpOnly browser cookie, nonce, PKCE and official ID-token verification. Scope is openid/email only. No Google login on TV required.
- TV requests an expiring pairing code. An authenticated administrator enters the code, identifies/names the device and approves it. Approval attaches to an independent random browser secret, not possession of the displayed code alone.
- Store hashed opaque session/device/pairing secrets persistently in MongoDB; server checks expiry/revocation on every request. Cookies HttpOnly, SameSite=Lax, Secure on HTTPS. No tokens in localStorage or URLs.
- Admin can list and revoke approved browsers, see names and last seen; mutations need same-origin/CSRF protection and bounded rate limits. Auth stores unavailable means denied, not unlocked. SSE connections close on revocation and expiry. Client clears sensitive displays and history cache when access is lost.
- All protected responses are private/no-store; no permissive CORS. TLS certificate validation must remain enabled. Public health reveals no confidential application data.
- Default new server is locked, even if OAuth configuration is missing: a setup-required shell is allowed, data is not. Existing running process and production deployment stay untouched until OAuth configuration and administrator enrollment are verified. No deployment/push in this task.
- Recovery uses correcting environment allowlist/OAuth configuration and restarting, not an undocumented bypass. Explain browser approval is not physical-device binding, and cannot prevent photos or offline copies already obtained.

## UI
- Pairing and administration are usable on phone and TV, English/Vietnamese, accessible labels. Safe text rendering for device names. Administrator session lasts 12 hours; device approval 180 days; pairing 10 minutes; pending browser polling 5 seconds.
- At narrow phone widths (<=767px), show one leaderboard selected by touch tabs, normal vertical list scrolling, no automatic vertical animation. Landscape phones up to 950px wide and 500px high use the same layout. Larger desktop/TV retain five equal columns plus optional sixth, existing sizing, shortcuts and settings.
- Mobile settings must allow all controls to be reached without clipping. Logo and total points never overlap. History tab appears only when column six enabled. Preserve existing filters, language, defaults, full numbers, points toggles and ticker behavior.

## Verification and handoff
- Automated tests cover unauthenticated access, pairing, allowed/denied identities, callback state/nonce, expiry, CSRF, rate limits, revocation including SSE, and server-route integration.
- Browser tests cover mobile tabs/history, language, settings and viewport changes; regression suite preserves TV.
- Document exact Google OAuth callback and setup steps. Never claim a live Google sign-in or production lock was verified without credentials/live evidence.
