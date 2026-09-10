/* ============================================================
   My Business — everything Jentera knows, plus what it is allowed
   to do on your behalf.

   Absorbs two views that used to sit at the top level: the agent
   roster (now "what Jentera handles") and connections. Neither is a
   product in its own right — they are facts about this business.
   ============================================================ */

import { useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpenText,
  Buildings,
  Check,
  Info,
  MapPin,
  PencilSimple,
  PlugsConnected,
  Plus,
  Robot,
  ShieldCheck,
  Trash,
} from '@phosphor-icons/react';
import { Avatar, Button, Card, Eyebrow, Input, LoadingState, Tag } from '@/components/ui';
import { useT } from '@/i18n/I18nProvider';
import { DataIcon } from '@/components/Icon';
import { Tabs, type TabDef } from '@/components/Tabs';
import { JenteraMark } from '@/components/JenteraMark';
import PermissionsPanel from './PermissionsPanel';
import KnowledgePanel from './KnowledgePanel';
import TelegramConnect from './TelegramConnect';
import { isLive, withoutLinkClaim } from '@/lib/live-connectors';
import { connectedNames, type ConnectionsState } from '@/hooks/useConnections';
import { useSignedIn } from '@/lib/repo/gate';
import { useToast } from '@/components/Toast';
import { findConnector } from '@/lib/tools';
import { useMutate, useSnapshot } from '@/lib/repo';
import type { useBusiness } from '@/hooks/useBusiness';

const CHANNELS = ['WhatsApp', 'Telegram', 'Instagram', 'Email', 'Phone'];

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="business-detail-row">
      <Eyebrow className="shrink-0">{label}</Eyebrow>
      <span>{value || '—'}</span>
    </div>
  );
}

export type BizTab = 'profile' | 'knows' | 'handles' | 'connections' | 'permissions';

