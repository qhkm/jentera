import { useEffect, useRef, useState } from 'react';
import { Bell, CalendarBlank, CheckCircle, Clock } from '@phosphor-icons/react';
import { useI18n } from '@/i18n/I18nProvider';
import { usePushNotifications } from '@/pwa/push';
import { ReminderError, reminderLocalTime, reminderRequest, type Reminder, type ReminderDraft } from '@/lib/reminders';

export function ReminderCard({ draft }: { draft: ReminderDraft }) {
  const { lang } = useI18n();
  const bm = lang === 'bm';
  const push = usePushNotifications();
  const proposedTime = reminderLocalTime(draft.dueAt).slice(0, 16);
  const [message, setMessage] = useState(draft.message.slice(0, 500));
  const [time, setTime] = useState(proposedTime);
  const [saved, setSaved] = useState<Reminder | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [pushResult, setPushResult] = useState('');
  const lock = useRef(false);

  useEffect(() => {
    let live = true;
    reminderRequest(draft.id, 'GET').then(data => {
      if (live) setSaved(data.reminder);
    }).catch(e => {
      if (live && !(e instanceof ReminderError && e.status === 404)) {
        setError(bm ? 'Tidak dapat menyemak peringatan. Cuba semula.' : 'Could not check this reminder. Retry before saving.');
        setUncertain(true);
      }
    }).finally(() => { if (live) setChecking(false); });
    return () => { live = false; };
  }, [draft.id, bm]);

  async function save() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      /* Keep the model's precise instant when the owner accepts it unchanged,
         while hiding seconds the minute-granularity scheduler cannot promise.
         An edited field starts at :00 of the minute the owner chose. */
      const due = draft.dueAt && time === proposedTime
        ? new Date(draft.dueAt)
        : new Date(`${time}:00+08:00`);
      if (!Number.isFinite(due.getTime()) || due.getTime() <= Date.now()) {
        throw new ReminderError(bm ? 'Pilih masa akan datang.' : 'Choose a future date and time.', 400);
      }
      const result = await reminderRequest(draft.id, 'POST', {
        id: draft.id,
        message,
        dueAt: due.toISOString(),
        timeZone: 'Asia/Kuala_Lumpur',
      });
      setSaved(result.reminder);
      setUncertain(false);
      setPushResult(result.push === 'subscribed'
        ? (bm ? 'Push aktif pada peranti ini.' : 'Push is active on this device.')
        : (bm ? 'Peringatan masih akan muncul dalam Notifikasi.' : 'The reminder will still appear in Notifications.'));
    } catch (e) {
      const ambiguous = !(e instanceof ReminderError) || e.status === 0 || e.status >= 500;
      setUncertain(ambiguous);
      setError(ambiguous
        ? (bm ? 'Simpanan belum dapat disahkan. Semak status sebelum mencuba lagi.' : 'Save not confirmed. Check status before trying again.')
        : (e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function check() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await reminderRequest(draft.id, 'GET');
      setSaved(result.reminder);
      setUncertain(false);
    } catch (e) {
      if (e instanceof ReminderError && e.status === 404) setUncertain(false);
      else setError(bm ? 'Semakan gagal. Cuba lagi.' : 'Status check failed. Try again.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function cancel() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await reminderRequest(draft.id, 'DELETE');
      setSaved(result.reminder);
    } catch {
      setUncertain(true);
      setError(bm ? 'Pembatalan belum disahkan. Semak status.' : 'Cancellation not confirmed. Check status.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const title = saved
    ? saved.status === 'scheduled'
      ? (bm ? 'Peringatan dijadualkan' : 'Reminder scheduled')
      : saved.status === 'sent'
        ? (bm ? 'Dihantar ke Notifikasi' : 'Sent to Notifications')
        : (bm ? 'Peringatan dibatalkan' : 'Reminder cancelled')
    : (bm ? 'Semak peringatan' : 'Review reminder');

  return (
    <section className="card reminder-card" aria-label={bm ? 'Peringatan' : 'Reminder'}>
      <header className="reminder-card-header">
        <span className="reminder-card-icon" aria-hidden="true">
          {saved ? <CheckCircle size={20} weight="duotone" /> : <Bell size={20} weight="duotone" />}
        </span>
        <div>
          <span>{bm ? 'Sekali sahaja' : 'One-time reminder'}</span>
          <strong>{title}</strong>
        </div>
      </header>

      {checking ? (
        <p role="status" className="reminder-card-checking">{bm ? 'Menyemak peringatan…' : 'Checking reminder…'}</p>
      ) : saved ? (
        <div className="reminder-card-receipt">
          <p>{saved.message}</p>
          <div className="reminder-card-time">
            <CalendarBlank size={17} aria-hidden="true" />
            <span>{new Date(saved.dueAt).toLocaleString(bm ? 'ms-MY' : 'en-GB', {
              timeZone: 'Asia/Kuala_Lumpur',
              dateStyle: 'medium',
              timeStyle: 'short',
            })}</span>
          </div>
          <small>MYT · Asia/Kuala_Lumpur (UTC+8)</small>
          {saved.status === 'scheduled' && (
            <button type="button" className="btn btn-outline reminder-card-cancel" disabled={busy} onClick={cancel}>
              {busy ? (bm ? 'Membatalkan…' : 'Cancelling…') : (bm ? 'Batalkan peringatan' : 'Cancel reminder')}
            </button>
          )}
        </div>
      ) : (
        <form className="reminder-card-form" onSubmit={e => { e.preventDefault(); void save(); }}>
          <label className="reminder-card-field">
            <span>{bm ? 'Ingatkan saya untuk' : 'Remind me to'}</span>
            <textarea
              className="input"
              rows={2}
              value={message}
              maxLength={500}
              required
              disabled={busy || uncertain}
              onChange={e => setMessage(e.target.value)}
            />
          </label>
          <label className="reminder-card-field">
            <span className="reminder-card-field-heading">
              <span>{bm ? 'Bila' : 'When'}</span>
              <small>MYT · UTC+8</small>
            </span>
            <input
              className="input"
              type="datetime-local"
              step="60"
              required
              value={time}
              disabled={busy || uncertain}
              onChange={e => setTime(e.target.value)}
              aria-label={bm ? 'Tarikh dan masa' : 'Date and time'}
            />
          </label>

          <div className="reminder-card-delivery">
            <Clock size={18} aria-hidden="true" />
            <div>
              <strong>{bm ? 'Dihantar ke Notifikasi' : 'Delivered to Notifications'}</strong>
              <span>{bm ? 'Disemak setiap minit' : 'Checked every minute'}{push.state === 'on' ? (bm ? ' · push aktif' : ' · push on') : ''}</span>
            </div>
            {push.state !== 'on' && (
              <button type="button" className="reminder-card-link" disabled={push.busy} onClick={async () => {
                const result = await push.enable();
                setPushResult(result === 'on'
                  ? (bm ? 'Push diaktifkan pada peranti ini.' : 'Push enabled on this device.')
                  : (bm ? `Push belum diaktifkan (${result}).` : `Push not enabled (${result}).`));
              }}>{push.busy ? (bm ? 'Mengaktifkan…' : 'Enabling…') : (bm ? 'Aktifkan push' : 'Enable push')}</button>
            )}
          </div>

          <button className="btn btn-primary reminder-card-primary" disabled={busy || uncertain} type="submit">
            <Bell size={17} weight="fill" aria-hidden="true" />
            {busy ? (bm ? 'Menyimpan…' : 'Saving…') : (bm ? 'Sahkan peringatan' : 'Confirm reminder')}
          </button>
        </form>
      )}

      {pushResult && <p className="reminder-card-note" role="status">{pushResult}</p>}
      {uncertain && (
        <button type="button" className="btn btn-outline reminder-card-check" disabled={busy} onClick={check}>
          {bm ? 'Semak status' : 'Check status'}
        </button>
      )}
      {error && <p className="reminder-card-error" role="alert">{error}</p>}
    </section>
  );
}
