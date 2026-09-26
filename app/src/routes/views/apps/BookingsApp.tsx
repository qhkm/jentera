import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from '@phosphor-icons/react';
import { Button, Card, LoadingState } from '@/components/ui';
import { Tabs } from '@/components/Tabs';
import { useT } from '@/i18n/I18nProvider';
import { useApps } from '@/lib/apps/useApps';
import { bookingsConfigQuery } from '@/lib/apps/queries';
import type { BookingsConfig } from '@/lib/apps/types';
import { useRequiredBusinessId } from '@/lib/query/scope';
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
  const businessId = useRequiredBusinessId();
  /* A revisit inside 30 s shows the cached settings with no request. While
     the settings form is open (Settings, or setup before the first publish)
     nothing reads them again in the background: a newer version from the
     owner's other device would remount the form under them and wipe what
     they had typed. Their save finds it instead (CONFIG_CHANGED, Reload). */
  const editing = (config: BookingsConfig | undefined) =>
    config !== undefined && (section === 'settings' || config.installation == null);
  const read = useQuery({
    ...bookingsConfigQuery(api, businessId),
    refetchOnWindowFocus: (query) => !editing(query.state.data),
    refetchOnReconnect: (query) => !editing(query.state.data),
  });
  const config = read.data ?? null;
  /* A retry in flight shows the loading state, not the failure again. */
  const failed = read.isError && !config && !read.isFetching;
  const reload = () => { void read.refetch(); };

  const installed = config?.installation != null;
  const active: BookingsSection = !installed ? 'settings' : section === 'page' || section === 'settings' ? section : 'bookings';

  /* The save itself put the answer in the cache and refreshed the apps
     list (useSaveBookingsConfig). This is called with the config from the
     render the save started in, so a first publish still moves to the page. */
  function saved() {
    if (!installed) onSection('page');
  }

  return <section className="bookings-app" aria-labelledby="bookings-title">
    <header className="bookings-app-heading">
      <h1 id="bookings-title">{t('bookings.title')}</h1>
      <Button variant="ghost" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />{t('bookings.back')}</Button>
    </header>
    {failed && <Card role="alert" className="bookings-state">
      <p>{t('bookings.config.error')}</p>
      <Button variant="outline" onClick={reload}>{t('apps.retry')}</Button>
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
        {active === 'page' && <BookingPage api={api} config={config} onChange={saved} onReload={reload} />}
        {active === 'settings' && <BookingsSettings key={config.version ?? 'new'} api={api} config={config} onSaved={saved} onReload={reload} />}
      </div>
    </>}
  </section>;
}
