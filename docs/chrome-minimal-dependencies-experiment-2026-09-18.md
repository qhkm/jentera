# Minimal Chrome dependencies experiment — 18 September 2026

Status: **executed after provider recovery, partial compatibility pass**.
No production changes. One fresh environment per arm, not a statistical benchmark.

## Prepared comparison

Harness: `scripts/experiments/chrome-setup-benchmark.mjs`, modes `default` and
`minimal`. Both use full Chrome for Testing 153.0.8010.47 with the same verified
archive digest and agent-browser 0.38.1. Library lists and explicit fonts are
identical. Only apt's `--no-install-recommends` differs; it is applied to both
conflict simulation and real installation. Browser installation is serial in
both arms to isolate this variable.

Separate timings cover apt index update, package resolution/conflict simulation,
installation, Chrome download/checksum/extraction and browser smokes. Package
inventories before and after installation allow comparing package count/names;
aggregate installed package size is also recorded.

Planned checks: navigation/title, DOM snapshot, canvas pixels and input value,
multilingual screenshot, PNG/PDF headers and size, and localStorage surviving
close/reopen with a persistent profile. Inspect screenshots for actual glyph
rendering. These are not headed desktop/sandbox acceptance tests. `fc-match`
is diagnostic only when present; a missing utility is not missing font files.

JavaScript and emitted shell syntax checks pass. Both installs passed navigation,
title, snapshot, canvas pixel/input assertions, PNG screenshot and PDF generation
with file-header/size checks. The minimal screenshot was copied locally and
visually inspected: Malay/Chinese/Arabic/emoji glyphs and the red canvas rendered.
PDF text extraction and headed desktop/sandbox operation were not checked.

## Measurements after recovery

| Stage | Normal apt | No recommended packages |
| --- | ---: | ---: |
| Browser CLI npm installation (outside dependency timer) | 6.366 s | 3.248 s |
| apt index update | 4.929 s | 9.018 s |
| package resolution/conflict simulation | 17.096 s | 8.529 s |
| apt installation | 84.728 s | 45.152 s |
| total Linux dependency setup | **106.783 s** | **62.713 s** |
| added packages | **131** | **108** |
| total installed package size (dpkg metadata, KiB) | 1,284,922 | 1,276,751 |
| Chrome download | 11.537 s | 9.117 s |
| Chrome checksum verification | 0.838 s | 0.604 s |
| Chrome extraction | 4.782 s | 3.077 s |
| total Chrome preparation | 17.185 s | 12.814 s |

Dependency setup was 44.070 seconds (41.3%) faster in this pair, but mirrors,
provider load and package resolution differ between machines. Package reduction
is structural; the timing improvement needs repetitions. The size difference
was only 8,171 KiB, so don't attribute every timing difference to fewer bytes.
Summed dependency/Chrome stage times are not an uninterrupted readiness timer.

Both added-package inventories were retained locally and compared: the minimal
arm added no package absent from the normal arm. The 23 normal-only packages:

```text
alsa-topology-conf alsa-ucm-conf at-spi2-core dmsetup
gsettings-desktop-schemas ibus-gtk3 libcryptsetup12 libdevmapper1.02.1
libglib2.0-data libgtk-3-bin libheif-plugin-aomenc libibus-1.0-5
libkmod2 libnss-systemd librsvg2-common libxtst6 linux-sysctl-defaults
systemd-cryptsetup systemd-resolved systemd-timesyncd
user-session-migration x11-common xdg-user-dirs
```

These are not automatically unnecessary for every feature: input methods,
accessibility and desktop integrations merit explicit testing. Some systemd
components installed by recommendations are not needed for this headless smoke,
but this test alone does not approve a desktop package policy.

Both original runs stopped at an inventory-sorting diagnostic: sort/comm locale
ordering disagreed. The harness now fixes `LC_ALL=C`; existing inventories were
re-sorted and browser preparation resumed without rerunning or retiming apt.
`--finish-after-deps` is only for this recovery on these exact experiment targets.
No library install failed.

Persistent-profile checks were **not validated**: one immediate reopen hit a
daemon connection error, then both variants produced the same localStorage
SecurityError after reporting example.com opened. This could be tab/origin or
CLI lifecycle behaviour; cause was not established. Subsequent diagnostics hit
provider temporary-unavailable errors. Do not call persistence passed or blame
minimal libraries on this evidence. Broader Jentera runner acceptance is still
required before deployment.

## Provider attempts and resource uncertainty

Only these exact disposable names were requested:

- `aisar-exp-chrome-default-20260918-02`
- `aisar-exp-chrome-minimal-20260918-02`

Initial creation requests returned temporary-unavailable/deadline errors; exact
GETs returned 404 for both. One same-name retry per target also timed out.
Subsequent GET checks encountered provider unavailability. Consequently resource
creation after those retries is **not confirmed absent**. No benchmark exec was
started on either target and neither contains customer data. When the provider
recovers, inspect only these exact names, verify private URL auth, run the
comparison if genuinely fresh, and destroy these disposable test resources
after retaining results. Never substitute customer Sprites or ready spares.

## Recovery and recommendation

At about 17:29 UTC, both same-name environments were successfully created in
24 seconds and exact GETs verified private `sprite`/`admins` access. The tests
then ran on those fresh targets. Later provider exec errors recurred.

This option is promising for clean-factory provisioning; retain the same required
libraries/fonts and removal guards. Do not deploy from this single partial test.
Next: repeat timings and test the actual pinned Jentera browser runner, including
persistent sessions, owner control, sandbox checks and future desktop support.
It does not change model/chat response time or the already-prepared-spare path.

## Final cleanup

Destroyed only the two disposable targets after saving results and inventories.
Both deletion commands reported an error, but subsequent exact provider GETs
returned 404 for both, confirming absence. No customer Sprite or ready spare
was touched. The minimal screenshot is retained locally at
`/tmp/jentera-chrome-minimal-20260918.png` (reproducible public fixture).
