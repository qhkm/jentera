# AI bots, avatars and personal defaults — 22 September 2026

Status: implemented for local review; not deployed. This owner-requested
direction supersedes the earlier single-Chief/no-roster presentation rule.
It does not add customer-facing agents or separate VMs per bot.

## Behavior

- My Business → AI bots, separate from the human Team tab.
- Jentera is the built-in coordinator. Owners can add/edit/disable up to eight
  additional bots using existing persistent Hermes specialist profiles.
- Each bot has a name, remit, instructions and an avatar. Picking a character
  does not install skills or grant permissions.
- Members choose their own default for new web chats, scoped to user and
  business. Jentera's personal avatar is scoped the same way. Specialist
  definitions and avatars are shared with business members.
- New web chats start with Jentera unless the member selects another bot.
  This replaces keyword routing for new web chats. Telegram keeps its existing
  six-hour sticky/keyword routing.
- Existing web chats retain their last bot, even after six hours or a default
  change. Lightweight coordinator turns count as conversation history too.
- Lightweight messages go through Hermes when the chosen/existing bot is a
  specialist, preserving its instructions and memory even for greetings.
- Disabling a bot resets affected defaults to Jentera. Existing chats whose
  bot is disabled fall back to Jentera. Saved run history remains, but this
  does not migrate the disabled bot's Hermes memory into another profile.
- No new credentials, models, runtimes or connection permissions. Bots stay
  within the existing managed-agent authorization boundary.

## Artwork

Owner's source: `ChatGPT Image Sep 22, 2026, 05_47_22 PM.png`.
Web asset: `app/public/images/jentera-bot-avatar-sheet-v1.webp` (1536×1024,
123 KB). `BotAvatar.tsx` clips CSS backgrounds to ten character selections;
the original backgrounds remain. This is not regenerated art or a transparent
cutout. The duplicate emerald in the lower row is not a separate avatar.

The picker uses native labeled radios and visible keyboard focus. Cards are
responsive, action buttons have 44px minimum height, and the default is labeled
with text and a checkmark rather than color alone. Reduced motion is respected.

## Storage and rollout

- `specialist_profile.avatar`: allowlisted stable avatar id.
- `bot_preference`: `(business_id, user_id)` primary key, forced tenant RLS.
  API queries bind the authenticated user id; clients cannot change another
  member's preference. Owner-only specialist management remains server-enforced.
- Local demo key: `aisar-bot-preference-v1`. Real choices persist in Postgres.
- `/api/state` includes defaults, avatars and `canManageBots`.
- POST `/api/state/bot-preference` requires an active bot in the current tenant.
- Preference changes and disabling share a transaction advisory lock.

Release in this order, only on explicit authorization:

1. Run `pnpm db:migrate:bot-preferences` from `worker/`, with the existing
   production owner connection supplied securely. It applies migration 065
   transactionally and verifies RLS/policy/grants without logging credentials.
2. Deploy the Worker. Its snapshot/config reads now require the avatar column.
3. Publish the app with `./deploy.sh`; verify the served bundle and real API.

No runner release or sprite changes: existing runtime config already supports
profile definitions, and avatar ids do not enter that config. Roll back app and
Worker first if needed; leave the additive schema in place.

## Verification

Tests cover creation, avatar persistence, individual defaults, invalid ids,
owner/staff permissions, tenant isolation, disabling, request routing, older
chats, lightweight messages, save errors and cancellation. Worker tests use
disposable Postgres with the real RLS role. The local UI preview uses sample
data; it does not execute AI or connect to production.

Local results: app/Worker typechecks and production app build passed; 69 focused
Worker tests passed. Bot, chat, workspace and onboarding checks passed. The
full UI run reached 1,151/1,152 passing with timing-sensitive failures moving
between task-recovery and activity-mode tests on successive runs; this is not
a clean full-suite release gate. Desktop, 390px mobile, landscape, light/dark
and keyboard selection were checked in Chrome with no page errors or horizontal
overflow. Physical-device and production verification are still outstanding.
