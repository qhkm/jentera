# Telegram photos, files and voice notes

Status: design, 24 September 2026. No code, no migrations, no deployment.
Decisions below were taken with the owner in one session; the Hermes findings
were read from the pinned source, not assumed. Builds on
[`2026-09-15-chat-attachments-design.md`](2026-09-15-chat-attachments-design.md),
which this does not repeat: read that first.

The owner asked why their bot "was not working". Their last text message had
been answered correctly (run `b1a12978`, Telegram message 761 delivered). What
fails is everything that is not text. `parseUpdate`
(`worker/src/connectors/telegram.ts:664`) requires a non-empty `text`; a photo
carries `photo` and an optional `caption`, a voice note carries `voice`, a file
carries `document`. Each is dropped at `worker/src/routes/connect.ts:561-564`
with a 200, so Telegram never redelivers and the owner gets silence. The test
suite asserts this on purpose (`worker/test/webhook.test.ts:213-215`).
`docs/todo.md:80` records the voice half of the same gap.

## Decisions taken with the owner

| Question | Decision |
|---|---|
| Notice only, voice only, or voice and photos? | **Voice and photos**, understood by the agent |
| What gets sent | Receipts and invoices, screenshots, general photos, voice notes in BM and English |
| Order | **Attachments first**: the 15 September store and delivery, then Telegram on top |
| Retention of photos and files | **Kept until deleted**, as the 15 September design has it |
| Retention of voice audio | **Not kept.** The transcript is kept; the audio is discarded after transcription |
| Where transcription runs | **In the worker**, Workers AI Whisper on our account. Owners configure nothing |
| Bots whose token predates the vault | **The worker downloads for them** with the token it already holds |

## What Hermes does and does not do

Checked at the pin, `v2026.9.22` / `929f477` (`worker/src/runtime/hermes-pin.ts`),
because "Hermes already handles this" is half true.

- **Hermes' own Telegram gateway handles all of it**:
  `plugins/platforms/telegram/adapter.py:8465-8540` downloads photos, voice,
  audio, video and documents, and `gateway/run.py:16979-16986` transcribes voice
  before the agent sees it. None of that runs for a Jentera bot. The bot's
  webhook points at the worker, which owns pairing, approvals, dedupe and
  metering, and reaches Hermes only through `/v1/runs`
  (`runner/src/server.mjs:908-929`). Using Hermes' gateway would put a second
  path to Telegram beside the approval gate.
- **Transcription is not an agent tool.** The only audio tool registered is
  `text_to_speech` (`tools/tts_tool.py:3003`). Pointing Hermes' STT at our
  Whisper (`STT_OPENAI_BASE_URL`, `tools/transcription_tools.py:99`) would change
  nothing on the `/v1/runs` path, because nothing on it calls STT. Hence the
  worker.
- **The API is ahead of the 15 September probe for images, not for files.**
  `/v1/chat/completions` and `/v1/responses` now keep `image_url` parts
  (`tests/gateway/test_api_server_multimodal.py`). `/v1/runs` passes the last
  message's content through untouched (`gateway/platforms/api_server.py:4926`)
  and flattens history to text; whether an image part reaches the model there
  is **unmeasured** at this pin. Files and audio are refused with 400 on every
  endpoint: "Only text and image_url/input_image parts are supported."

So photos and documents still reach the agent as files on disk, per the
15 September design, and voice reaches it as text.

## Order of work

| # | Piece | Where it stands | Sprite release |
|---|---|---|---|
| 0 | Stopgap: an honest reply to anything that is not text | this spec | no |
| 1 | Attachment store: rows under RLS, bytes in R2, upload route, delete | `plans/2026-09-15-chat-attachments-storage.md`, stale (it names migration 047; 069 is taken) | no |
| 2 | Delivery to the sprite and vision: inputs folder, task-bound fetch, `supports_vision` pinned, PDF decision, receipt probe in the release gate | designed 15 September, no plan | **yes** |
| 3 | Telegram media | this spec | no (worker and vault) |
| 4 | App composer and Files | designed 15 September, no plan | no |

0, then 1, 2, 3. Telegram needs 1 and 2, not 4, so the bot is served first; 4
can run beside it. Each piece gets its own plan. Voice does not depend on 1 or 2
and could ship straight after 0, but the owner chose attachments first; it
ships with 3.

