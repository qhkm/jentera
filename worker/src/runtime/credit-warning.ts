/* Telling the owners before the month's AI credits run out.

   Until this, an owner first heard about spend from CREDIT_CAP_NOTICE, in
   the reply to a request that had already been refused. Two limits can stop
   work — cost and computer time — so the share that counts is whichever is
   nearer its cap, and the message names that one.

   Once a month per owner: the source key carries the month, and
   `createNotification` inserts nothing for a key it already holds. The
   month is the database's `date_trunc('month', now())`, the same window
   `runtimeBudgetSnapshot` sums, so the warning and the meter agree on when
   the credits reset. */
import type postgres from 'postgres';
import { createNotification } from '../notifications/store';
import { ownersOf } from '../notifications/recipients';
import { runtimeBudgetSnapshot } from './usage';

export const CREDIT_WARNING_SHARE = 0.8;

const RESET = 'They reset on the 1st. Reply in chat if you need more before then.';
const usd = (microusd: number) => `US$${(microusd / 1_000_000).toFixed(2)}`;

/** Warn every owner once this month if 80% of a cap is used; returns how
    many were told. Called after a run's usage is final. */
export async function maybeWarnCredits(tx: postgres.TransactionSql, businessId: string): Promise<number> {
  const { budget, usage } = await runtimeBudgetSnapshot(tx, businessId);
  const costShare = usage.costMicrousd / budget.monthlyCostMicrousd;
  const runtimeShare = usage.runtimeMs / (budget.monthlyRuntimeSeconds * 1_000);
  if (Math.max(costShare, runtimeShare) < CREDIT_WARNING_SHARE) return 0;

  const body = runtimeShare > costShare
    ? `${(usage.runtimeMs / 3_600_000).toFixed(1)} of ${Math.round(budget.monthlyRuntimeSeconds / 3_600)} hours of computer time used. ${RESET}`
    : `${usd(usage.costMicrousd)} of ${usd(budget.monthlyCostMicrousd)} used. ${RESET}`;
  const [{ month }] = await tx<{ month: string }[]>`
    select to_char(date_trunc('month', now()), 'YYYY-MM') as month`;

  let sent = 0;
  for (const owner of await ownersOf(tx, businessId)) {
    if (await createNotification(tx, businessId, {
      recipientUserId: owner,
      kind: 'credit_warning',
      title: '80% of this month’s AI credits used',
      body,
      sourceKey: `credit_warning:${month}`,
      url: '/app?view=business&tab=profile',
    })) sent += 1;
  }
  return sent;
}
