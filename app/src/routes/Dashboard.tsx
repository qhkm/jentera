/* ============================================================
   Dashboard shell. Views are routes-within-a-route driven by
   local state, matching the static site's .as-view toggling.

   Home is stage-driven, not a fixed layout: setup → connect →
   operating, one clear call to action per stage.
   ============================================================ */

import { useState } from 'react';
import { Link } from 'react-router';
import { Shell } from '@/components/Shell';
import { Avatar, Button, Card, Eyebrow, Progress, Tag } from '@/components/ui';
import { useBusiness } from '@/hooks/useBusiness';
import { useT } from '@/i18n/I18nProvider';
import { isAgentReady } from '@/lib/business';
import { decideApproval } from '@/lib/tools';
import type { Tone } from '@/components/ui';

type View = 'home' | 'aiteam' | 'work' | 'connections' | 'approvals';

const NAV: { id: View; labelKey: string }[] = [
  { id: 'home', labelKey: 'nav.home' },
  { id: 'aiteam', labelKey: 'nav.aiteam' },
  { id: 'work', labelKey: 'nav.work' },
  { id: 'connections', labelKey: 'nav.connections' },
  { id: 'approvals', labelKey: 'nav.approvals' },
];

function toneFor(tc: string): Tone {
  return tc === 'green' || tc === 'red' || tc === 'amber' ? tc : 'neutral';
}

