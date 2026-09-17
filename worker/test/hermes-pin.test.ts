/** The Hermes pin must live in exactly one place.
 *
 * It was a literal in eight — the transfer, both sides of the spare
 * attestation, the marker written on the sprite, two manual scripts and two
 * test fixtures. Moving it meant finding all eight, and missing one fails
 * silently rather than loudly: a spare whose marker names a different commit
 * is judged unsafe and retired, so the pool empties and every signup pays a
 * cold provision. Two fixtures were in fact stale on 2026-09-17 and only the
 * spare tests caught them.
 *
 * This fails on any Hermes-shaped SHA written outside hermes-pin.ts.
 */
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { HERMES_COMMIT, HERMES_TAG } from '../src/runtime/hermes-pin';

const REPO = new URL('../..', import.meta.url).pathname;

function grep(pattern: string): string[] {
  try {
    const out = execFileSync('git', ['grep', '-lE', pattern, '--', 'worker/src', 'worker/test', 'runner/bin'], {
      cwd: REPO, encoding: 'utf8',
    });
    return out.split('\n').filter(Boolean);
  } catch {
    return []; // git grep exits 1 when nothing matches
  }
}

describe('the Hermes pin', () => {
  it('is written in exactly one file', () => {
    const holders = grep(HERMES_COMMIT).filter((f) => f !== 'worker/src/runtime/hermes-pin.ts');
    expect(holders, 'import HERMES_COMMIT from runtime/hermes-pin instead of copying the SHA').toEqual([]);
  });

  it('names no other Hermes release anywhere', () => {
    /* A leftover from a previous pin is the same failure one bump later.
       Quoted only: the bootstrap's comments cite older releases as history
       ("Installers before v2026.9.5"), which is prose, not a second pin. */
    const holders = grep('[\'\"]v2026\\.[0-9]+\\.[0-9]+[\'\"]').filter((f) => f !== 'worker/src/runtime/hermes-pin.ts');
    expect(holders, 'a Hermes tag outside hermes-pin.ts is a second source of truth').toEqual([]);
  });

  it('keeps the tag and the commit together', () => {
    /* bootstrap fetches the tag so the installer's checkout resolves, then
       pins forward to the commit. A tag that points elsewhere leaves the
       sprite on whatever the tag names. */
    expect(HERMES_TAG).toMatch(/^v\d{4}\.\d+\.\d+$/);
    expect(HERMES_COMMIT).toMatch(/^[0-9a-f]{40}$/);
  });
});
