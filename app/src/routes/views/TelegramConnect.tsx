/* ============================================================
   Connecting the business's private Telegram agent.

   Their bot, not ours. One private owner chat is paired after the token
   is saved; a public bot username alone never grants access to internal
   business memory or tools.

   The cost is that the owner has to make one, so the walkthrough is
   part of the screen rather than a link to documentation. Four steps,
   in the order Telegram actually presents them.
   ============================================================ */

import { useEffect, useState } from 'react';
import { Button, Card, Eyebrow, Input, LoadingState, Tag } from '@/components/ui';
import { useRepository } from '@/lib/repo';
import type { Connection } from '@/lib/repo';
import type { ConnectionsState } from '@/hooks/useConnections';

const STEPS = [
  'Open Telegram and message @BotFather',
  'Send /newbot, then pick a name and a username for it',
  'BotFather replies with a token that looks like 123456789:AA…',
  'Paste that token below',
];

function statusTone(c: Connection) {
  if (c.status === 'connected' && c.paired) return 'green' as const;
  return c.status === 'error' ? 'red' as const : 'amber' as const;
}

/* Rows come from the screen rather than from here, so the tab badge
   and this card cannot disagree about what is connected. */
export default function TelegramConnect({ rows, setRows }: Pick<ConnectionsState, 'rows' | 'setRows'>) {
  const repo = useRepository();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const [health, setHealth] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  /* Pairing happens in Telegram, outside this tab. Poll only while a row is
     waiting so returning to the browser turns the card green without asking
     the owner to reload or understand two separate states. */
  useEffect(() => {
    if (!(rows ?? []).some((row) => row.connector === 'telegram' && !row.paired)) return;
    const timer = window.setInterval(() => {
      void repo.connections().then(setRows).catch(() => {});
    }, 3000);
    return () => window.clearInterval(timer);
  }, [repo, rows, setRows]);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const c = await repo.connectTelegram(token.trim());
      setRows((prev) => [c, ...(prev ?? []).filter((r) => r.id !== c.id)]);
      // Cleared immediately on success: there is no reason for a live
      // bot token to sit in a form field afterwards.
      setToken('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not connect that bot.');
    } finally {
      setBusy(false);
    }
  }

  /* Telegram's own answer to "I messaged it and nothing happened".
     Without this the owner cannot tell a bot they never messaged from
     one whose webhook is pointing at the wrong place — both look like
     silence. */
  async function check(id: string) {
    setChecking(id);
    try {
      const h = await repo.connectionHealth(id);
      setHealth((prev) => ({
        ...prev,
        [id]: !h.pointsHere
          ? 'Telegram is sending messages somewhere else. Disconnect and connect again.'
          : h.lastError
            ? `Telegram could not reach us: ${h.lastError}`
            : h.pending > 0
              ? `${h.pending} message${h.pending === 1 ? '' : 's'} waiting to come through.`
              : 'Receiving normally. Send your bot a message to try it.',
      }));
    } catch (e) {
      setHealth((prev) => ({
        ...prev,
        [id]: e instanceof Error ? e.message : 'Could not check.',
      }));
    } finally {
      setChecking(null);
    }
  }

  async function drop(id: string) {
    setRows((prev) => (prev ?? []).filter((r) => r.id !== id));
    await repo.disconnect(id).catch(() => setRows(null));
  }

  const telegram = (rows ?? []).filter((r) => r.connector === 'telegram');

  return (
    <Card>
      <Eyebrow>Telegram</Eyebrow>

      {telegram.length > 0 ? (
        <div className="mt-2 flex flex-col">
          {telegram.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-rail py-3 last:border-b-0"
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-sm">{c.displayName ?? 'Telegram bot'}</span>
                {c.lastError && (
                  <span className="text-[12px] text-text-secondary">{c.lastError}</span>
                )}
                {health[c.id] && (
                  <span className="text-[12px] text-text-secondary">{health[c.id]}</span>
                )}
                {checking === c.id ? (
                  <span role="status" className="text-[12px] text-text-secondary">
                    Checking the webhook and recent delivery status…
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Tag tone={statusTone(c)}>
                  {c.status === 'connected' && !c.paired ? 'pair owner' : c.status}
                </Tag>
                {!c.paired && c.pairingUrl ? (
                  <a
                    className="btn btn-primary"
                    href={c.pairingUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open in Telegram
                  </a>
                ) : null}
                <Button variant="ghost" onClick={() => void check(c.id)}>
                  {checking === c.id ? 'Checking…' : 'Test'}
                </Button>
                <Button variant="ghost" onClick={() => void drop(c.id)}>
                  Disconnect
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <p className="mt-2 text-sm text-text-secondary">
            Chat privately with Jentera about your own business. The bot works for you and your team,
            not as a public customer-support agent.
          </p>
          <ol className="mt-3 flex list-decimal flex-col gap-1 pl-5 text-[13px] text-text-secondary">
            {STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Input
              className="min-w-[14rem] flex-1"
              placeholder="123456789:AA…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              aria-label="Your bot token"
              // Not `password`: the owner is pasting and should be able
              // to see they pasted the right thing. It is cleared the
              // moment it is saved, and never shown back afterwards.
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
            <Button onClick={() => void connect()} disabled={busy || !token.trim()}>
              {busy ? 'Securing bot…' : 'Connect'}
            </Button>
          </div>
          {busy ? (
            <LoadingState
              compact
              className="mt-3"
              title="Checking your Telegram bot…"
              detail="Verifying the token and securing its private webhook. The token is cleared after it is saved."
            />
          ) : null}
          {error && (
            <p role="alert" className="mt-3 text-sm text-text-secondary">
              {error}
            </p>
          )}
          <p className="mt-3 text-[12px] text-text-muted">
            After connecting, open the secure pairing link once from your Telegram account. Only
            that private chat can access your business agent.
          </p>
        </>
      )}
    </Card>
  );
}
