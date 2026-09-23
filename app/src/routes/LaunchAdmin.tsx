import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { JenteraMark } from '@/components/JenteraMark';
import { Button } from '@/components/ui';

const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
type Person = {
  email: string;
  joined_at: string | null;
  invited_at: string | null;
  redeemed_at: string | null;
  trial_expires_at: string | null;
  access_kind: string | null;
  access_expires_at: string | null;
  revoked_at: string | null;
  onboardingCompletedAt: string | null;
  computerReadyAt: string | null;
  installedAppOpenedAt: string | null;
  pushEnabledAt: string | null;
  lastPushAcceptedAt: string | null;
  firstCompletedRequest: string | null;
  firstReminderScheduledAt: string | null;
  firstReminderDeliveredAt: string | null;
  firstReminderPushAcceptedAt: string | null;
  lastPushIssue: string | null;
};
type Launch = { totals: { waitlist: number; invited: number; redeemed: number; active: number }; rows: Person[]; hasMore: boolean };
const date = (value?: string | null) => value ? new Date(value).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium', timeStyle: 'short' }) : '—';

export default function LaunchAdmin() {
  const [data, setData] = useState<Launch | null>(null);
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [email, setEmail] = useState('');
  const [invite, setInvite] = useState<{ email: string; code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState({ key: '', subject: '', text: '' });
  const [preview, setPreview] = useState<{ recipients: number; remaining: number } | null>(null);
  const [delivery, setDelivery] = useState<{ sent: number; failed: number; remaining: number } | null>(null);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const activation = data ? [
    ['Trial claimed', data.rows.filter(person => person.redeemed_at).length],
    ['Onboarding done', data.rows.filter(person => person.onboardingCompletedAt).length],
    ['Computer ready', data.rows.filter(person => person.computerReadyAt).length],
    ['Installed app opened', data.rows.filter(person => person.installedAppOpenedAt).length],
    ['Push enabled', data.rows.filter(person => person.pushEnabledAt).length],
    ['First task done', data.rows.filter(person => person.firstCompletedRequest).length],
    ['Reminder scheduled', data.rows.filter(person => person.firstReminderScheduledAt).length],
    ['Reminder push accepted', data.rows.filter(person => person.firstReminderPushAcceptedAt).length],
  ] as const : [];
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError('');
    fetch(`${API}/api/admin/launch?offset=${offset}`, { credentials: 'include', signal: controller.signal }).then(async res => {
      if (res.status === 404 || res.status === 401 || res.status === 403) { setDenied(true); return; }
      if (!res.ok) throw new Error('Could not load launch data. Try refreshing.');
      setDenied(false); setData(await res.json());
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [offset, refresh]);
  async function create(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(''); setInvite(null); setCopied(false);
    try {
      const res = await fetch(`${API}/api/admin/launch/invites`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.err || 'Could not create the code.');
      setInvite(body); setRefresh(value => value + 1);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create the code.'); }
    finally { setBusy(false); }
  }
  /* An edit invalidates the preview, so the count on the send button is
     always the count for the message about to go out. */
  function edit(field: 'key' | 'subject' | 'text', value: string) {
    setNotice(current => ({ ...current, [field]: value }));
    setPreview(null); setDelivery(null);
  }
  async function announce(dryRun: boolean) {
    if (busy) return;
    setBusy(true); setError(''); if (dryRun) setDelivery(null);
    try {
      const res = await fetch(`${API}/api/admin/launch/announce`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...notice, dryRun }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.err || 'Could not reach the waiting list.');
      if (dryRun) setPreview({ recipients: body.recipients, remaining: body.remaining });
      else { setDelivery({ sent: body.sent, failed: body.failed, remaining: body.remaining }); setPreview(null); }
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not reach the waiting list.'); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto min-h-dvh max-w-4xl px-4 py-6 text-text">
    <header className="mb-8 flex items-center justify-between gap-4"><Link to="/app" className="flex items-center gap-2"><JenteraMark size={32} />Back to Jentera</Link><span className="text-xs text-text-muted">ADMIN ONLY</span></header>
    <h1 className="text-3xl font-semibold">Launch centre</h1>
    {denied ? <p className="mt-6" role="alert">This page is available only to the launch administrator. <Link to="/signin" className="text-brand">Sign in</Link></p> : <>
      <p className="mt-2 text-sm text-text-secondary">Waitlist, invitations and trial activation. Dates are in Malaysia time.</p>
      {data && <div className="my-6 grid grid-cols-2 gap-3 sm:grid-cols-4">{Object.entries(data.totals).map(([label, count]) => <div className="rounded-xl border border-border p-4" key={label}><strong className="block text-2xl text-brand">{count}</strong><span className="text-sm capitalize text-text-secondary">{label === 'active' ? 'Active trials' : label === 'invited' ? 'People with codes' : label}</span></div>)}</div>}
      {data && <section className="my-6" aria-labelledby="activation-funnel-title">
        <div className="mb-3"><h2 id="activation-funnel-title" className="text-lg font-medium">Activation funnel</h2><p className="mt-1 text-xs text-text-muted">People on this page. Green means the server observed the milestone—not that somebody merely clicked a button. Installed-app opens respect browser privacy opt-outs and may be undercounted.</p></div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{activation.map(([label, count]) => <div className="rounded-xl bg-bg-card p-3" key={label}><strong className="block text-xl text-brand">{count}</strong><span className="text-xs text-text-secondary">{label}</span></div>)}</div>
      </section>}
      {data && <form onSubmit={event => void create(event)} className="my-6 grid gap-3 rounded-xl border border-border p-4">
        <h2 className="text-lg font-medium">Create a trial invitation</h2><p className="text-sm text-text-secondary">Email-bound. Redeem within 7 days; trial lasts 3 days from redemption. This does not send an email or grant paid access.</p>
        <label className="grid gap-2 text-sm">Recipient email<input className="input w-full" type="email" required maxLength={320} value={email} onChange={e => setEmail(e.target.value)} disabled={busy} /></label>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create trial code'}</button>
      </form>}
      {invite && <section className="my-6 grid gap-3 rounded-xl border border-brand p-4" aria-label="New trial code">
        <h2 className="font-medium">Code for {invite.email}</h2><p className="text-sm text-text-secondary">Copy now—this code cannot be retrieved later. No email has been sent.</p>
        <code className="select-all break-all rounded-lg bg-bg-card p-3">{invite.code}</code>
        <p className="text-sm">Redeem by {date(invite.expiresAt)} MYT</p>
        <p className="text-sm text-text-secondary">Ask the recipient to sign in, then open <Link className="text-brand" to="/access?invite=1">the invite redemption page</Link>.</p>
        <Button onClick={() => { void navigator.clipboard.writeText(`Sign in to Jentera, then open https://jentera.ai/access?invite=1\nYour code: ${invite.code}\nUse the account ${invite.email}. Redeem by ${date(invite.expiresAt)} MYT. Your 3-day trial starts when you redeem.`).then(() => setCopied(true)).catch(() => setError('Could not copy. Select the code and copy it manually.')); }}>{copied ? 'Copied' : 'Copy invitation'}</Button>
        <Button variant="outline" onClick={() => setInvite(null)}>Hide code</Button>
      </section>}
      {data && <section className="my-6 grid gap-3 rounded-xl border border-border p-4" aria-labelledby="announcement-title">
        <h2 id="announcement-title" className="text-lg font-medium">Email the waiting list</h2>
        <p className="text-sm text-text-secondary">Plain text, from hello@jentera.ai, one message per address. The key is how a person is remembered as having had this announcement—reuse it to reach only whoever was added since, change it to start a new one. Every message carries an unsubscribe address.</p>
        <label className="grid gap-2 text-sm">Announcement key<input className="input w-full" required maxLength={64} pattern="[a-z0-9][a-z0-9-]*" placeholder="launch-week" value={notice.key} onChange={e => edit('key', e.target.value)} disabled={busy} /></label>
        <label className="grid gap-2 text-sm">Subject<input className="input w-full" required maxLength={150} value={notice.subject} onChange={e => edit('subject', e.target.value)} disabled={busy} /></label>
        <label className="grid gap-2 text-sm">Message<textarea className="input min-h-40 w-full" required maxLength={4000} value={notice.text} onChange={e => edit('text', e.target.value)} disabled={busy} /></label>
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="outline" disabled={busy || !notice.key || !notice.subject || !notice.text} onClick={() => void announce(true)}>{busy && !preview ? 'Checking…' : 'Preview recipients'}</Button>
          {preview && <button type="button" className="btn btn-primary" disabled={busy || preview.recipients === 0} onClick={() => void announce(false)}>{busy ? 'Sending…' : `Send to ${preview.recipients} ${preview.recipients === 1 ? 'person' : 'people'}`}</button>}
        </div>
        {preview && <p className="text-sm" role="status">{preview.recipients} people have not had this announcement. Nothing has been sent yet.{preview.remaining > 0 && ` ${preview.remaining} more will wait for a second run.`}</p>}
        {delivery && <p className="text-sm" role="status">Sent to {delivery.sent}.{delivery.failed > 0 && ` ${delivery.failed} were refused and stay unmarked—run it again to reach them.`}{delivery.remaining > 0 && ` ${delivery.remaining} still waiting; run it again.`}</p>}
      </section>}
      <div className="my-4 flex items-center justify-between"><h2 className="text-lg font-medium">People</h2><Button variant="outline" onClick={() => setRefresh(value => value + 1)}>Refresh</Button></div>
      {!data && !error && <p role="status">Loading launch data…</p>}
      {data?.rows.length === 0 && <p className="py-6 text-text-secondary">No waitlist signups or invitations yet.</p>}
      <div className="grid gap-3">{data?.rows.map(person => {
        const journey = [
          ['Claimed invite', person.redeemed_at],
          ['Finished onboarding', person.onboardingCompletedAt],
          ['Computer ready', person.computerReadyAt],
          ['Opened installed app', person.installedAppOpenedAt],
          ['Enabled push', person.pushEnabledAt],
          ['Completed first task', person.firstCompletedRequest],
          ['Scheduled reminder', person.firstReminderScheduledAt],
          ['Reminder reached inbox', person.firstReminderDeliveredAt],
          ['Reminder accepted by push service', person.firstReminderPushAcceptedAt],
        ] as const;
        return <article key={person.email} className="rounded-xl border border-border p-4">
        <h3 className="break-all font-medium">{person.email}</h3>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">{[
          ['Joined waitlist', date(person.joined_at)], ['Last code created', date(person.invited_at)],
          ['Trial redeemed', date(person.redeemed_at)], ['Trial ends', date(person.trial_expires_at)],
          ['Access', person.revoked_at ? 'Revoked' : person.access_kind && (!person.access_expires_at || Date.parse(person.access_expires_at) > Date.now()) ? person.access_kind : 'No active grant'],
        ].map(([label, value]) => <div key={label}><dt className="text-text-muted">{label}</dt><dd>{value}</dd></div>)}</dl>
        <h4 className="mt-4 text-sm font-medium">Journey</h4>
        <ol className="mt-2 grid gap-2 sm:grid-cols-2">{journey.map(([label, value]) => <li className="flex min-w-0 gap-2 rounded-lg bg-bg-card px-3 py-2" key={label}>
          <span className={`mt-1.5 size-2 shrink-0 rounded-full ${value ? 'bg-brand' : 'bg-text-muted/30'}`} aria-hidden="true" />
          <span className="min-w-0"><strong className="block text-sm font-normal">{label}</strong><span className="block text-xs text-text-muted">{date(value)}</span></span>
        </li>)}</ol>
        {person.lastPushAcceptedAt && <p className="mt-3 text-xs text-text-muted">Last push accepted by a device service: {date(person.lastPushAcceptedAt)}</p>}
        {person.lastPushIssue && <p className="mt-2 rounded-lg border border-danger/40 px-3 py-2 text-xs text-danger">Latest push retry issue: {person.lastPushIssue}</p>}
        <Button variant="outline" className="mt-3" disabled={!!person.redeemed_at} onClick={() => { setEmail(person.email); window.scrollTo({ top: 0, behavior: 'instant' }); }}>Prepare invitation</Button>
      </article>})}</div>
      <p className="my-4 text-xs text-text-muted">“First task done” means a chat request finished after trial redemption—not a verified business outcome. “Push accepted” means the device’s push service accepted delivery; browsers provide no proof that a person saw it. Creating a code does not mean an invitation was sent.</p>
      {data && <nav className="flex justify-between gap-3" aria-label="People pages"><Button variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous</Button><Button variant="outline" disabled={!data.hasMore} onClick={() => setOffset(offset + 25)}>Next</Button></nav>}
    </>}
    {error && <p className="mt-4" role="alert">{error}</p>}
  </main>;
}
