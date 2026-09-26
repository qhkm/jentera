import { useState } from 'react';
import { ArrowSquareOut, Copy, ShareNetwork } from '@phosphor-icons/react';
import { Button, Card } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { AppsError } from '@/lib/apps/api';
import { configToInput } from '@/lib/apps/bookings';
import { useSaveBookingsConfig } from '@/lib/apps/queries';
import type { AppsApi, BookingsConfig } from '@/lib/apps/types';

/* The public link and the one switch that matters day to day. The customer
   page cannot be framed (its CSP says frame-ancestors 'none'), so the
   preview is the list customers choose from, plus a link to the real page. */

export default function BookingPage({ api, config, onChange, onReload }: {
  api: AppsApi;
  config: BookingsConfig;
  onChange: (next: BookingsConfig) => void;
  onReload: () => void;
}) {
  const { t } = useI18n();
  const saveConfig = useSaveBookingsConfig(api);
  const installation = config.installation!;
  const accepting = config.settings?.accepting ?? false;
  const taking = installation.state === 'active' && accepting;
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<{ key: string; reload: boolean } | null>(null);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function copy() {
    try {
      await navigator.clipboard.writeText(installation.publicUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setProblem({ key: 'bookings.page.copyFailed', reload: false });
    }
  }

  async function toggle(next: boolean) {
    setSaving(true);
    setProblem(null);
    try {
      onChange(await saveConfig.mutateAsync({ ...configToInput(config), accepting: next }));
    } catch (error) {
      if (error instanceof AppsError && error.code === 'CONFIG_CHANGED') setProblem({ key: 'bookings.settings.error.changed', reload: true });
      else if (error instanceof AppsError && error.uncertain) setProblem({ key: 'bookings.settings.error.uncertain', reload: true });
      else setProblem({ key: 'bookings.settings.error.generic', reload: false });
    } finally {
      setSaving(false);
    }
  }

  return <div className="booking-page">
    <Card className="booking-page-link">
      <h2>{t('bookings.page.title')}</h2>
      <p className="booking-page-url"><a href={installation.publicUrl} target="_blank" rel="noopener noreferrer">{installation.publicUrl}</a></p>
      <p className={taking ? 'booking-page-live' : 'booking-page-paused'}>{t(taking ? 'bookings.page.taking' : 'bookings.page.paused')}</p>
      <div className="booking-page-actions">
        <Button variant="outline" onClick={() => void copy()}><Copy size={17} aria-hidden="true" />{t(copied ? 'bookings.page.copied' : 'bookings.page.copy')}</Button>
        {canShare && <Button variant="outline" onClick={() => void navigator.share({ title: t('apps.bookings.name'), url: installation.publicUrl }).catch(() => undefined)}>
          <ShareNetwork size={17} aria-hidden="true" />{t('bookings.page.share')}
        </Button>}
        <a className="btn btn-outline" href={installation.publicUrl} target="_blank" rel="noopener noreferrer">
          <ArrowSquareOut size={17} aria-hidden="true" />{t('bookings.page.open')}
        </a>
      </div>
      <label className="bookings-check">
        <input type="checkbox" checked={accepting} disabled={saving} onChange={(event) => void toggle(event.target.checked)} />
        {t('bookings.page.accepting')}
      </label>
      {installation.state === 'paused' && <p>{t('bookings.page.installationPaused')}</p>}
      {problem && <div className="bookings-problem" role="alert">
        <p>{t(problem.key)}</p>
        {problem.reload && <Button variant="outline" onClick={onReload}>{t('bookings.settings.reload')}</Button>}
      </div>}
    </Card>
    <Card className="booking-page-preview" aria-labelledby="booking-preview-title">
      <h3 id="booking-preview-title">{t('bookings.page.preview')}</h3>
      <p>{t('bookings.page.preview.detail')}</p>
      <ul>
        {config.services.filter((service) => service.active).map((service) => <li key={service.id}>
          <strong>{service.name}</strong>
          <span>{t('bookings.settings.minutes', { n: service.durationMinutes })}{service.priceLabel ? ` · ${service.priceLabel}` : ''}</span>
        </li>)}
      </ul>
    </Card>
  </div>;
}
