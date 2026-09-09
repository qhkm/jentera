import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, ArrowUpRight, Bell, CalendarBlank, Clock, FileText, Pause, Play, Plus, ArrowClockwise } from '@phosphor-icons/react';
import { Button, LoadingState } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { useRoutines } from '@/hooks/useRoutines';
import { RoutineError } from '@/lib/routines/api';
import { occurrenceReason, occurrenceStatus, routineDate, scheduleLabel, starterSchedule } from '@/lib/routines/format';
import {
  ROUTINE_KINDS, ROUTINE_ZONE, knownRoutine, validSchedule,
  type Routine, type RoutineAction, type RoutineConfig, type RoutineKind,
  type RoutineOccurrence, type RoutinesApi,
} from '@/lib/routines/types';

const JOB_ICONS = { business_summary: FileText, weekly_summary: CalendarBlank, approval_reminder: Bell };
type Editor = { config: RoutineConfig; paused: boolean; source?: Routine };
type Pending = {
  action: RoutineAction;
  name: string;
  since: number;
  phase: 'review' | 'sending' | 'uncertain' | 'rejected';
  error?: RoutineError;
  retryAt?: number;
};

function errorKey(error: unknown, read = false): string {
  if (error instanceof RoutineError) {
    if (error.status === 401) return 'routines.error.session';
    if (error.status === 404) return 'routines.error.missing';
    if (error.code === 'OWNER_REQUIRED') return 'routines.readonly';
    if (error.code === 'ROUTINES_DISABLED') return 'routines.unavailable';
    if (error.code === 'REVISION_CONFLICT') return 'routines.error.conflict';
    if (error.code === 'IDEMPOTENCY_CONFLICT') return 'routines.error.idempotency';
    if (error.code === 'RUN_ALREADY_ACTIVE') return 'routines.error.active';
    if (error.code.startsWith('INVALID_') && error.code !== 'INVALID_RESPONSE') return 'routines.validation';
  }
  return read ? 'routines.error.load' : 'routines.error.generic';
}

function Status({ value, routine = false }: { value: string; routine?: boolean }) {
  const { t } = useI18n();
  const key = routine ? ['active', 'paused'].includes(value) ? `routines.${value}` : 'routines.status.unknown' : occurrenceStatus(value);
  const tone = routine ? value === 'active' ? 'good' : 'neutral'
    : value === 'completed' ? 'good' : value === 'failed' ? 'bad' : 'neutral';
  return <span className={`routine-status routine-status-${tone}`}>{t(key)}</span>;
}

function Occurrence({ item, onOpenTask }: { item: RoutineOccurrence; onOpenTask: (id: string) => void }) {
  const { lang, t } = useI18n();
  const reason = occurrenceReason(item.reason);
  return <li className="routine-occurrence">
    <div className="routine-row-heading">
      <div><Status value={item.status} /><span className="routine-meta">{t(item.trigger === 'manual' ? 'routines.manual' : 'routines.scheduled')}</span></div>
      <time dateTime={item.scheduledFor}>{routineDate(item.scheduledFor, lang)}</time>
    </div>
    {item.summary && <p>{item.summary}</p>}
    {reason && <p className="routine-muted">{t(reason)}</p>}
    {item.runId && <button type="button" className="routine-link" onClick={() => onOpenTask(item.runId!)}>
      {t('routines.viewResult')}<ArrowUpRight size={16} aria-hidden="true" />
    </button>}
  </li>;
}

