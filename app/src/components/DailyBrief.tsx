import { ArrowClockwise, ArrowRight, ArrowUpRight, Bell, BookOpen, ChatCircle, CheckCircle, Clock, WarningCircle } from '@phosphor-icons/react';
import { Button, Eyebrow, LoadingState } from '@/components/ui';
import { JenteraMark } from '@/components/JenteraMark';
import { useI18n } from '@/i18n/I18nProvider';
import type { ActivityState } from '@/hooks/useActivity';
import type { BusinessSnapshot, WorkSummary } from '@/lib/repo';
import { BUSINESS_TIME_ZONE, dailyBrief } from '@/lib/daily-brief';
import { isRunId } from '@/lib/task';
import type { View } from '@/routes/Dashboard';
import type { BizTab } from '@/routes/views/MyBusinessView';

const STATUS: Record<string, string> = {
  completed: 'work.done', failed: 'work.failed', blocked: 'work.blocked',
  needs_approval: 'work.waiting', cancelled: 'task.cancelled',
  queued: 'task.queued', working: 'work.inprogress', running: 'work.inprogress',
};

export function DailyBrief({ activity, snapshot, now, onNavigate }: {
  activity: ActivityState;
  snapshot: BusinessSnapshot;
  now: Date;
  onNavigate: (view: View, tab?: BizTab, runId?: string) => void;
}) {
  const { t, lang } = useI18n();
  const brief = activity.real && activity.data ? dailyBrief(activity.data, snapshot, now) : null;
  const locale = lang === 'bm' ? 'ms-MY' : 'en-MY';
  const clock = (date: Date) => date.toLocaleTimeString(locale, { timeZone: BUSINESS_TIME_ZONE, hour: 'numeric', minute: '2-digit' });
  const Icon = brief?.priority === 'approval' ? Bell : brief?.priority === 'failed' ? WarningCircle
    : brief?.priority === 'working' ? Clock : brief?.priority === 'knowledge' ? BookOpen : ChatCircle;
  function openWork(work?: WorkSummary) {
    onNavigate('work', undefined, isRunId(work?.runId) ? work.runId : undefined);
  }
  function next() {
    if (!brief) return;
    if (brief.priority === 'approval') openWork();
    else if (brief.focus) openWork(brief.focus);
    else if (brief.priority === 'knowledge') onNavigate('business', 'knows');
    else onNavigate('chat');
  }
  return (
    <section className="daily-brief" aria-labelledby="daily-brief-heading" aria-busy={activity.loading}>
      <header className="daily-brief-header">
        <div className="daily-brief-identity"><JenteraMark size={32} /><h2 id="daily-brief-heading">{t('brief.title')}</h2></div>
        <button type="button" className="brief-refresh" onClick={activity.reload} disabled={activity.loading}>
          <ArrowClockwise size={17} aria-hidden="true" />{t('brief.refresh')}
        </button>
      </header>
      {activity.mode === 'error' ? (
        <div className="brief-state" role="alert"><WarningCircle size={24} aria-hidden="true" />
          <p>{t('brief.error')}</p>
          <Button variant="outline" onClick={activity.reload}>{t('loading.retry')}</Button>
        </div>
      ) : !brief ? (
        <div className="brief-state"><LoadingState title={t('brief.loading')} detail={t('brief.loading.detail')} /></div>
      ) : (
        <>
          <div className="daily-brief-body">
            <div className="brief-priority">
              <Eyebrow><Icon size={16} aria-hidden="true" />{t('brief.start')}</Eyebrow>
              <h3>{t(brief.priority === 'approval' && activity.data!.counters.needsYou === 1 ? 'brief.approval.one' : `brief.${brief.priority}.title`, { n: activity.data!.counters.needsYou })}</h3>
              <p>{t(`brief.${brief.priority}.detail`)}</p>
              {brief.focus && <p className="brief-focus">{brief.focus.objective}</p>}
              <div><Button onClick={next}>{t(`brief.${brief.priority}.cta`)}<ArrowRight size={17} aria-hidden="true" /></Button></div>
              {brief.priority !== 'approval' && <span className="brief-approval-clear"><CheckCircle size={16} aria-hidden="true" />{t('brief.noApprovals')}</span>}
            </div>
            <div className="brief-records">
              <h3>{t('brief.recorded')}</h3>
              {brief.today.length ? (
                <ul>{brief.today.slice(0, 2).map((work) => (
                  <li key={work.id}><button type="button" onClick={() => openWork(work)}>
                    <span><strong>{work.objective}</strong>
                      <span className="brief-record-meta"><span>{t(STATUS[work.status] ?? 'task.unknown')}</span>
                        <time dateTime={work.occurredAt}>{clock(new Date(work.occurredAt))}</time>
                      </span>
                    </span><ArrowUpRight size={17} aria-hidden="true" />
                  </button></li>
                ))}</ul>
              ) : <p className="brief-no-records">{t('brief.empty')}</p>}
              <button type="button" className="brief-all" onClick={() => openWork()}>{t('brief.all')}<ArrowRight size={16} aria-hidden="true" /></button>
            </div>
          </div>
          <footer className="daily-brief-footer">
            <span>{t('brief.scope')}</span>
            {activity.updatedAt !== null && <span>{t('brief.updated')} <time dateTime={new Date(activity.updatedAt).toISOString()}>
              {new Date(activity.updatedAt).toLocaleDateString(locale, { timeZone: BUSINESS_TIME_ZONE, day: 'numeric', month: 'short' })}, {clock(new Date(activity.updatedAt))}
            </time></span>}
          </footer>
        </>
      )}
    </section>
  );
}
