import { spawnSync } from 'node:child_process';

/** Exercise the pinned bootstrap's actual Bash guard, not a second tag regex.
 * Never execute the downloaded bootstrap or its failure branch on the host.
 * Only anchored numeric-version regex syntax is admitted into the shell;
 * the tag itself travels as an argument, never interpolated shell source. */
export function assertBootstrapAcceptsHermesTag(bootstrap, tag) {
  const guards = [...bootstrap.matchAll(/^\[\[ "\$hermes_tag" =~ ([^\n]+) \]\] \|\|/gm)];
  if (guards.length !== 1) throw new Error('cannot identify exactly one bootstrap Hermes tag guard');
  const pattern = guards[0][1];
  if (pattern.length > 200 || !pattern.startsWith('^') || !pattern.endsWith('$') ||
      !/^[\\v0-9.\[\]{}()+?|,-]+$/.test(pattern.slice(1, -1))) {
    throw new Error('bootstrap Hermes tag guard has unreviewed syntax');
  }
  const result = spawnSync('bash', ['-c', `hermes_tag="$1"\n[[ "$hermes_tag" =~ ${pattern} ]]`,
    'bootstrap-tag-contract', tag], { encoding: 'utf8', timeout: 5000, maxBuffer: 4096 });
  if (result.error || ![0, 1].includes(result.status)) {
    throw new Error('could not execute the bootstrap Hermes tag guard');
  }
  if (result.status !== 0) throw new Error('pinned bootstrap rejects the central Hermes tag; ship a compatible bundle before deploying');
}
