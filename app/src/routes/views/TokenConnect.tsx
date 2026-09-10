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

export default function TokenConnect({ rows, setRows }: Pick<ConnectionsState, 'rows' | 'setRows'>) {
  const repo = useRepository();
  const t = useT();
  const [catalogue, setCatalogue] = useState<{ connector: string; label: string }[]>([]);
  const [chosen, setChosen] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    repo.tokenConnectors()
      .then((list) => {
        if (cancelled) return;
        setCatalogue(list);
        setChosen((current) => current || list[0]?.connector || '');
      })
      /* Nothing to offer is a normal state, not an error to report: the
         local repository has no provider to verify against. */
      .catch(() => { if (!cancelled) setCatalogue([]); });
    return () => { cancelled = true; };
  }, [repo]);

  if (!catalogue.length) return null;

  const connected = (rows ?? []).filter((row) =>
    catalogue.some((entry) => entry.connector === row.connector));

  async function connect() {
    if (!chosen || !token.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const connection = await repo.connectToken(chosen, token.trim());
      setRows((prev) => [connection, ...(prev ?? []).filter((r) => r.id !== connection.id)]);
      /* Cleared on success. A live token has no reason to stay in a form
         field, where a screenshot or a shoulder would find it. */
      setToken('');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('connect.token.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="gap-4">
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
            onChange={(e) => setChosen(e.target.value)}
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
        <Button onClick={connect} disabled={!token.trim() || busy}>
          {busy ? t('connect.token.checking') : t('connect.token.connect')}
        </Button>
      </div>

      {/* Said plainly, because a token is a thing an owner can over-grant
          without noticing. */}
      <p className="max-w-[66ch] text-[12px] text-text-muted">{t('connect.token.scope')}</p>
      {error && <p className="text-[13px] text-red-500" role="alert">{error}</p>}
    </Card>
  );
}
