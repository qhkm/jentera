/* ============================================================
   My Business — everything Jentera knows, plus what it is allowed
   to do on your behalf.

   Absorbs two views that used to sit at the top level: the agent
   roster (now "what Jentera handles") and connections. Neither is a
   product in its own right — they are facts about this business.
   ============================================================ */

import { useMemo, useState } from 'react';
import { Avatar, Button, Card, Eyebrow, Input, LoadingState, Tag } from '@/components/ui';
import { useT } from '@/i18n/I18nProvider';
import { DataIcon } from '@/components/Icon';
import { Tabs, type TabDef } from '@/components/Tabs';
import PermissionsPanel from './PermissionsPanel';
import KnowledgePanel from './KnowledgePanel';
import TelegramConnect from './TelegramConnect';
import { isLive, withoutLinkClaim } from '@/lib/live-connectors';
import { connectedNames, useConnections } from '@/hooks/useConnections';
import { useSignedIn } from '@/lib/repo/gate';
import { useToast } from '@/components/Toast';
import { isAgentReady } from '@/lib/business';
import { findConnector } from '@/lib/tools';
import { useMutate, useSnapshot } from '@/lib/repo';
import type { PlaybookFunc, Tone } from '@/lib/types';
import type { useBusiness } from '@/hooks/useBusiness';

/* Writes are fire-and-forget by design; the provider surfaces failures
   centrally, so this only stops an unhandled rejection. */
const noop = () => {};

const CHANNELS = ['WhatsApp', 'Telegram', 'Instagram', 'Email', 'Phone'];

function funcTone(colour: string): Tone {
  return colour === 'green' || colour === 'amber' || colour === 'red' ? colour : 'neutral';
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-rail py-2.5 last:border-b-0">
      <Eyebrow className="shrink-0">{label}</Eyebrow>
      <span className="text-right text-[13px] text-text-secondary">{value || '—'}</span>
    </div>
  );
}

type BizTab = 'profile' | 'knows' | 'handles' | 'connections' | 'permissions';

