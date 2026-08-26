/* ============================================================
   One-time transfer of browser state to the server, on first sign-in.

   The dangerous direction is the reverse one. A returning owner who
   signs in on a fresh browser has an EMPTY local snapshot; pushing that
   over their real business would erase it. So this runs only when the
   account has no business at all, and never overwrites.
   ============================================================ */

import type { BusinessSnapshot } from './types';
import type { LocalRepository } from './local';
import type { RemoteRepository } from './remote';
import * as store from '@/lib/storage';

/** True when the browser holds a business worth carrying over. */
export function hasLocalState(snap: BusinessSnapshot): boolean {
  return Boolean(snap.bizType) || snap.onboarded || snap.conns.length > 0 || snap.facts.length > 0;
}

/**
 * Copy the local snapshot into a newly created remote business.
 *
 * Call only when the account has no business — the caller establishes
 * that from a NO_BUSINESS response, not from a guess.
 */
export async function migrateLocalToRemote(
  local: LocalRepository,
  remote: RemoteRepository,
): Promise<'migrated' | 'created-empty'> {
  const snap = await local.load();

  await remote.createBusiness({
    name: snap.bizName || 'My business',
    playbookKey: snap.bizType || 'generic',
    country: snap.country,
    lang: snap.lang,
    locality: snap.bizLoc || undefined,
  });

  if (!hasLocalState(snap)) return 'created-empty';

  /* Order matters only in that the flow gates go last: if the transfer
     dies halfway, the owner lands mid-onboarding with partial data
     rather than on a dashboard that claims to be set up and is not. */
  if (snap.channels?.length) await remote.setChannels(snap.channels);
  if (snap.conns.length) await remote.setConnections(snap.conns);
  if (snap.theme !== 'dark') await remote.setTheme(snap.theme);

  for (const [op, policy] of Object.entries(snap.permissions)) {
    await remote.setPolicy(op, policy);
  }
  for (const [key, indices] of Object.entries(snap.workDone)) {
    for (const idx of indices) await remote.markWorkDone(key, Number(idx));
  }
  for (const [key, picks] of Object.entries(snap.learn)) {
    for (const [pick, count] of Object.entries(picks)) {
      for (let i = 0; i < count; i++) await remote.recordLearn(key, pick);
    }
  }
  for (const a of snap.approvals) {
    if (a.status === 'pending') await remote.queueApproval(a);
  }
  /* Live facts only. Replaying superseded versions would rewrite the
     history in the wrong order, and the demo's history is not worth
     more than a clean starting point on the server. */
  for (const f of snap.facts) {
    await remote.setFact({
      key: f.key,
      value: f.value,
      source: f.source,
      sourceRef: f.sourceRef,
      confidence: f.confidence,
    });
  }

  if (snap.onboarded) await remote.setOnboarded(true);
  if (snap.setupDone) await remote.setSetupDone(true);

  /* Clear the browser copy only once the server has it. Leaving it would
     mean a later sign-out silently reverts the owner to a stale snapshot
     of their own business. */
  store.resetAll();

  return 'migrated';
}
