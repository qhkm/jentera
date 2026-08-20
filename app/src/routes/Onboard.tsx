/* ============================================================
   Onboarding — a port of the static site's six-step flow.

   The React rebuild had collapsed this to three steps (describe →
   confirm → channels). That removed the two things that carry the
   product's argument: the choice between importing a business and
   describing it, and the live Business Profile panel that fills in as
   the user answers. Without them the flow reads as a signup form
   rather than as AISAR learning the business.

   Steps, matching onboard.html:
     1 setup path   — import from web/social, or describe manually
     2 scan         — terminal readout while the playbook is matched
     3 confirm      — "did I get it right?"
     4 channels     — where enquiries arrive (multi)
     5 time sinks   — what eats the week (single)
     6 recommendation — the first agent, then activate

   Steps 1 and 2 carry their own actions, so the shared nav footer is
   hidden there — same rule as the static version.
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Calendar,
  ChatCircle,
  Envelope,
  InstagramLogo,
  Megaphone,
  Package,
  PaperPlaneTilt,
  PencilSimple,
  Phone,
  Sparkle,
  type Icon as PhosphorIcon,
} from '@phosphor-icons/react';
import { Shell } from '@/components/Shell';
import { Button, Card, Eyebrow, Input, Progress, Tag } from '@/components/ui';
import { DataIcon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { inferPlaybook } from '@/lib/infer';
import { PLAYBOOKS } from '@/lib/data/playbooks';
import { confirmFor, registerBusiness, resolveBusiness, setBizType } from '@/lib/business';
import { useT } from '@/i18n/I18nProvider';
import * as store from '@/lib/storage';
import { KEYS } from '@/lib/storage';

const STEP_COUNT = 6;

/** The static flow defaults to restaurant and only moves off it when
    something is actually inferred. Keeping that so an empty import
    still produces a populated demo rather than the generic playbook. */
const DEFAULT_TYPE = 'restaurant';

/* ---- Business types ----
   The static site hardcodes twenty pills. Deriving the list from
   PLAYBOOKS instead means a playbook added by scripts/add-playbook.mjs
   shows up here without a second edit; the map only overrides labels
   where the static site's wording differs from the playbook's own
   `type`, and anything unlisted falls back to that. */
const TYPE_LABELS: Record<string, string> = {
  restaurant: 'Restaurant / Café',
  retail: 'Retail / E-commerce',
  smallretail: 'Boutique / Kedai',
  catering: 'Catering / Event',
  photography: 'Photography / Video',
  bakery: 'Bakery / Patisserie',
  wedding: 'Wedding / Events',
  services: 'Services / Agency',
  clinic: 'Clinic / Health',
  salon: 'Salon / Beauty',
  gym: 'Gym / Fitness',
  tuition: 'Tuition / Education',
  laundry: 'Laundry / Dobi',
  auto: 'Auto / Bengkel',
  petcare: 'Pet Care / Grooming',
  florist: 'Florist / Gifting',
  property: 'Real Estate',
  cleaning: 'Cleaning Services',
  minimart: 'Minimart',
  generic: 'Other',
};

const TYPE_ORDER = Object.keys(TYPE_LABELS);

function businessTypes(): { key: string; label: string; icon: string }[] {
  const known = new Set(TYPE_ORDER);
  const extras = Object.keys(PLAYBOOKS).filter((k) => !known.has(k));
  return [...TYPE_ORDER, ...extras]
    .filter((k) => PLAYBOOKS[k])
    .map((k) => ({
      key: k,
      label: TYPE_LABELS[k] ?? PLAYBOOKS[k].type,
      icon: PLAYBOOKS[k].icon,
    }));
}

/* Channels and time sinks carry Phosphor glyphs directly rather than
   going through DataIcon — these are UI chrome, not playbook data, and
   two of them (Telegram, Instagram) have no emoji in the data map. */
const CHANNELS: { name: string; Glyph: PhosphorIcon }[] = [
  { name: 'WhatsApp', Glyph: ChatCircle },
  { name: 'Telegram', Glyph: PaperPlaneTilt },
  { name: 'Instagram', Glyph: InstagramLogo },
  { name: 'Email', Glyph: Envelope },
  { name: 'Phone', Glyph: Phone },
];

const PAINS: { key: string; Glyph: PhosphorIcon }[] = [
  { key: 'Answering enquiries', Glyph: ChatCircle },
  { key: 'Reservations', Glyph: Calendar },
  { key: 'Marketing', Glyph: Megaphone },
  { key: 'Inventory', Glyph: Package },
];

type Mode = 'auto' | 'manual' | null;

