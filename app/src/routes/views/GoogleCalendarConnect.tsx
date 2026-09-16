import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Card, Eyebrow, Tag } from '@/components/ui';
import { ConnectionActions } from '@/components/ConnectionActions';
import { useT } from '@/i18n/I18nProvider';
import { useRepository } from '@/lib/repo';
import type { ConnectionsState } from '@/hooks/useConnections';
import { isNative } from '@/lib/native';
import { GoogleCalendarConnectionLink } from '@/components/GoogleCalendarConnectionLink';

export default function GoogleCalendarConnect({
  rows,
  setRows,
  id,
}: Pick<ConnectionsState, 'rows' | 'setRows'> & { id?: string }) {
  const repo = useRepository();
  const t = useT();
  const [searchParams] = useSearchParams();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const calendars = (rows ?? []).filter((row) => row.connector === 'google');
  const outcome = searchParams.get('calendar');

  async function disconnect(id: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await repo.disconnect(id);
      setRows((current) => (current ?? []).filter((row) => row.id !== id));
      setConfirming(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not disconnect Google Calendar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card id={id} tabIndex={id ? -1 : undefined} className="gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3"><Eyebrow>Google Calendar</Eyebrow><Tag>Pilot</Tag></div>
        <p className="max-w-[66ch] text-[13px] text-text-secondary">
          Let Jentera check your primary calendar and draft events. A draft is never added until
          you approve it in Activity.
        </p>
        <p className="text-[12px] text-text-muted">{t('connectors.googleVerification')}</p>
      </div>

      {outcome === 'failed' && <p role="alert" className="text-[13px] text-text-secondary">Google did not complete the connection. Please try again.</p>}
      {outcome === 'unavailable' && <p role="alert" className="text-[13px] text-text-secondary">Google Calendar is not configured for this Jentera environment yet.</p>}
      {outcome === 'session' && <p role="alert" className="text-[13px] text-text-secondary">Your session changed during connection. Sign in again, then retry.</p>}
      {outcome === 'connected' && calendars.some(calendar => calendar.status === 'connected') && <p role="status" className="text-[13px] text-brand">Google Calendar connected.</p>}

      {calendars.length ? (
        <ul className="flex flex-col gap-3">
          {calendars.map((calendar) => (
            <li key={calendar.id} className="flex flex-col gap-3 rounded-card border border-border bg-bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm">{calendar.displayName ?? 'Google account'}</p>
                  <p className="mt-1 text-[12px] text-text-muted">
                    Primary calendar · event access only · no Gmail, Drive, Contacts, or Sheets
                  </p>
                </div>
                <Tag tone={calendar.status === 'connected' ? 'green' : 'amber'}>
                  {calendar.status === 'connected' ? 'Connected' : 'Reconnect needed'}
                </Tag>
              </div>
              {calendar.lastError && <p className="text-[12px] text-text-secondary">{calendar.lastError}</p>}
              <ConnectionActions name="Google Calendar" confirming={confirming === calendar.id} busy={busy}
                explanation={t('connectors.disconnectCalendar')}
                onRequestDisconnect={() => setConfirming(calendar.id)} onCancel={() => setConfirming(null)} onDisconnect={() => void disconnect(calendar.id)}>
                {calendar.status !== 'connected' && !confirming && (
                  <GoogleCalendarConnectionLink className="btn btn-primary inline-flex" newTab={false}>
                    Reconnect
                  </GoogleCalendarConnectionLink>
                )}
              </ConnectionActions>
            </li>
          ))}
        </ul>
      ) : isNative() ? (
        <div className="rounded-card border border-border bg-bg-card p-4">
          <p className="text-[13px] text-text-secondary">
            Connect Calendar at jentera.ai in your phone&rsquo;s browser. Google does not allow account
            authorisation inside an embedded app browser.
          </p>
          <GoogleCalendarConnectionLink className="btn btn-outline mt-3 inline-flex">
            Open jentera.ai →
          </GoogleCalendarConnectionLink>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <ul className="flex list-disc flex-col gap-1 pl-5 text-[12px] text-text-secondary">
            <li>Read event times and titles on your primary calendar</li>
            <li>Draft new events when you ask</li>
            <li>Require your approval before every event is added</li>
          </ul>
          <div>
            <GoogleCalendarConnectionLink className="btn btn-primary inline-flex" newTab={false}>
              Connect Google Calendar →
            </GoogleCalendarConnectionLink>
          </div>
          <p className="text-[11px] text-text-muted">
            Google will show the exact Calendar permission before you agree. Jentera stores the
            grant encrypted and you can revoke it here at any time.
          </p>
        </div>
      )}
      {error && <p role="alert" className="text-[13px] text-text-secondary">{error}</p>}
    </Card>
  );
}
