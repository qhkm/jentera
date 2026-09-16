import { ArrowUpRight, CalendarCheck } from '@phosphor-icons/react';
import { useT } from '@/i18n/I18nProvider';
import { isNative } from '@/lib/native';
import { GoogleCalendarConnectionLink } from '@/components/GoogleCalendarConnectionLink';
import { GOOGLE_CALENDAR_WEB_SETUP } from '@/lib/calendar-connection';
import { useToast } from '@/components/Toast';
import { TaskRecoveryActions } from '@/components/TaskRecoveryActions';
import { useSignedIn } from '@/lib/repo/gate';

export function CalendarConnectCard({ runId, title, onContinue }: {
  runId?: string;
  title?: string;
  onContinue?: (context: string, sessionId?: string) => void;
} = {}) {
  const t = useT();
  const toast = useToast();
  const canRecover = useSignedIn() && Boolean(runId && onContinue);
  async function copySetupLink() {
    try {
      // Copy only the public setup page, never an OAuth callback, code or bearer.
      await navigator.clipboard.writeText(GOOGLE_CALENDAR_WEB_SETUP);
      toast(t('ask.calendarConnect.copied'));
    } catch { toast(t('ask.calendarConnect.copyFailed'), 'error'); }
  }
  return (
    <section className="card ask-browser-handoff ask-calendar-connect" aria-label={t('ask.calendarConnect.title')}>
      <header>
        <span className="ask-browser-handoff-icon" aria-hidden="true"><CalendarCheck size={22} weight="duotone" /></span>
        <div>
          <p>Google Calendar</p>
          <h3>{t('ask.calendarConnect.title')}</h3>
        </div>
      </header>
      <p className="ask-browser-handoff-detail">{t('ask.calendarConnect.detail')}</p>
      <div className="ask-calendar-connect-actions">
        <GoogleCalendarConnectionLink className="btn btn-primary">
          {t('ask.calendarConnect.action')}
          <ArrowUpRight size={17} aria-hidden="true" />
        </GoogleCalendarConnectionLink>
        <button type="button" className="btn btn-ghost" onClick={() => void copySetupLink()}>
          {t('ask.calendarConnect.copy')}
        </button>
      </div>
      {(!canRecover || isNative()) && <p className="ask-browser-handoff-note">{t(isNative() ? 'ask.calendarConnect.native' : 'ask.calendarConnect.continue')}</p>}
      {runId && onContinue && <TaskRecoveryActions runId={runId} request="google_calendar" title={title} onContinue={onContinue} />}
      <small>{t('ask.calendarConnect.private')}</small>
    </section>
  );
}
