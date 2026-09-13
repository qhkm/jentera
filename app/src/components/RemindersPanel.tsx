import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { useSignedIn } from '@/lib/repo/gate';
import { listReminders, reminderRequest, type Reminder } from '@/lib/reminders';

/** A server-backed list keeps reminders manageable after chat history is cleared. */
export function RemindersPanel({ active }: { active: boolean }) {
  const signedIn = useSignedIn();
  const { lang } = useI18n();
  const bm = lang === 'bm';
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Reminder[]>([]);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!signedIn || !active || !open) return;
    let live = true;
    setBusy(true); setError(false);
    listReminders().then(items => { if (live) setRows(items); }).catch(() => { if (live) setError(true); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [signedIn, active, open, revision]);
  if (!signedIn) return null;
  return <section className="card gap-3">
    <button type="button" className="text-left font-semibold" aria-expanded={open} onClick={() => setOpen(!open)}>{bm ? 'Peringatan peribadi saya' : 'My personal reminders'}</button>
    {open && <>
      <p className="text-sm text-text-muted">{bm ? 'Peringatan sekali sahaja yang disahkan dalam chat. Asia/Kuala_Lumpur (UTC+8).' : 'One-time reminders confirmed in chat. Asia/Kuala_Lumpur (UTC+8).'}</p>
      {busy && <p role="status">{bm ? 'Memuatkan…' : 'Loading…'}</p>}
      {error && <p role="alert">{bm ? 'Tidak dapat mengesahkan status. Muat semula sebelum mencuba lagi.' : 'Could not confirm status. Refresh before trying again.'}</p>}
      <button type="button" className="btn self-start" disabled={busy} onClick={() => setRevision(n => n + 1)}>{bm ? 'Muat semula' : 'Refresh reminders'}</button>
      {!busy && !error && rows.length === 0 && <p>{bm ? 'Tiada peringatan akan datang.' : 'No upcoming reminders.'}</p>}
      {!error && rows.map(row => <div key={row.id} className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
        <div className="min-w-0 flex-1"><p className="break-words">{row.message}</p><p className="text-sm text-text-muted">{new Date(row.dueAt).toLocaleString(bm ? 'ms-MY' : 'en-GB', { timeZone: 'Asia/Kuala_Lumpur' })}</p></div>
        <button type="button" className="btn" disabled={busy} onClick={async () => {
          setBusy(true);
          try { await reminderRequest(row.id, 'DELETE'); setRevision(n => n + 1); }
          catch { setError(true); }
          finally { setBusy(false); }
        }}>{bm ? 'Batalkan' : 'Cancel'}</button>
      </div>)}
    </>}
  </section>;
}