## Piece 0: the stopgap

One branch in `parseUpdate` recognises `photo`, `document`, `voice`, `audio`,
`video`, `video_note` and `sticker`, and the webhook replies in one line instead
of dropping:

- **Photo or file with a caption**: the caption runs as an ordinary message,
  with the instruction that the owner also sent a photo or file the agent cannot
  see, so the agent says so if the question depends on it. It must not answer
  "record this receipt" as though it had read the receipt.
- **Without a caption, and voice**: "I can't read photos, files or voice notes
  here yet. Type your message, or send the file in the Jentera app."
- Everything else: "I can only read text messages for now."

`webhook.test.ts:213-215` changes from "is null" to the reply it now gets.
Piece 3 replaces the photo, file and voice branches; the rest stay.

## What the owner sees

| Sent | Behaviour |
|---|---|
| Photo, with or without caption | Stored as an attachment on the run; the agent opens the file. The caption is the request. With no caption the agent looks, says what it is, and offers next steps ("Receipt from Kedai Seri Murni, RM30.32. Record it in Bukku?"). It never acts unasked; approvals are unchanged |
| Album | Telegram sends one update per item. They become **one** request carrying every item |
| File (PDF, Word, Excel, CSV, an image sent uncompressed) | Stored as an attachment like a photo. PDF reading is piece 2's decision |
| Voice note | Transcribed, shown back (🎤 "…"), answered as typed text. The run records it came from voice. Unintelligible: a one-line request to type it. **Never an approval** |
| Audio file, video, video note, sticker, location, contact | One-line "can't read this yet" (from piece 0) |
| Over 20 MB | Telegram will not let a bot download it. The reply says so and points at the app |

Only the paired owner reaches the agent (`connect.ts:598`), so every Telegram
attachment is uploaded by the owner. Approvals arrive only as button callbacks
(`connect.ts:539-560`); no text, typed or transcribed, approves anything, and
this design keeps it that way.

## The path a file takes

```
Telegram ─► webhook (connect.ts)
            parseUpdate reads photo / document / voice / caption / media_group_id
            carries ids only: file_id, file_unique_id, size, name, mime. Never bytes
            over 20 MB or an unsupported kind ─► one-line reply, stop
            │
            ▼  same intake as text: inline first slice + queued safety net
         admission (consumer / placed slice)
            │
   voice ───┼─► download ─► Whisper ─► transcript becomes the message text
            │                          nothing intelligible ─► reply, no run
            │                          audio discarded
            │
   photo /  └─► download ─► R2 <business>/attachments/<id>/<name>
   document      ─► one tenant transaction: attachment row + run + link + runtime task
                     ─► runner fetches into inputs/<task>/ (piece 2) ─► agent opens it
```

**Parsing.** `IncomingMessage` (`connectors/telegram.ts:603-609`) gains an
optional `media` list of `{ kind: 'photo' | 'document' | 'voice', fileId,
fileUniqueId, size, name?, mime?, durationS?, mediaGroupId? }`. For `photo`,
Telegram sends several sizes; take the largest. `text` becomes the caption, or
empty. `validTelegramIntake` (`runtime/consumer.ts:2834-2847`) requires
non-empty text today and must accept empty text when media is present. The
queue message stays small: ids, not bytes.

**Downloads happen after the webhook has answered**, in admission, and never
inside a tenant transaction (`consumer.ts:735-737` already forbids awaiting
Telegram there). Order: download, store, then one transaction that inserts the
attachment, starts the run, links them and enqueues the runtime task, so the
runner's task-bound fetch always finds the file.

**Voice.** Workers AI `@cf/openai/whisper-large-v3-turbo` on the existing `AI`
binding, with `vad_filter` on, `condition_on_previous_text` off and an
`initial_prompt` naming Malay and English; whether to pass `language` is decided
by measurement (below). The transcript becomes the message text. `triggerRef`
(`consumer.ts:724-730`) records `input: 'voice'` and the duration alongside
`question`. The transcript is shown to the owner in the chat before the answer
and stays visible after it, so a mishearing can be caught before it is acted
on. Whisper is known to produce stock phrases on silence ("Terima kasih",
"Thank you for watching"); an empty or suspect transcript is treated as
unintelligible, not sent.

### Downloads: the vault, and bots that predate it

