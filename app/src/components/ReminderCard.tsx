import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { usePushNotifications } from '@/pwa/push';
import { ReminderError, reminderLocalTime, reminderRequest, type Reminder, type ReminderDraft } from '@/lib/reminders';

export function ReminderCard({ draft }: { draft: ReminderDraft }) {
  const { lang } = useI18n();
  const bm = lang === 'bm';
  const push = usePushNotifications();
  const [message, setMessage] = useState(draft.message.slice(0, 500));
  const [time, setTime] = useState(() => reminderLocalTime(draft.dueAt));
  const [saved, setSaved] = useState<Reminder | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [pushResult, setPushResult] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    let live = true;
    reminderRequest(draft.id, 'GET').then(data => { if (live) setSaved(data.reminder); }).catch(e => {
      if (live && !(e instanceof ReminderError && e.status === 404)) { setError(bm ? 'Tidak dapat menyemak peringatan. Cuba semula.' : 'Could not check this reminder. Retry before saving.'); setUncertain(true); }
    }).finally(() => { if (live) setChecking(false); });
    return () => { live = false; };
  }, [draft.id, bm]);
  async function save() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const due = new Date(`${time.length === 16 ? `${time}:00` : time}+08:00`);
      if (!Number.isFinite(due.getTime()) || due.getTime() <= Date.now()) throw new ReminderError(bm ? 'Pilih masa akan datang.' : 'Choose a future date and time.', 400);
      const result = await reminderRequest(draft.id, 'POST', { id: draft.id, message, dueAt: due.toISOString(), timeZone: 'Asia/Kuala_Lumpur' });
      setSaved(result.reminder); setUncertain(false);
      setPushResult(result.push === 'subscribed'
        ? (bm ? 'Peranti berdaftar untuk push. Penghantaran bergantung pada sambungan dan tetapan peranti.' : 'Push device registered. Delivery depends on connectivity and device settings.')
        : (bm ? 'Push belum diaktifkan. Peringatan masih akan muncul dalam peti masuk notifikasi.' : 'Push is not enabled. Your reminder will still appear in the notification inbox.'));
    } catch (e) {
      const ambiguous = !(e instanceof ReminderError) || e.status === 0 || e.status >= 500;
      setUncertain(ambiguous);
      setError(ambiguous ? (bm ? 'Simpanan belum dapat disahkan. Semak status sebelum mencuba lagi.' : 'Save not confirmed. Check status before trying again.') : (e as Error).message);
    } finally { lock.current = false; setBusy(false); }
  }
  async function check() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { const result = await reminderRequest(draft.id, 'GET'); setSaved(result.reminder); setUncertain(false); }
    catch (e) { if (e instanceof ReminderError && e.status === 404) setUncertain(false); else setError(bm ? 'Semakan gagal. Cuba lagi.' : 'Status check failed. Try again.'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function cancel() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { const result = await reminderRequest(draft.id, 'DELETE'); setSaved(result.reminder); }
    catch { setUncertain(true); setError(bm ? 'Pembatalan belum disahkan. Semak status.' : 'Cancellation not confirmed. Check status.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="card mt-3 gap-3" aria-label={bm ? 'Peringatan' : 'Reminder'}>
    <strong>{saved ? (saved.status === 'scheduled' ? (bm ? 'Peringatan dijadualkan' : 'Reminder scheduled') : saved.status === 'sent' ? (bm ? 'Dihantar ke peti masuk notifikasi' : 'Sent to notification inbox') : (bm ? 'Peringatan dibatalkan' : 'Reminder cancelled')) : (bm ? 'Sahkan peringatan' : 'Confirm reminder')}</strong>
    {checking ? <p role="status">{bm ? 'Menyemak…' : 'Checking…'}</p> : saved ? <>
      <p>{saved.message}</p>
      <p className="text-sm text-text-muted">{new Date(saved.dueAt).toLocaleString(bm ? 'ms-MY' : 'en-GB', { timeZone: 'Asia/Kuala_Lumpur' })} · Asia/Kuala_Lumpur (UTC+8)</p>
      {saved.status === 'scheduled' && <button type="button" className="btn self-start" disabled={busy} onClick={cancel}>{bm ? 'Batalkan peringatan' : 'Cancel reminder'}</button>}
    </> : <form className="flex min-w-0 flex-col gap-3" onSubmit={e => { e.preventDefault(); void save(); }}>
      <p className="text-sm text-text-muted">{bm ? 'Sekali sahaja. Semak mesej dan pilih tarikh serta masa. Untuk peringatan berulang, gunakan Rutin.' : 'One-time reminder. Review the message and choose the date and time. For recurring reminders, use Routines.'}</p>
      <label className="flex flex-col gap-1">{bm ? 'Mesej' : 'Message'}<textarea className="w-full rounded-lg border border-border bg-bg-card p-2" value={message} maxLength={500} required disabled={busy || uncertain} onChange={e => setMessage(e.target.value)} /></label>
      <label className="flex min-w-0 flex-col gap-1">{bm ? 'Tarikh dan masa' : 'Date and time'}<input className="min-w-0 max-w-full rounded-lg border border-border bg-bg-card p-2" type="datetime-local" step="1" required value={time} disabled={busy || uncertain} onChange={e => setTime(e.target.value)} /></label>
      <p className="text-sm text-text-muted">{bm ? 'Penghantaran: peti masuk notifikasi dan push jika diaktifkan, bukan mesej chat.' : 'Delivery: notification inbox and push when enabled, not a chat message.'}</p>
      <p className="text-sm text-text-muted">Asia/Kuala_Lumpur (UTC+8) · {bm ? 'Disemak setiap minit, bukan penggera saat tepat.' : 'Checked every minute, not an exact-second alarm.'}</p>
      <button className="btn self-start" disabled={busy || uncertain} type="submit">{bm ? 'Sahkan peringatan' : 'Confirm reminder'}</button>
    </form>}
    <p className="text-sm text-text-muted">{pushResult || (push.state === 'on' ? (bm ? 'Langganan push dikesan pada peranti ini; pengesahan pelayan dibuat semasa menyimpan.' : 'Push subscription detected on this device; server registration is checked when saving.') : (bm ? 'Push tidak aktif pada peranti ini.' : 'Push is not active on this device.'))}</p>
    {push.state !== 'on' && <button type="button" className="btn self-start" disabled={push.busy} onClick={async () => {
      const result = await push.enable();
      setPushResult(result === 'on' ? (bm ? 'Push diaktifkan pada peranti ini.' : 'Push enabled on this device.') : (bm ? `Push belum diaktifkan (${result}).` : `Push not enabled (${result}).`));
    }}>{bm ? 'Aktifkan push' : 'Enable push'}</button>}
    {uncertain && <button type="button" className="btn self-start" disabled={busy} onClick={check}>{bm ? 'Semak status' : 'Check status'}</button>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
