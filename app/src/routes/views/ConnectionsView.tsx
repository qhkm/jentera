/* ============================================================
   Connections — the tools the AI team works with. Every entry
   explains why it exists and how it authenticates, because the
   product's promise is that you never touch an API key.
   ============================================================ */

import { Avatar, Button, Card, Tag } from '@/components/ui';
import { useT } from '@/i18n/I18nProvider';
import { useToast } from '@/components/Toast';
import { findConnector } from '@/lib/tools';
import type { useBusiness } from '@/hooks/useBusiness';

export default function ConnectionsView({ b }: { b: ReturnType<typeof useBusiness> }) {
  const t = useT();
  const toast = useToast();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-pixel text-2xl tracking-tight">{t('view.connections')}</h1>
        <p className="max-w-[66ch] text-sm text-text-secondary">{t('view.connections.desc')}</p>
      </header>

      <div className="flex flex-col gap-3">
        {b.business.conns.map((c) => {
          const on = b.connections.includes(c.n);
          const cx = findConnector(c.n);
          return (
            <Card key={c.n}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <Avatar>{c.e}</Avatar>
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-semibold">{c.n}</span>
                    <span className="text-[11px] text-text-muted">{c.s}</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {cx ? (
                    <>
                      <Tag>{cx.tier}</Tag>
                      <Tag tone="amber" title={cx.flow}>
                        {t(`cx.${cx.method}`)}
                      </Tag>
                    </>
                  ) : null}
                  <Tag tone={on ? 'green' : 'neutral'}>{on ? 'connected' : 'off'}</Tag>
                </div>
              </div>

              <p className="text-[13px] text-text-secondary">{c.d}</p>
              {cx ? <p className="text-[11px] text-text-muted">{cx.flow}</p> : null}

              {cx && cx.scope.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {cx.scope.map((s) => (
                    <span key={s} className="chip">
                      {s}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="flex justify-end">
                <Button
                  variant={on ? 'outline' : 'primary'}
                  className="px-4 py-1.5 text-xs"
                  onClick={() => {
                    b.toggleConn(c.n);
                    toast(on ? `${c.n} disconnected.` : `${c.n} connected ✓`);
                  }}
                >
                  {on ? t('db.disconnect') : t('conn.enable')}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
