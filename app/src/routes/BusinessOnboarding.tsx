import { useEffect, useRef, useState } from 'react';
import { Shell } from '@/components/Shell';
import { JenteraMark } from '@/components/JenteraMark';
import { Button, Input } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { useMutate, useRepository, useSnapshot } from '@/lib/repo';
import { onboardingCopy } from '@/lib/onboarding-copy';
import * as store from '@/lib/storage';
import type { IngestResult } from '@/lib/repo/types';
import { useNavigate } from 'react-router';

type Finding = { key: string; value: string; source: string; selected: boolean; original: string };

/** Real account onboarding. Anonymous draft progress never substitutes for reading a source. */
export default function BusinessOnboarding() {
  const { lang } = useI18n(); const c = onboardingCopy[lang];
  const repo = useRepository(); const mutate = useMutate(); const snap = useSnapshot();
  const navigate = useNavigate();
  const [saved] = useState(() => store.getJSON<{ url?: string; social?: string; desc?: string }>(store.KEYS.onboardingDraft, {}));
  const [mode, setMode] = useState<'website' | 'upload' | 'describe'>(saved.desc && !saved.url && !saved.social ? 'describe' : 'website');
  const [url, setUrl] = useState(saved.url || '');
  const [social, setSocial] = useState(saved.social || '');
  const [name, setName] = useState(snap.bizName === 'My business' ? '' : snap.bizName);
  const [about, setAbout] = useState(saved.desc || '');
  const [file, setFile] = useState<File | null>(null);
  const [findings, setFindings] = useState<Finding[]>(() => snap.facts.filter(f => !f.confirmed && typeof f.value === 'string').map(f => ({ key: f.key, value: String(f.value), original: String(f.value), source: f.sourceRef || c.manual, selected: true })));
  const [review, setReview] = useState(findings.length > 0);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const lock = useRef(false); const mounted = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const fieldLabel = (key: string) => c.fields[key] ?? key.replaceAll('.', ' · ');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (review) heading.current?.focus({ preventScroll: true });
  }, [review]);
  useEffect(() => {
    store.setJSON(store.KEYS.onboardingDraft, { step: 0, mode: mode === 'describe' ? 'manual' : 'auto', url, social, desc: about });
  }, [mode, url, social, about]);

  async function read() {
    if (lock.current) return;
    setError('');
    if ((mode === 'website' && !url.trim() && !social.trim()) || (mode === 'upload' && !file) || (mode === 'describe' && !about.trim())) { setError(c.missing); return; }
    lock.current = true; setBusy(true);
    try {
      let next: Finding[];
      if (mode === 'describe') {
        next = [{ key: 'business.about', value: about.trim(), original: '', source: c.manual, selected: true }];
        if (name.trim()) next.unshift({ key: 'business.name', value: name.trim(), original: '', source: c.manual, selected: true });
      } else {
        const sources = mode === 'upload' ? [file!.name] : [...new Set([url, social].map(s => s.trim()).filter(Boolean).map(s => /^https?:\/\//i.test(s) ? s : `https://${s}`))];
        const found = new Map<string, Finding>();
        const failures: string[] = [];
        for (const source of sources) {
          try {
            let result: IngestResult;
            if (mode === 'upload') {
              if (!repo.ingestFile) throw new Error(c.failed);
              result = await repo.ingestFile(file!);
            } else result = await repo.ingest(source);
            if (!result.facts || !result.suggestions?.length) throw new Error(c.empty);
            for (const f of result.suggestions) found.set(f.key, { ...f, original: f.value, source, selected: true });
          } catch (e) { failures.push(`${source}: ${e instanceof Error ? e.message : c.failed}`); }
        }
        next = [...found.values()];
        if (!next.length) throw new Error(failures.join('\n') || c.empty);
        if (failures.length && mounted.current) setError(failures.join('\n'));
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

  return <Shell><div className="business-onboarding">
    <ol className="onboarding-moments" aria-label="Onboarding">{c.steps.map((step, i) => <li key={step} aria-current={i === (review ? 1 : 0) ? 'step' : undefined}><span>{i + 1}</span>{step}</li>)}</ol>
    <JenteraMark size={44} />
    <header><h1 ref={heading} tabIndex={-1}>{review ? c.review : c.title}</h1><p>{review ? c.reviewNote : c.intro}</p></header>
    {!review ? <>
      {(saved.url || saved.social || saved.desc) && <p className="text-text-muted">{c.resume}</p>}
      <div className="onboarding-source-options">{(['website', 'upload', 'describe'] as const).map(option => <button type="button" key={option} aria-pressed={mode === option} disabled={busy} onClick={() => { setMode(option); setError(''); }}>{c[option]}</button>)}</div>
      <section className="onboarding-source-panel">
        {mode === 'website' && <><label>{c.website}<Input value={url} disabled={busy} onChange={e => setUrl(e.target.value)} placeholder="yourbusiness.com" /></label><label>{c.social}<Input value={social} disabled={busy} onChange={e => setSocial(e.target.value)} /></label><p>{c.limit}</p></>}
        {mode === 'upload' && <><label>{c.upload}<input type="file" disabled={busy} accept=".pdf,.docx,.pptx,.xlsx,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.webp" onChange={e => setFile(e.target.files?.[0] ?? null)} /></label><p>{c.fileNote}</p></>}
        {mode === 'describe' && <><label>{c.name}<Input value={name} disabled={busy} onChange={e => setName(e.target.value)} /></label><label>{c.about}<textarea value={about} disabled={busy} maxLength={12000} onChange={e => setAbout(e.target.value)} /></label></>}
        <Button disabled={busy} onClick={() => void read()}>{busy ? c.reading : c.read}</Button>
        {busy && <p role="status">{c.reading}</p>}
      </section>
    </> : <>
      <div className="onboarding-findings">{findings.map((f, i) => <article key={f.key} className="onboarding-finding">
        <label className="onboarding-finding-label"><input type="checkbox" checked={f.selected} disabled={busy} onChange={e => setFindings(current => current.map((item, index) => index === i ? { ...item, selected: e.target.checked } : item))} />{fieldLabel(f.key)}</label>
        <textarea aria-label={fieldLabel(f.key)} value={f.value} disabled={busy} onChange={e => setFindings(current => current.map((item, index) => index === i ? { ...item, value: e.target.value } : item))} />
        <small>{c.source}: {f.source}</small>
      </article>)}</div>
      <p className="text-text-secondary">{c.consent}</p>
      <Button disabled={busy || !findings.some(f => f.selected && f.value.trim())} onClick={() => void confirm()}>{busy ? c.saving : c.confirm}</Button>
      <button type="button" disabled={busy} className="ask-inline-action" onClick={() => { setReview(false); setError(''); }}>{c.back}</button>
    </>}
    {error && <p role="alert" className="onboarding-error">{error}</p>}
  </div></Shell>;
}
