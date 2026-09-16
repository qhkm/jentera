import { useCallback, useEffect, useState } from 'react';
import { useT } from '@/i18n/I18nProvider';
import { HumanApprovalCard, type HumanApprovalStatus } from './HumanApprovalCard';

const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

interface VaultApproval {
  id: string;
  reason: string;
  resource: string;
  operations: string[];
  status: Exclude<HumanApprovalStatus, 'deciding'>;
  requestedAt: string;
  expiresAt: string;
  decidedAt: string | null;
}

type Phase = 'loading' | 'ready' | 'deciding' | 'settled' | 'gone';

function destination(resource: string): string {
  try { return new URL(resource).hostname; } catch { return resource; }
}

export function VaultApprovalCard({ approvalId, onDecided }: { approvalId: string; onDecided?: () => void }) {
  const t = useT();
  const [approval, setApproval] = useState<VaultApproval | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    setApproval(null);
    setProblem(null);
    void fetch(`${API}/api/vault/approvals/${approvalId}`, { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error('unavailable');
        return response.json() as Promise<{ approval: VaultApproval }>;
      })
      .then((body) => {
        if (cancelled) return;
        setApproval(body.approval);
        setPhase(body.approval.status === 'pending' ? 'ready' : 'settled');
      })
      .catch(() => { if (!cancelled) setPhase('gone'); });
    return () => { cancelled = true; };
  }, [approvalId, attempt]);

  const decide = useCallback(async (decision: 'approve' | 'deny') => {
    setPhase('deciding');
    setProblem(null);
    try {
      const response = await fetch(`${API}/api/vault/approvals/${approvalId}/decide`, {
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
      if (response.status >= 500 || response.status === 401 || response.status === 403 || response.status === 429) {
        setProblem(t('ask.approval.retry'));
        setPhase('ready');
        return;
      }
      setPhase('settled');
    } catch {
      setProblem(t('ask.approval.retry'));
      setPhase('ready');
    }
  }, [approvalId, onDecided, t]);

  if (phase === 'loading') return null;
  const expires = approval?.expiresAt
    ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(approval.expiresAt))
    : '';
  const status = phase === 'deciding' ? 'deciding' : approval?.status ?? 'expired';
  return (
    <HumanApprovalCard
      title={t('vault.approval.title')}
      eyebrow={t('vault.approval.eyebrow')}
      summary={approval?.reason ?? ''}
      facts={[
        { label: t('vault.approval.action'), value: approval?.operations.join(', ') ?? '' },
        { label: t('vault.approval.destination'), value: destination(approval?.resource ?? '') },
        { label: t('vault.approval.expires'), value: expires },
      ]}
      disclosure={t('vault.approval.disclosure')}
      status={status}
      statusLabel={t(`ask.approval.status.${status}`)}
      unavailable={phase === 'gone' ? t('task.approvalUnavailable') : undefined}
      retryLabel={t('loading.retry')}
      approveLabel={t('ask.approval.approve')}
      denyLabel={t('ask.approval.deny')}
      approvedLabel={t('ask.approval.approved')}
      deniedLabel={t('ask.approval.denied')}
      closedLabel={t('ask.approval.closed')}
      problem={problem}
      onRetry={() => setAttempt((n) => n + 1)}
      onDecision={(decision) => void decide(decision)}
    />
  );
}