A Telegram file URL is `https://api.telegram.org/file/bot<token>/<file_path>`:
the token is in it. The vault allow-lists Telegram calls by path
(`~/ios/aisar-vault/src/manifests.ts:63-78`) and `getFile` is not on the list;
its client JSON-parses every response (`worker/src/vault/client.ts:48-53`), so a
binary download cannot pass through today.

- **Vault route** `POST /v1/telegram/<secretId>/file`, body
  `{ businessId, fileId }`. The vault calls `getFile`, refuses over 20 MB, fetches
  the bytes and returns them with the content type. It never returns
  `file_path` or the URL. `getFile` joins the manifest. This is a change in the
  `aisar-vault` repository, shipped before the worker calls it.
- **Worker client** gains a binary variant beside `callVaultTelegram`.
- **Bots that predate the vault** (6 of 7 on 24 September, the owner's among
  them; `connection.vault_secret_id` is null) already have their token in the
  worker, which uses it for every send. For those the worker downloads directly,
  through one helper that builds the URL and never logs it or an error that
  contains it. Moving old bots into the vault goes on `docs/todo.md`.

`getFile` is called fresh each time: Telegram guarantees a `file_path` for an
hour only.

### Resends

Telegram redelivers on 5xx, and the inline slice and the queued safety net both
run, so every step must tolerate running twice. Runs are already deduped per
message (`telegram:<connection>:<chat>:<message>`, `consumer.ts:652`). An
attachment records `source_ref = 'telegram:<file_unique_id>'`, unique per
business, so a second download finds the stored row and reuses it rather than
storing a copy. A voice note may be transcribed twice; that costs a fraction of
a cent and is accepted.

### Albums

Every item arrives as its own update sharing a `media_group_id`, and the
caption, if any, is on one of them.

- Each item is downloaded and stored as a `staged` attachment with
  `group_key = 'telegram:<connection>:<media_group_id>'`.
- The first item enqueues a flush with a 3-second delay, deduped on the group
  key. The flush claims every staged row in the group (`staged` → `attached`),
  takes whichever caption exists, and starts one run. Later flushes find nothing
  unclaimed and do nothing.
- An item that lands after its group was flushed becomes a follow-up request,
  never a dropped one. Items never flushed are removed by piece 1's 24-hour
  sweep of staged rows.
- **Admission is charged once per album, at the flush.** `admitPaidAgentRun`
  (`worker/src/request-guard.ts:45-56`) allows 10 runs per 60 s per chat
  (`AGENT_RUN_BURST`, `worker/wrangler.toml:274-279`). Charging each item at the
  webhook would let one ten-photo album exhaust it.

### Sprites on an older release

A sprite that cannot fetch attachments answers a photo or file with a reply
("I can't open files on this version yet") rather than running a turn about a
file it will never see. The check is piece 2's release gate.

## Data model

Piece 1's `attachment` table, plus, in this piece's own migration so piece 1's
plan does not reopen:

- `source_ref text`, unique on `(business_id, source_ref)` where not null.
- `group_key text`, indexed where `state = 'staged'`.

`uploaded_by` is the connection's `connected_by`, the owner. That column is
nullable and is null on one connection (a revoked demo bot, 24 September), so
fall back to the business's owner membership rather than failing the upload.

**Visibility follows the run, and Telegram runs belong to the whole business.**
All 218 Telegram runs in production have no `requested_by` and no chat session,
and a run with no chat is readable by every member
(`worker/src/chat-sessions.ts:11-14`). So a
photo sent to the bot is visible to every member of a team-plan business, as the
Telegram conversation already is. That is consistent, and it is stated here so
nobody discovers it. Making Telegram private is a change to the run rule, not
to attachments.

## Limits

| What | Cap | Over it |
|---|---|---|
| Any file | 20 MB, Telegram's bot download limit; matches piece 1's `MAX_ATTACHMENT_BYTES` | Reply at the webhook, from the `file_size` Telegram sends; no run |
| One request | 60 MB, piece 1's per-run total, matching the runner's own cap | Album items past it are skipped, and the reply names them |
| Voice note | 10 minutes | "Too long, send a shorter one or type it" |
| Caption | Telegram's own 1024 characters, inside the existing 4000 | — |

