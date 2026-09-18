# Connecting a service by asking for it

Status: design, 18 September 2026. No code, no runner change, no release.
**Blocked on a security decision** — see *The boundary this design assumed,
and does not have*. The flow below is sound; where it runs is not settled.

The owner types "connect my Bukku" in chat. Jentera opens its browser at
Bukku, the owner signs in while watching, and Jentera does the rest. No
control panel, no token to find, no subdomain to explain.

This replaces nothing. The paste form shipped today
(`TokenConnect.tsx`, `/connect/bukku`) stays as the fallback, for reasons
in *When the recipe breaks* below.

## The boundary this design assumed, and does not have

An earlier draft of this document argued that the credential must reach the
control plane "without passing through the model's context", and designed a
worker-driven harvest so the agent never reads the page. Checked on
18 September, that boundary is not real.

`business-browser.mjs` launches Chromium with `--remote-debugging-port=9222`
bound to `127.0.0.1`, and Hermes holds a terminal on the same machine
(`tools/terminal_tool.py`). The agent can speak CDP to that port directly.
Our proxy's careful action allowlist governs what *the app* may ask for; it
governs nothing about what the agent may do, because the agent does not have
to use it.

Two consequences, and the second is larger than this feature:

- A worker-driven harvest is not a protection. The agent could read the same
  page itself, at any time, whether or not `harvest` exists.
- **Anything an owner signs into in the business browser is readable by the
  agent today.** That is a live property of the product, not a risk this
  design introduces. It is bounded by the agent being ours and by what the
  approval gate lets it *do* with what it reads — but "the agent cannot see
  your logged-in sessions" is not a claim that can be made.

The Bukku API token itself is unaffected: it is stored in the control plane
and never delivered to a sprite, which remains true. The exposure is the
browser, not the connector.

### Options

1. **Capture credentials off the sprite.** Run the sign-in and the harvest
   in a browser the agent has no machine access to — Cloudflare Browser Run,
   streamed to the app — and destroy it afterwards. The properties that
   disqualified Browser Run for a persistent business profile in
   `docs/browser-run-vs-sprite-chromium.md` (a ten-minute idle ceiling,
   nothing retained) are the properties a one-shot credential capture wants.
2. **Isolate on the sprite.** A separate OS user or namespace so the agent
   cannot reach 9222. One container, and the kind of isolation that looks
   correct while leaking.
3. **Keep credentials out of the shared browser.** The paste form handles
   credentials; the business browser does non-credential work. Today's
   position, and the fallback if 1 is not taken.
4. **Narrow the claim.** Rely on the executor limiting what the agent can do
   rather than what it can see. Protects Bukku and nothing else the owner
   has signed into.

**Recommendation: 1, with 3 as the position until 1 exists.** It is the only
option that makes the claim true rather than smaller, and the Browser Run
evaluation is already done.

What no option solves: the owner's password reaches the browser as keystrokes
through Jentera's infrastructure. That is inherent to typing a password into
a browser you do not own, and belongs in what the owner is told rather than
in what the architecture pretends away.

## Why the agent should still not be the one reading it

Given the section above, keeping the harvest out of the agent's context is
no longer a boundary — the agent could read the page itself. It is still
worth doing, for two smaller reasons that survive:

- **Least privilege that costs nothing.** A credential the agent is never
  *handed* is one that does not appear in a transcript, a trace, or a
  summary, and does not have to be scrubbed from any of them. That the agent
  could have fetched it is not a reason to put it there.
- **It is the right shape for wherever this ends up running.** Under option
  1 the agent genuinely cannot reach the browser, and the worker-driven
  harvest is then a real boundary rather than a habit. Designing it the
  other way would mean redesigning it.

What it is not is a defence against the agent. Anything written here that
reads as one is wrong.

## What already exists

| Piece | Where |
|---|---|
| A browser the owner drives and watches | `runner/src/business-browser.mjs`; screencast since `2026.09.14-3` |
| "Jentera needs you in the browser" handoff | `BrowserHandoffCard` in `AskReply.tsx`, with a continue action |
| A place to keep credentials the agent cannot read | `connection` + `credential`, sealed; `connectors.ts` executes |
| A tool the agent can call | `POST /v1/runtime/connector` (18 Sep) |
| Reading a value off the page | **nothing** |

