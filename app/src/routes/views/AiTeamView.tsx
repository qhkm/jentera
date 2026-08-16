/* ============================================================
   AI Team — organised by job, not by agents/models/workflows.
   Recommendations are derived from the playbook's own
   "opportunity" functions, so they stay industry-correct.
   ============================================================ */

import { Avatar, Button, Card, Eyebrow, Tag } from '@/components/ui';
import { useT } from '@/i18n/I18nProvider';
import { useToast } from '@/components/Toast';
import { isAgentReady } from '@/lib/business';
import type { useBusiness } from '@/hooks/useBusiness';
import type { View } from '../Dashboard';

export default function AiTeamView({
  b,
  onNavigate,
}: {
  b: ReturnType<typeof useBusiness>;
  onNavigate: (v: View) => void;
}) {
  const t = useT();
  const toast = useToast();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-pixel text-2xl tracking-tight">{t('view.aiteam')}</h1>
        <p className="max-w-[66ch] text-sm text-text-secondary">{t('view.aiteam.desc')}</p>
      </header>

      <div className="grid gap-3 md:grid-cols-2">
        {b.business.team.map((m) => {
          const ready = isAgentReady(m);
          return (
            <Card key={m.n}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Avatar>{m.e}</Avatar>
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold">{m.n}</span>
                    <span className="text-[11px] text-text-muted">{m.ch}</span>
                  </div>
                </div>
                {ready ? (
                  <Tag tone="green">live</Tag>
                ) : (
                  <Button
                    className="px-4 py-1.5 text-xs"
                    onClick={() => onNavigate('connections')}
                  >
                    {m.setup ? t('conn.enable') : t('conn.first')}
                  </Button>
                )}
              </div>
              <p className="text-[13px] text-text-secondary">{m.d}</p>
              <span className="text-[11px] text-text-muted">
                {ready ? m.m : 'Waiting on a connection — connect a channel first.'}
              </span>
            </Card>
          );
        })}
      </div>

      {b.recommended.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Eyebrow>{t('rec.title')}</Eyebrow>
            <h2 className="font-pixel text-lg tracking-tight">{t('rec.head')}</h2>
            <p className="max-w-[66ch] text-[13px] text-text-secondary">{t('rec.desc')}</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {b.recommended.map((r) => (
              <Card key={r.n}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Avatar>{r.e}</Avatar>
                    <span className="text-sm font-semibold">{r.n}</span>
                  </div>
                  <Tag>{r.tag}</Tag>
                </div>
                <p className="text-[13px] text-text-secondary">{r.d}</p>
                <div>
                  <Button
                    variant="reco"
                    className="px-4 py-1.5 text-xs"
                    onClick={() => toast(t('rec.added').replace('{n}', r.n))}
                  >
                    {t('rec.cta')}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
