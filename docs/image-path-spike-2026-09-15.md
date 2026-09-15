# Which path reads a receipt

Status: measured 15 September 2026, against a generated receipt whose values
were known in advance. The spec
(`docs/superpowers/specs/2026-09-15-chat-attachments-design.md`) said receipt
accuracy was unproven and named this as the test.

The receipt: `KEDAI MAKAN SERI MURNI`, three line items, `TOTAL 30.32`,
`Teh Tarik 3 x 3.20`, `Change 19.68`, rendered 380×460 at 13 KB. Each path was
asked for the same three values as JSON.

| Path | Result | Verdict |
|---|---|---|
| **C** — worker model proxy, `image_url` block, direct | `{"total": 30.32, "teh_tarik_qty": 3, "change": 19.68}` | **3/3 correct** |
| **A** — Hermes, file path in the text, `supports_vision: true` | `{"total": 30.32, "teh_tarik_qty": 3, "change": 19.68}` | **3/3 correct**, and its reasoning transcribed every line of the receipt |
| **B** — same, on a sprite without the flag | run failed: `HTTP 403: Platform access required` | **inconclusive** — that business cannot call the model at all |
| Control — file path that does not exist | run failed, no output | **fails rather than inventing** |

## What this settles

**Receipt-grade accuracy is proven for a clean digital receipt.** Both working
paths read every value correctly, including the arithmetic-bearing ones. The
spec may stop hedging for this case — but "clean digital receipt" is the easy
end. A crumpled photograph under kitchen lighting is a different measurement and
has not been made.

**A missing file fails the run; it does not produce a fabricated answer.** That
is the behaviour the design depends on, and it is Hermes' own, not something to
be built.

**The flag has to be pinned, and that decides the mechanism.**
`model.supports_vision: true` is set on the Kitakod sprite and **on no other** —
two sprites checked, both unset — and nothing in the bundle sets it.
It was applied by hand, which CLAUDE.md forbids precisely because the next
re-bootstrap erases it. So:

- Pin `model.supports_vision: true` in `runner/bin/configure-model-provider.py`
  and ship it in a bundle. That makes Path A the mechanism on every sprite, and
  Path A is measured correct.
- Path C stays as the fallback worth keeping in mind — it needs no sprite
  behaviour at all — but it costs a second model call and moves image handling
  into the worker, so it is not the default.

Path B was going to answer "how bad is the auxiliary path when the flag is
off". Once the flag is pinned on, that question stops mattering.

## Two things found on the way

**A live business cannot run the model.** Sprite
`aisar-b-7974363998ba97838531` answers `HTTP 403: Platform access required` for
any run, not only these probes. If that business is simply not admitted yet,
fine — but a provisioned sprite for an account whose every ask fails is worth
knowing about, and nothing surfaces it.

**Kitakod's sprite has drifted from the fleet in at least two ways**:
`supports_vision` set by hand, and Pillow installed where another sprite has
none. Anything measured only there is measured on an unrepresentative machine —
which is how the first reading of these probes went wrong.

## What still needs measuring

- A photograph of a real receipt, not a rendered one: skew, shadow, crumple,
  and a phone-sized file through the proxy's 8 MiB image cap where base64
  inflation bites first.
- The same on the pinned flag after it ships, on a sprite that was never
  touched by hand.
