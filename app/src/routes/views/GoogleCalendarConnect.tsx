import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button, Card, Eyebrow, Tag } from '@/components/ui';
import { useRepository } from '@/lib/repo';
import type { ConnectionsState } from '@/hooks/useConnections';
import { isNative } from '@/lib/native';
import { GoogleCalendarConnectionLink } from '@/components/GoogleCalendarConnectionLink';

export default function GoogleCalendarConnect({
  rows,
  setRows,
}: Pick<ConnectionsState, 'rows' | 'setRows'>) {
  const repo = useRepository();
  const [searchParams] = useSearchParams();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const calendars = (rows ?? []).filter((row) => row.connector === 'google');
  const outcome = searchParams.get('calendar');

  async function disconnect(id: string) {
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
    <Card className="gap-4">
      <div className="flex flex-col gap-1">
        <Eyebrow>Google Calendar</Eyebrow>
        <p className="max-w-[66ch] text-[13px] text-text-secondary">
          Let Jentera check your primary calendar and draft events. A draft is never added until
          you approve it in Activity.
        </p>
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
              <div className="flex flex-wrap items-center justify-end gap-2">
                {calendar.status !== 'connected' && !confirming && (
                  <GoogleCalendarConnectionLink className="btn btn-primary inline-flex" newTab={false}>
                    Reconnect
                  </GoogleCalendarConnectionLink>
                )}
                {confirming === calendar.id ? (
                  <>
                    <span className="w-full text-right text-[11px] text-text-muted">
                      Jentera will stop reading or adding events. Existing events stay in Google Calendar.
                    </span>
                    <Button variant="ghost" disabled={busy} onClick={() => setConfirming(null)}>Cancel</Button>
                    <Button variant="outline" disabled={busy} onClick={() => void disconnect(calendar.id)}>
                      {busy ? 'Disconnecting…' : 'Confirm disconnect'}
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" onClick={() => setConfirming(calendar.id)}>Disconnect</Button>
                )}
              </div>
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
