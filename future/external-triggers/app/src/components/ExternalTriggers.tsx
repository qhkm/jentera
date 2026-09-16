import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Copy, Key, Lightning, Plus, ShieldCheck } from '@phosphor-icons/react';
import { Button, Card, Input, LoadingState, Tag } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { useExternalTriggersScope } from '@/lib/repo/gate';
import { createTrigger, fetchTriggers, revokeTrigger, triggerEndpoint, TRIGGER_TASKS, TriggerError,
  type CreatedTrigger, type ExternalTrigger, type TriggerConfig, type TriggerList, type TriggerTask } from '@/lib/external-triggers';
import '@/styles/external-triggers.css';

type DialogState = { kind: 'new' } | { kind: 'review'; config: TriggerConfig }
  | { kind: 'key'; created: CreatedTrigger } | { kind: 'revoke'; row: ExternalTrigger };
const errorKey = (reason: unknown): string => {
  const code = reason instanceof TriggerError ? reason.code : '';
  return code === 'OWNER_REQUIRED' || code === 'SIGNED_IN_BUSINESS_REQUIRED' ? 'triggers.denied'
    : code === 'TRIGGERS_DISABLED' ? 'triggers.paused' : code === 'LIMIT_OR_ID_CONFLICT' ? 'triggers.limitError'
      : code === 'INVALID_CONFIG' ? 'triggers.invalid' : code === 'NOT_FOUND' ? 'triggers.missing' : 'triggers.error';
};

function TriggerDialog({ title, busy, onClose, children }: { title: string; busy: boolean; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.showModal();
    return () => { document.body.style.overflow = overflow; };
  }, []);
  useEffect(() => { dialog.current?.querySelector<HTMLElement>('[data-initial-focus]')?.focus(); }, [title]);
  return createPortal(<dialog ref={dialog} className="trigger-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="trigger-dialog-body"><div className="trigger-heading"><ShieldCheck size={24} aria-hidden="true" /><h3 id={titleId}>{title}</h3></div>{children}</div>
  </dialog>, document.body);
}

/** No requests or secret UI in demo, staff sessions, or an older backend. */
export default function ExternalTriggers() {
  const scope = useExternalTriggersScope();
  return scope ? <OwnerTriggers key={scope} /> : null;
}

