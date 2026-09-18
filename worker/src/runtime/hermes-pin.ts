/** The Hermes release the fleet runs.
 *
 * Every consumer imports these two values. They were literals in eight
 * places until 2026-09-17 — the transfer, the spare attestation on both
 * sides, the marker written on the sprite, two manual scripts and two test
 * fixtures — and moving the pin meant finding all eight. Missing one does
 * not fail loudly: a spare whose marker names a different commit is judged
 * unsafe and retired, so the pool quietly empties and every signup pays a
 * cold provision instead.
 *
 * `test/hermes-pin.test.ts` fails on any Hermes SHA written anywhere else.
 *
 * The tag must point at the commit: `bootstrap-runtime.sh` fetches the tag
 * to satisfy the installer's checkout, then the installer pins forward to
 * the commit.
 */
export const HERMES_TAG = 'v2026.9.18-1';
export const HERMES_COMMIT = '0f45fad93f82dd9ff12d5d3755f883b1881ac748';
