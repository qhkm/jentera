import { CalendarCheck } from '@phosphor-icons/react';
import { Button, Card, LoadingState } from '@/components/ui';
import { useT } from '@/i18n/I18nProvider';
import { useApps } from '@/lib/apps/useApps';
import { appLive } from '@/lib/apps/bookings';
import type { AppKey } from '@/lib/apps/types';
import BookingsApp from './apps/BookingsApp';

/* The owner's apps: what is installed, and what can be added. Only apps the
   Worker says exist are offered (`available`). */

const ICONS: Record<AppKey, typeof CalendarCheck> = { bookings: CalendarCheck };

export default function AppsView({ app, bookingId, section, onOpen, onConnectCalendar }: {
  app: string | null;
  bookingId: string | null;
  section: string | null;
  onOpen: (params: Record<string, string>) => void;
  onConnectCalendar: () => void;
}) {
  const t = useT();
  const apps = useApps();

  if (app === 'bookings' && apps.api) {
    return <BookingsApp
      bookingId={bookingId}
      section={section}
      onSection={(next, booking) => onOpen({ app: 'bookings', ...(next === 'bookings' ? {} : { section: next }), ...(booking ? { booking } : {}) })}
      onBack={() => onOpen({})}
      onConnectCalendar={onConnectCalendar}
    />;
  }

  const installed = apps.list?.apps ?? [];
  const addable = (apps.list?.available ?? []).filter((key) => !installed.some((app) => app.key === key));

  return <section className="apps-view" aria-labelledby="apps-title">
    <header className="apps-heading">
      <h1 id="apps-title">{t('apps.title')}</h1>
      <p>{t('apps.intro')}</p>
    </header>
    {apps.error && !apps.list && <Card role="alert" className="apps-state">
      <p>{t('apps.error')}</p>
      <Button variant="outline" onClick={() => void apps.refresh()}>{t('apps.retry')}</Button>
    </Card>}
    {!apps.error && !apps.list && <LoadingState title={t('apps.loading')} />}
    {apps.list && <>
      {installed.length > 0 && <section className="apps-section" aria-labelledby="apps-installed">
        <h2 id="apps-installed">{t('apps.installed')}</h2>
        <div className="apps-grid">
          {installed.map((app) => {
            const AppIcon = ICONS[app.key];
            return <button key={app.key} type="button" className={`apps-tile apps-tile-${app.key}`} onClick={() => onOpen({ app: app.key })}>
              <span className="apps-tile-icon"><AppIcon size={24} weight="duotone" aria-hidden="true" /></span>
              <span className="apps-tile-copy">
                <strong>{t(`apps.${app.key}.name`)}</strong>
                <small>{app.pending > 0 ? t('apps.pending', { n: app.pending }) : t(appLive(app) ? 'apps.ready' : 'apps.paused')}</small>
              </span>
            </button>;
          })}
        </div>
      </section>}
      <section className="apps-section" aria-labelledby="apps-add">
        <h2 id="apps-add">{t('apps.add.title')}</h2>
        {addable.length === 0 ? <p className="apps-none">{t('apps.none')}</p> : <div className="apps-grid">
          {addable.map((key) => {
            const AppIcon = ICONS[key];
            return <Card key={key} className="apps-offer">
              <span className="apps-tile-icon"><AppIcon size={24} weight="duotone" aria-hidden="true" /></span>
              <div>
                <h3>{t(`apps.${key}.name`)}</h3>
                <p>{t(`apps.${key}.detail`)}</p>
              </div>
              <Button onClick={() => onOpen({ app: key })} aria-label={`${t('apps.setup')} ${t(`apps.${key}.name`)}`}>{t('apps.setup')}</Button>
            </Card>;
          })}
        </div>}
      </section>
    </>}
  </section>;
}
