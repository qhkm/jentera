# The optional local driver — reach the cloud cannot have

Status: **proposed**. Prepared 11 September 2026. Nothing is built.

Amends two earlier decisions recorded the same day, and says so plainly
because three plans disagreeing with each other is worse than one that
changed its mind:

- `2026-09-11-malaysian-integrations.md` said **cloud only**. That becomes
  **cloud first, with optional local reach**.
- `2026-09-11-onpremise-bridge.md` was marked **not pursued**. It stops being
  a bespoke bridge and becomes one use of the driver below.

## The rule

**The cloud does everything it can. Installing unlocks reach it cannot have.**

The installed component is a *capability provider, never a dependency*.
Everything works without it. The moment a core feature requires it, every
customer has to install software to use the product — which is what "cloud
only" was protecting against, and that protection still matters.

This is what makes the reversal defensible rather than a drift. Requiring an
install is a support burden on every customer. Offering one is a burden only
for those who opt in, who are by selection the more motivated and more
technical, and who are getting something the cloud genuinely cannot give them.

## What it is

`cua-driver` from trycua (MIT), which this codebase already installs on
sprites, pinned by SHA-256, when `CUA_ENABLED=1`.

It inspects and operates native desktop apps and browsers, and it connects
over CLI, **MCP**, or typed SDKs. Three properties decide it:

**Cross-platform — macOS, Windows, Linux.** This matters more than Linux
support alone. Malaysian SMEs are on Windows; a Linux-only tool would be
useless to them. One installable covers every customer and the sprite.

**Background delivery.** It can drive apps without moving the pointer or
taking focus, where the platform allows. That is the difference between an
installable people keep and one they remove the first time it steals their
mouse mid-invoice.

**Already ours.** The same component runs on the sprite today. One tool
surface in two locations, one thing to learn, one thing to pin.

## What it unlocks

Three things the cloud cannot reach, in descending order of how likely they
are to matter:

1. **The owner's logged-in browser session.** No password is stored, asked
   for, or transmitted — the session already exists because they signed in as
   themselves. This is the insight `agentcookie` is built on, and it is the
   only honest answer to "let the agent use my accounts" for providers with
   no API.
2. **Desktop applications**, including the on-premise accounting that the
   bridge plan was written for. AutoCount reached through the driver on a
   machine the owner already runs is a far smaller proposition than a bespoke
   service we deploy and update.
3. **Files and printers** that exist only on that machine.

## What it does not change

Passwords are still not stored. The driver works because the owner is already
authenticated on their own machine; it is not a way to hold credentials, and
this plan does not reopen that.

Everything already built stays cloud-side. WhatsApp, payments, e-commerce,
documents and email are reached from the control plane and do not become
local just because a driver exists.

## The security problem, stated first

This is the part to get right, and it is worse than it first looks.

`web_extract` pulls arbitrary web pages into the agent's context. The local
driver gives that same agent hands on the owner's computer, inside their
logged-in sessions. **A page chosen by a stranger can therefore reach an agent
that can operate the owner's bank tab.** That is a materially larger blast
radius than anything shipped so far, where the worst case was an unwanted
message or a leaked scoped token.

Saying it plainly is the point. The mitigations have to be designed against
this, not bolted on:

- **Allowlisted operations, not a free desktop.** The driver exposes named,
  reviewed flows — "read the current page", "download the statement from this
  app" — rather than arbitrary click-and-type. Anything outside the list is
  not reachable, so a compromised agent can at most do a listed thing.
- **Approval for anything that acts.** The card shipped 2026-09-10 is the
  mechanism. Reading the screen is one class; clicking a button in the
  owner's banking session is another, and it should stop and ask.
- **Separate the reasoning that reads the web from the hands.** The strongest
  version: an agent turn that has ingested untrusted page content does not
  hold the driver in the same turn. This needs design work and may be the
  deciding constraint on the whole feature.
- **Visible and interruptible.** The owner sees what it is doing on their own
  machine and can stop it. Background delivery makes it invisible by default,
  which is good for ergonomics and bad for trust; the visualiser is not
  optional.
- **Scoped to apps the owner picked.** Not "the desktop" — the three
  applications they consented to.

The rule from the bridge plan — *the agent never reaches into a customer's
network* — is genuinely reversed here, and the reversal should be argued
rather than assumed. The difference is consent and locus: the owner installed
it on their own machine, for their own sessions, and can watch and stop it.
That is not the same as us holding credentials to reach in from outside. But
it is still hands on their computer, and the blast-radius paragraph above
stands regardless of consent.

## Shape

```
owner's machine                      |  Jentera cloud
                                     |
  their browser, already signed in   |
  their desktop apps                 |
          ↑                          |
     cua-driver  ───── outbound ─────→  control plane
     (installed, opt-in)   MCP        (pairs the machine to a business,
          ↑                           allowlists operations, records use)
     owner watches, can stop          |         ↓
                                     |    the agent asks for an operation,
                                     |    never for a credential
```

Outbound only, for the same reason as everything else: SME networks have no
inbound reachability and asking for a port forward is asking for a no.

## Decisions needed before code

1. **Pairing.** How a machine is bound to a business, and how that is revoked
   when a laptop is lost or an employee leaves. This is the first thing to get
   right and the easiest to botch.
2. **The operation allowlist**, and who writes it. Per application, reviewed,
   versioned — the same shape as the connector allowlist in the broker plan.
3. **The untrusted-content boundary.** Whether an agent turn can hold both
   extracted web content and the driver. If the answer is no, that shapes the
   runtime, not just this feature.
4. **Distribution and update.** Signed installers per platform, and how a
   driver version is rolled forward. Borrow the fleet's lesson: a release
   proves itself on the machine before it is called ready.
5. **What the owner sees.** Live, on their own screen, not only in a log
   afterwards.

## Acceptance gate

Before a driver touches a real owner's machine:

- An operation outside the allowlist is refused by the control plane and
  recorded, asserted the way the connector allowlist will be.
- A turn that has ingested extracted web content cannot invoke a driver
  operation — or, if that constraint is rejected, the rejection is written
  here with its reasoning.
- Unpairing a machine takes effect immediately and is testable, without the
  machine's cooperation.
- The owner can see an operation happening and stop it mid-flight.
- The product works fully with no driver installed, asserted by running the
  existing suites against a business that has none.
- No credential is transmitted from the machine to the control plane, asserted
  by inspecting what the pairing and operation payloads actually contain.

## Sequencing

Not before the cloud connectors. This adds reach, and reach is worth less
than the things every customer gets — and its security design is the hardest
thing on any of these three plans.

1. Cloud connectors first, per the integration plan.
2. Pairing and the allowlist, with one read-only operation: "what is on this
   page". Enough to prove the path and the consent model.
3. The untrusted-content boundary, resolved, before any operation that acts.
4. Desktop applications, AutoCount among them, as named flows.

The bridge plan's architecture section is still worth reading for the parts
that stay true — version pinning, machines that are switched off, and being
blamed for the customer's slow month-end.
