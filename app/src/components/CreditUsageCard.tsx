/* This month's AI credits, for the owner: what is used, of what, and when
   it resets. Until this, an owner first heard about spend from the reply
   that said the credits had run out.

   Two caps can stop work — cost and computer time — so the bar shows
   whichever is nearer, and names computer time when it is the one. The
   figures come from /api/runtime; the demo repository has none, so the
   card does not appear there rather than showing a made-up meter. */
import { useEffect, useState } from 'react';
import { Coins } from '@phosphor-icons/react';
import { Card, Progress } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { useRepository } from '@/lib/repo';
import type { RuntimeOverview } from '@/lib/repo/types';

const usd = (microusd: number) => `US$${(microusd / 1_000_000).toFixed(2)}`;

export function CreditUsageCard({ now = new Date() }: { now?: Date }) {
  const repo = useRepository();
  const { lang, t } = useI18n();
  const [overview, setOverview] = useState<RuntimeOverview | null>(null);

  useEffect(() => {
    let live = true;
    repo.runtimeStatus().then((next) => { if (live) setOverview(next); }).catch(() => {});
    return () => { live = false; };
  }, [repo]);

  const figures = overview?.canManage ? overview.budget : undefined;
  if (!figures) return null;

  const { budget, usage } = figures;
  const costShare = usage.costMicrousd / budget.monthlyCostMicrousd;
  const runtimeShare = usage.runtimeMs / (budget.monthlyRuntimeSeconds * 1_000);
  const share = Math.max(costShare, runtimeShare);
  /* The Worker's month is the database's UTC month, so credits reset at
     00:00 UTC on the 1st: 08:00 in Malaysia, the same day. */
  const reset = new Intl.DateTimeFormat(lang === 'bm' ? 'ms-MY' : 'en-MY', {
    day: 'numeric', month: 'long', timeZone: 'Asia/Kuala_Lumpur',
  }).format(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)));

  return (
    <Card>
      <div className="workspace-section-heading">
        <div>
          <h3>{t('credits.title')}</h3>
          <p>{t('credits.used', { used: usd(usage.costMicrousd), cap: usd(budget.monthlyCostMicrousd) })}</p>
        </div>
        <Coins size={20} aria-hidden="true" />
      </div>
      <div className={share >= 0.95 ? 'credit-meter-high' : share >= 0.8 ? 'credit-meter-warn' : undefined}>
        <Progress value={Math.round(share * 100)} label={t('credits.title')} />
      </div>
      {runtimeShare > costShare && (
        <p className="text-[12px] text-text-secondary">
          {t('credits.runtime', {
            used: (usage.runtimeMs / 3_600_000).toFixed(1),
            cap: String(Math.round(budget.monthlyRuntimeSeconds / 3_600)),
          })}
        </p>
      )}
      <p className="text-[12px] text-text-muted">{t('credits.reset', { date: reset })}</p>
    </Card>
  );
}
