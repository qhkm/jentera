/* ============================================================
   Connecting a service with a token the owner already has.

   The alternative is an interactive login, and Jentera cannot complete
   one: it opens a browser on Jentera's own machine, which the owner has
   no way to see, so it waits for a click that never comes. A token has
   no such problem — and it is the safer grant, being limited to what the
   owner ticked and revocable from the provider without asking us.

   Deliberately quiet. Most owners will never need this; it sits under
   the connections they do use rather than competing with them.
   ============================================================ */

import { useEffect, useState } from 'react';
import { Button, Card, Eyebrow, Input, Tag } from '@/components/ui';
import { useRepository } from '@/lib/repo';
import type { ConnectionsState } from '@/hooks/useConnections';
import { useT } from '@/i18n/I18nProvider';
import { permitsTokenConnector } from '@/lib/connector-catalogue';
import type { TokenConnectorOption } from '@/lib/repo/types';

/** `#connection-tokens-bukku` → `bukku`. Any other fragment means the card
    was reached on its own, so nothing is preselected. */
function connectorFromHash(): string {
  if (typeof window === 'undefined') return '';
  const match = /^#connection-tokens-([a-z0-9-]+)$/i.exec(window.location.hash);
  return match ? match[1].toLowerCase() : '';
}

export default function TokenConnect({ rows, setRows, connector, id }: Pick<ConnectionsState, 'rows' | 'setRows'> & { connector?: string; id?: string }) {
  const repo = useRepository();
  const t = useT();
  const [catalogue, setCatalogue] = useState<TokenConnectorOption[]>([]);
  const [chosen, setChosen] = useState('');
  const [token, setToken] = useState('');
  /* The second value some providers need beside the token. Not a secret —
     Bukku sends the company subdomain as a header on every request — so it
     is a plain field, and it is cleared when the service changes rather
     than carried to one that means something different by it. */
  const [account, setAccount] = useState('');
  const [busy, setBusy] = useState(false);
  /* Which service the owner clicked, carried in the fragment. Every
     connector's Connect button used to point at this one card, which then
     offered whichever service happened to sort first — so asking for Bukku
     landed on a form for Cloudflare. */
  const [asked, setAsked] = useState(() => connectorFromHash());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    repo.tokenConnectors()
      .then((list) => {
        if (cancelled) return;
        const available = list.filter(item => permitsTokenConnector(item.connector) && (!connector || item.connector === connector));
        setCatalogue(available);
        setChosen((current) => {
          const wanted = available.find(item => item.connector.toLowerCase() === asked);
          if (wanted) return wanted.connector;
          return available.some(item => item.connector === current) ? current : available[0]?.connector || '';
        });
      })
      /* Nothing to offer is a normal state, not an error to report: the
         local repository has no provider to verify against. */
      .catch(() => { if (!cancelled) setCatalogue([]); });
    return () => { cancelled = true; };
  }, [repo, connector, asked]);

  useEffect(() => {
    const onHash = () => setAsked(connectorFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (!catalogue.length) return null;

  const entry = catalogue.find((item) => item.connector === chosen);
  const needsAccount = Boolean(entry?.account);
  const ready = Boolean(token.trim()) && (!needsAccount || Boolean(account.trim()));

  const connected = (rows ?? []).filter((row) =>
    catalogue.some((entry) => entry.connector === row.connector));

  async function connect() {
    if (!chosen || !ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const connection = await repo.connectToken(chosen, token.trim(), account.trim() || undefined);
      setRows((prev) => [connection, ...(prev ?? []).filter((r) => r.id !== connection.id)]);
      /* Cleared on success. A live token has no reason to stay in a form
         field, where a screenshot or a shoulder would find it. */
      setToken('');
      setAccount('');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('connect.token.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card id={id} tabIndex={id ? -1 : undefined} className="gap-4">
      {catalogue.map((option) => (
        <span key={option.connector} id={`connection-tokens-${option.connector.toLowerCase()}`} aria-hidden="true" />
      ))}
      <div className="flex flex-col gap-1">
        <Eyebrow>{t('connect.token.title')}</Eyebrow>
        <p className="max-w-[66ch] text-[13px] text-text-secondary">
          {t('connect.token.desc')}
        </p>
      </div>

      {connected.length > 0 && (
        <ul className="flex flex-col gap-2">
          {connected.map((row) => (
            <li key={row.id} className="flex items-center gap-2 text-sm">
              <Tag tone={row.status === 'connected' ? 'green' : 'amber'}>{row.connector}</Tag>
              <span className="text-text-secondary">{row.displayName}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1 text-[13px]">
          <span className="text-text-secondary">{t('connect.token.service')}</span>
          <select
            className="input"
            value={chosen}
            onChange={(e) => { setChosen(e.target.value); setAccount(''); }}
          >
            {catalogue.map((entry) => (
              <option key={entry.connector} value={entry.connector}>{entry.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-[13px]">
          <span className="text-text-secondary">{t('connect.token.field')}</span>
          <Input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={t('connect.token.placeholder')}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        {entry?.account && (
          <label className="flex flex-col gap-1 text-[13px]">
            <span className="text-text-secondary">{entry.account.label}</span>
            <Input
              type="text"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-describedby={`${id ?? 'token'}-account-hint`}
            />
          </label>
        )}
        <Button onClick={connect} disabled={!ready || busy}>
          {busy ? t('connect.token.checking') : t('connect.token.connect')}
        </Button>
      </div>

      {/* Said plainly, because a token is a thing an owner can over-grant
          without noticing. */}
      {entry?.account && (
        <p id={`${id ?? 'token'}-account-hint`} className="max-w-[66ch] text-[12px] text-text-muted">
          {entry.account.hint}
        </p>
      )}
      <p className="max-w-[66ch] text-[12px] text-text-muted">{t('connect.token.scope')}</p>
      {error && <p className="text-[13px] text-red-500" role="alert">{error}</p>}
    </Card>
  );
}