function RoutineEditor({ editor, onChange, onReview, onCancel }: {
  editor: Editor; onChange: (editor: Editor) => void; onReview: () => void; onCancel: () => void;
}) {
  const { t, lang } = useI18n();
  const [invalid, setInvalid] = useState(false);
  const { config } = editor;
  const change = (patch: Partial<RoutineConfig>) => { setInvalid(false); onChange({ ...editor, config: { ...config, ...patch } }); };
  return <form className="routine-editor card" onSubmit={(event) => {
    event.preventDefault();
    if (!config.name.trim() || config.name.trim().length > 80 || !validSchedule(config.schedule)) { setInvalid(true); return; }
    onReview();
  }}>
    <div className="routine-section-heading"><h2>{t(editor.source ? 'routines.edit' : 'routines.add')}</h2><span>{t('routines.zone')}</span></div>
    <label>{t('routines.job')}<select className="input" value={config.task.kind} onChange={(event) => change({ task: { kind: event.target.value as RoutineKind } })}>
      {ROUTINE_KINDS.map((kind) => <option key={kind} value={kind}>{t(`routines.kind.${kind}`)}</option>)}
    </select></label>
    <p className="routine-muted">{t(`routines.description.${config.task.kind}`)}</p>
    <label>{t('routines.name')}<input className="input" required maxLength={80} value={config.name}
      onChange={(event) => change({ name: event.target.value })} autoComplete="off" /></label>
    <div className="routine-fields">
      <label>{t('routines.frequency')}<select className="input" value={config.schedule.frequency} onChange={(event) => {
        const frequency = event.target.value as 'daily' | 'weekdays' | 'weekly';
        change({ schedule: { frequency, time: config.schedule.time, timeZone: ROUTINE_ZONE,
          ...(frequency === 'weekly' ? { weekday: 5 } : {}) } as RoutineConfig['schedule'] });
      }}>
        {(['daily', 'weekdays', 'weekly'] as const).map((frequency) => <option key={frequency} value={frequency}>{t(`routines.frequency.${frequency}`)}</option>)}
      </select></label>
      {config.schedule.frequency === 'weekly' && <label>{t('routines.weekday')}<select className="input" value={config.schedule.weekday}
        onChange={(event) => change({ schedule: { ...config.schedule, frequency: 'weekly', weekday: Number(event.target.value) } })}>
        {[1, 2, 3, 4, 5, 6, 7].map((day) => <option key={day} value={day}>{t(`routines.day.${day}`)}</option>)}
      </select></label>}
      <label>{t('routines.time')}<input className="input" type="time" required step="60" value={config.schedule.time}
        onChange={(event) => change({ schedule: { ...config.schedule, time: event.target.value } })} /></label>
    </div>
    {!editor.source && <label className="routine-checkbox"><input type="checkbox" checked={editor.paused}
      onChange={(event) => onChange({ ...editor, paused: event.target.checked })} />{t('routines.startPaused')}</label>}
    <div className="routine-preview"><Clock size={20} aria-hidden="true" /><div>
      <strong>{validSchedule(config.schedule) ? scheduleLabel(config.schedule, lang, t) : t('routines.validation')}</strong>
      <p>{t('routines.delivery')}</p>
    </div></div>
    {invalid && <p role="alert">{t('routines.validation')}</p>}
    <div className="routine-actions"><Button type="submit">{t('routines.review')}</Button><Button type="button" variant="ghost" onClick={onCancel}>{t('routines.cancel')}</Button></div>
  </form>;
}

/** Kept mounted across workspace navigation so an ambiguous write retains its
 * idempotency key. There are no persisted drafts, browser schedules or fake runs. */