export default function MyBusinessView({
  b,
  connections,
  initialTab = 'profile',
  onTabChange,
}: {
  b: ReturnType<typeof useBusiness>;
  connections: ConnectionsState;
  initialTab?: BizTab;
  onTabChange?: (tab: BizTab) => void;
}) {
  const [tab, setTab] = useState<BizTab>(initialTab);
  const t = useT();
  const toast = useToast();
  const snap = useSnapshot();
  const mutate = useMutate();
  const { business } = b;
  const unconfirmed = snap.facts.filter((f) => !f.confirmed).length;
  const confirmed = snap.facts.filter((f) => f.confirmed);
  const signedIn = useSignedIn();
  const [name, setName] = useState(business.name);
  const [loc, setLoc] = useState(business.loc);
  const [savingProfile, setSavingProfile] = useState(false);
  const [specialistForm, setSpecialistForm] = useState(false);
  const [editingSpecialist, setEditingSpecialist] = useState<string | null>(null);
  const [specialistName, setSpecialistName] = useState('');
  const [specialistDescription, setSpecialistDescription] = useState('');
  const [specialistInstructions, setSpecialistInstructions] = useState('');
  const [savingSpecialist, setSavingSpecialist] = useState(false);
  const tabsId = useId();

  useEffect(() => setTab(initialTab), [initialTab]);

  function chooseTab(next: BizTab) {
    setTab(next);
    onTabChange?.(next);
  }

  /* One shared fetch for the whole dashboard. The Home notice, this badge,
     the chips, and the Telegram card all move from the same answer. */
  const conns = connections;
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

  async function save() {
    if (!name.trim() || !dirty || savingProfile) return;
    setSavingProfile(true);
    try {
      await mutate((r) => r.setBizProfile({ name: name.trim(), loc: loc.trim() }));
      setName(name.trim());
      setLoc(loc.trim());
      toast(t('biz.profile.saved'));
    } catch (error) {
      toast(error instanceof Error ? error.message : t('biz.profile.failed'), 'error');
    } finally {
      setSavingProfile(false);
    }
  }

  function openSpecialist(id?: string) {
    const specialist = id ? snap.specialists.find((item) => item.id === id) : undefined;
    setEditingSpecialist(specialist?.id ?? null);
    setSpecialistName(specialist?.name ?? '');
    setSpecialistDescription(specialist?.description ?? '');
    setSpecialistInstructions(specialist?.instructions ?? '');
    setSpecialistForm(true);
  }

  async function saveSpecialist() {
    const input = {
      name: specialistName.trim(),
      description: specialistDescription.trim(),
      instructions: specialistInstructions.trim(),
    };
    if (!input.name || !input.description || savingSpecialist) return;
    setSavingSpecialist(true);
    try {
      await mutate((repository) => editingSpecialist
        ? repository.updateSpecialist(editingSpecialist, input)
        : repository.createSpecialist(input));
      setSpecialistForm(false);
      toast(t(editingSpecialist ? 'biz.specialists.updated' : 'biz.specialists.created'));
    } catch (error) {
      toast(error instanceof Error ? error.message : t('biz.specialists.failed'), 'error');
    } finally {
      setSavingSpecialist(false);
    }
  }

  async function disableSpecialist(id: string) {
    try {
      await mutate((repository) => repository.disableSpecialist(id));
      toast(t('biz.specialists.removed'));
    } catch (error) {
      toast(error instanceof Error ? error.message : t('biz.specialists.failed'), 'error');
    }
  }

  const TABS: TabDef<BizTab>[] = useMemo(
    () => [
      {
        id: 'profile',
        label: t('biz.tab.profile'),
        icon: <Buildings size={17} aria-hidden="true" />,
      },
      {
        id: 'knows',
        label: t('biz.tab.knows'),
        icon: <BookOpenText size={17} aria-hidden="true" />,
        /* The count is unconfirmed facts, not the total. A badge
           reading "31" teaches people to ignore it; one showing how
           many decisions are waiting is worth a glance. */
        trailing: unconfirmed > 0 ? <Tag tone="amber">{unconfirmed}</Tag> : undefined,
        trailingCompact: true,
      },
      {
        id: 'connections',
        label: t('biz.tab.connections'),
        icon: <PlugsConnected size={17} aria-hidden="true" />,
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
      { id: 'handles', label: t('biz.tab.handles'), icon: <Robot size={17} aria-hidden="true" /> },
      {
        id: 'permissions',
        label: t('biz.tab.permissions'),
        icon: <ShieldCheck size={17} aria-hidden="true" />,
      },
    ],
    [t, b.connections.length, unconfirmed, conns.mode, conns.real, linked],
  );

  return (
    <div className="business-workspace flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-pixel text-2xl tracking-tight">{t('view.business')}</h1>
        <p className="max-w-[66ch] text-sm text-text-secondary">{t('view.business.desc')}</p>
      </header>

      <section
        className={`business-identity${tab === 'profile' ? '' : ' business-identity-compact'}`}
        aria-label={business.name}
      >
        <span className="business-identity-icon">
          <DataIcon emoji={business.icon} size={tab === 'profile' ? 32 : 22} />
        </span>
        <div>
          {tab === 'profile' && <span className="business-identity-type">{business.type}</span>}
          <h2>{business.name}</h2>
          <p>
            <MapPin size={14} aria-hidden="true" />
            {business.loc || t('biz.profile.location')}
          </p>
        </div>
      </section>

      <Tabs
        tabs={TABS}
        active={tab}
        onSelect={chooseTab}
        label={t('view.business')}
        className="business-tabs"
        idPrefix={tabsId}
      />

      <div
        role="tabpanel"
        id={`${tabsId}-panel-${tab}`}
        aria-labelledby={`${tabsId}-tab-${tab}`}
        className="business-panel"
        tabIndex={0}
      >
        {tab === 'profile' ? (
          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-medium">{t('biz.overview')}</h3>
              <p className="text-[13px] text-text-secondary">{t('biz.overview.detail')}</p>
            </div>
            <div className="business-shortcuts">
              <button type="button" onClick={() => chooseTab('knows')}>
                <BookOpenText size={22} weight="duotone" aria-hidden="true" />
                <ArrowUpRight size={15} aria-hidden="true" />
                <strong>{t('biz.guide.knowledge')}</strong>
                <span>
                  {unconfirmed > 0
                    ? t('biz.knowledge.review', { n: unconfirmed })
                    : snap.facts.length
                      ? t('biz.knowledge.ready', { n: snap.facts.length })
                      : t('biz.knowledge.empty')}
                </span>
              </button>
              <button type="button" onClick={() => chooseTab('connections')}>
                <PlugsConnected size={22} weight="duotone" aria-hidden="true" />
                <ArrowUpRight size={15} aria-hidden="true" />
                <strong>{t('biz.guide.connect')}</strong>
                <span>
                  {conns.mode === 'pending'
                    ? t('biz.connections.pending')
                    : conns.mode === 'error'
                      ? t('biz.connections.error')
                      : active.length
                        ? t('biz.connections.ready', { n: active.length })
                        : t('biz.connections.empty')}
                </span>
              </button>
              <button type="button" onClick={() => chooseTab('permissions')}>
                <ShieldCheck size={22} weight="duotone" aria-hidden="true" />
                <ArrowUpRight size={15} aria-hidden="true" />
                <strong>{t('biz.guide.controls')}</strong>
                <span>{t('biz.controls.detail')}</span>
              </button>
            </div>
          </section>
        ) : null}

        {tab === 'knows' && <KnowledgePanel />}

        {/* ---- Profile ---- */}
        {tab === 'profile' && (
          <div className="business-profile-grid">
            <Card>
              <div className="workspace-section-heading">
                <div>
                  <h3>{t('biz.profile')}</h3>
                  <p>{t('biz.profile.edit')}</p>
                </div>
                <Buildings size={20} aria-hidden="true" />
              </div>
              <form
                className="flex flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
              >
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12px] text-text-secondary">{t('biz.profile.name')}</span>
                  <Input
                    value={name}
                    required
                    disabled={savingProfile}
                    autoComplete="organization"
                    aria-invalid={dirty && !name.trim() ? true : undefined}
                    aria-describedby={dirty && !name.trim() ? `${tabsId}-name-error` : undefined}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full text-[13px]"
                  />
                  {dirty && !name.trim() && (
                    <span id={`${tabsId}-name-error`} className="text-xs text-text-secondary">
                      {t('biz.profile.required')}
                    </span>
                  )}
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12px] text-text-secondary">
                    {t('biz.profile.location')}
                  </span>
                  <Input
                    value={loc}
                    disabled={savingProfile}
                    autoComplete="address-level2"
                    onChange={(e) => setLoc(e.target.value)}
                    className="w-full text-[13px]"
                  />
                </label>
                <div className="business-profile-actions">
                  <p role="status">{dirty ? t('biz.profile.unsaved') : ''}</p>
                  <div>
                    {dirty && (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={savingProfile}
                        onClick={() => {
                          setName(business.name);
                          setLoc(business.loc);
                        }}
                      >
                        {t('workspace.cancel')}
                      </Button>
                    )}
                    <Button type="submit" disabled={!dirty || savingProfile || !name.trim()}>
                      {savingProfile ? t('biz.profile.saving') : t('biz.profile.save')}
                    </Button>
                  </div>
                </div>
              </form>
            </Card>

            <Card>
              <div className="workspace-section-heading">
                <div>
                  <h3>{t('biz.profile.detected')}</h3>
                  <p>{t('biz.profile.detected.detail')}</p>
                </div>
              </div>
              <div className="flex flex-col">
                <Row label={t('biz.contact')} value={active.join(' · ')} />
                {signedIn ? (
                  confirmed
                    .slice(0, 3)
                    .map((fact) => (
                      <Row
                        key={fact.key}
                        label={fact.key.replace(/[._-]/g, ' ')}
                        value={
                          typeof fact.value === 'string'
                            ? fact.value
                            : (JSON.stringify(fact.value) ?? '—')
                        }
                      />
                    ))
                ) : (
                  <>
                    <Row label={t('biz.website')} value={business.site} />
                    <Row label={t('biz.booking')} value={business.booking} />
                    <Row label={t('biz.systems')} value={business.systems} />
                  </>
                )}
                {signedIn && confirmed.length === 0 && (
                  <p className="mt-4 text-xs leading-relaxed text-text-secondary">
                    {t('biz.knowledge.empty')}
                  </p>
                )}
              </div>
              <button
                type="button"
                className="business-knowledge-link"
                onClick={() => chooseTab('knows')}
              >
                {t('biz.guide.knowledge')}
                <ArrowUpRight size={15} aria-hidden="true" />
              </button>
            </Card>
          </div>
        )}

        {/* Only capabilities that exist today belong here. Industry playbooks
          retain future customer-facing roles as product research data, but a
          role is not active merely because it was suggested. */}
        {tab === 'handles' && (
          <section className="business-staff">
            <Card className="business-staff-card">
              <header className="business-staff-heading">
                <div>
                  <JenteraMark size={44} />
                  <h2>{t('biz.private.title')}</h2>
                </div>
                <Tag tone="green">{t('biz.private.active')}</Tag>
              </header>
              <p className="business-staff-description">{t('biz.private.description')}</p>
              <ul className="business-staff-capabilities">
                {['research', 'planning', 'operations', 'memory'].map((capability) => (
                  <li key={capability}>
                    <Check size={18} weight="bold" aria-hidden="true" />
                    {t(`biz.private.${capability}`)}
                  </li>
                ))}
              </ul>
              <Link className="btn btn-primary business-staff-ask" to="/app?view=chat">
                {t('nav.chat')}
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
            </Card>

            <div className="flex flex-col gap-3">
              <div>
                <Eyebrow>{t('biz.specialists.eyebrow')}</Eyebrow>
                <p className="mt-1 max-w-[62ch] text-[13px] leading-relaxed text-text-secondary">
                  {t('biz.specialists.body')}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {snap.specialists.map((specialist) => (
                  <div key={specialist.id} className="flex flex-col gap-2 rounded-card border border-border p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-[13px] font-medium">{specialist.name}</h3>
                      <Tag>{t('biz.specialists.asNeeded')}</Tag>
                    </div>
                    <p className="text-[11px] leading-relaxed text-text-muted">
                      {specialist.description}
                    </p>
                    <div className="mt-auto flex gap-2 pt-2">
                      <Button type="button" variant="ghost" className="!min-h-8 !px-2" onClick={() => openSpecialist(specialist.id)}>
                        <PencilSimple size={15} aria-hidden="true" />
                        {t('biz.specialists.edit')}
                      </Button>
                      <Button type="button" variant="ghost" className="!min-h-8 !px-2" onClick={() => void disableSpecialist(specialist.id)}>
                        <Trash size={15} aria-hidden="true" />
                        {t('biz.specialists.remove')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              {snap.specialists.length === 0 && (
                <p className="text-[12px] text-text-muted">{t('biz.specialists.empty')}</p>
              )}
              {specialistForm ? (
                <Card className="gap-3">
                  <label className="flex flex-col gap-1 text-[12px] text-text-secondary">
                    {t('biz.specialists.name')}
                    <Input maxLength={60} value={specialistName} onChange={(event) => setSpecialistName(event.target.value)} />
                  </label>
                  <label className="flex flex-col gap-1 text-[12px] text-text-secondary">
                    {t('biz.specialists.remit')}
                    <textarea className="input min-h-20 w-full resize-y py-2" maxLength={500} value={specialistDescription} onChange={(event) => setSpecialistDescription(event.target.value)} />
                  </label>
                  <label className="flex flex-col gap-1 text-[12px] text-text-secondary">
                    {t('biz.specialists.instructions')}
                    <textarea className="input min-h-24 w-full resize-y py-2" maxLength={4000} value={specialistInstructions} onChange={(event) => setSpecialistInstructions(event.target.value)} placeholder={t('biz.specialists.instructions.placeholder')} />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" disabled={!specialistName.trim() || !specialistDescription.trim() || savingSpecialist} onClick={() => void saveSpecialist()}>
                      {savingSpecialist ? t('biz.specialists.saving') : t('biz.specialists.save')}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setSpecialistForm(false)}>{t('common.cancel')}</Button>
                  </div>
                </Card>
              ) : (
                <div>
                  <Button type="button" variant="outline" disabled={snap.specialists.length >= 8} onClick={() => openSpecialist()}>
                    <Plus size={16} aria-hidden="true" />
                    {t('biz.specialists.add')}
                  </Button>
                </div>
              )}
            </div>

            <div className="business-staff-notice" role="note">
              <Info size={19} aria-hidden="true" />
              <p>{t('biz.customerFuture.notice')}</p>
            </div>
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
            ) : conns.mode === 'error' ? (
              <Card role="alert" className="gap-3">
                <p className="text-sm">{t('loading.connections.error')}</p>
                <p className="text-[13px] text-text-secondary">{conns.error?.message}</p>
                <div>
                  <Button variant="outline" onClick={conns.retry}>
                    {t('loading.retry')}
                  </Button>
                </div>
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
                <span
                  key={c}
                  className={`chip ${active.includes(c) ? 'chip-green' : 'text-text-muted'}`}
                >
                  {c}
                </span>
              ))}
            </div>

            <details className="rounded-card border border-border p-4">
              <summary className="cursor-pointer text-[13px] font-semibold text-text">
                {t('biz.connections.more')}
              </summary>
              <div className="mt-4 flex flex-col gap-3">
                {business.conns
                  .filter((c) => !(signedIn && isLive(c.n)))
                  .map((c) => {
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
                            {pretend
                              ? t('conn.soon.cta')
                              : on
                                ? t('conn.disconnect')
                                : t('conn.connect')}
                          </Button>
                        </div>
                      </Card>
                    );
                  })}
              </div>
            </details>
          </section>
        )}

        {tab === 'permissions' && <PermissionsPanel />}
      </div>
    </div>
  );
}
