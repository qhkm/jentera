# Chrome setup serial/parallel experiment — 18 September 2026 MYT

No production changes. Two new private Sprites, no customers, credentials,
inference, runtime assignment or pool inventory writes. One sample per arm.

## Pins and procedure

- `agent-browser@0.38.1`; its reviewed apt dependency list, including fonts,
  t64 package resolution and refusal of simulated package removals.
- Chrome for Testing `153.0.8010.47`, Linux x86_64, full Chrome.
- Official archive URL:
  `https://storage.googleapis.com/chrome-for-testing-public/153.0.8010.47/linux64/chrome-linux64.zip`.
- SHA256 `89778cbf7a852726b6f51649b2586b894c00737e81f8031733721560d21bbea7`:
  established from a separate official HTTPS download locally, then both remote
  downloads compared to this exact digest before extraction/execution. This is
  repeatability/integrity checking, not an independently signed provenance claim.
- Serial arm installs Linux libraries, then downloads/verifies/extracts Chrome.
- Parallel arm overlaps the same library operation with Chrome preparation;
  both background exit statuses must succeed before the smoke.
- Agent-browser uses the explicitly supplied Chrome executable, opens example.com,
  asserts its title, takes a DOM snapshot and screenshot, then closes.
- Bash/node syntax checks passed. Invalid mode rejected before external actions.

Reproducible harness: `scripts/experiments/chrome-setup-benchmark.mjs`.
It targets only these exact newly created experiment names, refuses existing
Jentera directories or a previous benchmark directory, and is not invoked by
production bootstrap. `--print` emits the shell program without executing it.
Re-running requires freshly created private environments and explicit operator
inspection. It does not itself verify URL authentication; that was checked
through the provider API before this run (`sprite`, `admins` on both).

## Results

Times are wall-clock milliseconds inside each Sprite; no creation, queue,
tenant configuration or Jentera adapter checks included.

| Stage | Serial | Parallel |
| --- | ---: | ---: |
| npm browser CLI installation (outside browser timer) | 5,665 | 7,120 |
| apt index update | 8,029 | 4,728 |
| package resolution and conflict simulation | 14,039 | 19,181 |
| apt install | 67,436 | 93,705 |
| Total Linux dependency preparation | 89,526 | 117,721 |
| Chrome download | 10,456 | 12,440 |
| Chrome checksum verification | 661 | 787 |
| Chrome extraction | 3,902 | 4,160 |
| Total Chrome preparation | 15,041 | 17,412 |
| Combined installation critical path | **104,590** | **117,755** |
| Browser navigation/title/DOM/screenshot/close smoke | 11,071 | 6,453 |
| Installation + smoke | **115,678** | **124,224** |

Both checksums and both browser smokes passed. Parallel installation was about
13.2 seconds slower in this pair. Its apt preparation was about 28.2 seconds
slower; overlap hid the 17.4-second browser preparation, but could not compensate
for package-manager variation. One pair does not establish that concurrency
caused the apt slowdown, nor a reproducible speed improvement or regression.
The arms ran concurrently on separate Sprites; shared provider/mirror contention
is possible. These custom installer timings are not directly comparable to the
previous 71.809-second agent-browser installer sample (different extraction,
version selection and environment conditions).

## Conclusion

Do not ship this concurrency change as a proven latency optimisation. The
dominant work here is Linux dependencies and apt package resolution, not Chrome
download. Prepared clean spares avoid both on the signup path already.

Next isolated benchmark: use `--no-install-recommends` with the same explicitly
required libraries and fonts, compare installed package lists, retain removal
guards, and verify persistent profiles, screenshots, PDF/font rendering and
sandbox/desktop behaviour before considering deployment. Another option is a
reviewed OS/architecture-specific browser/library bundle; that needs loader,
libc, sandbox, licensing and security-update checks, not arbitrary system-file
copying. R2 browser downloads alone cannot remove apt preparation cost.

## Resource lifecycle

Targets: `aisar-exp-chrome-serial-20260918-01` and
`aisar-exp-chrome-parallel-20260918-01`. Provider creation requests timed out at
the CLI but subsequent exact GETs confirmed both were created, so no duplicate
creates were attempted. Both disposable experiment Sprites were destroyed after
retaining the results; exact provider GETs returned 404 for both. No other
Sprite was deleted. Installed public software and example.com screenshots
are reproducible and contain no unique customer artifacts.
