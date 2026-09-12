# Chat result recovery and clickable links

Deployed with the outcome-led onboarding changes, 12 September 2026.

Release commit `0ba35d8`; worker `521d801f-dea7-4cc7-a961-6b825fcb0c04`
(thin-page ingestion guard, deployed first); Pages
`0c794726.aisar-jentera.pages.dev`, entry `/assets/index-CcqyNGKG.js`.
Final pre-release frontend suite: 530 tests passed; frontend and worker
typechecks passed, as did 25 focused ingestion tests. No fleet changes.
Both Jentera domains serve the new entry; all 12 JS/CSS asset hashes match
the local build. Live Chrome loaded an active root-scoped service worker.
The separate `aisar.ai` project was untouched.

## Recovery

The reported run completed on the server while the browser reported a fetch
failure. Previously, a single failed durable-state read rejected the whole chat
promise, even when a run ID was already known.

Durable result polling now retries network failures, read timeouts, HTTP 408,
429 and 5xx with backoff capped at 15 seconds, within its existing 16-minute
window. Each read has a 15-second timeout. The WebSocket fallback uses the same
recovery path. Reconnecting/result-checking copy is shown separately from agent
progress, preserving partial answers and task identity.

Only result GETs are retried by this change. Initial submission failure does not
automatically resubmit work. Authentication/access failures and terminal task
failures still reject. Existing historical red errors can be opened through
their task link; they are not silently rerun or rewritten.

## Links

The shared chat/document/table renderer supports Markdown links and bare HTTP(S)
URLs. Named links display their normalized destination. Embedded credentials,
relative URLs, unsafe schemes, whitespace/control characters and backslash
targets are not activated. Links open a new tab with noopener/noreferrer and no
referrer; there is no URL preview fetch, raw HTML rendering, or trust endorsement.
Code remains literal; trailing prose punctuation is excluded from bare URLs.

## Checks and release

- Full frontend suite: 529 passed; production build passed.
- The subsequently added socket-close/fallback-read regression also passes:
  all 13 durable Ask bridge tests pass.
- Fake-timer regressions cover network/server recovery, no duplicate POSTs,
  access failures, and the overall deadline.
- Mobile Chrome checks cover named/bare/table links and no horizontal overflow.
  Screenshot: `/tmp/clickable-links-mobile.png`.
- Frontend-only change; no migration, fleet change, or production task execution.
- Shared local state remains compatible; no new storage keys.
