# ZeptoClaw provisioning experiment — 17 September 2026

Scope: installation and browser readiness on one new, isolated Sprite. No
production deployment, customer data, model credentials or inference requests.
This is not a Jentera adapter or security acceptance test.

## Environment and pins

- Temporary Sprite: `aisar-exp-zeptoclaw-20260917-01`, organisation `aisar`.
- URL authentication verified as `sprite`, private access `admins`.
- Linux x86_64, Node 24.18.0, npm 12.0.2; no pre-existing browser CLI.
- ZeptoClaw release `v0.9.2`, Linux x86_64 binary, 11,176,808 bytes.
- SHA256 verified against the release checksum before execution:
  `70919f3d2162d4a55a705d481c7ea159ab3f6565e9cc0328065a82e8b053321b`.
- Browser CLI pinned to `agent-browser@0.38.1`; Chrome engine selected explicitly.
  Browser downloads follow that CLI's installer, not a separately fixed digest.

## Measurements

Stage timers use nanosecond wall-clock timestamps inside the Sprite, except
creation measured by the local CLI. These are individual samples, not percentiles.

| Stage | Observed time |
| --- | ---: |
| Sprite creation | 2.93 s |
| Binary download, checksum download, verification, chmod, version/help smoke | 1.422 s |
| Version command, three subsequent invocations | 11 / 11 / 12 ms |
| Browser CLI npm installation | 3.719 s |
| Chrome download and system dependencies (`install --with-deps`) | 71.809 s |
| Open example.com, read title and accessibility snapshot | 1.273 s |
| Sum of measured stages, including Sprite creation | 81.153 s |

The version command is **not** a model-loop, agent startup or first-token test.
The Chrome smoke passed: title `Example Domain`, heading and link returned in
the snapshot, browser closed successfully. This exercised ZeptoClaw's external
browser dependency directly, not a model calling ZeptoClaw's BrowserTool.
Binary download caches/CDN proximity and package mirrors affect repeatability.

## Procedure

Download the binary and `.sha256` from
`https://github.com/qhkm/zeptoclaw/releases/download/v0.9.2/`, compare SHA256,
then execute `--version` and `--help`. Install `agent-browser@0.38.1` globally,
add `$(npm prefix -g)/bin` to PATH, and run `agent-browser install --with-deps`.
With `AGENT_BROWSER_ENGINE=chrome`, open `https://example.com`, read its title,
take an accessibility snapshot, and close the browser.

Two harness corrections were needed: the base image lacks `/usr/bin/time`, so
CLI timings use `date +%s%N`; npm's global bin directory was absent from the
login-shell PATH. Neither failure was a ZeptoClaw binary failure. Operator
pauses/retries are not included in summed stage durations.

## Historical comparison and limits

The preceding production review observed one cold Hermes provision taking
316.54 s end to end, including 199 s for Hermes installation and 55 s for
Chromium preparation. One prepared-spare pilot took 63.02 s end to end.
These are historical observations, **not** a simultaneous A/B benchmark.

ZeptoClaw's 1.422 s binary setup demonstrates much lower installation overhead
than that Hermes installation sample. Do not extrapolate it to signup readiness
or chat latency: tenant configuration, runner/adapter integration, inference,
approvals, upload handling, audit/metering and readiness checks were not tested.
Chrome dependencies still need installation.

No switch of production runtimes is justified by this experiment alone.

## Cleanup

After retaining these measurements locally, only the temporary experiment Sprite
was destroyed (the first provider request failed transiently; the retry succeeded).
Its contents were reproducible public software and public-page output;
it has no customer state or unique artifacts. No production Sprite or spare
inventory entry is created, modified or retired by this experiment.
