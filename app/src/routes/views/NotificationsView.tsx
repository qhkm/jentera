import { ArrowClockwise, ArrowUpRight, Bell, Check, WarningCircle } from '@phosphor-icons/react';
import { Button, LoadingState } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import type { AppNotification } from '@/lib/notifications';
import type { useNotifications } from '@/hooks/useNotifications';

type NotificationsState = ReturnType<typeof useNotifications>;

function Glyph({ item }: { item: AppNotification }) {
  const Icon = item.kind === 'routine_failed' ? WarningCircle
    : item.kind === 'routine_needs_approval' ? Bell : Check;
  return <span className={`notification-icon notification-icon-${item.kind}`}><Icon size={20} weight="duotone" aria-hidden="true" /></span>;
}

export default function NotificationsView({ state, onOpenTask, onOpenRoutine }: {
  state: NotificationsState;
  onOpenTask: (runId: string, title?: string) => void;
  onOpenRoutine: (routineId: string) => void;
}) {
  const { lang, t } = useI18n();
  const date = (instant: string) => new Intl.DateTimeFormat(lang === 'bm' ? 'ms-MY' : 'en-MY', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur',
  }).format(new Date(instant));
  async function open(item: AppNotification) {
    await state.markRead(item.id).catch(() => undefined);
    if (item.runId) onOpenTask(item.runId, item.title);
    else if (item.routineId) onOpenRoutine(item.routineId);
  }
  return <section className="notifications-view" aria-labelledby="notifications-title">
    <header className="notification-heading">
      <div><h1 id="notifications-title">{t('notifications.title')}</h1><p>{t('notifications.intro')}</p></div>
      <div className="notification-actions">
        <Button variant="ghost" aria-label={t('notifications.refresh')} disabled={state.loading} onClick={() => void state.refresh()}><ArrowClockwise size={19} /></Button>
        {state.unread > 0 && <Button variant="outline" onClick={() => void state.markAll()}>{t('notifications.readAll')}</Button>}
      </div>
    </header>
    {state.loading && state.items.length === 0 && <LoadingState title={t('notifications.loading')} />}
    {state.error && state.items.length === 0 && <div className="notification-empty card" role="alert"><p>{t('notifications.error')}</p><Button variant="outline" onClick={() => void state.refresh()}>{t('notifications.retry')}</Button></div>}
    {!state.loading && !state.error && state.items.length === 0 && <div className="notification-empty card"><Bell size={28} weight="duotone" /><h2>{t('notifications.empty')}</h2><p>{t('notifications.empty.detail')}</p></div>}
    {state.items.length > 0 && <ol className="notification-list" aria-busy={state.loading}>
      {state.items.map((item) => <li key={item.id}>
        <button type="button" className={`notification-card card ${item.readAt ? '' : 'notification-unread'}`} onClick={() => void open(item)}>
          <Glyph item={item} />
          <span className="notification-copy"><span className="notification-title-row"><strong>{item.title}</strong>{!item.readAt && <span className="notification-dot"><span className="sr-only">{t('notifications.unread')}</span></span>}</span>
            <span>{item.body}</span><time dateTime={item.createdAt}>{date(item.createdAt)}</time></span>
          <ArrowUpRight className="notification-arrow" size={18} aria-hidden="true" />
        </button>
      </li>)}
    </ol>}
    {state.nextCursor && <Button variant="outline" disabled={state.loadingMore} onClick={() => void state.loadMore()}>{t(state.loadingMore ? 'notifications.loadingMore' : 'notifications.more')}</Button>}
  </section>;
}