function OwnerTriggers() {
  const { t, lang } = useI18n();
  const titleId = useId();
  const [data, setData] = useState<TriggerList | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lost, setLost] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [name, setName] = useState('');
  const [task, setTask] = useState<TriggerTask>('business_summary');
  const [days, setDays] = useState(7);
  const [showKey, setShowKey] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [now, setNow] = useState(Date.now());
  const mounted = useRef(false);
  const operation = useRef(false);
  const controllers = useRef(new Set<AbortController>());
  const dialogGeneration = useRef(0);
  const lifecycle = useRef(0);
  const opener = useRef<HTMLElement | null>(null);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const pendingCreate = useRef<TriggerConfig | null>(null);
  const canCreate = Boolean(data?.available && !lost && data.triggers.length < 100
    && data.triggers.filter(row => !row.revokedAt && Date.parse(row.expiresAt) > now).length < data.limits.maxActive);
  const active = data?.triggers.filter(row => !row.revokedAt && Date.parse(row.expiresAt) > now).length ?? 0;
  const formatted = (value: string) => new Intl.DateTimeFormat(lang === 'bm' ? 'ms-MY' : 'en-MY', {
    timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(value)) + ' (UTC+8)';
  useLayoutEffect(() => {
    if (dialog) { wasOpen.current = true; return; }
    if (wasOpen.current && !busy && !loading) {
      const usable = opener.current?.isConnected && !(opener.current instanceof HTMLButtonElement && opener.current.disabled);
      const target = usable ? opener.current : refreshButton.current;
      target?.focus({ preventScroll: true });
      wasOpen.current = false;
    }
  }, [dialog, busy, loading]);

  // Bound requests, including credential lookup and response-body reading.
  async function request<T>(action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    controllers.current.add(controller);
    let timer: number | undefined;
    try { return await Promise.race([action(controller.signal), new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => { controller.abort(); reject(new TriggerError()); }, 15_000);
    })]); }
    finally { window.clearTimeout(timer); controllers.current.delete(controller); }
  }
  async function refresh() {
    if (operation.current) return;
    operation.current = true;
    const epoch = lifecycle.current;
    setLoading(true); setError(null); setNotice(null);
    try {
      const list = await request(fetchTriggers);
      if (mounted.current && epoch === lifecycle.current) {
        setData(list); setNow(Date.now());
        // An absent row immediately after a timeout is not proof the POST
        // failed: its transaction may still be running. Never clear on absence.
        setLost(current => current && list.triggers.some(row => row.id === current && (row.revokedAt || Date.parse(row.expiresAt) <= Date.now())) ? null : current);
      }
    } catch (reason) { if (mounted.current && epoch === lifecycle.current) { setData(null); setError(errorKey(reason)); } }
    finally { if (mounted.current && epoch === lifecycle.current) { operation.current = false; setLoading(false); } }
  }
  useEffect(() => {
    mounted.current = true;
    lifecycle.current += 1;
    void refresh();
    const clear = () => {
      dialogGeneration.current += 1;
      lifecycle.current += 1;
      operation.current = false;
      controllers.current.forEach(controller => controller.abort());
      if (pendingCreate.current) { setLost(pendingCreate.current.id); setName(pendingCreate.current.name); pendingCreate.current = null; }
      setDialog(null); setShowKey(false); setCopyStatus(null); setCopying(false); setBusy(false); setData(null); setLoading(false);
    };
    const returnToPage = () => { void refresh(); };
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    window.addEventListener('pagehide', clear);
    window.addEventListener('pageshow', returnToPage);
    return () => {
      mounted.current = false;
      lifecycle.current += 1;
      operation.current = false;
      dialogGeneration.current += 1;
      controllers.current.forEach(controller => controller.abort());
      window.clearInterval(clock);
      window.removeEventListener('pagehide', clear);
      window.removeEventListener('pageshow', returnToPage);
    };
    // Component is keyed by authenticated account + business; language changes
    // translate the current UI without refetching or keeping a second key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function open(next: DialogState) {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogGeneration.current += 1;
    setError(null); setNotice(null); setShowKey(false); setCopyStatus(null); setCopying(false); setDialog(next);
  }
  function close() {
    if (operation.current) return;
    dialogGeneration.current += 1;
    setDialog(null); setShowKey(false); setCopyStatus(null); setCopying(false);
  }
  function review() {
    if (!canCreate || !name.trim() || name.trim().length > 80 || operation.current) return;
    setDialog({ kind: 'review', config: { id: crypto.randomUUID(), name: name.trim(), task,
      timeZone: 'Asia/Kuala_Lumpur', expiresAt: new Date(Date.now() + days * 86400_000).toISOString() } });
  }
  async function grant(config: TriggerConfig) {
    if (operation.current || !canCreate) return;
    operation.current = true; setBusy(true); setError(null);
    pendingCreate.current = config;
    const generation = dialogGeneration.current;
    const epoch = lifecycle.current;
    try {
      const created = await request(signal => createTrigger(config, signal));
      if (!mounted.current || epoch !== lifecycle.current || generation !== dialogGeneration.current) return;
      setData(current => current ? { ...current, triggers: [created.trigger, ...current.triggers] } : null);
      setDialog({ kind: 'key', created });
    } catch (reason) {
      if (!mounted.current || epoch !== lifecycle.current) return;
      // Network, timeout or malformed success may follow a committed insert.
      // Do not retry POST, reveal a key via GET, or create another grant blindly.
      const uncertain = !(reason instanceof TriggerError) || ['INVALID_RESPONSE', 'TRIGGER_UNAVAILABLE', 'LIMIT_OR_ID_CONFLICT'].includes(reason.code);
      if (uncertain) { setLost(config.id); setName(config.name); }
      setDialog(null); setError(errorKey(reason));
      const list = await request(fetchTriggers).catch(() => null);
      if (mounted.current && epoch === lifecycle.current) setData(list);
    } finally { if (mounted.current && epoch === lifecycle.current) { pendingCreate.current = null; operation.current = false; setBusy(false); } }
  }
  async function revoke(row: ExternalTrigger) {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(null);
    const generation = dialogGeneration.current;
    const epoch = lifecycle.current;
    try {
      const updated = await request(signal => revokeTrigger(row.id, signal));
      if (!mounted.current || epoch !== lifecycle.current || generation !== dialogGeneration.current) return;
      setData(current => current ? { ...current, triggers: current.triggers.map(item => item.id === row.id ? updated : item) } : null);
      setLost(current => current === row.id ? null : current);
      setNotice('triggers.revokeDone'); setDialog(null);
      dialogGeneration.current += 1;
    } catch (reason) { if (mounted.current && epoch === lifecycle.current && generation === dialogGeneration.current) setError(errorKey(reason)); }
    finally { if (mounted.current && epoch === lifecycle.current) { operation.current = false; setBusy(false); } }
  }
  async function copy(value: string) {
    if (copying) return;
    const generation = dialogGeneration.current;
    setCopying(true); setCopyStatus(null);
    try {
      await navigator.clipboard.writeText(value);
      if (mounted.current && generation === dialogGeneration.current) setCopyStatus('triggers.copied');
    } catch { if (mounted.current && generation === dialogGeneration.current) setCopyStatus('triggers.copyFailed'); }
    finally { if (mounted.current && generation === dialogGeneration.current) setCopying(false); }
  }

  const title = dialog?.kind === 'new' ? t('triggers.add') : dialog?.kind === 'review' ? t('triggers.reviewTitle')
    : dialog?.kind === 'key' ? t('triggers.keyTitle') : dialog?.kind === 'revoke' ? t('triggers.revokeTitle', { name: dialog.row.name }) : '';
  return <Card className="external-triggers" role="region" aria-labelledby={titleId}>
    <div className="trigger-toolbar"><div className="trigger-heading"><Lightning size={24} aria-hidden="true" /><h3 id={titleId}>{t('triggers.title')}</h3><Tag>{t('triggers.pilot')}</Tag></div>
      <Button ref={refreshButton} variant="ghost" onClick={() => void refresh()} disabled={loading || busy || Boolean(dialog)}>{t('triggers.refresh')}</Button></div>
    <p>{t('triggers.intro')}</p><p className="trigger-boundary"><ShieldCheck size={18} aria-hidden="true" />{t('triggers.boundary')}</p>
    {loading && <LoadingState title={t('triggers.loading')} />}
    {error && !dialog && <p role="alert">{t(error)}</p>}
    {lost && <p role="alert">{t('triggers.lost', { name })}</p>}
    {notice && <p role="status">{t(notice)}</p>}
    {data && <>
      {!data.available && <p className="trigger-boundary">{t('triggers.paused')}</p>}
      <div className="trigger-toolbar"><p>{t('triggers.limits', { active, max: data.limits.maxActive, daily: data.limits.dailyEvents })}</p>
        <Button variant="outline" disabled={!canCreate || busy || loading} onClick={() => { setName(''); setTask('business_summary'); setDays(7); open({ kind: 'new' }); }}><Plus size={17} aria-hidden="true" />{t('triggers.add')}</Button></div>
      {!data.triggers.length ? <p>{t('triggers.empty')}</p> : <ul className="trigger-grid">{data.triggers.map(row => {
        const status = row.revokedAt ? 'revoked' : Date.parse(row.expiresAt) <= now ? 'expired' : 'active';
        return <li key={row.id} className="trigger-item"><div className="trigger-toolbar"><h4>{row.name}</h4><Tag tone={status === 'active' && data.available ? 'green' : 'neutral'}>{t(`triggers.${status === 'active' && !data.available ? 'pausedStatus' : status}`)}</Tag></div>
          <p>{t(`triggers.${row.task}`)}</p><p>{t('triggers.expiry', { expiry: formatted(row.expiresAt) })}</p>
          <label>{t('triggers.url')}<Input readOnly value={triggerEndpoint(row.id)} onFocus={event => event.currentTarget.select()} /></label>
          {!row.revokedAt && <Button variant="ghost" disabled={busy || loading} onClick={() => open({ kind: 'revoke', row })}>{t('triggers.revoke')}</Button>}
        </li>;
      })}</ul>}
    </>}
    {dialog && <TriggerDialog title={title} busy={busy} onClose={close}>
      {dialog.kind === 'new' && <form className="trigger-form" onSubmit={event => { event.preventDefault(); review(); }}>
        <label>{t('triggers.name')}<Input data-initial-focus required maxLength={80} value={name} onChange={event => setName(event.target.value)} autoComplete="off" /></label>
        <label>{t('triggers.task')}<select className="input" value={task} onChange={event => setTask(event.target.value as TriggerTask)}>{TRIGGER_TASKS.map(item => <option key={item} value={item}>{t(`triggers.${item}`)}</option>)}</select></label>
        <label>{t('triggers.days')}<select className="input" value={days} onChange={event => setDays(Number(event.target.value))}>{[1, 7, 30].map(n => <option key={n} value={n}>{t('triggers.duration', { n })}</option>)}</select></label>
        <p className="trigger-boundary">{t('triggers.boundary')}</p><div className="trigger-actions"><Button type="button" variant="ghost" onClick={close}>{t('triggers.cancel')}</Button><Button type="submit" disabled={!canCreate || !name.trim()}>{t('triggers.review')}<ArrowRight size={17} aria-hidden="true" /></Button></div>
      </form>}
      {dialog.kind === 'review' && <><p>{t('triggers.reviewDetail', { name: dialog.config.name, task: t(`triggers.${dialog.config.task}`), expiry: formatted(dialog.config.expiresAt) })}</p>
        <p>{t('triggers.cap', { daily: data?.limits.dailyEvents ?? 20 })}</p><p className="trigger-boundary">{t('triggers.boundary')}</p>
        <div className="trigger-actions"><Button data-initial-focus variant="ghost" disabled={busy} onClick={() => setDialog({ kind: 'new' })}>{t('triggers.back')}</Button><Button disabled={busy || !canCreate} onClick={() => void grant(dialog.config)}><Key size={17} aria-hidden="true" />{t(busy ? 'triggers.busy' : 'triggers.grant')}</Button></div></>}
      {dialog.kind === 'key' && <><p data-initial-focus tabIndex={-1} className="trigger-boundary">{t('triggers.once')}</p>
        <label>{t('triggers.url')}<Input readOnly value={dialog.created.url} onFocus={event => event.currentTarget.select()} /></label>
        <Button variant="outline" disabled={copying} onClick={() => void copy(dialog.created.url)}><Copy size={17} aria-hidden="true" />{t('triggers.copyUrl')}</Button>
        <label>{t('triggers.key')}<Input readOnly type={showKey ? 'text' : 'password'} value={dialog.created.secret} autoComplete="off" spellCheck={false} onFocus={event => event.currentTarget.select()} /></label>
        <div className="trigger-actions"><Button variant="ghost" aria-pressed={showKey} onClick={() => setShowKey(current => !current)}>{t(showKey ? 'triggers.hide' : 'triggers.show')}</Button><Button variant="outline" disabled={copying} onClick={() => void copy(dialog.created.secret)}><Copy size={17} aria-hidden="true" />{t('triggers.copyKey')}</Button></div>
        <p>{t('triggers.clipboard')}</p>{copyStatus && <p role="status">{t(copyStatus)}</p>}
        <details><summary>{t('triggers.protocol')}</summary><p>{t('triggers.protocolHelp')}</p><pre>{`v1\nPOST\n/api/webhooks/external/${dialog.created.trigger.id}\n<timestamp>\n<exact JSON body>`}</pre><p>{t('triggers.headers')}</p></details>
        <Button variant="outline" onClick={close}>{t('triggers.closeKey')}</Button></>}
      {dialog.kind === 'revoke' && <><p>{t('triggers.revokeDetail')}</p><div className="trigger-actions"><Button data-initial-focus variant="outline" disabled={busy} onClick={close}>{t('triggers.cancel')}</Button><Button variant="outline" className="trigger-revoke-confirm" disabled={busy} onClick={() => void revoke(dialog.row)}>{t(busy ? 'triggers.busy' : 'triggers.confirmRevoke')}</Button></div></>}
      {error && <p role="alert">{t(error)}</p>}
    </TriggerDialog>}
  </Card>;
}