export default function Onboard() {
  const t = useT();
  const navigate = useNavigate();
  const toast = useToast();

  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<Mode>(null);
  const [url, setUrl] = useState('');
  const [social, setSocial] = useState('');
  const [desc, setDesc] = useState('');
  const [typeOpen, setTypeOpen] = useState(false);
  const [bizType, setType] = useState(DEFAULT_TYPE);
  const [channels, setChannels] = useState<string[]>([]);
  const [pain, setPain] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);

  /* Scan readout */
  const [scanLines, setScanLines] = useState<string[]>([]);
  const [scanShown, setScanShown] = useState(0);
  const [profileLearned, setProfileLearned] = useState(false);

  const topRef = useRef<HTMLDivElement | null>(null);

  const business = useMemo(() => resolveBusiness(bizType), [bizType]);
  const playbook = PLAYBOOKS[bizType] ?? PLAYBOOKS[DEFAULT_TYPE];

  const go = useCallback((next: number) => {
    setStep((cur) => {
      const clamped = Math.min(Math.max(next, 0), STEP_COUNT - 1);
      if (clamped !== cur) window.scrollTo({ top: 0, behavior: 'smooth' });
      return clamped;
    });
  }, []);

  /* ---- Step 1 ---- */

  function beginScan(chosen: Mode) {
    const lines: string[] = [];

    if (chosen === 'auto') {
      if (!url.trim() && !social.trim()) {
        toast(t('ob.m.need'));
        return;
      }
      /* The static flow never reads the URL — it keeps the default
         playbook. Inferring from the link costs nothing and makes the
         import feel like it did something, but a zero-score match is
         ignored so an unrecognisable domain still lands somewhere
         sensible rather than on the generic playbook. */
      const guess = inferPlaybook(`${url} ${social}`);
      if (guess.score > 0) {
        setType(guess.key);
        setBizType(guess.key);
      }
      if (url.trim()) lines.push(t('ob.scan.web'));
      if (social.trim()) lines.push(t('ob.scan.social'));
    } else {
      if (desc.trim()) {
        const r = registerBusiness(desc.trim());
        setType(r.key);
      } else {
        setBizType(bizType);
      }
      lines.push(t('ob.scan.desc'));
    }

    /* Read the playbook the scan is about to claim, not the one in
       state — setType has not flushed yet at this point. */
    const key =
      chosen === 'auto'
        ? (() => {
            const g = inferPlaybook(`${url} ${social}`);
            return g.score > 0 ? g.key : bizType;
          })()
        : desc.trim()
          ? inferPlaybook(desc.trim()).key
          : bizType;
    const p = PLAYBOOKS[key] ?? PLAYBOOKS[DEFAULT_TYPE];

    lines.push(t('ob.scan.match', { type: p.type }));
    lines.push(t('ob.scan.detected', { detect: p.detect }));

    setMode(chosen);
    setScanLines(lines);
    setScanShown(0);
    setProfileLearned(false);
    go(1);
  }

  /* ---- Step 2: play the readout, then advance ---- */

  useEffect(() => {
    if (step !== 1 || scanLines.length === 0) return;

    if (scanShown < scanLines.length) {
      const id = setTimeout(() => setScanShown((n) => n + 1), 650);
      return () => clearTimeout(id);
    }

    setProfileLearned(true);
    const id = setTimeout(() => go(2), 800);
    return () => clearTimeout(id);
  }, [step, scanShown, scanLines, go]);

  /* ---- Picks ---- */

  function toggleChannel(name: string) {
    setChannels((prev) => {
      const next = prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name];
      store.setJSON(KEYS.channels, next);
      return next;
    });
  }

  function pickType(key: string) {
    setType(key);
    setBizType(key);
  }

  /* ---- Activate ---- */

  function activate() {
    setActivating(true);
    store.setJSON(KEYS.channels, channels);
    store.set(KEYS.bizType, bizType);
    store.set(KEYS.onboarded, '1');
    setTimeout(() => navigate('/setup'), 1200);
  }

  function next() {
    if (step === STEP_COUNT - 1) {
      activate();
      return;
    }
    go(step + 1);
  }

  const confirmText = confirmFor(bizType, desc);

  const recoExtra =
    pain === 'Reservations'
      ? t('ob.reco.extra.reservations')
      : pain === 'Marketing'
        ? t('ob.reco.extra.marketing')
        : pain === 'Inventory'
          ? t('ob.reco.extra.inventory')
          : t('ob.reco.extra.default');

  /* Steps 1, 2 and 6 carry their own actions — the static flow hides the
     footer on the first two for that reason, and step 6 gained an inline
     Activate/Back pair here, so showing the footer there too rendered a
     second Back directly under the first. */
  const navVisible = step > 1 && step < STEP_COUNT - 1;
  const nextLabel = step === 4 ? t('ob.nav.plan') : t('ob.nav.continue');

  return (
    <Shell suffix="/setup">
      <div ref={topRef} className="flex flex-col gap-6 py-6 md:gap-8 md:py-8">
        {/* Progress */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <Tag>{t('ob.step', { n: step + 1 })}</Tag>
            <span className="text-[11px] text-text-muted">
              {step + 1} / {STEP_COUNT}
            </span>
          </div>
          <Progress value={((step + 1) / STEP_COUNT) * 100} label={t('ob.step', { n: step + 1 })} />
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
          <div className="flex flex-col gap-6 lg:col-span-3">
            {step === 0 ? (
              <StepMethod
                t={t}
                mode={mode}
                setMode={setMode}
                url={url}
                setUrl={setUrl}
                social={social}
                setSocial={setSocial}
                desc={desc}
                setDesc={setDesc}
                typeOpen={typeOpen}
                setTypeOpen={setTypeOpen}
                bizType={bizType}
                pickType={pickType}
                beginScan={beginScan}
              />
            ) : null}

            {step === 1 ? (
              <section className="flex flex-col gap-3">
                <Eyebrow>{t('ob.scan.eyebrow')}</Eyebrow>
                <h2 className="font-pixel text-xl tracking-tight md:text-2xl">
                  {t('ob.scan.head')}
                </h2>
                <div className="rounded-item border border-border bg-well p-4 font-mono text-[11px] leading-relaxed text-text-secondary md:p-5">
                  <span className="text-text-muted">$ </span>
                  aisar onboard --business{' '}
                  <span className="text-text">{url || social || desc || playbook.type}</span>
                  {scanLines.slice(0, scanShown).map((line) => (
                    <div key={line} className="mt-1">
                      <span className="text-text-muted">✓</span> {line}
                    </div>
                  ))}
                  <span className="kv-cursor" aria-hidden="true" />
                </div>
                <p className="text-[12px] text-text-muted">{t('ob.scan.note')}</p>
              </section>
            ) : null}

            {step === 2 ? (
              <section className="flex flex-col gap-3">
                <Eyebrow>{t('ob.confirm.eyebrow')}</Eyebrow>
                <h2 className="font-pixel text-xl tracking-tight md:text-2xl">{confirmText}</h2>
                <p className="text-[13px] text-text-secondary md:text-sm">
                  {t('ob.confirm.body')}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button onClick={() => go(3)}>{t('ob.confirm.yes')}</Button>
                  <Button variant="outline" onClick={() => go(0)}>
                    {t('ob.confirm.no')}
                  </Button>
                </div>
              </section>
            ) : null}

            {step === 3 ? (
              <section className="flex flex-col gap-3">
                <Eyebrow>{t('ob.ch.eyebrow')}</Eyebrow>
                <h2 className="font-pixel text-xl tracking-tight md:text-2xl">{t('ob.ch.head')}</h2>
                <p className="text-[13px] text-text-secondary md:text-sm">{t('ob.ch.body')}</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {CHANNELS.map(({ name, Glyph }) => (
                    <Option
                      key={name}
                      picked={channels.includes(name)}
                      onClick={() => toggleChannel(name)}
                      label={name}
                      glyph={<Glyph size={18} weight="duotone" aria-hidden="true" />}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {step === 4 ? (
              <section className="flex flex-col gap-3">
                <Eyebrow>{t('ob.pain.eyebrow')}</Eyebrow>
                <h2 className="font-pixel text-xl tracking-tight md:text-2xl">
                  {t('ob.pain.head')}
                </h2>
                <p className="text-[13px] text-text-secondary md:text-sm">{t('ob.pain.body')}</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {PAINS.map(({ key, Glyph }) => (
                    <Option
                      key={key}
                      picked={pain === key}
                      onClick={() => setPain(key)}
                      label={t(`ob.pain.${key === 'Answering enquiries' ? 'enquiries' : key.toLowerCase()}`)}
                      glyph={<Glyph size={18} weight="duotone" aria-hidden="true" />}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {step === 5 ? (
              <section className="flex flex-col gap-3">
                <Eyebrow>{t('ob.reco.eyebrow')}</Eyebrow>
                <h2 className="font-pixel text-xl tracking-tight md:text-2xl">
                  {t('ob.reco.head')}
                </h2>
                <p className="text-[13px] text-text-secondary md:text-sm">{t('ob.reco.body')}</p>

                <Card className="gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-pixel text-sm md:text-base">{t('ob.reco.agent')}</span>
                    <Tag tone="green">{t('ob.reco.tag')}</Tag>
                  </div>
                  <p className="text-[13px] text-text-secondary">{t('ob.reco.handles')}</p>
                  <div className="mt-1 flex flex-col gap-1 border-t border-rail pt-3 text-[12px] text-text-muted">
                    {business.conns.slice(0, 3).map((c) => (
                      <span key={c.n} className="flex items-center gap-2">
                        <DataIcon emoji={c.e} size={14} />
                        <span className="text-text-secondary">{c.n}</span>
                        <span>{c.s}</span>
                      </span>
                    ))}
                  </div>
                </Card>

                <p className="text-[12px] text-text-muted">{recoExtra}</p>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button onClick={activate} disabled={activating}>
                    {activating ? t('ob.reco.activating') : t('ob.nav.activate')}
                  </Button>
                  <Button variant="outline" onClick={() => go(4)} disabled={activating}>
                    {t('ob.nav.back')}
                  </Button>
                </div>
              </section>
            ) : null}

            {/* Shared footer. Steps 1 and 2 have their own actions. */}
            {navVisible ? (
              <div className="flex items-center justify-between border-t border-rail pt-4">
                <span className="text-[11px] text-text-muted">
                  {step + 1} / {STEP_COUNT}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => go(step - 1)}
                    className={step <= 2 ? 'invisible' : undefined}
                  >
                    {t('ob.nav.back')}
                  </Button>
                  <Button onClick={next} disabled={step === 3 && channels.length === 0}>
                    {nextLabel}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          {/* Live Business Profile */}
          <aside className="lg:col-span-2">
            <Card className="gap-4 lg:sticky lg:top-24">
              <div className="flex items-center justify-between gap-3">
                <Eyebrow>{t('ob.p.title')}</Eyebrow>
                <Tag tone={profileLearned ? 'green' : 'neutral'}>
                  {step === STEP_COUNT - 1
                    ? t('ob.p.ready')
                    : profileLearned
                      ? t('ob.p.learned')
                      : t('ob.p.building')}
                </Tag>
              </div>

              <div className="flex flex-col">
                <ProfileRow k={t('ob.p.name')} v={profileLearned ? business.name : null} />
                <ProfileRow k={t('ob.p.type')} v={profileLearned ? business.type : null} />
                <ProfileRow k={t('ob.p.loc')} v={profileLearned ? business.loc : null} />
                <ProfileRow k={t('ob.p.url')} v={url || null} />
                <ProfileRow k={t('ob.p.social')} v={social || null} />
                <ProfileRow k={t('ob.p.ch')} v={channels.length ? channels.join(', ') : null} />
                <ProfileRow k={t('ob.p.pain')} v={pain} />
                <ProfileRow
                  k={t('ob.p.team')}
                  v={step === STEP_COUNT - 1 ? t('ob.p.teamValue') : null}
                />
              </div>

              <p className="border-t border-rail pt-3 text-[11px] leading-relaxed text-text-muted">
                {t('ob.p.note')}
              </p>
            </Card>
          </aside>
        </div>
      </div>
    </Shell>
  );
}

/* ============================================================
   Step 1 — extracted only because it carries most of the markup.
   ============================================================ */

function StepMethod({
  t,
  mode,
  setMode,
  url,
  setUrl,
  social,
  setSocial,
  desc,
  setDesc,
  typeOpen,
  setTypeOpen,
  bizType,
  pickType,
  beginScan,
}: {
  t: (k: string, p?: Record<string, string | number>) => string;
  mode: Mode;
  setMode: (m: Mode) => void;
  url: string;
  setUrl: (v: string) => void;
  social: string;
  setSocial: (v: string) => void;
  desc: string;
  setDesc: (v: string) => void;
  typeOpen: boolean;
  setTypeOpen: (v: boolean) => void;
  bizType: string;
  pickType: (k: string) => void;
  beginScan: (m: Mode) => void;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <Eyebrow>{t('ob.m.eyebrow')}</Eyebrow>
        <h2 className="font-pixel text-xl tracking-tight md:text-2xl">{t('ob.m.head')}</h2>
        <p className="text-[13px] text-text-secondary md:text-sm">{t('ob.m.body')}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MethodCard
          picked={mode === 'auto'}
          onClick={() => setMode('auto')}
          glyph={<Sparkle size={20} weight="duotone" aria-hidden="true" />}
          tag={t('ob.m.auto.tag')}
          tone="green"
          title={t('ob.m.auto.title')}
          body={t('ob.m.auto.body')}
        />
        <MethodCard
          picked={mode === 'manual'}
          onClick={() => setMode('manual')}
          glyph={<PencilSimple size={20} weight="duotone" aria-hidden="true" />}
          tag={t('ob.m.manual.tag')}
          title={t('ob.m.manual.title')}
          body={t('ob.m.manual.body')}
        />
      </div>

      {mode === 'auto' ? (
        <Card className="gap-4">
          <div>
            <h3 className="font-pixel text-base">{t('ob.m.auto.panelHead')}</h3>
            <p className="mt-1 text-[12px] text-text-muted">{t('ob.m.auto.panelBody')}</p>
          </div>
          <label className="flex flex-col gap-2">
            <span className="text-[11px] text-text-secondary">{t('ob.m.auto.website')}</span>
            <Input
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="yourbusiness.com"
              className="w-full font-mono"
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-[11px] text-text-secondary">{t('ob.m.auto.social')}</span>
            <Input
              value={social}
              onChange={(e) => setSocial(e.target.value)}
              placeholder="instagram.com/yourbrand"
              className="w-full font-mono"
            />
          </label>
          <Button className="w-full" onClick={() => beginScan('auto')}>
            {t('ob.m.auto.cta')}
          </Button>
          <p className="text-[11px] text-text-muted">{t('ob.m.auto.note')}</p>
        </Card>
      ) : null}

      {mode === 'manual' ? (
        <Card className="gap-4">
          <div>
            <h3 className="font-pixel text-base">{t('ob.m.manual.panelHead')}</h3>
            <p className="mt-1 text-[12px] text-text-muted">{t('ob.m.manual.panelBody')}</p>
          </div>
          <Input
            autoFocus
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder={t('ob.ask.placeholder')}
            aria-label={t('ob.m.manual.panelHead')}
            className="w-full"
          />

          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => setTypeOpen(!typeOpen)}
              aria-expanded={typeOpen}
              className="self-start text-[12px] text-text-secondary underline-offset-4 hover:text-text hover:underline"
            >
              {t('ob.m.manual.summary')}
            </button>
            {typeOpen ? (
              <div className="grid grid-cols-2 gap-2">
                {businessTypes().map((b) => (
                  <Option
                    key={b.key}
                    picked={bizType === b.key}
                    onClick={() => pickType(b.key)}
                    label={b.label}
                    glyph={<DataIcon emoji={b.icon} size={16} />}
                  />
                ))}
              </div>
            ) : null}
          </div>

          <Button className="w-full" onClick={() => beginScan('manual')}>
            {t('ob.m.manual.cta')}
          </Button>
        </Card>
      ) : null}
    </section>
  );
}

/* ---- Shared pieces ---- */

function MethodCard({
  picked,
  onClick,
  glyph,
  tag,
  tone,
  title,
  body,
}: {
  picked: boolean;
  onClick: () => void;
  glyph: React.ReactNode;
  tag: string;
  tone?: 'green';
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={picked}
      onClick={onClick}
      className={`flex flex-col gap-2 rounded-card border p-4 text-left transition-colors ${
        picked
          ? 'border-brand-line bg-brand-soft'
          : 'border-border hover:border-border-light'
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-text-secondary">{glyph}</span>
        <Tag tone={tone}>{tag}</Tag>
      </span>
      <span className="font-pixel text-base">{title}</span>
      <span className="text-[12px] leading-relaxed text-text-secondary">{body}</span>
    </button>
  );
}

function Option({
  picked,
  onClick,
  label,
  glyph,
}: {
  picked: boolean;
  onClick: () => void;
  label: string;
  glyph: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={picked}
      onClick={onClick}
      className={`flex min-w-0 items-center gap-2.5 rounded-item border px-3 py-2.5 text-left text-[13px] transition-colors ${
        picked
          ? 'border-brand-line bg-brand-soft text-text'
          : 'border-border text-text-secondary hover:border-border-light hover:text-text'
      }`}
    >
      <span className="shrink-0 text-text-secondary">{glyph}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {picked ? <span className="shrink-0 text-brand">✓</span> : null}
    </button>
  );
}

function ProfileRow({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-rail py-2 last:border-b-0">
      <span className="shrink-0 text-[11px] text-text-muted">{k}</span>
      <span
        className={`min-w-0 truncate text-right text-[12px] ${v ? 'text-text' : 'text-text-muted'}`}
      >
        {v ?? '—'}
      </span>
    </div>
  );
}
