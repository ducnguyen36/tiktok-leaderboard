# Private leaderboard access

The new server starts locked. With absent or invalid Google settings it serves the setup/pairing shell, but no rankings, avatars, history, debug output, app scripts or SSE. `/api/health` reports only `{ "status": "ok" }`; it indicates a responding process, not database readiness.

## Configure Google before cutover

1. Choose a stable HTTPS origin. For the current domain, set `PUBLIC_ORIGIN=https://ranking.heliostalent.online` (no trailing slash). Temporary tunnel URLs change the OAuth callback and require another Google configuration update.
2. In Google Cloud Console, create or choose the application project. Configure Google Auth Platform branding and audience. Create an OAuth client of type **Web application**.
3. Register the exact authorized redirect URI `https://ranking.heliostalent.online/auth/google/callback`. For another origin, the URI is `${PUBLIC_ORIGIN}/auth/google/callback`. The application uses the server authorization-code flow with `openid email` only; no Drive or other Google API permission is needed.
4. Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the server's private environment file or secret manager. Do not put them in browser JavaScript, screenshots, Git, or messages.
5. Set the confirmed administrators exactly:

   `ADMIN_EMAILS=ducnguyen36@gmail.com,heliostalentofficial@gmail.com,kimlinh727@gmail.com`

   If `ADMIN_EMAILS` is omitted, these same three accounts are the default. An explicitly supplied value replaces that list; an explicitly empty value keeps access locked.

6. If the Google consent app remains in **Testing**, add all three accounts as Google test users. Google test-user eligibility and this application's administrator allowlist are separate checks. Enable Google 2-Step Verification/passkeys on these accounts.
7. Keep TLS certificate validation enabled. The server enforces `NODE_TLS_REJECT_UNAUTHORIZED=1`; fix trusted CA/network configuration if certificates fail. Never restore the old compose TLS bypass.

