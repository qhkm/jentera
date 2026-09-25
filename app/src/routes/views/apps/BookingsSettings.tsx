import { useMemo, useState, type FormEvent } from 'react';
import { Button, Input } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { useBusiness } from '@/hooks/useBusiness';
import { AppsError } from '@/lib/apps/api';
import type { AppsApi, BookingService, BookingsConfig, BookingsConfigInput, WeeklyHours } from '@/lib/apps/types';

/* Monday first, as a Malaysian week reads; 0 is Sunday in the data. */
const WEEK = [1, 2, 3, 4, 5, 6, 0] as const;
const DURATIONS = Array.from({ length: 32 }, (_, i) => (i + 1) * 15);
const NOTICE = [0, 30, 60, 120, 240, 360, 720, 1440, 2880, 10080];
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const RESERVED = new Set(['api', 'admin', 'www', 'app', 'b']);

interface DayDraft { open: boolean; opens: string; closes: string }
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
  const installed = config.installation !== null;
  const [slugInput, setSlugInput] = useState<string | null>(config.installation?.slug ?? null);
  const slug = slugInput ?? slugFrom(business.name);
  const [services, setServices] = useState<ServiceDraft[]>(() => (config.services.length ? config.services.map(toDraft) : [newService()]));
  const [minNotice, setMinNotice] = useState(config.settings?.minNoticeMinutes ?? 120);
  const [changeCutoff, setChangeCutoff] = useState(config.settings?.changeCutoffMinutes ?? 360);
  const [horizon, setHorizon] = useState(config.settings?.horizonDays ?? 30);
  const [location, setLocation] = useState(config.settings?.location ?? '');
  const [acknowledged, setAcknowledged] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<{ key: string; reload: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
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
    return found;
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) return;
    const input: BookingsConfigInput = {
      version: config.version,
      slug,
      accepting: config.settings?.accepting ?? true,
      minNoticeMinutes: minNotice,
      changeCutoffMinutes: changeCutoff,
      horizonDays: horizon,
      location: location.trim() || null,
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
    };
    setSaving(true);
    try {
      onSaved(await api.saveBookingsConfig(input));
    } catch (error) {
      const code = error instanceof AppsError ? error.code : '';
      if (code === 'SLUG_TAKEN') setErrors({ slug: 'bookings.settings.error.slugTaken' });
      else if (code === 'ACK_REQUIRED') setErrors({ acknowledge: 'bookings.settings.error.acknowledge' });
      else if (code === 'CAPACITY_BELOW_RESERVED') {
        const service = services.find((draft) => draft.id === (error as AppsError).serviceId);
        if (service) setErrors({ [`${service.key}.capacity`]: 'bookings.settings.error.capacity.reserved' });
        else setProblem({ key: 'bookings.settings.error.capacity.reserved', reload: false });
      } else if (code === 'CONFIG_CHANGED' || code === 'UNKNOWN_SERVICE') setProblem({ key: 'bookings.settings.error.changed', reload: true });
      else if (error instanceof AppsError && error.uncertain) setProblem({ key: 'bookings.settings.error.uncertain', reload: true });
      else if (error instanceof AppsError && error.status === 400) setProblem({ key: 'bookings.settings.error.invalid', reload: false });
      else setProblem({ key: 'bookings.settings.error.generic', reload: false });
    } finally {
      setSaving(false);
    }
  }

  const error = (key: string) => (errors[key] ? <p className="field-error" role="alert">{t(errors[key])}</p> : null);
  const noticeLabel = (minutes: number) => (NOTICE.includes(minutes)
    ? t(`bookings.settings.notice.${minutes}`) : t('bookings.settings.notice.custom', { n: minutes }));

  return <form className="bookings-settings" onSubmit={(event) => void save(event)} noValidate>
    <h2>{t(installed ? 'bookings.settings.title' : 'bookings.setup.title')}</h2>
    {!installed && <p className="bookings-lead">{t('bookings.setup.lead')}</p>}
    <label>{t('bookings.settings.location')}
      <Input value={location} maxLength={160} placeholder={t('bookings.settings.location.placeholder')}
        aria-invalid={Boolean(errors.location)} onChange={(event) => setLocation(event.target.value)} />
    </label>
    <p className="bookings-lead">{t('bookings.settings.location.help')}</p>
    {error('location')}
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
      <div className="bookings-hours" role="group" aria-label={t('bookings.settings.hours')}>
        <span className="bookings-hours-title">{t('bookings.settings.hours')}</span>
        {WEEK.map((day) => <div key={day} className="bookings-day">
          <label className="bookings-check bookings-day-open">
            <input type="checkbox" checked={service.days[day].open} onChange={(event) => updateDay(service.key, day, { open: event.target.checked })} />
            {dayName(day)}
          </label>
          {service.days[day].open && <>
            <input className="input" type="time" step={900} aria-label={t('bookings.settings.opens', { day: dayName(day) })}
              value={service.days[day].opens} onChange={(event) => updateDay(service.key, day, { opens: event.target.value })} />
            <input className="input" type="time" step={900} aria-label={t('bookings.settings.closes', { day: dayName(day) })}
              value={service.days[day].closes} onChange={(event) => updateDay(service.key, day, { closes: event.target.value })} />
          </>}
          {error(`${service.key}.day.${day}`)}
        </div>)}
        {error(`${service.key}.hours`)}
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
    <label>{t('bookings.settings.slug')}
      <Input value={slug} maxLength={40} aria-invalid={Boolean(errors.slug)} onChange={(event) => setSlugInput(event.target.value.toLowerCase())} />
    </label>
    {/* Before the first publish there is no page yet, so only say where it will be. */}
    <p className="bookings-link-preview">{!installed ? t('bookings.settings.link.future', { path: `/b/${slug}` })
      : origin ? `${origin}/b/${slug}` : `…/b/${slug}`}</p>
    {error('slug')}
    <details className="bookings-advanced">
      <summary>{t('bookings.settings.advanced')}</summary>
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
    </details>
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
    <Button type="submit" disabled={saving}>{t(installed ? 'bookings.settings.save' : 'bookings.setup.publish')}</Button>
  </form>;
}
