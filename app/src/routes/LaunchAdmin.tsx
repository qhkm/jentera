import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { JenteraMark } from '@/components/JenteraMark';

const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
type Person = { email: string; joined_at: string | null; invited_at: string | null; redeemed_at: string | null; trial_expires_at: string | null; access_kind: string | null; access_expires_at: string | null; revoked_at: string | null; firstCompletedRequest: string | null };
type Launch = { totals: { waitlist: number; invited: number; redeemed: number; active: number }; rows: Person[]; hasMore: boolean };
const date = (value: string | null) => value ? new Date(value).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium', timeStyle: 'short' }) : '—';

export default function LaunchAdmin() {
  const [data, setData] = useState<Launch | null>(null);
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [email, setEmail] = useState('');
  const [invite, setInvite] = useState<{ email: string; code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
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
  return <main className="mx-auto min-h-dvh max-w-4xl px-4 py-6 text-text">
    <header className="mb-8 flex items-center justify-between gap-4"><Link to="/app" className="flex items-center gap-2"><JenteraMark size={32} />Back to Jentera</Link><span className="text-xs text-text-muted">ADMIN ONLY</span></header>
    <h1 className="text-3xl font-semibold">Launch centre</h1>
    {denied ? <p className="mt-6" role="alert">This page is available only to the launch administrator. <Link to="/signin" className="text-brand">Sign in</Link></p> : <>
      <p className="mt-2 text-sm text-text-secondary">Waitlist, invitations and trial activation. Dates are in Malaysia time.</p>
      {data && <div className="my-6 grid grid-cols-2 gap-3 sm:grid-cols-4">{Object.entries(data.totals).map(([label, count]) => <div className="rounded-xl border border-border p-4" key={label}><strong className="block text-2xl text-brand">{count}</strong><span className="text-sm capitalize text-text-secondary">{label === 'active' ? 'Active trials' : label === 'invited' ? 'People with codes' : label}</span></div>)}</div>}
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
        <button className="btn" onClick={() => { void navigator.clipboard.writeText(`Sign in to Jentera, then open https://jentera.ai/access?invite=1\nYour code: ${invite.code}\nUse the account ${invite.email}. Redeem by ${date(invite.expiresAt)} MYT. Your 3-day trial starts when you redeem.`).then(() => setCopied(true)).catch(() => setError('Could not copy. Select the code and copy it manually.')); }}>{copied ? 'Copied' : 'Copy invitation'}</button>
        <button className="btn" onClick={() => setInvite(null)}>Hide code</button>
      </section>}
      <div className="my-4 flex items-center justify-between"><h2 className="text-lg font-medium">People</h2><button className="btn" onClick={() => setRefresh(value => value + 1)}>Refresh</button></div>
      {!data && !error && <p role="status">Loading launch data…</p>}
      {data?.rows.length === 0 && <p className="py-6 text-text-secondary">No waitlist signups or invitations yet.</p>}
      <div className="grid gap-3">{data?.rows.map(person => <article key={person.email} className="rounded-xl border border-border p-4">
        <h3 className="break-all font-medium">{person.email}</h3>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">{[
          ['Joined waitlist', date(person.joined_at)], ['Last code created', date(person.invited_at)],
          ['Trial redeemed', date(person.redeemed_at)], ['Trial ends', date(person.trial_expires_at)],
          ['First completed request', date(person.firstCompletedRequest)],
          ['Access', person.revoked_at ? 'Revoked' : person.access_kind && (!person.access_expires_at || Date.parse(person.access_expires_at) > Date.now()) ? person.access_kind : 'No active grant'],
        ].map(([label, value]) => <div key={label}><dt className="text-text-muted">{label}</dt><dd>{value}</dd></div>)}</dl>
        <button className="btn mt-3" disabled={!!person.redeemed_at} onClick={() => { setEmail(person.email); window.scrollTo({ top: 0, behavior: 'instant' }); }}>Prepare invitation</button>
      </article>)}</div>
      <p className="my-4 text-xs text-text-muted">“First completed request” means a chat request finished after trial redemption—not a verified business outcome. Creating a code does not mean an invitation was sent.</p>
      {data && <nav className="flex justify-between gap-3" aria-label="People pages"><button className="btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous</button><button className="btn" disabled={!data.hasMore} onClick={() => setOffset(offset + 25)}>Next</button></nav>}
    </>}
    {error && <p className="mt-4" role="alert">{error}</p>}
  </main>;
}
