# Leaderboard frontend versions

The default frontend remains the current Classic / Studio / Podium application.
Settings → Saved Defaults → Switch to V1 Original · Tabs opens the original tabbed application.
V1 Settings includes a version selector to return to the current application.
The selection is saved immediately in this browser, independently of Save as Default.
Existing settings for each frontend are preserved independently.

V1 HTML, JavaScript and CSS were recovered from commit `56d0cdb`, immediately before
the five-column command-center implementation (`9df9543`). Changes to that snapshot
are limited to asset names, the shared version selector, and compatibility with the
current cache-first endpoint and SSE invalidation messages. The current backend and
access controls serve both frontends; the old server is not restored.
