import { useEffect, useRef, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Button, Input } from '@/components/ui';
import { ArrowUp, Check, CircleNotch, FileText, Globe, PencilSimple, UploadSimple, WarningCircle } from '@phosphor-icons/react';
import { useI18n } from '@/i18n/I18nProvider';
import { useMutate, useRepository, useSnapshot } from '@/lib/repo';
import { onboardingCopy } from '@/lib/onboarding-copy';
import * as store from '@/lib/storage';
import type { IngestResult } from '@/lib/repo/types';
import { useNavigate } from 'react-router';
import { renderSourceLink } from '@/lib/reply-markdown';
import { firstWorkflowTask, workflowCategories, workflowCategoryKey, workflowTaskKey, type WorkflowCategory } from '@/lib/first-workflow';
import { FounderGroupInvite } from '@/components/FounderGroupInvite';
import { OnboardingGuide } from '@/components/OnboardingGuide';

type Finding = { key: string; value: string; source: string; selected: boolean; original: string };

/** Real account onboarding. Anonymous draft progress never substitutes for reading a source. */
export default function BusinessOnboarding() {
  const { lang } = useI18n(); const c = onboardingCopy[lang];
  const repo = useRepository(); const mutate = useMutate(); const snap = useSnapshot();
  const navigate = useNavigate();
  const [saved] = useState(() => store.getJSON<{ url?: string; social?: string; desc?: string }>(store.KEYS.onboardingDraft, {}));
  const [mode, setMode] = useState<'website' | 'upload' | 'describe'>(saved.desc && !saved.url && !saved.social ? 'describe' : 'website');
  const [sourceChosen, setSourceChosen] = useState(Boolean(saved.url || saved.social || saved.desc));
  const [url, setUrl] = useState(saved.url || '');
  const [social, setSocial] = useState(saved.social || '');
  const [name, setName] = useState(snap.bizName === 'My business' ? '' : snap.bizName);
  const [about, setAbout] = useState(saved.desc || '');
  const [file, setFile] = useState<File | null>(null);
  const [findings, setFindings] = useState<Finding[]>(() => snap.facts.filter(f => !f.confirmed && typeof f.value === 'string').map(f => ({ key: f.key, value: String(f.value), original: String(f.value), source: f.sourceRef || c.manual, selected: true })));
  const [review, setReview] = useState(findings.length > 0);
  const [choosingWorkflow, setChoosingWorkflow] = useState(findings.length === 0 && !firstWorkflowTask(snap));
  const [workflowCategory, setWorkflowCategory] = useState<WorkflowCategory | null>(null);
  // Unconfirmed task text belongs to this mounted form, not shared browser storage.
  const [workflowTask, setWorkflowTask] = useState(() => firstWorkflowTask(snap));
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const readingSource = busy && !review && mode !== 'describe';
  const [sources, setSources] = useState<{ source: string; state: 'sourceWaiting' | 'sourceReading' | 'sourceRead' | 'sourceFailed' }[]>([]);
  const lock = useRef(false); const mounted = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const fieldLabel = (key: string) => key === workflowCategoryKey ? c.workflowCategoryField
    : key === workflowTaskKey ? c.workflowTaskField : c.fields[key] ?? key.replaceAll('.', ' · ');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    heading.current?.focus({ preventScroll: true });
  }, [review, choosingWorkflow, workflowCategory, sourceChosen, mode, readingSource]);
  useEffect(() => {
    store.setJSON(store.KEYS.onboardingDraft, { step: 0, mode: mode === 'describe' ? 'manual' : 'auto', url, social, desc: about });
  }, [mode, url, social, about]);

  async function read() {
    if (lock.current) return;
    setError(''); setSources([]);
    if ((mode === 'website' && !url.trim() && !social.trim()) || (mode === 'upload' && !file) || (mode === 'describe' && !about.trim())) { setError(c.missing); return; }
    lock.current = true; setBusy(true);
    try {
      let next: Finding[];
      if (mode === 'describe') {
        next = [{ key: 'business.about', value: about.trim(), original: '', source: c.manual, selected: true }];
        if (name.trim()) next.unshift({ key: 'business.name', value: name.trim(), original: '', source: c.manual, selected: true });
      } else {
        const sources = mode === 'upload' ? [file!.name] : [...new Set([url, social].map(s => s.trim()).filter(Boolean).map(s => /^https?:\/\//i.test(s) ? s : `https://${s}`))];
        if (mounted.current) setSources(sources.map(source => ({ source, state: 'sourceWaiting' })));
        const found = new Map<string, Finding>();
        const failures: string[] = [];
        for (const source of sources) {
          if (mounted.current) setSources(current => current.map(item => item.source === source ? { ...item, state: 'sourceReading' } : item));
          try {
            let result: IngestResult;
            if (mode === 'upload') {
              if (!repo.ingestFile) throw new Error(c.failed);
              result = await repo.ingestFile(file!);
            } else result = await repo.ingest(source);
            if (!result.facts || !result.suggestions?.length) throw new Error(c.empty);
            for (const f of result.suggestions) found.set(f.key, { ...f, original: f.value, source, selected: true });
            if (mounted.current) setSources(current => current.map(item => item.source === source ? { ...item, state: 'sourceRead' } : item));
          } catch (e) {
            failures.push(`${source}: ${e instanceof Error ? e.message : c.failed}`);
            if (mounted.current) setSources(current => current.map(item => item.source === source ? { ...item, state: 'sourceFailed' } : item));
          }
        }
        next = [...found.values()];
        if (!next.length) throw new Error(failures.join('\n') || c.empty);
        if (failures.length && mounted.current) setError(failures.join('\n'));
      }
      if (workflowCategory && workflowTask.trim()) {
        next = next.filter(f => f.key !== workflowCategoryKey && f.key !== workflowTaskKey);
        next.push(
          { key: workflowCategoryKey, value: workflowCategory, original: '', source: c.manual, selected: true },
          { key: workflowTaskKey, value: workflowTask.trim(), original: '', source: c.manual, selected: true },
        );
      }
      if (mounted.current) { setFindings(next); setReview(true); }
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : c.failed); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }

  async function confirm() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const selected = findings.filter(f => f.selected && f.value.trim());
      if (!selected.length) throw new Error(c.empty);
      // Persist explicit edits, then confirm only the reviewed selection.
      // Unticked proposals remain unconfirmed in Knowledge, never used as facts.
      for (const f of selected) {
        if (f.value !== f.original) await repo.setFact({ key: f.key, value: f.value.trim(), source: 'owner' });
      }
      await repo.confirmFacts(selected.map(f => f.key));
      await mutate(r => r.completeOnboarding({ playbookKey: snap.bizType || 'generic', channels: snap.channels ?? [],
        name: selected.find(f => f.key === 'business.name')?.value.trim() || name.trim() || undefined,
        locality: selected.find(f => f.key === 'business.address')?.value.trim(),
      }));
      store.remove(store.KEYS.onboardingDraft);
      navigate('/setup');
      // The lifecycle guard takes the owner to /setup: stage three and real provisioning.
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : c.failed); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }

  if (choosingWorkflow) return <Shell><div className="business-onboarding business-onboarding--conversation">
    <div className="onboarding-conversation-heading" role="region" aria-label={c.welcomeTitle}>
      <span className="eyebrow">{c.guideMeet}</span>
      <p>{c.welcomeSetup}</p>
    </div>
    <div className="onboarding-stage" key={workflowCategory ? 'task' : 'category'}>
    {workflowCategory && <button type="button" className="onboarding-context" onClick={() => { setWorkflowCategory(null); setError(''); }}>
      <PencilSimple size={14} aria-hidden="true" />{c.workflowCategories[workflowCategory]}<span>{c.change}</span>
    </button>}
    <OnboardingGuide>
      <h1 ref={heading} tabIndex={-1}>{workflowCategory ? c.repeatedTask : c.workflowTitle}</h1>
      <p>{workflowCategory ? c.workflowExamples[workflowCategory] : c.workflowIntro}</p>
    </OnboardingGuide>
    <form className="first-workflow" onSubmit={event => {
      event.preventDefault();
      if (!workflowCategory) { setError(c.workflowMissing); return; }
      if (!workflowTask.trim()) { setError(c.workflowTaskMissing); return; }
      setError(''); setChoosingWorkflow(false);
    }}>
      {!workflowCategory ? <div className="first-workflow-categories onboarding-replies" role="group" aria-label={c.workflowCategoryField}>
        {workflowCategories.map(category => <button key={category} type="button" aria-pressed={workflowCategory === category} onClick={() => { setWorkflowCategory(category); setError(''); }}>
          <strong>{c.workflowCategories[category]}</strong><small>{c.workflowExamples[category]}</small>
        </button>)}
      </div> : <>
        <div className="onboarding-composer">
          <label className="sr-only" htmlFor="first-workflow-task">{c.repeatedTask}</label>
          <textarea id="first-workflow-task" required maxLength={2000} value={workflowTask} placeholder={c.repeatedPlaceholder} onChange={event => setWorkflowTask(event.target.value)} />
          <Button type="submit" aria-label={c.workflowNext} title={c.workflowNext}><ArrowUp size={20} weight="bold" aria-hidden="true" /></Button>
        </div>
        <p className="onboarding-privacy">{c.workflowPrivacy}</p>
      </>}
      {error && <p role="alert" className="onboarding-error">{error}</p>}
    </form>
    </div>
    {!workflowCategory && <FounderGroupInvite />}
  </div></Shell>;

  return <Shell><div className="business-onboarding business-onboarding--conversation">
    <ol className="onboarding-moments" aria-label="Onboarding">{c.steps.map((step, i) => <li key={step} aria-current={i === (review ? 1 : 0) ? 'step' : undefined}><span>{i + 1}</span>{step}</li>)}</ol>
    <div className="onboarding-stage" key={readingSource ? 'reading' : review ? 'review' : sourceChosen ? mode : 'source'}>
    {readingSource ? <section className="onboarding-discovery" aria-labelledby="discovery-title">
      <div className="onboarding-discovery__scene" aria-hidden="true">
        <div className="onboarding-discovery__halo" />
        <div className="onboarding-discovery__orbit" />
        <div className="onboarding-discovery__page"><FileText size={28} /><i /><i /><i /></div>
        <img src="/images/jentera-guide-v1.webp" alt="" draggable={false} />
        <span className="onboarding-discovery__spark">✦</span>
      </div>
      <span className="eyebrow">Jentera</span>
      <h1 id="discovery-title" ref={heading} tabIndex={-1}>{c.learning}</h1>
      <p className="onboarding-discovery__note">{c.learningNote}</p>
      <div className="onboarding-discovery__sources" role="status" aria-label={c.reading} aria-live="polite" aria-atomic="true">
        {sources.map(item => <div className="onboarding-discovery__source" key={item.source}>
          {mode === 'upload' ? <FileText size={20} aria-hidden="true" /> : <Globe size={20} aria-hidden="true" />}
          <span className="onboarding-discovery__url">{item.source}</span>
          <span className="onboarding-discovery__state">
            {item.state === 'sourceRead' ? <Check size={16} aria-hidden="true" /> : item.state === 'sourceFailed' ? <WarningCircle size={16} aria-hidden="true" /> : item.state === 'sourceReading' ? <CircleNotch className="onboarding-discovery__spinner" size={16} aria-hidden="true" /> : null}
            {c[item.state]}
          </span>
        </div>)}
      </div>
      <div className="onboarding-discovery__track" aria-hidden="true"><span /></div>
      <p className="onboarding-discovery__hint">{c.learningHint}</p>
    </section> : <>
    {!review && <button type="button" className="onboarding-context" disabled={busy} onClick={() => {
      if (sourceChosen) setSourceChosen(false);
      else setChoosingWorkflow(true);
      setError('');
    }}><PencilSimple size={14} aria-hidden="true" />{sourceChosen ? c.back : c.changeWorkflow}</button>}
    <OnboardingGuide>
      <h1 ref={heading} tabIndex={-1}>{review ? c.review : sourceChosen ? c[mode] : c.title}</h1>
      <p>{review ? c.reviewNote : sourceChosen ? c.sourcePrompts[mode] : c.intro}</p>
    </OnboardingGuide>
    {!review ? <>
      {!sourceChosen ? <div className="onboarding-source-options onboarding-replies">{(['website', 'upload', 'describe'] as const).map(option => <button type="button" key={option} disabled={busy} onClick={() => { setMode(option); setSourceChosen(true); setError(''); }}>{c[option]}</button>)}</div> : <section className="onboarding-source-panel onboarding-active-source">
        {mode === 'website' && <><label>{c.website}<Input value={url} disabled={busy} onChange={e => setUrl(e.target.value)} placeholder="yourbusiness.com" /></label><label>{c.social}<Input value={social} disabled={busy} onChange={e => setSocial(e.target.value)} /></label><p>{c.limit}</p></>}
        {mode === 'upload' && <>
          <div className={`onboarding-upload${file ? ' has-file' : ''}`}>
            <div className="onboarding-upload__icon" aria-hidden="true">{file ? <FileText size={28} /> : <UploadSimple size={28} />}</div>
            <div className="onboarding-upload__details" aria-live="polite">
              <strong>{file ? file.name : c.uploadPrompt}</strong>
              <span>{file ? `${Math.max(1, Math.ceil(file.size / 1024)).toLocaleString()} KB` : c.uploadHint}</span>
            </div>
            <input ref={fileInput} className="sr-only" tabIndex={-1} type="file" aria-label={c.upload} aria-describedby="onboarding-file-note" disabled={busy} accept=".pdf,.docx,.pptx,.xlsx,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.webp" onChange={e => { const selected = e.target.files?.[0]; if (selected) { setFile(selected); setError(''); } }} />
            <Button type="button" variant="outline" className="onboarding-upload__choose" disabled={busy} onClick={() => fileInput.current?.click()}><UploadSimple size={18} aria-hidden="true" />{file ? c.changeFile : c.chooseFile}</Button>
          </div>
          <p id="onboarding-file-note">{c.fileNote}</p>
        </>}
        {mode === 'describe' && <><label>{c.name}<Input value={name} disabled={busy} onChange={e => setName(e.target.value)} /></label><label>{c.about}<textarea value={about} disabled={busy} maxLength={12000} onChange={e => setAbout(e.target.value)} /></label></>}
        <Button className="onboarding-send" disabled={busy || (mode === 'upload' && !file)} onClick={() => void read()}>{busy ? c.reading : c.read}<ArrowUp size={18} weight="bold" aria-hidden="true" /></Button>
      </section>}
    </> : <>
      <section className="onboarding-business-preview" aria-label={c.readyToReview}>
        <span className="eyebrow">{c.readyToReview}</span>
        {findings.find(f => f.key === 'business.name' && f.selected)?.value.trim() && <h2>{findings.find(f => f.key === 'business.name' && f.selected)?.value}</h2>}
        {findings.find(f => f.key === 'business.about' && f.selected)?.value.trim() && <p className="onboarding-business-about">{findings.find(f => f.key === 'business.about' && f.selected)?.value}</p>}
        <strong>{findings.filter(f => f.selected && f.value.trim()).length} {c.selectedDetails}</strong>
        <small>{c.previewNote}</small>
      </section>
      <div className="onboarding-findings">{findings.map((f, i) => <article key={f.key} className="onboarding-finding">
        <label className="onboarding-finding-label"><input type="checkbox" checked={f.selected} disabled={busy} onChange={e => setFindings(current => current.map((item, index) => index === i ? { ...item, selected: e.target.checked } : item))} />{fieldLabel(f.key)}</label>
        <textarea aria-label={fieldLabel(f.key)} maxLength={f.key === workflowTaskKey ? 2000 : 12000} value={f.value} disabled={busy} onChange={e => setFindings(current => current.map((item, index) => index === i ? { ...item, value: e.target.value } : item))} />
        <small>{c.source}: {renderSourceLink(f.source)}</small>
      </article>)}</div>
      <p className="text-text-secondary">{c.consent}</p>
      <Button disabled={busy || !findings.some(f => f.selected && f.value.trim())} onClick={() => void confirm()}>{busy ? c.saving : c.confirm}</Button>
      <button type="button" disabled={busy} className="ask-inline-action" onClick={() => { setReview(false); setError(''); }}>{c.back}</button>
    </>}
    {error && <p role="alert" className="onboarding-error">{error}</p>}
    </>}
    </div>
  </div></Shell>;
}
