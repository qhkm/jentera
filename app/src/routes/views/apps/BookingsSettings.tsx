import { useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { Button, Input } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { useBusiness } from '@/hooks/useBusiness';
import { AppsError } from '@/lib/apps/api';
import { useSaveBookingsConfig } from '@/lib/apps/queries';
import type { AppsApi, BookingPageTheme, BookingService, BookingsConfig, BookingsConfigInput, WeeklyHours } from '@/lib/apps/types';

/* Monday first, as a Malaysian week reads; 0 is Sunday in the data. */
const WEEK = [1, 2, 3, 4, 5, 6, 0] as const;
const DURATIONS = Array.from({ length: 32 }, (_, i) => (i + 1) * 15);
const NOTICE = [0, 30, 60, 120, 240, 360, 720, 1440, 2880, 10080];
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const RESERVED = new Set(['api', 'admin', 'www', 'app', 'b']);
const BRAND_COLOR = /^#[0-9a-f]{6}$/i;
const BRAND_COLORS = ['#4aebb5', '#62a8ff', '#a78bfa', '#f472b6', '#fb923c', '#facc15'] as const;
const LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const LOGO_MAX_BYTES = 1024 * 1024;

interface DayDraft { open: boolean; opens: string; closes: string }
interface BlockDraft { key: string; id: string | null; label: string; startsAt: string; endsAt: string }
type SettingsPanel = 'services' | 'hours' | 'page' | 'rules' | 'calendar' | 'blocks';
interface ServiceDraft {
  key: string;
  id: string | null;
  name: string;
  description: string;
  durationMinutes: number;
  capacity: number;
  priceLabel: string;
  active: boolean;
  days: Record<number, DayDraft>;
  /** Further ranges on a day, kept exactly as saved: the editor shows one per day. */
  extra: WeeklyHours[];
}

let draftKeys = 0;
let blockKeys = 0;

function malaysiaInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`;
}

function malaysiaIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00+08:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function newBlock(): BlockDraft {
  const start = new Date(Date.now() + 24 * 60 * 60_000);
  start.setUTCMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60_000);
  return { key: `block-${++blockKeys}`, id: null, label: '', startsAt: malaysiaInput(start.toISOString()), endsAt: malaysiaInput(end.toISOString()) };
}

/** A link name from a business name, or '' when none fits the rules. */
export function slugFrom(name: string): string {
  const slug = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return SLUG.test(slug) && !RESERVED.has(slug) ? slug : '';
}

/** The web origin of the saved public link, or null when it is not a full
    http(s) address (a Worker without SITES_ORIGIN serves a relative one). */
function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

function previewAccentInk(value: string): '#080808' | '#ffffff' {
  if (!BRAND_COLOR.test(value)) return '#080808';
  const r = Number.parseInt(value.slice(1, 3), 16);
  const g = Number.parseInt(value.slice(3, 5), 16);
  const b = Number.parseInt(value.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 >= 150 ? '#080808' : '#ffffff';
}

function newService(): ServiceDraft {
  return {
    key: `new-${++draftKeys}`, id: null, name: '', description: '', durationMinutes: 60, capacity: 1, priceLabel: '', active: true,
    days: Object.fromEntries(WEEK.map((day) => [day, { open: day >= 1 && day <= 5, opens: '09:00', closes: '17:00' }])),
    extra: [],
  };
}

function toDraft(service: BookingService): ServiceDraft {
  const days: Record<number, DayDraft> = Object.fromEntries(WEEK.map((day) => [day, { open: false, opens: '09:00', closes: '17:00' }]));
  const extra: WeeklyHours[] = [];
  for (const range of [...service.hours].sort((a, b) => a.opens.localeCompare(b.opens))) {
    if (days[range.weekday].open) extra.push(range);
    else days[range.weekday] = { open: true, opens: range.opens, closes: range.closes };
  }
  return {
    key: service.id, id: service.id, name: service.name, description: service.description ?? '', durationMinutes: service.durationMinutes,
    capacity: service.capacity, priceLabel: service.priceLabel ?? '', active: service.active, days, extra,
  };
}

export default function BookingsSettings({ api, config, onSaved, onReload }: {
  api: AppsApi;
  config: BookingsConfig;
  onSaved: (next: BookingsConfig) => void;
  onReload: () => void;
}) {
  const { t, lang } = useI18n();
  const { business } = useBusiness();
  const saveConfig = useSaveBookingsConfig(api);
  const installed = config.installation !== null;
  const [slugInput, setSlugInput] = useState<string | null>(config.installation?.slug ?? null);
  const slug = slugInput ?? slugFrom(business.name);
  const [services, setServices] = useState<ServiceDraft[]>(() => (config.services.length ? config.services.map(toDraft) : [newService()]));
  const [minNotice, setMinNotice] = useState(config.settings?.minNoticeMinutes ?? 120);
  const [changeCutoff, setChangeCutoff] = useState(config.settings?.changeCutoffMinutes ?? 360);
  const [horizon, setHorizon] = useState(config.settings?.horizonDays ?? 30);
  const [location, setLocation] = useState(config.settings?.location ?? '');
  const [brandColor, setBrandColor] = useState(config.settings?.brandColor ?? '#4aebb5');
  const [pageTheme, setPageTheme] = useState<BookingPageTheme>(config.settings?.pageTheme ?? 'dark');
  const [welcomeTitle, setWelcomeTitle] = useState(config.settings?.welcomeTitle ?? '');
  const [welcomeMessage, setWelcomeMessage] = useState(config.settings?.welcomeMessage ?? '');
  const [blocks, setBlocks] = useState<BlockDraft[]>(() => config.blocks.map((block) => ({
    key: block.id, id: block.id, label: block.label, startsAt: malaysiaInput(block.startsAt), endsAt: malaysiaInput(block.endsAt),
  })));
  const [acknowledged, setAcknowledged] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<{ key: string; reload: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [panel, setPanel] = useState<SettingsPanel>('services');
  const dayName = useMemo(() => {
    const format = new Intl.DateTimeFormat(lang === 'bm' ? 'ms-MY' : 'en-MY', { weekday: 'long', timeZone: 'UTC' });
    // 4 October 2026 was a Sunday, so day d is 4 + d October.
    return (day: number) => format.format(new Date(Date.UTC(2026, 9, 4 + day)));
  }, [lang]);
  const origin = config.installation ? originOf(config.installation.publicUrl) : null;
  const notices = [...new Set([...NOTICE, minNotice])].sort((a, b) => a - b);
  const cutoffs = [...new Set([...NOTICE, changeCutoff])].sort((a, b) => a - b);

  function update(key: string, change: Partial<ServiceDraft>) {
    setServices((list) => list.map((service) => (service.key === key ? { ...service, ...change } : service)));
  }
  function updateDay(key: string, day: number, change: Partial<DayDraft>) {
    setServices((list) => list.map((service) => (service.key === key
      ? { ...service, days: { ...service.days, [day]: { ...service.days[day], ...change } } } : service)));
  }

  function validate(): Record<string, string> {
    const found: Record<string, string> = {};
    if (!SLUG.test(slug) || RESERVED.has(slug)) found.slug = 'bookings.settings.error.slug';
    if (!Number.isInteger(horizon) || horizon < 1 || horizon > 90) found.horizon = 'bookings.settings.error.horizon';
    if (!Number.isInteger(changeCutoff) || changeCutoff < 0 || changeCutoff > 10080) found.changeCutoff = 'bookings.settings.error.cutoff';
    if (!installed && !acknowledged) found.acknowledge = 'bookings.settings.error.acknowledge';
    if (!services.some((service) => service.active)) found.services = 'bookings.settings.error.noService';
    for (const service of services) {
      const name = service.name.trim();
      if (!name || name.length > 80) found[`${service.key}.name`] = 'bookings.settings.error.name';
      if (service.description.trim().length > 240) found[`${service.key}.description`] = 'bookings.settings.error.description';
      if (!Number.isInteger(service.capacity) || service.capacity < 1 || service.capacity > 50) {
        found[`${service.key}.capacity`] = 'bookings.settings.error.capacity.range';
      }
      const open = WEEK.filter((day) => service.days[day].open);
      if (service.active && open.length === 0) found[`${service.key}.hours`] = 'bookings.settings.error.noHours';
      for (const day of open) {
        if (service.days[day].closes <= service.days[day].opens) found[`${service.key}.day.${day}`] = 'bookings.settings.error.closes';
      }
    }
    if (location.trim().length > 160) found.location = 'bookings.settings.error.location';
    if (!BRAND_COLOR.test(brandColor)) found.brandColor = 'bookings.settings.error.brandColor';
    if (welcomeTitle.trim().length > 80) found.welcomeTitle = 'bookings.settings.error.welcomeTitle';
    if (welcomeMessage.trim().length > 240) found.welcomeMessage = 'bookings.settings.error.welcomeMessage';
    for (const block of blocks) {
      const start = malaysiaIso(block.startsAt);
      const end = malaysiaIso(block.endsAt);
      if (!block.label.trim() || block.label.trim().length > 80 || !start || !end ||
          Date.parse(end) <= Date.parse(start) || Date.parse(end) - Date.parse(start) > 31 * 86_400_000) {
        found[`${block.key}.range`] = 'bookings.settings.error.block';
      }
    }
    return found;
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) {
      const keys = Object.keys(found);
      if (keys.some((key) => key === 'location' || key === 'slug' || key === 'brandColor' || key.startsWith('welcome'))) setPanel('page');
      else if (keys.some((key) => key === 'horizon' || key === 'changeCutoff')) setPanel('rules');
      else if (keys.some((key) => key.endsWith('.range'))) setPanel('blocks');
      else if (keys.some((key) => key.endsWith('.hours') || key.includes('.day.'))) setPanel('hours');
      else setPanel('services');
      return;
    }
    const input: BookingsConfigInput = {
      version: config.version,
      slug,
      accepting: config.settings?.accepting ?? true,
      minNoticeMinutes: minNotice,
      changeCutoffMinutes: changeCutoff,
      horizonDays: horizon,
      location: location.trim() || null,
      brandColor: brandColor.toLowerCase(),
      pageTheme,
      welcomeTitle: welcomeTitle.trim() || null,
      welcomeMessage: welcomeMessage.trim() || null,
      acknowledgeAvailabilityLimits: installed || acknowledged,
      services: services.map((service) => ({
        id: service.id,
        name: service.name.trim(),
        description: service.description.trim() || null,
        durationMinutes: service.durationMinutes,
        capacity: service.capacity,
        priceLabel: service.priceLabel.trim() || null,
        active: service.active,
        hours: [
          ...WEEK.filter((day) => service.days[day].open)
            .map((day) => ({ weekday: day, opens: service.days[day].opens, closes: service.days[day].closes })),
          ...service.extra,
        ],
      })),
      blocks: blocks.map((block) => ({
        id: block.id,
        label: block.label.trim(),
        startsAt: malaysiaIso(block.startsAt)!,
        endsAt: malaysiaIso(block.endsAt)!,
      })),
    };
    setSaving(true);
    try {
      onSaved(await saveConfig.mutateAsync(input));
    } catch (error) {
      const code = error instanceof AppsError ? error.code : '';
      if (code === 'SLUG_TAKEN') {
        setErrors({ slug: 'bookings.settings.error.slugTaken' });
        setPanel('page');
      } else if (code === 'ACK_REQUIRED') {
        setErrors({ acknowledge: 'bookings.settings.error.acknowledge' });
        setPanel('services');
      }
      else if (code === 'CAPACITY_BELOW_RESERVED') {
        const service = services.find((draft) => draft.id === (error as AppsError).serviceId);
        if (service) {
          setErrors({ [`${service.key}.capacity`]: 'bookings.settings.error.capacity.reserved' });
          setPanel('services');
        }
        else setProblem({ key: 'bookings.settings.error.capacity.reserved', reload: false });
      } else if (code === 'CONFIG_CHANGED' || code === 'UNKNOWN_SERVICE') setProblem({ key: 'bookings.settings.error.changed', reload: true });
      else if (error instanceof AppsError && error.uncertain) setProblem({ key: 'bookings.settings.error.uncertain', reload: true });
      else if (error instanceof AppsError && error.status === 400) setProblem({ key: 'bookings.settings.error.invalid', reload: false });
      else setProblem({ key: 'bookings.settings.error.generic', reload: false });
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file: File | undefined) {
    if (!file) return;
    setProblem(null);
    if (!LOGO_TYPES.has(file.type) || file.size === 0 || file.size > LOGO_MAX_BYTES) {
      setProblem({ key: 'bookings.settings.logo.error', reload: false });
      return;
    }
    setLogoBusy(true);
    try {
      onSaved(await api.uploadBookingsLogo(file));
    } catch (error) {
      setProblem({ key: error instanceof AppsError && error.uncertain
        ? 'bookings.settings.error.uncertain' : 'bookings.settings.logo.uploadError', reload: error instanceof AppsError && error.uncertain });
    } finally {
      setLogoBusy(false);
    }
  }

  async function removeLogo() {
    setProblem(null);
    setLogoBusy(true);
    try {
      onSaved(await api.removeBookingsLogo());
    } catch (error) {
      setProblem({ key: error instanceof AppsError && error.uncertain
        ? 'bookings.settings.error.uncertain' : 'bookings.settings.logo.removeError', reload: error instanceof AppsError && error.uncertain });
    } finally {
      setLogoBusy(false);
    }
  }

  const error = (key: string) => (errors[key] ? <p className="field-error" role="alert">{t(errors[key])}</p> : null);
  const noticeLabel = (minutes: number) => (NOTICE.includes(minutes)
    ? t(`bookings.settings.notice.${minutes}`) : t('bookings.settings.notice.custom', { n: minutes }));
  const panels: Array<{ id: SettingsPanel; label: string; navLabel: string; meta?: string }> = [
    { id: 'services', label: t('bookings.settings.services'), navLabel: t('bookings.settings.nav.services'), meta: String(services.length) },
    { id: 'hours', label: t('bookings.settings.hours'), navLabel: t('bookings.settings.nav.hours') },
    { id: 'page', label: t('bookings.settings.pageDetails'), navLabel: t('bookings.settings.nav.page') },
    { id: 'rules', label: t('bookings.settings.rules'), navLabel: t('bookings.settings.nav.rules') },
    { id: 'calendar', label: t('bookings.settings.calendarProtection'), navLabel: t('bookings.settings.nav.calendar'), meta: config.calendarProtection.lastError ? '!' : undefined },
    { id: 'blocks', label: t('bookings.settings.blocks'), navLabel: t('bookings.settings.nav.blocks'), meta: blocks.length ? String(blocks.length) : undefined },
  ];
  const previewServices = services.filter((service) => service.active).slice(0, 3);
  const previewService = previewServices.length === 1 ? previewServices[0] : null;
  const previewWeekdays = lang === 'bm' ? ['ISN', 'SEL', 'RAB', 'KHA', 'JUM', 'SAB', 'AHA'] : ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const previewDays: Array<number | null> = [null, null, null, ...Array.from({ length: 31 }, (_, day) => day + 1)];
  const previewTimes = lang === 'bm' ? ['9.00 pagi', '10.00 pagi', '11.00 pagi'] : ['9:00 am', '10:00 am', '11:00 am'];

  return <form className="bookings-settings" onSubmit={(event) => void save(event)} noValidate>
    {!installed && <>
      <h2>{t('bookings.setup.title')}</h2>
      <p className="bookings-lead">{t('bookings.setup.lead')}</p>
    </>}
    <div className="bookings-settings-shell">
      <nav className="bookings-settings-nav" aria-label={t('bookings.settings.nav')}>
        {panels.map((item) => <button key={item.id} type="button" className={panel === item.id ? 'active' : ''}
          aria-label={item.navLabel} aria-current={panel === item.id ? 'page' : undefined} onClick={() => setPanel(item.id)}>
          <span>{item.navLabel}</span>{item.meta && <small>{item.meta}</small>}
        </button>)}
      </nav>
      <section className="bookings-settings-panel">
        <header className="bookings-settings-panel-heading">
          <h3>{panels.find((item) => item.id === panel)!.label}</h3>
        </header>
    {panel === 'services' && <>
      {services.map((service, index) => <fieldset key={service.key} className="bookings-service card">
      <legend>{services.length > 1 ? t('bookings.settings.serviceN', { n: index + 1 }) : t('bookings.settings.service')}</legend>
      <label>{t('bookings.settings.name')}
        <Input value={service.name} maxLength={80} aria-invalid={Boolean(errors[`${service.key}.name`])}
          onChange={(event) => update(service.key, { name: event.target.value })} />
      </label>
      {error(`${service.key}.name`)}
      <label>{t('bookings.settings.description')}
        <textarea className="input" value={service.description} maxLength={240} rows={3}
          placeholder={t('bookings.settings.description.placeholder')}
          aria-invalid={Boolean(errors[`${service.key}.description`])}
          onChange={(event) => update(service.key, { description: event.target.value })} />
      </label>
      {error(`${service.key}.description`)}
      <div className="bookings-service-basics">
      <label>{t('bookings.settings.duration')}
        <select className="input" value={service.durationMinutes} onChange={(event) => update(service.key, { durationMinutes: Number(event.target.value) })}>
          {DURATIONS.map((minutes) => <option key={minutes} value={minutes}>{t('bookings.settings.minutes', { n: minutes })}</option>)}
        </select>
      </label>
      <label>{t('bookings.settings.capacity')}
        <Input type="number" min={1} max={50} value={service.capacity} aria-invalid={Boolean(errors[`${service.key}.capacity`])}
          onChange={(event) => update(service.key, { capacity: Number(event.target.value) })} />
      </label>
      {error(`${service.key}.capacity`)}
      <label>{t('bookings.settings.price')}
        <Input value={service.priceLabel} maxLength={40} placeholder={t('bookings.settings.price.placeholder')}
          onChange={(event) => update(service.key, { priceLabel: event.target.value })} />
      </label>
      </div>
      {service.id !== null && <label className="bookings-check">
        <input type="checkbox" checked={service.active} onChange={(event) => update(service.key, { active: event.target.checked })} />
        {t('bookings.settings.active')}
      </label>}
      {service.id === null && services.length > 1 && <Button type="button" variant="ghost"
        onClick={() => setServices((list) => list.filter((draft) => draft.key !== service.key))}>{t('bookings.settings.remove')}</Button>}
    </fieldset>)}
    {error('services')}
    {installed && <div className="bookings-more">
      <Button type="button" variant="outline" onClick={() => setServices((list) => [...list, newService()])}>{t('bookings.settings.addService')}</Button>
      <p>{t('bookings.settings.independent')}</p>
    </div>}
    </>}
    {panel === 'hours' && <div className="bookings-hours-services">
      {services.map((service) => <fieldset key={service.key} className="bookings-service card">
        <legend>{service.name || t('bookings.settings.service')}</legend>
        <div className="bookings-hours" role="group" aria-label={`${service.name || t('bookings.settings.service')} · ${t('bookings.settings.hours')}`}>
          {WEEK.map((day) => <div key={day} className="bookings-day">
            <label className="bookings-check bookings-day-open">
              <input type="checkbox" checked={service.days[day].open} onChange={(event) => updateDay(service.key, day, { open: event.target.checked })} />
              {dayName(day)}
            </label>
            {service.days[day].open && <>
              <input className="input" type="time" step={900} aria-label={services.length > 1
                ? `${service.name || t('bookings.settings.service')}: ${t('bookings.settings.opens', { day: dayName(day) })}`
                : t('bookings.settings.opens', { day: dayName(day) })}
                value={service.days[day].opens} onChange={(event) => updateDay(service.key, day, { opens: event.target.value })} />
              <input className="input" type="time" step={900} aria-label={services.length > 1
                ? `${service.name || t('bookings.settings.service')}: ${t('bookings.settings.closes', { day: dayName(day) })}`
                : t('bookings.settings.closes', { day: dayName(day) })}
                value={service.days[day].closes} onChange={(event) => updateDay(service.key, day, { closes: event.target.value })} />
            </>}
            {error(`${service.key}.day.${day}`)}
          </div>)}
          {error(`${service.key}.hours`)}
        </div>
      </fieldset>)}
    </div>}
    {panel === 'page' && <div className="bookings-page-editor">
    <div className="bookings-page-controls">
    <section className="bookings-page-copy" aria-labelledby="bookings-welcome-title">
      <div>
        <h4 id="bookings-welcome-title">{t('bookings.settings.welcome')}</h4>
        <p className="bookings-lead">{t('bookings.settings.welcome.help')}</p>
      </div>
      <label>{t('bookings.settings.welcome.title')}
        <Input value={welcomeTitle} maxLength={80} placeholder={t('bookings.settings.welcome.title.placeholder')}
          aria-invalid={Boolean(errors.welcomeTitle)} onChange={(event) => setWelcomeTitle(event.target.value)} />
      </label>
      {error('welcomeTitle')}
      <label>{t('bookings.settings.welcome.message')}
        <textarea className="input" value={welcomeMessage} maxLength={240} placeholder={t('bookings.settings.welcome.message.placeholder')}
          aria-invalid={Boolean(errors.welcomeMessage)} onChange={(event) => setWelcomeMessage(event.target.value)} />
      </label>
      {error('welcomeMessage')}
    </section>
    <section className="bookings-branding" aria-labelledby="bookings-branding-title">
      <div>
        <h4 id="bookings-branding-title">{t('bookings.settings.branding')}</h4>
        <p className="bookings-lead">{t('bookings.settings.branding.help')}</p>
      </div>
      <div className="bookings-logo-row">
        <div className="bookings-logo-preview" style={{ '--booking-brand': brandColor } as CSSProperties}>
          {config.settings?.logoUrl
            ? <img src={config.settings.logoUrl} alt={t('bookings.settings.logo.preview')} />
            : <span aria-hidden="true">{Array.from(business.name.trim())[0]?.toUpperCase()}</span>}
        </div>
        <div className="bookings-logo-actions">
          <label className={`btn btn-outline${!installed || logoBusy ? ' disabled' : ''}`}>
            {t(config.settings?.logoUrl ? 'bookings.settings.logo.replace' : 'bookings.settings.logo.add')}
            <input type="file" accept="image/png,image/jpeg,image/webp" disabled={!installed || logoBusy}
              onChange={(event) => { void uploadLogo(event.target.files?.[0]); event.currentTarget.value = ''; }} />
          </label>
          {config.settings?.logoUrl && <Button type="button" variant="ghost" disabled={logoBusy} onClick={() => void removeLogo()}>
            {t('bookings.settings.logo.remove')}
          </Button>}
          <small>{t(installed ? 'bookings.settings.logo.help' : 'bookings.settings.logo.publishFirst')}</small>
        </div>
      </div>
      <fieldset className="bookings-theme-field">
        <legend>{t('bookings.settings.pageTheme')}</legend>
        <div className="bookings-theme-options" role="group" aria-label={t('bookings.settings.pageTheme')}>
          {(['dark', 'light'] as const).map((theme) => <button key={theme} type="button"
            className={pageTheme === theme ? 'active' : ''} aria-pressed={pageTheme === theme}
            onClick={() => setPageTheme(theme)}>{t(`bookings.settings.pageTheme.${theme}`)}</button>)}
        </div>
        <small>{t('bookings.settings.pageTheme.help')}</small>
      </fieldset>
      <fieldset className="bookings-color-field">
        <legend>{t('bookings.settings.brandColor')}</legend>
        <div className="bookings-color-options">
          {BRAND_COLORS.map((color) => <button key={color} type="button" className={brandColor.toLowerCase() === color ? 'active' : ''}
            aria-label={color} aria-pressed={brandColor.toLowerCase() === color} style={{ backgroundColor: color }} onClick={() => setBrandColor(color)} />)}
          <label className="bookings-color-custom" title={t('bookings.settings.brandColor.custom')}>
            <input type="color" value={BRAND_COLOR.test(brandColor) ? brandColor : '#4aebb5'} onChange={(event) => setBrandColor(event.target.value)} />
            <span>+</span>
          </label>
        </div>
      </fieldset>
      {error('brandColor')}
    </section>
    <label>{t('bookings.settings.location')}
      <Input value={location} maxLength={160} placeholder={t('bookings.settings.location.placeholder')}
        aria-invalid={Boolean(errors.location)} onChange={(event) => setLocation(event.target.value)} />
    </label>
    <p className="bookings-lead">{t('bookings.settings.location.help')}</p>
    {error('location')}
    <label>{t('bookings.settings.slug')}
      <Input value={slug} maxLength={40} aria-invalid={Boolean(errors.slug)} onChange={(event) => setSlugInput(event.target.value.toLowerCase())} />
    </label>
    {/* Before the first publish there is no page yet, so only say where it will be. */}
    <p className="bookings-link-preview">{!installed ? t('bookings.settings.link.future', { path: `/b/${slug}` })
      : origin ? `${origin}/b/${slug}` : `…/b/${slug}`}</p>
    {error('slug')}
    </div>
    <aside className="bookings-live-preview" aria-label={t('bookings.settings.preview.title')}
      style={{
        '--booking-preview-accent': BRAND_COLOR.test(brandColor) ? brandColor : '#4aebb5',
        '--booking-preview-accent-ink': previewAccentInk(brandColor),
      } as CSSProperties}>
      <header>
        <div><strong>{t('bookings.settings.preview.title')}</strong><span>{t('bookings.settings.preview.help')}</span></div>
        <small>{t('bookings.settings.preview.live')}</small>
      </header>
      <div className={`bookings-preview-frame is-${pageTheme}`}>
        <div className="bookings-preview-business">
          <div className="bookings-preview-identity">
            <div className="bookings-preview-logo">
              {config.settings?.logoUrl
                ? <img src={config.settings.logoUrl} alt="" />
                : <span aria-hidden="true">{Array.from(business.name.trim())[0]?.toUpperCase()}</span>}
            </div>
            <strong>{business.name}</strong>
          </div>
          {previewService && <div className="bookings-preview-service-context">
            <h5>{previewService.name.trim() || t('bookings.settings.service')}</h5>
            <span>{t('bookings.settings.minutes', { n: previewService.durationMinutes })}{previewService.priceLabel.trim() ? ` · ${previewService.priceLabel.trim()}` : ''}</span>
            {previewService.description.trim() && <p>{previewService.description.trim()}</p>}
            {(welcomeTitle.trim() || welcomeMessage.trim()) && <div className="bookings-preview-welcome">
              {welcomeTitle.trim() && <strong>{welcomeTitle.trim()}</strong>}
              {welcomeMessage.trim() && <p>{welcomeMessage.trim()}</p>}
            </div>}
          </div>}
          <small className="bookings-preview-location">⌖ {location.trim() || t('bookings.settings.preview.locationFallback')}</small>
        </div>
        <div className="bookings-preview-content">
          {previewService ? <>
            <h5>{t('bookings.settings.preview.chooseTime')}</h5>
            <div className="bookings-preview-calendar">
              <strong>{t('bookings.settings.preview.month')}</strong><span aria-hidden="true">‹ &nbsp; ›</span>
              <div className="bookings-preview-weekdays" aria-hidden="true">{previewWeekdays.map((day) => <i key={day}>{day}</i>)}</div>
              <div className="bookings-preview-days" aria-hidden="true">{previewDays.map((day, index) => day === null
                ? <i key={`blank-${index}`} />
                : <i key={day} className={day === 6 ? 'selected' : day % 7 === 3 || day % 7 === 4 ? 'closed' : ''}>{day}</i>)}</div>
            </div>
            <div className="bookings-preview-times">{previewTimes.map((time) => <span key={time}>{time}</span>)}</div>
          </> : previewServices.length ? <>
            <h5>{welcomeTitle.trim() || t('bookings.settings.preview.choose')}</h5>
            <p>{welcomeMessage.trim() || t('bookings.settings.preview.chooseHelp')}</p>
            <div className="bookings-preview-services">{previewServices.map((service) => <div key={service.key}>
              <span><strong>{service.name.trim() || t('bookings.settings.service')}</strong>
                <small>{t('bookings.settings.minutes', { n: service.durationMinutes })}{service.priceLabel.trim() ? ` · ${service.priceLabel.trim()}` : ''}</small></span>
              <b aria-hidden="true">→</b>
            </div>)}</div>
          </> : <div className="bookings-preview-empty">{t('bookings.settings.preview.empty')}</div>}
        </div>
      </div>
    </aside>
    </div>}
    {panel === 'rules' && <div className="bookings-settings-fields">
      <label>{t('bookings.settings.notice')}
        <select className="input" value={minNotice} onChange={(event) => setMinNotice(Number(event.target.value))}>
          {notices.map((minutes) => <option key={minutes} value={minutes}>{noticeLabel(minutes)}</option>)}
        </select>
      </label>
      <label>{t('bookings.settings.horizon')}
        <Input type="number" min={1} max={90} value={horizon} aria-invalid={Boolean(errors.horizon)} onChange={(event) => setHorizon(Number(event.target.value))} />
      </label>
      {error('horizon')}
      <label>{t('bookings.settings.cutoff')}
        <select className="input" value={changeCutoff} aria-invalid={Boolean(errors.changeCutoff)} onChange={(event) => setChangeCutoff(Number(event.target.value))}>
          {cutoffs.map((minutes) => <option key={minutes} value={minutes}>{noticeLabel(minutes)}</option>)}
        </select>
      </label>
      <p className="bookings-lead">{t('bookings.settings.cutoff.help')}</p>
      {error('changeCutoff')}
      <p className="bookings-lead">{t('bookings.settings.reminders')}</p>
    </div>}
    {panel === 'calendar' && <div className="bookings-settings-fields">
        <p className="bookings-lead">{config.calendarProtection.connected
          ? config.calendarProtection.syncedAt
            ? t('bookings.settings.calendarProtection.active', { account: config.calendarProtection.account ?? t('bookings.settings.calendarProtection.calendar') })
            : t('bookings.settings.calendarProtection.waiting')
          : t('bookings.settings.calendarProtection.disconnected')}</p>
        {config.calendarProtection.lastError && <p className="field-error" role="alert">{t('bookings.settings.calendarProtection.problem')}</p>}
    </div>}
    {panel === 'blocks' && <>
      <div className="bookings-blocks">
        <p className="bookings-lead">{t('bookings.settings.blocks.help')}</p>
        {blocks.map((block) => <fieldset key={block.key} className="bookings-block card">
          <legend>{t('bookings.settings.block')}</legend>
          <label>{t('bookings.settings.block.label')}
            <Input value={block.label} maxLength={80} onChange={(event) => setBlocks((list) => list.map((item) => item.key === block.key ? { ...item, label: event.target.value } : item))} />
          </label>
          <label>{t('bookings.settings.block.start')}
            <Input type="datetime-local" step={900} value={block.startsAt} onChange={(event) => setBlocks((list) => list.map((item) => item.key === block.key ? { ...item, startsAt: event.target.value } : item))} />
          </label>
          <label>{t('bookings.settings.block.end')}
            <Input type="datetime-local" step={900} value={block.endsAt} onChange={(event) => setBlocks((list) => list.map((item) => item.key === block.key ? { ...item, endsAt: event.target.value } : item))} />
          </label>
          {error(`${block.key}.range`)}
          <Button type="button" variant="ghost" onClick={() => setBlocks((list) => list.filter((item) => item.key !== block.key))}>
            {t('bookings.settings.block.remove')}
          </Button>
        </fieldset>)}
        {blocks.length < 100 && <Button type="button" variant="outline" onClick={() => setBlocks((list) => [...list, newBlock()])}>
          {t('bookings.settings.block.add')}
        </Button>}
      </div>
    </>}
    {!installed && <label className="bookings-check bookings-ack">
      <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
      {t('bookings.setup.acknowledge')}
    </label>}
    {error('acknowledge')}
    {problem && <div className="bookings-problem" role="alert">
      <p>{t(problem.key)}</p>
      {problem.reload && <Button type="button" variant="outline" onClick={onReload}>{t('bookings.settings.reload')}</Button>}
    </div>}
    {installed && <p className="bookings-kept">{t('bookings.settings.kept')}</p>}
    <div className="bookings-settings-actions">
      <Button type="submit" disabled={saving}>{t(installed ? 'bookings.settings.save' : 'bookings.setup.publish')}</Button>
    </div>
      </section>
    </div>
  </form>;
}