export default function Dashboard() {
  const t = useT();
  const [view, setView] = useState<View>('home');
  const b = useBusiness();
  const { business } = b;

  return (
    <Shell suffix="/platform">
      <div className="flex flex-col gap-8 lg:flex-row">
        {/* ---- Sidebar ---- */}
        <aside className="flex shrink-0 flex-col gap-6 lg:w-[220px]">
          <Card className="gap-2">
            <div className="flex items-center gap-3">
              <Avatar>{business.icon}</Avatar>
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-semibold">{business.name}</span>
                <span className="truncate text-[11px] text-text-muted">{business.loc}</span>
              </div>
            </div>
            <div className="flex flex-col gap-2 border-t border-rail pt-3">
              <div className="flex items-center justify-between">
                <Eyebrow>{t('side.potential')}</Eyebrow>
                <span className="font-pixel text-sm tabular-nums text-brand">{b.potential}%</span>
              </div>
              <Progress value={b.potential} label="AI potential" />
              <span className="text-[11px] text-text-muted">
                {t('pot.txt').replace('{n}', String(business.opportunities))}
              </span>
            </div>
          </Card>

          <nav className="flex flex-col gap-1" aria-label="Dashboard sections">
            {NAV.map((item) => {
              const active = view === item.id;
              const badge = item.id === 'approvals' ? b.approvals.length : 0;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setView(item.id)}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center justify-between gap-2 rounded-item px-3.5 py-2.5 text-[13px] transition-colors ${
                    active
                      ? 'bg-brand-soft text-brand'
                      : 'text-text-secondary hover:bg-[rgb(var(--border-ink)/0.05)] hover:text-text'
                  }`}
                >
                  <span>{t(item.labelKey)}</span>
                  {badge > 0 ? <Tag tone="amber">{badge}</Tag> : null}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* ---- Views ---- */}
        <div className="min-w-0 flex-1">
          {view === 'home' && <Home b={b} />}
          {view === 'aiteam' && <AiTeam b={b} />}
          {view === 'work' && <Work b={b} />}
          {view === 'connections' && <Connections b={b} />}
          {view === 'approvals' && <Approvals b={b} />}
        </div>
      </div>
    </Shell>
  );
}

/* ---- Home: one CTA per stage ---- */

function Home({ b }: { b: ReturnType<typeof useBusiness> }) {
  const t = useT();
  const { business, stage } = b;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-pixel text-2xl tracking-tight">{t('view.home.greet')}</h1>
        <p className="text-sm text-text-secondary">
          {stage === 'setup'
            ? t('sub.step1')
            : stage === 'connect'
              ? t('sub.step2')
              : t('sub.step3')}
        </p>
      </header>

      {stage !== 'operating' ? (
        <Card className="gap-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <Eyebrow>{t(stage === 'setup' ? 'cmd.step1.title' : 'cmd.step2.title')}</Eyebrow>
              <h2 className="font-pixel text-lg tracking-tight">
                {t(stage === 'setup' ? 'cmd.step1.head' : 'cmd.step2.head')}
              </h2>
              <p className="text-[13px] text-text-secondary">
                {t(stage === 'setup' ? 'cmd.step1.body' : 'cmd.step2.body')}
              </p>
            </div>
            <Tag tone="amber">{stage === 'setup' ? 'setup' : t('cmd.step2.tag')}</Tag>
          </div>
          <div>
            <Link to="/setup">
              <Button className="px-5 py-2 text-sm">
                {t(stage === 'setup' ? 'cmd.step1.cta' : 'cmd.step2.cta')}
              </Button>
            </Link>
          </div>
        </Card>
      ) : (
        <Card className="gap-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <Eyebrow>{t('cmd.step3.title')}</Eyebrow>
              <h2 className="font-pixel text-lg tracking-tight">
                {t('db.handled', { n: business.work.filter((w) => w.tag !== 'needs you').length })}
              </h2>
              <p className="text-[13px] text-text-secondary">
                {business.team.slice(0, 3).map((m) => `${m.e} ${m.n}`).join(' · ')}
              </p>
            </div>
            <Tag tone="green">live</Tag>
          </div>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {business.stats.map((s) => (
          <Card key={s.d} className="gap-3">
            <Eyebrow>{s.d}</Eyebrow>
            <span className="font-pixel text-3xl tabular-nums">
              {s.v}
              {s.u ? <span className="text-lg text-text-muted">{s.u}</span> : null}
            </span>
            <span className="text-[13px] text-text-secondary">{s.l}</span>
            {s.s ? <span className="text-[11px] text-text-muted">{s.s}</span> : null}
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ---- AI Team ---- */

function AiTeam({ b }: { b: ReturnType<typeof useBusiness> }) {
  const t = useT();
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
            <Card key={m.n} className="gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Avatar>{m.e}</Avatar>
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold">{m.n}</span>
                    <span className="text-[11px] text-text-muted">{m.ch}</span>
                  </div>
                </div>
                <Tag tone={ready ? 'green' : 'amber'}>{ready ? 'live' : t('conn.first')}</Tag>
              </div>
              <p className="text-[13px] text-text-secondary">{m.d}</p>
              {m.m ? <span className="text-[11px] text-text-muted">{m.m}</span> : null}
            </Card>
          );
        })}
      </div>

      {b.recommended.length > 0 && (
        <div className="flex flex-col gap-3">
          <Eyebrow>{t('rec.title')}</Eyebrow>
          <div className="grid gap-3 md:grid-cols-2">
            {b.recommended.map((r) => (
              <Card key={r.n} className="gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Avatar>{r.e}</Avatar>
                    <span className="text-sm font-semibold">{r.n}</span>
                  </div>
                  <Tag>{r.tag}</Tag>
                </div>
                <p className="text-[13px] text-text-secondary">{r.d}</p>
                <div>
                  <Button variant="reco" className="px-4 py-1.5 text-xs">
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

/* ---- Work ---- */

function Work({ b }: { b: ReturnType<typeof useBusiness> }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-pixel text-2xl tracking-tight">{t('view.work')}</h1>
        <p className="max-w-[66ch] text-sm text-text-secondary">{t('view.work.desc')}</p>
      </header>

      <div className="flex flex-col gap-3">
        {b.business.work.map((w, i) => {
          const done = b.workDone(i);
          const needsYou = w.tag === 'needs you' && !done;
          return (
            <Card key={`${w.n}-${i}`} className="gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <Avatar>{w.e}</Avatar>
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-semibold">{w.n}</span>
                    <span className="text-[11px] text-text-muted">{w.t}</span>
                  </div>
                </div>
                <Tag tone={done ? 'green' : toneFor(w.tc)}>{done ? 'done' : w.tag}</Tag>
              </div>
              <p className="text-[13px] text-text-secondary">{w.d}</p>
              {needsYou && (
                <div>
                  <Button className="px-4 py-1.5 text-xs" onClick={() => b.completeWork(i)}>
                    {t('work.respond')}
                  </Button>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ---- Connections ---- */

function Connections({ b }: { b: ReturnType<typeof useBusiness> }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-pixel text-2xl tracking-tight">{t('view.connections')}</h1>
        <p className="max-w-[66ch] text-sm text-text-secondary">{t('view.connections.desc')}</p>
      </header>

      <div className="flex flex-col gap-3">
        {b.business.conns.map((c) => {
          const on = b.connections.includes(c.n);
          return (
            <Card key={c.n} className="gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <Avatar>{c.e}</Avatar>
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-semibold">{c.n}</span>
                    <span className="text-[11px] text-text-muted">{c.s}</span>
                  </div>
                </div>
                <Button
                  variant={on ? 'outline' : 'reco'}
                  className="px-4 py-1.5 text-xs"
                  onClick={() => b.toggleConn(c.n)}
                >
                  {on ? t('db.disconnect') : t('conn.enable')}
                </Button>
              </div>
              <p className="text-[13px] text-text-secondary">{c.d}</p>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ---- Approvals: nothing goes out without a human ---- */

function Approvals({ b }: { b: ReturnType<typeof useBusiness> }) {
  const t = useT();

  function decide(id: number, ok: boolean) {
    decideApproval(id, ok);
    b.refresh();
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
          {b.approvals.map((a) => (
            <Card key={a.id} className="gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Avatar>🛡️</Avatar>
                  <div className="flex flex-col">
                    <span className="text-sm">
                      {a.conn} · {a.op}
                    </span>
                    <span className="text-[11px] text-text-muted">{a.ts}</span>
                  </div>
                </div>
                <Tag tone={a.risk === 'high' ? 'red' : a.risk === 'medium' ? 'amber' : 'green'}>
                  {t(`appr.risk.${a.risk}`)}
                </Tag>
              </div>
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
          ))}
        </div>
      )}
    </div>
  );
}
