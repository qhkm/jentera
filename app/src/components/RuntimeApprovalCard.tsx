import { useCallback, useEffect, useState } from 'react';
import { useT } from '@/i18n/I18nProvider';
const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

/**
 * The question Jentera is waiting on, and the two answers to it.
 *
 * The stream carries only an id, so this asks the API what is being approved
 * rather than trusting anything that arrived over the socket. That also makes
 * a reload work: the run outlives the tab, and the card rebuilds itself from
 * the same fetch.
 *
 * The tool name and its argument are model output. They are rendered as text,
 * never as markup, and the command sits in a `<code>` block so it reads as
 * something quoted rather than something the page is saying.
 */
export interface PendingApproval {
  id: string;
  tool: string;
  message: string;
  status: 'pending' | 'deciding' | 'approved' | 'denied' | 'expired';
  surface?: 'web' | 'telegram';
}

type Phase = 'loading' | 'ready' | 'deciding' | 'settled' | 'gone';

export function RuntimeApprovalCard({ approvalId, onDecided }: { approvalId: string; onDecided?: () => void }) {
  const t = useT();
  const [approval, setApproval] = useState<PendingApproval | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    setApproval(null);
    setProblem(null);
    (async () => {
      try {
        const response = await fetch(`${API}/api/runtime/approvals/${approvalId}`, {
          credentials: 'include',
        });
        if (cancelled) return;
        if (!response.ok) { setPhase('gone'); return; }
        const body = await response.json() as { approval: PendingApproval };
        if (cancelled) return;
        setApproval(body.approval);
        setPhase(body.approval.status === 'pending' ? 'ready' : 'settled');
      } catch {
        if (!cancelled) setPhase('gone');
      }
    })();
    return () => { cancelled = true; };
  }, [approvalId, attempt]);

  const decide = useCallback(async (decision: 'approve' | 'deny') => {
    setPhase('deciding');
    setProblem(null);
    try {
      const response = await fetch(`${API}/api/runtime/approvals/${approvalId}/decide`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      if (response.ok) {
        setApproval((current) => current && {
          ...current,
          status: decision === 'approve' ? 'approved' : 'denied',
        });
        setPhase('settled');
        onDecided?.();
        return;
      }
      /* 503 is the retryable one: the decision was released back to pending,
         so asking again is the right thing rather than a lost answer, and the
         problem line is what invites the second attempt. */
      if (response.status >= 500 || response.status === 401 || response.status === 403 || response.status === 429) {
        setProblem(t('ask.approval.retry'));
        setPhase('ready');
        return;
      }
      /* Anything else settles, and the settled note already says the request
         is no longer waiting. Setting `problem` here as well printed that
         same sentence twice, once under the other. */
      setPhase('settled');
    } catch {
      setProblem(t('ask.approval.retry'));
      setPhase('ready');
    }
  }, [approvalId, t, onDecided]);

  if (phase === 'loading') return null;
  if (phase === 'gone') {
    return <div className="ask-approval-note"><p>{t('task.approvalUnavailable')}</p>
      <button type="button" className="btn btn-outline" onClick={() => setAttempt((n) => n + 1)}>{t('loading.retry')}</button></div>;
  }

  const settled = phase === 'settled';
  return (
    <section className="ask-approval" aria-label={t('ask.approval.title')}>
      <p className="ask-approval-title">{t('ask.approval.title')}</p>
      <p className="ask-approval-tool">{approval?.tool}</p>
      <code className="ask-approval-command">{approval?.message}</code>
      {/* Said plainly, because "approve and run" invites the wrong mental
          model: this runs on Jentera's machine, not the owner's. */}
      <p className="ask-approval-where">{t('ask.approval.where')}</p>
      {approval?.surface === 'telegram' && !settled ? <p>{t('task.telegramApproval')}</p> : settled ? (
        <p className="ask-approval-note">
          {approval?.status === 'approved'
            ? t('ask.approval.approved')
            : approval?.status === 'denied'
              ? t('ask.approval.denied')
              : t('ask.approval.closed')}
        </p>
      ) : (
        <div className="ask-approval-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={phase === 'deciding'}
            onClick={() => void decide('approve')}
          >
            {t('ask.approval.approve')}
          </button>
          <button
            type="button"
            className="btn"
            disabled={phase === 'deciding'}
            onClick={() => void decide('deny')}
          >
            {t('ask.approval.deny')}
          </button>
        </div>
      )}
      {problem && <p className="ask-approval-problem" role="status">{problem}</p>}
    </section>
  );
}
