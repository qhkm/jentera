/* ============================================================
   Approvals — outbound actions the AI wants to take. Nothing
   leaves until a human says so; the tool contract queues anything
   above low risk here rather than executing it.
   ============================================================ */

import { Avatar, Button, Card, Tag } from '@/components/ui';
import { useT } from '@/i18n/I18nProvider';
import { useToast } from '@/components/Toast';
import { decideApproval } from '@/lib/tools';
import type { Tone } from '@/lib/types';
import type { useBusiness } from '@/hooks/useBusiness';

function riskTone(risk: string): Tone {
  if (risk === 'high') return 'red';
  if (risk === 'medium') return 'amber';
  return 'green';
}

export default function ApprovalsView({ b }: { b: ReturnType<typeof useBusiness> }) {
  const t = useT();
  const toast = useToast();

  function decide(id: number, ok: boolean) {
    decideApproval(id, ok);
    b.refresh();
    toast(ok ? t('appr.approved') : t('appr.rejected'));
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-pixel text-2xl tracking-tight">{t('view.approvals')}</h1>
        <p className="max-w-[66ch] text-sm text-text-secondary">{t('view.approvals.desc')}</p>
      </header>

      {b.approvals.length === 0 ? (
        <Card className="items-center gap-2 py-8 text-center">
          <span className="text-2xl" aria-hidden="true">
            🛡️
          </span>
          <p className="text-[13px] text-text-secondary">{t('appr.empty')}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {b.approvals.map((a) => {
            const args = Object.entries(a.args ?? {});
            return (
              <Card key={a.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Avatar>🛡️</Avatar>
                    <div className="flex flex-col">
                      <span className="text-sm">
                        {a.conn} · {a.op}
                      </span>
                      <span className="text-[11px] text-text-muted">{a.ts}</span>
                    </div>
                  </div>
                  <Tag tone={riskTone(a.risk)}>{t(`appr.risk.${a.risk}`)}</Tag>
                </div>

                {args.length ? (
                  <div className="overflow-x-auto rounded-item bg-[rgb(var(--border-ink)/0.03)] p-3">
                    <pre className="font-mono text-[11px] whitespace-pre-wrap text-text-secondary">
                      {args.map(([k, v]) => `${k}: ${String(v)}`).join('\n')}
                    </pre>
                  </div>
                ) : null}

                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    className="px-4 py-1.5 text-xs"
                    onClick={() => decide(a.id, false)}
                  >
                    {t('appr.reject')}
                  </Button>
                  <Button className="px-4 py-1.5 text-xs" onClick={() => decide(a.id, true)}>
                    {t('appr.approve')}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
