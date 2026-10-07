# Google Sheets read-only connection

## Current implementation

An administrator can connect/reconnect Google Sheets in `/auth`, test reading,
and remove the server-side saved connection. Normal Google sign-in remains
`openid email`; Sheets consent is a separate admin-only, CSRF-protected flow.
The refresh token is AES-256-GCM encrypted in `leaderboard_access`, without a TTL.
No token or cell values are returned by the test endpoint.

The test checks all eight configured group entries, reads metadata first, locates
the current Vietnam-calendar month tab, and reads only `A1:L3`. It reports each
failure separately. All eight sheet IDs are configured, including the owner-supplied
AURA and 2026 DATA NEXAR links. The connection badge reflects saved credentials;
the separate per-group reading result persists across reloads for that connection.
This is a connectivity test, not score reconciliation or evidence of live score accuracy.

## Existing cloud configuration

Reuse project `helios-talent` (display name `helios-talent-leaderboard`).
Google Sheets API is enabled and `spreadsheets.readonly` is declared.
Keep the existing production OAuth client and callback:
`https://ranking.heliostalent.online/auth/google/callback`.
Declaring the scope does not grant any Google account permission.

## Owner-managed server configuration

Keep the existing server `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`PUBLIC_ORIGIN`, `ADMIN_EMAILS`, and access-control configuration.
Docker automatically creates a 0600 key in `/app/avatars/.private/sheets-token.key`,
inside the existing persistent avatar volume. This private subdirectory is not served
by the avatar endpoint (image basenames only). Back up the volume securely. The key
survives ordinary Watchtower recreation; do not remove the volume during rollback.
No manual secret setup is needed for this standard production Docker layout.

For non-Docker installations, or an explicit owner-managed override, add
`SHEETS_TOKEN_ENCRYPTION_KEY` as 64 hex characters representing 32 random bytes.
Generate it on the server or via the owner's secret-management interface:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Store the result in server configuration only, never in chat, source control, or
frontend code. Back it up securely: losing or changing it requires reconnecting.
Do not copy credentials from HeliosControl or another project.

After deploying the connection code, sign in to `/auth`,
click **Connect Google Sheets**, and personally review Google's consent screen.
Then click **Test reading**. Expected maximum coverage is **8/8**.
Account access can further reduce
that number; the Google Drive chat connector has independent credentials.

The cloud app was in External Testing during inspection. Resolve the Branding /
Production publishing requirements before treating refresh-token access as durable;
Google limits most External Testing refresh tokens to seven days.
See https://developers.google.com/identity/protocols/oauth2#expiration.

## Remaining feature work (not shipped here)

- Score reconciliation must use the same period/cutoff and comparable totals.
  Never compare a live incomplete day with unfilled sheet cells, or double-count common points.
- Small discrepancy details indicator for absolute differences strictly greater than 1,000.
- New ranking layout and explicit old/new launch choices.
- HeliosControl live-state producer and avatar badges for groups/talents.
- Session-start daily attribution at 06:00, separate from monthly close at 07:00.

No production deployment or successful production-server Sheets read is implied
by the local mocked tests.