export default function RoutinesView({ api, active, selectedId, onSelect, onOpenTask }: {
  api: RoutinesApi; active: boolean; selectedId: string | null;
  onSelect: (id: string | null) => void; onOpenTask: (id: string) => void;
}) {
  const { t, lang } = useI18n();
  const state = useRoutines(api, active, selectedId);
  const latest = useRef({ active, refresh: state.refresh, onSelect });
  latest.current = { active, refresh: state.refresh, onSelect };
  const [adding, setAdding] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<RoutineOccurrence | null>(null);
  const [now, setNow] = useState(Date.now());
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const panelHeading = useRef<HTMLHeadingElement>(null);
  const caps = state.data?.capabilities;
  const readsReady = !!caps && !state.loading && !state.error;
  const canManage = readsReady && caps.canManage;
  const canSchedule = canManage && caps.canSchedule && caps.timeZones.includes(ROUTINE_ZONE);
  const canAdd = canSchedule && state.data!.routines.length < caps.maxRoutines;
  const detail = state.detail?.routine;
  const detailReady = !!detail && !state.detailLoading && !state.detailError && knownRoutine(detail);
  const busy = pending?.phase === 'sending';

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (active) (pending ? panelHeading.current : heading.current)?.focus({ preventScroll: true });
  }, [active, selectedId, !!editor, adding, !!pending]);
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [!!pending]);

  function pick(kind: RoutineKind) {
    if (!canAdd || pending) return;
    setNotice(null);
    setReceipt(null);
    setEditor({ config: { name: t(`routines.name.${kind}`), task: { kind }, schedule: starterSchedule(kind), delivery: 'workspace' }, paused: false });
  }

  function review() {
    if (!editor || !canSchedule || pending) return;
    const config = { ...editor.config, name: editor.config.name.trim() };
    const requestId = crypto.randomUUID();
    setPending({ name: config.name, since: Date.now(), phase: 'review', action: editor.source
      ? { kind: 'update', id: editor.source.id, body: { ...config, requestId, expectedRevision: editor.source.revision } }
      : { kind: 'create', body: { ...config, requestId, enabled: !editor.paused } } });
  }

  function reviewAction(kind: 'run' | 'state') {
    if (!detailReady || !canManage || pending) return;
    const action: RoutineAction = kind === 'run'
      ? { kind, id: detail.id, body: { requestId: crypto.randomUUID(), expectedRevision: detail.revision } }
      : { kind, id: detail.id, body: { requestId: crypto.randomUUID(), expectedRevision: detail.revision, status: detail.status === 'active' ? 'paused' : 'active' } };
    setNotice(null);
    setReceipt(null);
    setPending({ action, name: detail.name, since: Date.now(), phase: 'review' });
  }

  function allowed(action: RoutineAction) {
    if (!canManage) return false;
    if (action.kind === 'run') return !!caps?.canRunNow;
    if (action.kind === 'state' && action.body.status === 'paused') return true;
    return canSchedule && (action.kind !== 'create' || canAdd);
  }

  async function submit() {
    if (!pending || inFlight.current || pending.phase === 'sending' || pending.phase === 'rejected') return;
    if (Date.now() - pending.since >= 7 * 24 * 60 * 60 * 1000 || (pending.retryAt ?? 0) > Date.now()) return;
    // A replay must retain the exact body/key even if the first write changed
    // the cap or revision. The backend rechecks authority and replay identity.
    if (pending.phase === 'review' && !allowed(pending.action)) return;
    if (pending.phase === 'uncertain' && !readsReady) return;
    inFlight.current = true;
    const request = pending;
    setPending({ ...request, phase: 'sending', error: undefined });
    try {
      const result = await api.execute(request.action);
      if (!mounted.current) return;
      setPending(null);
      setEditor(null);
      setAdding(false);
      setNotice('occurrence' in result ? 'routines.runSaved' : 'routines.saved');
      if ('occurrence' in result) setReceipt(result.occurrence);
      // Never use a replay acknowledgement as the current configuration.
      await latest.current.refresh();
      if (latest.current.active) latest.current.onSelect('occurrence' in result ? result.occurrence.routineId : result.routine.id);
    } catch (error) {
      if (!mounted.current) return;
      const failure = error instanceof RoutineError ? error : new RoutineError('NETWORK', 0, true);
      setPending({ ...request, phase: failure.uncertain ? 'uncertain' : 'rejected', error: failure,
        retryAt: failure.retryAfter ? Date.now() + failure.retryAfter * 1000 : undefined });
      await latest.current.refresh();
    } finally { inFlight.current = false; }
  }

  function cancel() { setPending(null); setEditor(null); setAdding(false); }
  const pendingConfig = pending && (pending.action.kind === 'create' || pending.action.kind === 'update') ? pending.action.body : null;
  const pendingState = pending?.action.kind === 'state' ? pending.action.body.status : null;
  const expired = !!pending && now - pending.since >= 7 * 24 * 60 * 60 * 1000;
  const retryIn = pending?.retryAt ? Math.max(0, Math.ceil((pending.retryAt - now) / 1000)) : 0;
  const showEditor = !!editor && !pending;
  const unavailable = caps && (!caps.canSchedule || !caps.timeZones.includes(ROUTINE_ZONE));

  return <section className="routines-view" aria-labelledby="routines-title">
    <header className="routine-page-heading">
      <div><h1 id="routines-title" ref={heading} tabIndex={-1}>{t('routines.title')}</h1><p>{t('routines.intro')}</p></div>
      <div className="routine-actions">
        <Button type="button" variant="ghost" aria-label={t('routines.refresh')} disabled={state.loading || busy} onClick={() => void state.refresh()}><ArrowClockwise size={19} aria-hidden="true" /></Button>
        {!editor && !pending && !adding && canAdd && !!state.data?.routines.length && <Button type="button" onClick={() => { setAdding(true); setNotice(null); }}><Plus size={18} aria-hidden="true" />{t('routines.add')}</Button>}
      </div>
    </header>

    {notice && !state.loading && !state.error && !state.detailError && !state.detailLoading && <p role="status" className="routine-notice">{t(notice)}</p>}
    {state.error ? <div className="routine-notice" role="alert"><p>{t(errorKey(state.error, true))}</p>
      {state.error instanceof RoutineError && state.error.status === 401 && <Link className="routine-link" to="/signin">{t('routines.signin')}</Link>}
      <Button variant="outline" type="button" disabled={state.loading} onClick={() => void state.refresh()}>{t('routines.refresh')}</Button>
    </div> : null}
    {state.loading && !state.data && <LoadingState title={t('routines.loading')} />}
    {readsReady && !caps.canManage && <p className="routine-notice">{t('routines.readonly')}</p>}
    {readsReady && unavailable && <p className="routine-notice">{t('routines.unavailable')}</p>}

    {pending && <section className="routine-confirm card" aria-labelledby="routine-confirm-title" aria-busy={busy}>
      <h2 id="routine-confirm-title" ref={panelHeading} tabIndex={-1}>{t(pendingConfig ? 'routines.review.title' : pendingState === 'paused' ? 'routines.pause' : pendingState === 'active' ? 'routines.resume' : 'routines.manual')}</h2>
      <strong>{pending.name}</strong>
      {pendingConfig && <div className="routine-preview"><Clock size={22} aria-hidden="true" /><div>
        <strong>{scheduleLabel(pendingConfig.schedule, lang, t)}</strong><p>{t('routines.zone')}</p>
        <p>{t(`routines.description.${pendingConfig.task.kind}`)}</p>
      </div></div>}
      <p>{t(pending.action.kind === 'run' ? 'routines.manual.detail' : pendingState === 'paused' ? 'routines.pause.detail' : pendingState === 'active' ? 'routines.resume.detail'
        : pending.action.kind === 'update' ? 'routines.review.edit' : pending.action.kind === 'create' && pending.action.body.enabled ? 'routines.review.active' : 'routines.review.paused')}</p>
      <p className="routine-muted">{t('routines.delivery')}</p>
      {pending.phase === 'uncertain' && <p role="alert">{t('routines.uncertain')}</p>}
      {pending.phase === 'rejected' && <p role="alert">{t(errorKey(pending.error))}</p>}
      {pending.error?.status === 401 && <Link className="routine-link" to="/signin">{t('routines.signin')}</Link>}
      {pending.error?.runId && <button className="routine-link" type="button" onClick={() => onOpenTask(pending.error!.runId!)}>{t('routines.viewResult')}<ArrowUpRight size={16} aria-hidden="true" /></button>}
      {expired && <p role="alert">{t('routines.expired')}</p>}
      {retryIn > 0 && <p role="status">{t('routines.retryWait', { n: retryIn })}</p>}
      <div className="routine-actions">
        {pending.phase !== 'rejected' && <Button type="button" onClick={() => void submit()}
          disabled={busy || expired || retryIn > 0 || (pending.phase === 'review' ? !allowed(pending.action) : !readsReady)}>
          {t(busy ? 'routines.saving' : pending.phase === 'uncertain' ? 'routines.retrySame' : pendingConfig
            ? pending.action.kind === 'create' ? pending.action.body.enabled ? 'routines.activate' : 'routines.savePaused' : 'routines.save'
            : pendingState === 'paused' ? 'routines.pause' : pendingState === 'active' ? 'routines.resume' : 'routines.confirmRun')}
        </Button>}
        {pending.phase === 'review' && <Button type="button" variant="ghost" onClick={() => { setPending(null); if (!editor) cancel(); }}>{t(editor ? 'routines.change' : 'routines.cancel')}</Button>}
        {pending.phase === 'uncertain' && <Button type="button" variant="outline" disabled={state.loading} onClick={() => void state.refresh()}>{t('routines.reconcile')}</Button>}
        {pending.phase === 'rejected' && <Button type="button" variant="outline" disabled={state.loading || retryIn > 0} onClick={() => { cancel(); void state.refresh(); }}>{t('routines.reconcile')}</Button>}
      </div>
    </section>}

    {showEditor && <fieldset className="routine-editor-gate" disabled={!canSchedule}>
      <RoutineEditor editor={editor} onChange={setEditor} onReview={review} onCancel={cancel} />
    </fieldset>}
    {showEditor && !canSchedule && <Button variant="ghost" type="button" onClick={cancel}>{t('routines.cancel')}</Button>}

    {!pending && !editor && (adding || (readsReady && !selectedId && state.data!.routines.length === 0)) && <section className="routine-starters" aria-labelledby="routine-starters-title">
      <div className="routine-section-heading"><div><h2 id="routine-starters-title">{t('routines.empty')}</h2><p>{t(canManage ? 'routines.empty.detail' : 'routines.empty.readonly')}</p></div>
        {adding && <Button variant="ghost" type="button" onClick={cancel}>{t('routines.cancel')}</Button>}
      </div>
      {canManage && <div className="routine-starter-grid">{ROUTINE_KINDS.map((kind) => {
        const Icon = JOB_ICONS[kind];
        return <button type="button" key={kind} className="routine-starter card" disabled={!canAdd} onClick={() => pick(kind)}>
          <Icon size={26} weight="duotone" aria-hidden="true" /><strong>{t(`routines.kind.${kind}`)}</strong>
          <span>{t(`routines.description.${kind}`)}</span><span className="routine-starter-time">{scheduleLabel(starterSchedule(kind), lang, t)}</span>
          <span className="routine-link">{t('routines.choose')}<ArrowUpRight size={16} aria-hidden="true" /></span>
        </button>;
      })}</div>}
    </section>}

    {!editor && !adding && state.data && !state.error && <>
      {!selectedId && <div className="routine-list" aria-busy={state.loading}>
        {state.data.routines.map((routine) => {
          const Icon = JOB_ICONS[routine.task.kind];
          return <button type="button" className="routine-card card" key={routine.id} onClick={() => onSelect(routine.id)} aria-label={t('routines.open', { name: routine.name })}>
            <span className="routine-job-icon"><Icon size={24} weight="duotone" aria-hidden="true" /></span>
            <span className="routine-card-copy"><span className="routine-row-heading"><strong>{routine.name}</strong><Status value={routine.status} routine /></span>
              <span>{scheduleLabel(routine.schedule, lang, t)}</span>
              <span className="routine-muted">{routine.nextRunAt && routine.status === 'active' && caps?.canSchedule
                ? `${t('routines.next')}: ${routineDate(routine.nextRunAt, lang)}` : t('routines.noNext')}</span>
              <span className="routine-latest">{routine.lastOccurrence ? <>{t('routines.latest')}<Status value={routine.lastOccurrence.status} /></> : t('routines.notRun')}</span>
            </span><ArrowUpRight className="routine-card-arrow" size={18} aria-hidden="true" />
          </button>;
        })}
      </div>}
      {selectedId && <section className="routine-detail">
        <button type="button" className="routine-link" onClick={() => onSelect(null)}><ArrowLeft size={17} aria-hidden="true" />{t('routines.back')}</button>
        {state.detailLoading && !detail && <LoadingState title={t('routines.loading')} />}
        {state.detailError ? <div className="routine-notice" role="alert"><p>{t(errorKey(state.detailError, true))}</p>
          <Button type="button" variant="outline" onClick={() => void state.refresh()}>{t('routines.refresh')}</Button>
        </div> : detail && <>
          <div className="routine-detail-card card">
            <div className="routine-row-heading"><h2>{detail.name}</h2><Status value={detail.status} routine /></div>
            <p>{t(`routines.description.${detail.task.kind}`)}</p>
            <div className="routine-preview"><Clock size={24} aria-hidden="true" /><div><strong>{scheduleLabel(detail.schedule, lang, t)}</strong><p>{t('routines.zone')}</p></div></div>
            <div className="routine-next"><span>{t('routines.next')}</span><strong>{detail.nextRunAt && detail.status === 'active' && caps?.canSchedule ? routineDate(detail.nextRunAt, lang) : t('routines.noNext')}</strong></div>
            {detail.status === 'paused' && <p className="routine-muted">{t('routines.pause.detail')}</p>}
            {caps?.canManage && <div className="routine-actions">
              <Button type="button" variant="outline" disabled={!detailReady || !canSchedule || !!pending} onClick={() => {
                setNotice(null); setEditor({ config: { name: detail.name, task: detail.task, schedule: detail.schedule, delivery: detail.delivery }, source: detail, paused: detail.status === 'paused' });
              }}>{t('routines.edit')}</Button>
              <Button type="button" variant="outline" disabled={!detailReady || !canManage || (detail.status !== 'active' && !canSchedule) || !!pending} onClick={() => reviewAction('state')}>
                {detail.status === 'active' ? <Pause size={17} aria-hidden="true" /> : <Play size={17} aria-hidden="true" />}{t(detail.status === 'active' ? 'routines.pause' : 'routines.resume')}
              </Button>
              <Button type="button" variant="ghost" disabled={!detailReady || !canManage || !caps.canRunNow || !!pending} onClick={() => reviewAction('run')}><Play size={17} aria-hidden="true" />{t('routines.manual')}</Button>
            </div>}
          </div>
          {receipt?.routineId === detail.id && receipt.runId && <button type="button" className="routine-link" onClick={() => onOpenTask(receipt.runId!)}>{t('routines.viewResult')}<ArrowUpRight size={16} aria-hidden="true" /></button>}
          <section className="routine-history card" aria-labelledby="routine-history-title" aria-busy={state.detailLoading}>
            <div className="routine-section-heading"><h2 id="routine-history-title">{t('routines.history')}</h2><span>{t('routines.zone')}</span></div>
            {state.detail!.history.occurrences.length ? <ol>{state.detail!.history.occurrences.map((item) => <Occurrence item={item} key={item.id} onOpenTask={onOpenTask} />)}</ol> : <p className="routine-muted">{t('routines.history.empty')}</p>}
            {state.moreError && <p role="alert">{t('routines.more.error')}</p>}
            {state.detail!.history.nextCursor && <Button type="button" variant="outline" disabled={state.moreLoading || state.detailLoading} onClick={() => void state.loadMore()}>{t('routines.more')}</Button>}
          </section>
        </>}
      </section>}
    </>}
    {readsReady && caps.canManage && state.data!.routines.length >= caps.maxRoutines && <p className="routine-muted">{t('routines.limit', { n: caps.maxRoutines })}</p>}
    {!editor && !pending && <footer className="routine-footer"><Clock size={16} aria-hidden="true" /><p>{t('routines.zone')}<br />{t('routines.delivery')}</p></footer>}
  </section>;
}