A compressed Telegram photo is well under the model proxy's 8 MiB image cap
(`worker/src/routes/model.ts:54-55`). An image sent uncompressed as a file is
not, and goes through piece 2's resize path.

## When something fails

A reply, never silence, and never a run without its file.

- **Download fails**, from Telegram or the vault: the queue retries. After the
  last attempt: "Couldn't fetch your photo, please send it again."
- **Whisper fails, finds no speech, or returns a stock silence phrase**:
  "Couldn't make out that voice note, please type it."
- **Storing to R2 fails**: retry, then the same reply as a failed download.
- **Older sprite**: the reply above.

## Safety

- The download URL carries the token. It never leaves the vault or the one
  worker helper, and it is never logged, including inside error text.
- File names are reduced to the artifact name rule,
  `[A-Za-z0-9][A-Za-z0-9._-]{0,119}`. Photos are named
  `photo-<messageId>[-<n>].jpg`. Nothing from Telegram's `file_path` becomes a
  name.
- File contents are untrusted input, per the 15 September design's instruction.
- A transcript carries the owner's words, not the owner's authority over
  approvals: approvals are buttons only, and a test says so.
- Each album item passes the same paired-owner check as a text message.
- Telegram strips EXIF, including location, from compressed photos but not
  from images sent as files. Whether the store strips it is piece 1's decision
  (the mini-apps plan asks for it); this design inherits that answer.

## Privacy and notices

The privacy notice must say that voice notes are processed by Cloudflare Workers
AI, that the audio is not kept, and that the transcript is kept in history like
a typed message. Photos and files follow the retention wording piece 1 already
owes. The App Store label in `docs/mobile-launch-checklist.md:46`, photographs
transmitted and not retained, becomes wrong for photos and must also cover
audio.

## Measure before the plan

1. **Whisper on Telegram voice.** Does `whisper-large-v3-turbo` accept
   Telegram's OGG/Opus as sent, or does it need transcoding? Accuracy on five
   real voice notes in BM and Manglish, with and without `language`, with and
   without `initial_prompt`. The longest audio one request accepts, which may
   lower the 10-minute cap or require chunking.
2. **Piece 2: an image part through `/v1/runs` at the current pin.** If the
   model sees it, the agent can be handed the pixels every time instead of
   relying on it choosing `vision_analyze`, the weakness the 15 September design
   records. It does not remove the file on disk, which Bukku attachment and
   retention need.

## Testing

**Worker suite** (`cd worker && pnpm test`, asserting as `aisar_app`):

- `parseUpdate` for photo (largest size taken), document, voice, caption,
  album id, oversize and each unsupported kind.
- A redelivered update reuses the stored attachment; one R2 object, one row.
- An album becomes one run carrying every item; a late item becomes a
  follow-up; albums do not exhaust `AGENT_RUN_BURST`.
- A voice note runs as its transcript, echoed, with `input: 'voice'` recorded.
- Every failure above replies and starts no run.
- A transcript reading "approve" approves nothing.
- The token appears in no log line, including a failed direct download.

**Vault suite** (`~/ios/aisar-vault`): `getFile` allowed; the file route
returns bytes only, refuses over 20 MB, and is bound to the business.

**Live, before calling it done**, on a sprite nobody has touched by hand (the
Kitakod sprite has drifted; `docs/image-path-spike-2026-09-15.md`):

- five real voice notes in BM and Manglish,
- a photographed receipt through Telegram end to end, asserting the values
  that come back, not a 202,
- a ten-photo album,
- a file over the limit.

## Not in this design

- Video, video notes, stickers, locations, contacts: the piece 0 reply stays.
- Transcribing audio sent as a file (a recorded meeting as an `.mp3`). It is
  stored as an attachment; the agent cannot transcribe it.
- Keeping voice audio.
- Group chats. The bot is private to its paired owner.
- Pointing Hermes' own STT at our Whisper. Nothing on our path calls it.

## Consequences elsewhere

- **Piece 1's plan** is stale before it starts: migration 047 is long taken
  (069 is in the tree; take the next free number when implementing), and its
  line references predate a week of changes. Refresh it before executing.
- **`docs/todo.md:80`** ("Telegram voice notes vanish") is covered by piece 3 and
  moves to Closed when that ships. A new item records moving pre-vault bots into
  the vault.
- **`docs/architecture.md`** gains the vault's file route and the worker's
  Whisper call when they ship.