The browser proxy's actions are `navigate, click, text, key, scroll, tab,
frame, preview` (`routes/browser.ts`). `text` *types* text. There is no read.

## The new capability: a recipe, not an eval

The tempting shape is `evaluate(js)`. It must not be. That browser holds
every session the owner has signed into, and an eval endpoint is a general
grant to read and act as them, reachable by anything that can reach the
browser route.

Instead the runner gains one action with a closed set of arguments:

```
harvest { connector: 'bukku' }  ->  { fields: { token, subdomain } }
```

The recipe is code in the bundle, not a parameter:

```js
bukku: {
  path: '/cp/integrations',
  enable: '#api_access_on',            // ant-switch-checked when already on
  read: { token: '#api_access_token', subdomain: '#subdomain' },
}
```

Three properties follow, and all three matter:

- **The caller cannot name a selector or a script.** A compromised worker
  route, or a confused agent, can ask for `bukku` and nothing else.
- **The recipe ships like every fleet change** — reviewed, pinned, released.
  Adding a connector is a release, which is the right friction for code that
  reads credentials out of a logged-in browser.
- **The result goes to the worker over the sealed runner key**, the same
  channel the CDP proxy already uses. The agent is not in the path — which
  is hygiene while the browser is on the sprite, and a boundary once it is
  not.

`harvest` is owner-scoped: it runs only while the owner holds browser
control, which is the same gate that already governs typing a password into
that window.

## The flow

1. Owner: "connect my Bukku". The agent calls
   `connect_service { name: 'bukku' }` on the runtime bridge.
2. The control plane answers with a handoff: the sign-in URL and a
   sentence for the owner. The agent renders it; the app opens the browser
   at `https://<subdomain>.bukku.my`.
3. The owner signs in, watching. **Jentera types nothing here.** A password
   is the owner's to enter, and this is the same window they already trust
   with one.
4. Owner says they are done — or the app offers a Continue on the handoff
   card, which is the existing affordance.
5. The worker runs `harvest`, receives two values, and never returns them
   to the agent. (On the sprite this is hygiene, not a boundary; see above.)
6. The worker verifies them the way the paste form does: `GET /companies`
   with both headers, matching the company against the subdomain, so a
   token that opens someone else's books is refused here too.
7. On success it writes the connection and seals the credential. The agent
   is told "connected as Aisar AI" and nothing more.

## What the page actually looks like

Verified against a live Bukku account on 18 September 2026:

| | |
|---|---|
| Route | `/cp/integrations` — stable, deep-linkable |
| Toggle | `#api_access_on`, state readable from `ant-switch-checked` |
| Token | `#api_access_token`, a **read-only textarea**, value present in the DOM |
| Subdomain | `#subdomain`, read-only input |
| Refresh Token | **no id** — class and text only |

That last row is luck worth keeping: the one destructive control on the
page is the hardest to address, and the recipe never needs it. **Nothing is
generated.** If API access is already on, the existing token is read. Only
when it is off does the recipe flip the toggle — which generates the first
token and is the one case not yet observed, because testing it means
turning off a live integration.

One dead end, recorded so nobody repeats it: `/settings/api` — the URL in
the token's own `iss` claim — redirects to `/dashboard`. It is a label, not
a route.

## What is not promised

The connector page was corrected today for the same reason this section
exists. A Bukku API token **carries the permissions of the person who
created it**; the settings page says so, pointing at Users. Reading-only is
Jentera's guarantee, kept by an executor that refuses every operation but
`list`. This flow does not change that, and must not be described as
granting less than it does.

## When the recipe breaks

It will. It is automation against someone else's product, and a Bukku
redesign moves an id.

- **Detection is the verify step.** A recipe that reads the wrong thing
  fails `GET /companies`, so a broken recipe is a failed connect rather
  than a stored credential that does not work.
- **The fallback is the paste form**, which is why it stays. The failure
  message says which company it could not open, and offers the form.
- **A broken recipe is a release, not an outage.** Nothing already
  connected stops working; only new connections are affected.

## Open decisions

1. **Where the sign-in happens.** The open question above. On the sprite,
   the owner's Bukku login lands in a browser the agent can read; off the
   sprite, it does not exist afterwards at all. This decides the rest.
2. **Whether the agent may start the flow unprompted.** It should not. An
   owner asking is the authorisation; an agent deciding to collect a
   credential is not.
3. **The toggle-off path.** Needs a second Bukku company, or a window where
   breaking the live connection is acceptable.

## How we would know it works

- A connect that stores a credential the agent never held: assert the run's
  events and the model transcript contain no substring of the stored token.
- A wrong-company token refused at step 6, as the paste form already is.
- `harvest` refused when the owner does not hold browser control.
- `harvest` refused for any connector without a recipe, and for any
  argument that is not a recipe name.
- A recipe whose selectors miss returns no credential and no connection.

## Sequence

1. The runner action and its Bukku recipe, with tests that a selector miss
   and an unknown connector both fail closed. Pinned and released.
2. The worker orchestration: handoff, harvest, verify, store — reusing the
   paste form's verifier rather than a second copy of it.
3. The agent tool and the handoff card wiring.
4. Test on the Kitakod account end to end, including one deliberately
   broken selector.

Steps 1 and 2 are independently useful: step 1 with no caller is inert,
which is how the runtime bridge shipped today.

Note for step 1: anything the recipe fetches from the sprite must name
itself. Cloudflare answers `Python-urllib` with error 1010, which cost a
fleet-visible bug on 18 September — a 403 carrying none of our own fields,
which read as the owner's accounting refusing us.
