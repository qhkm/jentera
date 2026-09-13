import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { useMutate, useRepository, useSnapshot } from '@/lib/repo';
import { confirmedValue, hasConfirmedValue } from '@/lib/knowledge';
import { onboardingCopy } from '@/lib/onboarding-copy';
import { ArtifactList } from '@/components/ArtifactList';
import { LiveTaskProgress } from '@/components/LiveTaskProgress';
import { renderReplyMarkdown } from '@/lib/reply-markdown';
import type { AskAnswer } from '@/lib/repo/types';

export function FirstJob({ ready }: { ready: boolean }) {
  const { lang } = useI18n(); const c = onboardingCopy[lang];
  const repo = useRepository(); const mutate = useMutate(); const snap = useSnapshot(); const navigate = useNavigate();
  const context = snap.facts.filter(hasConfirmedValue).map(f => String(confirmedValue(f) ?? '')).join(' ');
  const workshop = /workshop|training|bengkel|latihan/i.test(context);
  const choices = [
    { label: c.content, prompt: c.contentPrompt, outcome: c.contentOutcome },
    { label: workshop ? c.workshop : c.reply, prompt: workshop ? c.workshopPrompt : c.replyPrompt, outcome: workshop ? c.workshopOutcome : c.replyOutcome },
    { label: c.checklist, prompt: c.checklistPrompt, outcome: c.checklistOutcome },
  ];
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [result, setResult] = useState<AskAnswer | null>(null);
  const [progress, setProgress] = useState<{ since: number; last: number; steps: string[]; disconnected: boolean } | null>(null);
  const request = useRef<string | null>(null); const lock = useRef(false);
  const resultTitle = result?.taskStatus === 'completed' ? c.draftReady : c.responseReady;
  function edit(value: string) { setDraft(value); request.current = null; setError(''); }
  async function open(id: string) {
    await mutate(r => r.setSetupDone(true));
    navigate(`/app?view=work&run=${encodeURIComponent(id)}`);
  }
  async function start() {
    if (!ready || !draft.trim() || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    request.current ??= crypto.randomUUID();
    setProgress({ since: Date.now(), last: Date.now(), steps: [], disconnected: false });
    try {
      const result = await repo.ask(`${draft.trim()}\n\n${c.safety}`, {
        requestId: request.current, mode: 'work', responseMode: 'deep',
        onRunCreated: id => setRunId(id),
        onProgress: event => setProgress(current => current ? {
          ...current,
          last: event.type === 'reconnecting' ? current.last : Date.now(),
          disconnected: event.type === 'reconnecting',
          steps: event.type === 'status' && (event.kind === 'tool' || event.kind === 'step') && event.detail && current.steps.at(-1) !== event.detail
            ? [...current.steps, event.detail].slice(-20) : current.steps,
        } : current),
      });
      if (result.runId) { setRunId(result.runId); setResult(result); }
      else throw new Error(c.failed);
    } catch (e) { setError(e instanceof Error ? e.message : c.failed); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="first-job">
    <span className="eyebrow">3 · {c.steps[2]}</span>
    <h2>{c.jobs}</h2><p>{c.jobsNote}</p>
    <div className="first-job-options">{choices.map(choice => <button type="button" key={choice.label} disabled={busy || Boolean(runId)} aria-pressed={draft === choice.prompt} onClick={() => edit(choice.prompt)}><span>{choice.label}<small>{choice.outcome}</small></span><span aria-hidden="true">↗</span></button>)}</div>
    {draft && <label>{c.draft}<textarea value={draft} disabled={busy || Boolean(runId)} maxLength={6000} onChange={e => edit(e.target.value)} /></label>}
    {!ready && <p role="status">{c.waiting}</p>}
    {runId ? <Button onClick={() => void open(runId).catch(e => setError(String(e)))}>{c.open}</Button>
      : <Button disabled={!ready || !draft.trim() || busy} onClick={() => void start()}>{busy ? c.starting : c.start}</Button>}
    {busy && progress && <LiveTaskProgress steps={progress.steps} since={progress.since} lastProgressAt={progress.last} disconnected={progress.disconnected} durable={Boolean(runId)} />}
    {result && <section className="first-job-result" aria-label={resultTitle}>
      <h3>{resultTitle}</h3>
      <div className="ask-reply-text">{renderReplyMarkdown(result.text)}</div>
      {Boolean(result.artifacts?.length) && <ArtifactList artifacts={result.artifacts!} inlineImages label={c.draft} />}
    </section>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