Google reference: [OpenID Connect server flow](https://developers.google.com/identity/openid-connect/openid-connect). Token exchange and signed ID-token verification use the official `google-auth-library`. State binds the callback to an HttpOnly browser cookie; nonce, S256 PKCE, audience/issuer/signature/token expiry verification and verified email allowlisting protect sign-in. OAuth state can be consumed only once.

## Enroll and use browsers

Open `/auth` on an administrator's browser and sign in with an allowed Google account. The admin session expires after 12 hours. On a TV/browser, generate a pairing code and keep that page open. On the administrator's phone, enter that code, check which screen requested it, give the device a recognizable name, and approve it. The TV polls every five seconds and opens the leaderboard when approved.

A code expires within ten minutes (or at the current pending browser session's earlier expiry). Generate another after expiry. Codes are single-use; knowing a code does not grant the entering browser access. Authorization attaches only to the independent secret in the original requesting browser's HttpOnly cookie. Approved browser access lasts 180 days. Administrators can list approved browsers, last seen and expiry, revoke any browser, and log out their own current browser at `/auth`.

Cookies are HttpOnly, SameSite=Lax, Secure for HTTPS and host-only. Plain HTTP is permitted only for localhost/127.0.0.1 development origins. Tokens are never stored in localStorage. On access loss, the app hides the page, clears all leaderboard localStorage keys (including saved settings containing talent names and history), blocks late JSON responses and navigates to `/auth`. This privacy cleanup resets saved leaderboard settings for that browser.

## Persistence, operational behavior and limits

MongoDB collection `leaderboard_access` stores SHA-256 hashes of opaque session secrets, pairing codes and OAuth state, with explicit expiration times. The database user needs read/write and index creation for that collection. MongoDB TTL cleanup is only housekeeping: every authorization and code consumption checks expiry independently. Pairing approval and callback consumption use atomic operations. No Google access/refresh/ID tokens are persisted.

Auth store failure denies data. There is no environment or HTTP bypass. The access boundary runs before all static, root and API handlers. Only exact shell assets, auth routes and minimal health are public; unknown paths never bypass it. Protected and auth responses enforce `private, no-store` at header emission, including static/avatar responses. No wildcard CORS is enabled. POST mutations require exact configured Origin plus a session-derived CSRF token and admin capability where needed; JSON bodies are limited to 4 KiB.

Persistent per-source-IP budgets are 20 sign-in starts, 30 mutations and 1,200 status requests per minute. Forwarded IP headers are deliberately not trusted. A reverse proxy/tunnel may share that budget among browsers; if legitimate use exceeds it, adjust the limits with an explicit deployment review. SSE validates before each send and independently every five seconds, closing on revocation, expiry or store errors. A disconnected/hidden browser checks again when visible; it cannot guarantee removal of already captured data while offline.

Browser approval is not physical-device binding: an approved browser profile, copied cookie, screenshot, recording or offline copy can retain previously obtained data. This control cannot recall those copies. Use trusted managed screens and operating-system access controls. MongoDB access is security sensitive because its records authorize browsers.

## Stage, verify and cut over

This implementation does not restart the old process, push, publish an image, or deploy. New guard JavaScript is injected only by the new server when rendering protected HTML; it is not added to shared static HTML that the old running process still serves.

Prepare a separate staging process/container and database, with its own stable origin and registered callback. Verify a real Google login for the allowed accounts, deny an unrelated account, request and approve a TV code, revoke it while its SSE is connected, and confirm a fresh private/incognito browser cannot read direct app/API/avatar/overlay URLs. Verify store loss closes access and that login works again after database recovery. These live Google and MongoDB checks need real staging configuration; injected test providers are not evidence of live sign-in.

Only after enrollment and staging checks are confirmed should the operator schedule the production restart/cutover. Check Watchtower/automatic image updates before publishing an image: pushing the image can restart the NAS. Remove any CDN cache-everything rule for this origin and purge old public responses during the authorized cutover. Previous publicly cached files or already-running old pages are not retroactively protected by a source change.

After cutover, repeat direct unauthenticated requests against the public HTTPS domain, check `Cache-Control: private, no-store`, and verify all three administrators can manage devices. `/api/health` alone does not prove that access configuration or MongoDB works.

## Recovery

Correct `PUBLIC_ORIGIN`, Google client/redirect settings, or the confirmed `ADMIN_EMAILS` configuration and restart the new service during an authorized maintenance window. A removed administrator loses authorization on the next request after the configured server restarts. Expired administrators sign in again; expired/revoked browsers request a fresh code. If MongoDB is unavailable, restore database connectivity and permissions. There is no undocumented unlock URL, default password, or no-config fallback to public data. Rolling back to an old unauthenticated image would reopen data and must not be used as an automatic access-recovery step.

Local verification: `node --test test/leaderboardAuth.test.js test/accessGuard.test.js test/accessUi.test.js`, then `npm test`. The auth suite uses a temporary Express application and injected in-memory store/provider; its actual-server integration additionally starts an isolated locked child process on a temporary port with no real credentials or database.

### Local verification recorded on 2026-09-18

- Combined access/mobile implementation, including final accessibility fixes at `fc395ae`: `npm test` — 97 passed, 0 failed (independent final run: 34.18 seconds). Independent scoped re-review closed all findings; ready for local handoff, not deployment.
- `npm audit --omit=dev` — 0 reported vulnerabilities, with TLS certificate verification enabled.
- Separate actual-server probe: all 13 private HTML/API/avatar/overlay/SSE paths returned 401 without credentials; `/auth` remained reachable. The probe used an unavailable loopback database, not production MongoDB.
- Phone portrait 390×844 and landscape 844×390, desktop/TV layouts, optional history tabs, language changes, settings and phone-to-TV resizing are covered by browser tests. Fixture screenshots were inspected at 390×844 and 1920×1080.
- Real Google login, auth-record persistence in a staging MongoDB, administrator enrollment and public-domain cutover are **not verified or activated**. The existing local process was left running without the new access guard.
