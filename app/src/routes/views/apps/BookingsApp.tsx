import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft } from '@phosphor-icons/react';
import { Button, Card, LoadingState } from '@/components/ui';
import { Tabs } from '@/components/Tabs';
import { useT } from '@/i18n/I18nProvider';
import { useApps } from '@/lib/apps/useApps';
import type { BookingsConfig } from '@/lib/apps/types';
import BookingsList from './BookingsList';
import BookingPage from './BookingPage';
import BookingsSettings from './BookingsSettings';

export type BookingsSection = 'bookings' | 'page' | 'settings';

export default function BookingsApp({ bookingId, section, onSection, onBack, onConnectCalendar }: {
  bookingId: string | null;
  section: string | null;
  onSection: (section: BookingsSection, bookingId?: string) => void;
  onBack: () => void;
  onConnectCalendar: () => void;
}) {
  const t = useT();
  const apps = useApps();
  const api = apps.api!;
  const [config, setConfig] = useState<BookingsConfig | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setConfig(await api.bookingsConfig());
    } catch {
      setFailed(true);
    }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  const installed = config?.installation != null;
  const active: BookingsSection = !installed ? 'settings' : section === 'page' || section === 'settings' ? section : 'bookings';

  function saved(next: BookingsConfig) {
    const first = !installed;
    setConfig(next);
    void apps.refresh();
    if (first) onSection('page');
  }

  return <section className="bookings-app" aria-labelledby="bookings-title">
    <header className="bookings-app-heading">
      <h1 id="bookings-title">{t('bookings.title')}</h1>
      <Button variant="ghost" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />{t('bookings.back')}</Button>
    </header>
    {failed && <Card role="alert" className="bookings-state">
      <p>{t('bookings.config.error')}</p>
      <Button variant="outline" onClick={() => void load()}>{t('apps.retry')}</Button>
    </Card>}
    {!failed && !config && <LoadingState title={t('bookings.config.loading')} />}
    {config && <>
      {installed && <Tabs<BookingsSection>
        tabs={[
          { id: 'bookings', label: t('bookings.tab.bookings') },
          { id: 'page', label: t('bookings.tab.page') },
          { id: 'settings', label: t('bookings.tab.settings') },
        ]}
        active={active}
        onSelect={(id) => onSection(id)}
        label={t('bookings.tabs')}
        idPrefix="bookings"
      />}
      <div role={installed ? 'tabpanel' : undefined} id={installed ? `bookings-panel-${active}` : undefined}
        aria-labelledby={installed ? `bookings-tab-${active}` : undefined} className="bookings-panel">
        {active === 'bookings' && <BookingsList api={api} bookingId={bookingId} onConnectCalendar={onConnectCalendar} />}
        {active === 'page' && <BookingPage api={api} config={config} onChange={saved} onReload={() => void load()} />}
        {active === 'settings' && <BookingsSettings key={config.version ?? 'new'} api={api} config={config} onSaved={saved} onReload={() => void load()} />}
      </div>
    </>}
  </section>;
}