export default function MyBusinessView({ b }: { b: ReturnType<typeof useBusiness> }) {
  const [tab, setTab] = useState<BizTab>('profile');
  const t = useT();
  const toast = useToast();
  const snap = useSnapshot();
  const mutate = useMutate();
  const { business } = b;
  const unconfirmed = snap.facts.filter((f) => !f.confirmed).length;
  const signedIn = useSignedIn();
  const [name, setName] = useState(business.name);
  const [loc, setLoc] = useState(business.loc);

  /* One fetch for the whole screen. The badge, the chips and the
     Telegram card all read it, so disconnecting a bot moves all three. */
  const conns = useConnections();
  const linked = useMemo(() => connectedNames(conns.rows), [conns.rows]);

  /* Signed in, "active" means connected — not what onboarding said the
     business uses, and not what the playbook seeded. Those two were
     lighting WhatsApp and Instagram for an account whose only
     connection was the Telegram bot sitting directly above them.

     Pending is not the demo here either: falling back while the fetch
     was in flight lit those same two chips for a moment on every
     visit. Nothing lit until the answer arrives. */
  const active =
    conns.mode === 'demo' ? (business.ch.length ? business.ch : b.connections) : [...linked];
  const dirty = name.trim() !== business.name || loc.trim() !== business.loc;

  function save() {
    void mutate((r) => r.setBizProfile({ name: name.trim(), loc: loc.trim() })).catch(noop);
    toast('Business profile updated ✓');
  }

  const TABS: TabDef<BizTab>[] = useMemo(
    () => [
      { id: 'profile', label: t('biz.tab.profile') },
      {
        id: 'knows',
        label: t('biz.tab.knows'),
        /* The count is unconfirmed facts, not the total. A badge
           reading "31" teaches people to ignore it; one showing how
           many decisions are waiting is worth a glance. */
        trailing: unconfirmed > 0 ? <Tag tone="amber">{unconfirmed}</Tag> : undefined,
        trailingCompact: true,
      },
      { id: 'handles', label: t('biz.tab.handles') },
      {
        id: 'connections',
        label: t('biz.tab.connections'),
        /* Real connections when there is a server to ask. The seeded
           playbook list said "4" for a business that had one — and said
           it again for a moment on every load, until `pending` stopped
           being answered with the demo. */
        trailing: (
          <Tag tone="green">
            {conns.mode === 'demo' ? b.connections.length : conns.real ? linked.size : '—'}
          </Tag>
        ),
        trailingCompact: true,
      },
      { id: 'permissions', label: t('biz.tab.permissions') },
    ],
    [t, b.connections.length, unconfirmed, conns.mode, conns.real, linked],
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-pixel text-2xl tracking-tight">{t('view.business')}</h1>
        <p className="max-w-[66ch] text-sm text-text-secondary">{t('view.business.desc')}</p>
      </header>

      <Tabs tabs={TABS} active={tab} onSelect={setTab} label={t('view.business')} />

      {tab === 'knows' && <KnowledgePanel />}

      {/* ---- Profile ---- */}
      {tab === 'profile' && (
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <Eyebrow>{t('biz.profile')}</Eyebrow>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] text-text-muted">Business name</span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full text-[13px]"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] text-text-muted">Location</span>
              <Input
                value={loc}
                onChange={(e) => setLoc(e.target.value)}
                className="w-full text-[13px]"
              />
            </label>
            <div className="flex items-center gap-2">
              <Button className="px-4 py-1.5 text-xs" onClick={save} disabled={!dirty}>
                Save changes
              </Button>
              <span className="inline-flex items-center gap-1.5 text-[11px] text-text-muted">
                <DataIcon emoji={business.icon} size={13} />
                {business.type}
              </span>
            </div>
          </div>
        </Card>

        <Card>
          <Eyebrow>Detected</Eyebrow>
          <div className="flex flex-col">
            <Row label={t('biz.website')} value={business.site} />
            <Row label={t('biz.contact')} value={active.join(' · ')} />
            <Row label={t('biz.booking')} value={business.booking} />
            <Row label={t('biz.systems')} value={business.systems} />
          </div>
        </Card>
      </div>
      )}

      {/* ---- What Jentera handles (was the AI Team view) ---- */}
      {tab === 'handles' && (
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <Eyebrow>{t('biz.handles')}</Eyebrow>
          <p className="max-w-[66ch] text-[13px] text-text-secondary">{t('biz.handles.desc')}</p>
        </div>

        <Card className="gap-2">
          {business.funcs.map((f: PlaybookFunc) => (
            <div key={f[0]} className="flex items-center justify-between gap-3">
              <span className="text-[13px]">{f[0]}</span>
              <Tag tone={funcTone(f[1])}>{t(`func.${f[2]}`) || f[2]}</Tag>
            </div>
          ))}
        </Card>

        <div className="grid gap-3 md:grid-cols-2">
          {business.team.map((m) => {
            const ready = isAgentReady(snap, m);
            return (
              <Card key={m.n}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Avatar emoji={m.e} />
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold">{m.n}</span>
                      <span className="text-[11px] text-text-muted">{m.ch}</span>
                    </div>
                  </div>
                  <Tag tone={ready ? 'green' : 'amber'}>
                    {ready ? t('func.live') : t('team.waiting')}
                  </Tag>
                </div>
                <p className="text-[13px] text-text-secondary">{m.d}</p>
                {ready && m.m ? (
                  <span className="text-[11px] text-text-muted">{m.m}</span>
                ) : null}
              </Card>
            );
          })}
        </div>

        {b.recommended.length > 0 && (
          <>
            <Eyebrow>{t('rec.title')}</Eyebrow>
            <div className="grid gap-3 md:grid-cols-2">
              {b.recommended.map((r) => (
                <Card key={r.n}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Avatar emoji={r.e} />
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
          </>
        )}
      </section>
      )}

      {/* ---- Connections (was its own view) ---- */}
      {tab === 'connections' && (
      <section className="flex flex-col gap-4">
        {/* Real connections first. The catalogue below is what Jentera
            could connect to; this is what it actually can. */}
        {conns.mode === 'pending' ? (
          <Card>
            <LoadingState
              title={t('loading.connections.title')}
              detail={t('loading.connections.detail')}
            />
          </Card>
        ) : (
          <TelegramConnect rows={conns.rows} setRows={conns.setRows} />
        )}
        <div className="flex flex-col gap-1">
          <Eyebrow>{t('biz.connections')}</Eyebrow>
          <p className="max-w-[66ch] text-[13px] text-text-secondary">
            {t('biz.connections.desc')}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {CHANNELS.map((c) => (
            <span key={c} className={`chip ${active.includes(c) ? 'chip-green' : 'opacity-50'}`}>
              {c}
            </span>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          {business.conns.map((c) => {
            const on = b.connections.includes(c.n);
            const cx = findConnector(c.n);
            /* Signed in, this is a real business: a connector with no
               implementation behind it cannot be marked connected,
               because the toggle only ever wrote a name into a list.
               Telegram has its own card above; the rest are honest
               about not being ready. The demo keeps the simulation —
               it is showing what the product will do. */
            const pretend = signedIn && !isLive(c.n);
            return (
              <Card key={c.n}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <Avatar emoji={c.e} />
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-semibold">{c.n}</span>
                      {/* "Business API · linked" is a claim baked into
                          static data. Drop it for a real business; the
                          demo keeps the illustration. */}
                      {(pretend ? withoutLinkClaim(c.s) : c.s) && (
                        <span className="text-[11px] text-text-muted">
                          {pretend ? withoutLinkClaim(c.s) : c.s}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {cx && !pretend ? (
                      <Tag tone="amber">{t(`conn.guide.${cx.method}`)}</Tag>
                    ) : null}
                    <Tag tone={pretend ? 'neutral' : on ? 'green' : 'neutral'}>
                      {pretend ? t('conn.soon') : on ? t('conn.connected') : t('conn.off')}
                    </Tag>
                  </div>
                </div>
                <p className="text-[13px] text-text-secondary">{c.d}</p>
                <div className="flex justify-end">
                  <Button
                    variant={on ? 'outline' : 'primary'}
                    className="px-4 py-1.5 text-xs"
                    disabled={pretend}
                    onClick={() => {
                      if (pretend) return;
                      b.toggleConn(c.n);
                      toast(on ? `${c.n} disconnected.` : `${c.n} connected ✓`);
                    }}
                  >
                    {pretend ? t('conn.soon.cta') : on ? t('conn.disconnect') : t('conn.connect')}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      </section>
      )}

      {tab === 'permissions' && <PermissionsPanel />}
    </div>
  );
}
