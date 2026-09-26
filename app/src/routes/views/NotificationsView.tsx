import { ArrowClockwise, ArrowRight, ArrowUpRight, Bell, CalendarBlank, CalendarCheck, Check, WarningCircle } from '@phosphor-icons/react';
import { Button, LoadingState } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import type { AppNotification } from '@/lib/notifications';
import type { useNotifications } from '@/hooks/useNotifications';
import { notificationSummary } from '@/lib/notification-summary';

type NotificationsState = ReturnType<typeof useNotifications>;

function Glyph({ item }: { item: AppNotification }) {
  const Icon = notificationSummary(item) ? CalendarBlank
    : item.kind === 'routine_failed' || item.kind === 'credit_warning' ? WarningCircle
    : item.kind === 'reminder_due' || item.kind === 'routine_needs_approval' || item.kind === 'approval_requested' || item.kind === 'work_needs_you' ? Bell
    : item.kind === 'booking_requested' ? CalendarCheck : Check;
  return <span className={`notification-icon notification-icon-${item.kind}`}><Icon size={20} weight="duotone" aria-hidden="true" /></span>;
}

export default function NotificationsView({ state, onOpenTask, onOpenRoutine, onOpenReview, onOpenUrl }: {
  state: NotificationsState;
  onOpenTask: (runId: string, title?: string) => void;
  onOpenReview?: (runId: string) => void;
  onOpenRoutine: (routineId: string) => void;
  onOpenUrl?: (url: string) => void;
}) {
  const { lang, t } = useI18n();
  const date = (instant: string) => new Intl.DateTimeFormat(lang === 'bm' ? 'ms-MY' : 'en-MY', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur',
  }).format(new Date(instant));
  const summaryDate = (instant: string) => new Intl.DateTimeFormat(lang === 'bm' ? 'ms-MY' : 'en-MY', {
    day: 'numeric', month: 'short', timeZone: 'Asia/Kuala_Lumpur',
  }).format(new Date(instant));
  async function open(item: AppNotification) {
    await state.markRead(item.id).catch(() => undefined);
    if (item.url && onOpenUrl) onOpenUrl(item.url);
    else if (item.runId && onOpenReview && ['work_needs_you', 'approval_requested'].includes(item.kind)) onOpenReview(item.runId);
    else if (item.runId) onOpenTask(item.runId, item.title);
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
      {state.items.map((item) => {
        const summary = notificationSummary(item);
        return <li key={item.id}>
          <button type="button" className={`notification-card card ${summary ? 'notification-summary-card' : ''} ${item.readAt ? '' : 'notification-unread'}`} onClick={() => void open(item)}>
            <Glyph item={item} />
            <span className="notification-copy">
              <span className="notification-title-row">
                <strong>{summary ? t(`notifications.summary.${summary.period}`) : item.title}</strong>
                {!item.readAt && <span className="notification-dot"><span className="sr-only">{t('notifications.unread')}</span></span>}
              </span>
              {summary ? <>
                <span className="notification-summary-metrics">
                  <span><strong>{summary.total}</strong>{t('notifications.summary.recorded')}</span>
                  <span><strong>{summary.completed}</strong>{t('notifications.summary.completed')}</span>
                  <span className={summary.failed ? 'notification-summary-issue' : ''}><strong>{summary.failed}</strong>{t('notifications.summary.failed')}</span>
                </span>
                {summary.failed > 0 && <span className="notification-summary-attention">
                  <WarningCircle size={16} aria-hidden="true" />
                  {t(`notifications.summary.attention.${summary.failed === 1 ? 'one' : 'many'}`, { n: summary.failed })}
                </span>}
                <span className="notification-summary-open">{t('notifications.summary.open')}<ArrowRight size={15} aria-hidden="true" /></span>
              </> : <span className={item.runId || item.routineId || item.url ? 'notification-body-preview' : undefined}>{item.body}</span>}
            </span>
            <span className="notification-side">
              <time dateTime={item.createdAt}>{summary ? summaryDate(item.createdAt) : date(item.createdAt)}</time>
              {summary ? <ArrowRight className="notification-arrow" size={18} aria-hidden="true" /> : <ArrowUpRight className="notification-arrow" size={18} aria-hidden="true" />}
            </span>
          </button>
        </li>;
      })}
    </ol>}
    {state.nextCursor && <Button variant="outline" disabled={state.loadingMore} onClick={() => void state.loadMore()}>{t(state.loadingMore ? 'notifications.loadingMore' : 'notifications.more')}</Button>}
  </section>;
}
