import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Globe, ArrowDown, ArrowUp, ArrowRight, ArrowBendDownLeft, CheckCircle, Clock, Eye, EyeSlash, Keyboard, CursorClick, ShieldCheck, WarningCircle, Minus, Plus, X } from '@phosphor-icons/react';
import { Button, Card, Eyebrow, Input } from '@/components/ui';
import { useRepository } from '@/lib/repo';
import type { BrowserCommand, BusinessBrowserState } from '@/lib/repo/types';
import { BrowserInput, type DirectInputState } from '@/lib/browser-input';
import { useT } from '@/i18n/I18nProvider';
import '@/styles/business-browser.css';

type Action = BrowserCommand extends infer C ? C extends BrowserCommand ? Omit<C, 'controlId'> : never : never;

export default function BusinessBrowser({
  appearance = 'card',
  openRequest = 0,
  onPauseChange,
}: {
  appearance?: 'card' | 'chat-tool' | 'dialog-only';
  openRequest?: number;
  onPauseChange?: (paused: boolean) => void;
}) {
  const repo = useRepository();
  const t = useT();
  const titleId = useId();
  const descriptionId = useId();
  const typingId = useId();
  const keyboardProxy = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const compositionRevision = useRef(0);
  const compositionStartRevision = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const controlId = useRef(crypto.randomUUID());
  const inFlight = useRef(false);
  const frameFlight = useRef<Promise<BusinessBrowserState> | null>(null);
  const actionBusy = useRef(false);
  const actionChain = useRef<Promise<void>>(Promise.resolve());
  const pendingActions = useRef(0);
  const live = useRef(true);
  const viewGeneration = useRef(0);
  const [open, setOpen] = useState(false);
  const [controlled, setControlled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusAttempt, setStatusAttempt] = useState(0);
  const [state, setState] = useState<BusinessBrowserState>({});
  const [frame, setFrame] = useState<BusinessBrowserState | null>(null);
  const [error, setError] = useState('');
  const [controlConflict, setControlConflict] = useState(false);
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [showText, setShowText] = useState(false);
  const [handedBack, setHandedBack] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [typingState, setTypingState] = useState<DirectInputState>({ phase: 'idle' });
  const direct = useRef<BrowserInput | null>(null);
  const dispatch = useRef(send);
  dispatch.current = send;
  if (!direct.current) direct.current = new BrowserInput(
    command => dispatch.current(command),
    next => {
      if (live.current) setTypingState(next);
      if (next.phase === 'idle') {
        composing.current = false; compositionRevision.current++;
        if (keyboardProxy.current) { keyboardProxy.current.value = '\u200b'; keyboardProxy.current.blur(); }
      }
    },
    () => { if (live.current) setError(previous => previous || t('browser.direct.interrupted')); },
  );
  const directEnabled = controlled && frame?.directTyping === 1;
  // A zero-width sentinel lets mobile keyboards emit Backspace even though
  // the proxy never retains the remote field's value. Nothing is persisted.
  const sentinel = '\u200b';

  function resetTyping() {
    direct.current?.reset(); composing.current = false; compositionRevision.current++;
    if (keyboardProxy.current) keyboardProxy.current.value = sentinel;
  }

  function consumeProxy(input: HTMLInputElement) {
    // Changing input type (password -> text) can reset the local caret to
    // zero. Strip our one sentinel wherever that first character landed.
    const value = input.value.replace(sentinel, '');
    input.value = sentinel; input.setSelectionRange(1, 1);
    direct.current?.text(value);
  }

  useEffect(() => {
    const input = keyboardProxy.current;
    if (!directEnabled || !input) return;
    const beforeInput = (event: InputEvent) => {
      if (composing.current || event.isComposing) return;
      if (input.value === sentinel) input.setSelectionRange(1, 1);
      if (event.inputType === 'deleteContentBackward' || event.inputType === 'deleteContentForward') {
        event.preventDefault(); event.stopPropagation();
        direct.current?.key(event.inputType === 'deleteContentBackward' ? 'Backspace' : 'Delete');
      } else if (event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph') {
        event.preventDefault(); event.stopPropagation(); direct.current?.key('Enter');
      }
    };
    input.addEventListener('beforeinput', beforeInput);
    return () => input.removeEventListener('beforeinput', beforeInput);
  }, [directEnabled]);

  useEffect(() => { live.current = true; return () => { live.current = false; resetTyping(); }; }, []);
  useEffect(() => {
    if (!openRequest) return;
    setError(''); setHandedBack(false); setOpen(true);
  }, [openRequest]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    setStatusLoading(true);
    dialog.current?.showModal();
    void repo.businessBrowser().then((s) => {
      if (!cancelled && live.current) { setState(s); if (typeof s.paused === 'boolean') onPauseChange?.(s.paused); }
    })
      .catch((e: Error) => { if (!cancelled && live.current) setError(e.message); })
      .finally(() => { if (!cancelled && live.current) setStatusLoading(false); });
    return () => { cancelled = true; document.body.style.overflow = priorOverflow; };
  }, [open, repo, onPauseChange, statusAttempt]);

  useEffect(() => {
    if (!open || !controlled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      if (!inFlight.current && !actionBusy.current && !document.hidden) {
        inFlight.current = true;
        try {
          frameFlight.current = repo.businessBrowser({ action: 'frame', controlId: controlId.current });
          const next = await frameFlight.current;
          if (!cancelled) { setFrame(next); direct.current?.observe(next); }
        } catch (e) {
          if (!cancelled) {
            setError((e as Error).message);
            setControlled(false);
            setFrame(null);
            setText(''); setShowText(false);
            resetTyping();
          }
        } finally { inFlight.current = false; frameFlight.current = null; }
      }
      if (!cancelled) timer = setTimeout(() => void refresh(), 1500);
    }
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, controlled, repo]);

  async function send(action: Action) {
    const generation = viewGeneration.current;
    const previous = actionChain.current;
    let finish!: () => void;
    actionChain.current = new Promise(resolve => { finish = resolve; });
    pendingActions.current++;
    actionBusy.current = true;
    setBusy(true);
    setError('');
    await previous;
    try {
      if (!live.current || generation !== viewGeneration.current) return null;
      // A screenshot may be in flight when the owner clicks. Wait for it;
      // never silently drop a click or password because a poll held the slot.
      await frameFlight.current?.catch(() => undefined);
      inFlight.current = true;
      const next = await repo.businessBrowser({ ...action, controlId: controlId.current } as BrowserCommand);
      if (!live.current) return null;
      if (action.action === 'claim' || action.action === 'reclaim') {
        setControlConflict(false);
        setState(next); onPauseChange?.(true);
        if (generation === viewGeneration.current) { setControlled(true); setHandedBack(false); }
      }
      if (action.action === 'release') {
        setState(next); setControlled(false); setFrame(null); setText(''); setShowText(false);
        if (generation === viewGeneration.current) setHandedBack(true);
        onPauseChange?.(false);
      }
      if (generation !== viewGeneration.current) return null;
      if (next.image) setFrame(next);
      return next;
    } catch (e) {
      if (live.current && generation === viewGeneration.current) {
        const message = (e as Error).message;
        setError(message);
        setControlConflict(/controlling this browser/i.test(message));
        /* A lost lease is not a transient error, and treating it as one is what
           trapped the owner: the toolbar kept offering Hand back, the only
           button it had, and that button could now only fail. Dropping the
           local claim puts Take control back within reach. */
        if (/expired|controlling this browser/i.test(message)) { setControlled(false); setFrame(null); setText(''); setShowText(false); resetTyping(); }
      }
      return null;
    }
    finally {
      inFlight.current = false; pendingActions.current--; actionBusy.current = pendingActions.current > 0;
      finish(); if (live.current) setBusy(actionBusy.current);
    }
  }

  function command(action: Action) { resetTyping(); void send(action); }

  function close() {
    viewGeneration.current += 1;
    resetTyping();
    // Closing the viewer does NOT silently hand a half-completed login to
    // the agent. The durable pause remains until an explicit hand-back.
    // The local claim does not survive, though: it goes stale while the dialog
    // is shut, and reopening on a stale one showed a Hand back that could only
    // 409. Reopening re-reads the real state and offers both doors.
    dialog.current?.close(); setOpen(false); setControlled(false); setControlConflict(false); setFrame(null); setText(''); setShowText(false); setUrl(''); setZoom(1);
  }

  const openBrowser = () => { setError(''); setHandedBack(false); setOpen(true); };
  const mode = statusLoading ? 'checking' : controlled ? 'control' : state.paused ? 'paused' : 'view';
  const tabName = (origin: string) => {
    try { return new URL(origin).hostname || t('browser.blank'); } catch { return t('browser.blank'); }
  };
  const trigger = appearance === 'chat-tool' ? (
    <button type="button" className="ask-context-link" onClick={openBrowser}
      aria-label={t('browser.open')} title={t('browser.open')}>
      <Globe size={15} aria-hidden="true" /><span>{t('ask.toolbar.browser')}</span>
    </button>
  ) : null;

  return <>
    {appearance === 'card' ? <Card className="gap-3">
      <Eyebrow>{t('browser.title')}</Eyebrow>
      <p className="text-sm text-text-secondary">{t('browser.description')}</p>
      <div><Button variant="outline" onClick={openBrowser}>
        <Globe size={18} aria-hidden="true" />{t('browser.open')}
      </Button></div>
    </Card> : trigger}
    {open && createPortal(<dialog ref={dialog} className="business-browser-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
      // Portals escape the composer DOM, but React events still bubble through it.
      onSubmit={(event) => event.stopPropagation()}
      onCancel={(e) => { e.preventDefault(); close(); }}>
      <header className="business-browser-header">
        <span className="business-browser-brand" aria-hidden="true"><Globe size={25} weight="duotone" /></span>
        <div className="business-browser-heading">
          <h2 id={titleId}>{t('browser.title')}</h2>
          <p id={descriptionId}>{t('browser.subtitle')}</p>
        </div>
        <span className={`business-browser-state is-${mode}`} role="status">
          <span aria-hidden="true" />{t(`browser.state.${mode}`)}
        </span>
        <button type="button" className="business-browser-icon-button" aria-label={t('browser.close')} title={t('browser.close')} onClick={close}><X size={20} aria-hidden="true" /></button>
      </header>
      <div className="business-browser-body">
        {error && <div className="business-browser-error" role="alert">
          <WarningCircle size={20} aria-hidden="true" /><p>{error}</p>
          {!controlled && <button type="button" disabled={busy || statusLoading} onClick={() => { setError(''); setStatusAttempt(n => n + 1); }}>{t('loading.retry')}</button>}
        </div>}
        {!controlled && controlConflict && state.controlRecovery === 1 && <div className="business-browser-recovery" role="region" aria-label={t('browser.recover.title')}>
          <div><strong>{t('browser.recover.title')}</strong><p>{t('browser.recover.detail')}</p></div>
          <Button type="button" disabled={busy || statusLoading} onClick={() => command({ action: 'reclaim' })}>{t('browser.recover.action')}<ArrowRight size={16} aria-hidden="true" /></Button>
        </div>}
        <div className={`business-browser-workspace ${controlled ? 'is-controlled' : ''}`}>
          <div className="business-browser-window">
            {controlled && frame?.tabs && frame.tabs.length > 0 && <div className="business-browser-tabs" role="group" aria-label={t('browser.tabs')}>
              {frame.tabs.map(tab => <button type="button" key={tab.index} aria-pressed={tab.selected}
                title={tab.origin === 'null' ? t('browser.blank') : tab.origin} disabled={busy}
                onClick={() => command({ action: 'tab', index: tab.index })}>
                <Globe size={14} aria-hidden="true" /><span>{tabName(tab.origin)}</span>
              </button>)}
            </div>}
            {controlled ? <form className="business-browser-address" onSubmit={e => { e.preventDefault(); command({ action: 'navigate', url }); }}>
              <Globe size={17} aria-hidden="true" />
              <Input aria-label={t('browser.address')} placeholder={frame?.tabs?.find(tab => tab.selected)?.origin || 'https://example.com'} type="url" value={url}
                disabled={busy} onChange={e => setUrl(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} />
              <Button type="submit" variant="outline" disabled={busy || !url}>{t('browser.go')}<ArrowRight size={16} aria-hidden="true" /></Button>
            </form> : <div className="business-browser-window-label"><Globe size={16} aria-hidden="true" />{t('browser.windowLabel')}</div>}
            {controlled && frame?.image ? <div className="business-browser-viewport" ref={viewport}><button type="button" className="business-browser-screen" disabled={busy && !directEnabled} style={{ width: `${zoom * 100}%` }}
              aria-label={t(directEnabled ? 'browser.direct.screen' : 'browser.screen')} onClick={e => {
                // Keyboard activation has no remote screen coordinates. Use the
                // explicit key controls, never turn it into a top-left click.
                if (!e.detail) return;
                const bounds = e.currentTarget.getBoundingClientRect();
                const x = Math.min(1279, Math.max(0, (e.clientX - bounds.left) * 1280 / bounds.width));
                const y = Math.min(799, Math.max(0, (e.clientY - bounds.top) * 800 / bounds.height));
                if (directEnabled) {
                  composing.current = false; compositionRevision.current++;
                  if (keyboardProxy.current) { keyboardProxy.current.value = sentinel; keyboardProxy.current.readOnly = false; }
                  direct.current?.select(x, y);
                  // Focus synchronously inside the tap: iOS won't open its
                  // keyboard if we wait for the network acknowledgement.
                  keyboardProxy.current?.focus({ preventScroll: true });
                  keyboardProxy.current?.setSelectionRange(1, 1);
                } else command({ action: 'click', x, y });
              }}>
              <img src={`data:image/jpeg;base64,${frame.image}`} alt={t('browser.screen')} draggable={false} />
            </button></div> : <div className="business-browser-empty" role={controlled || statusLoading ? 'status' : undefined}>
              <span className="business-browser-empty-icon" aria-hidden="true">
                {handedBack ? <CheckCircle size={38} weight="duotone" /> : controlled || statusLoading ? <Clock size={38} weight="duotone" /> : <CursorClick size={38} weight="duotone" />}
              </span>
              <h3>{t(handedBack ? 'browser.returned.title' : controlled || statusLoading ? 'browser.loading' : 'browser.welcome.title')}</h3>
              <p>{t(handedBack ? 'browser.returned.detail' : controlled || statusLoading ? 'browser.loadingDetail' : 'browser.welcome.detail')}</p>
              {!controlled && !handedBack && <ol className="business-browser-guide" aria-label={t('browser.guide')}>
                {['takeControl', 'signIn', 'handBack'].map((step, i) => <li key={step}><span>{i + 1}</span>{t(`browser.step.${step}`)}</li>)}
              </ol>}
            </div>}
            {controlled && <div className="business-browser-view-hint">
              {directEnabled ? <div className="business-browser-direct-input">
                <Keyboard size={16} aria-hidden="true" />
                <div className="business-browser-keyboard-proxy">
                  <input ref={keyboardProxy} aria-label={t('browser.direct.keyboard')} aria-describedby={`${typingId}-direct`}
                    type={typingState.kind === 'text' || typingState.kind === 'multiline' ? 'text' : 'password'}
                    defaultValue={sentinel} readOnly={typingState.phase === 'idle'}
                    autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                    onInput={e => {
                      e.stopPropagation();
                      if (!composing.current && !(e.nativeEvent as InputEvent).isComposing) consumeProxy(e.currentTarget);
                    }}
                    onCompositionStart={e => {
                      if (e.currentTarget.value === sentinel) e.currentTarget.setSelectionRange(1, 1);
                      composing.current = true; compositionStartRevision.current = compositionRevision.current;
                    }}
                    onCompositionEnd={e => {
                      composing.current = false;
                      if (compositionStartRevision.current === compositionRevision.current) consumeProxy(e.currentTarget);
                      else e.currentTarget.value = sentinel;
                    }}
                    onBlur={e => { composing.current = false; compositionRevision.current++; e.currentTarget.value = sentinel; }}
                    onKeyDown={e => {
                      e.stopPropagation();
                      if (e.nativeEvent.isComposing || composing.current || e.keyCode === 229) return;
                      if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.blur(); return; }
                      // This is an input sink, not the remote clipboard. Never
                      // replace the owner's clipboard with the local sentinel.
                      if ((e.ctrlKey || e.metaKey) && ['c', 'x'].includes(e.key.toLowerCase())) { e.preventDefault(); return; }
                      const key = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' ? 'ControlOrMeta+A'
                        : e.shiftKey && ['Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key) ? `Shift+${e.key}` : e.key;
                      if (['Enter', 'Tab', 'Shift+Tab', 'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'ControlOrMeta+A',
                        'Shift+ArrowLeft', 'Shift+ArrowRight', 'Shift+ArrowUp', 'Shift+ArrowDown', 'Shift+Home', 'Shift+End'].includes(key)) {
                        e.preventDefault(); direct.current?.key(key);
                      }
                    }} />
                  <span id={`${typingId}-direct`} aria-live="polite">{t(`browser.direct.${typingState.kind === 'control' && typingState.phase === 'ready' ? 'control' : typingState.phase}`)}</span>
                </div>
              </div> : <div><CursorClick size={16} aria-hidden="true" /><span>{t('browser.clickHint')}</span></div>}
              <div className="business-browser-zoom" role="group" aria-label={t('browser.zoomControls')}>
                <button type="button" onClick={() => { setZoom(1); if (viewport.current) { viewport.current.scrollTop = 0; viewport.current.scrollLeft = 0; } }}>{t('browser.fitView')}</button>
                <button type="button" className="business-browser-icon-button" aria-label={t('browser.zoomOut')} disabled={zoom <= 1} onClick={() => setZoom(v => Math.max(1, v - .25))}><Minus size={15} aria-hidden="true" /></button>
                <output>{Math.round(zoom * 100)}%</output>
                <button type="button" className="business-browser-icon-button" aria-label={t('browser.zoomIn')} disabled={zoom >= 2.5} onClick={() => setZoom(v => Math.min(2.5, v + .25))}><Plus size={15} aria-hidden="true" /></button>
              </div>
            </div>}
          </div>
          {controlled && <aside className="business-browser-controls" aria-label={t('browser.controls')}>
            <div className="business-browser-controls-heading"><Keyboard size={20} aria-hidden="true" /><h3>{t('browser.controls')}</h3></div>
            <p id={typingId}>{t(directEnabled ? 'browser.direct.hint' : 'browser.typingHint')}</p>
            <form className="business-browser-typing" autoComplete="off" onSubmit={e => {
              e.preventDefault(); const value = text; setText(''); setShowText(false);
              if (directEnabled) direct.current?.text(value);
              else command({ action: 'text', text: value });
            }}>
              <label className="business-browser-field-label" htmlFor={`${typingId}-input`}>{t('browser.type')}</label>
              <div className="business-browser-text-field">
                <Input id={`${typingId}-input`} aria-describedby={typingId} placeholder={t('browser.typePlaceholder')} type={showText ? 'text' : 'password'} value={text}
                  disabled={busy} onChange={e => setText(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} />
                <button type="button" className="business-browser-icon-button" aria-label={t(showText ? 'browser.hideText' : 'browser.showText')}
                  title={t(showText ? 'browser.hideText' : 'browser.showText')} aria-pressed={showText} disabled={busy} onClick={() => setShowText(v => !v)}>
                  {showText ? <EyeSlash size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
                </button>
              </div>
              <Button type="submit" variant="outline" disabled={busy || !text || !frame?.image || (directEnabled && (typingState.phase === 'idle' || typingState.kind === 'control'))}>{t('browser.sendText')}<ArrowRight size={16} aria-hidden="true" /></Button>
            </form>
            <div className="business-browser-keys" role="group" aria-label={t('browser.keys')}>
              {['Tab', 'Enter', 'Backspace'].map(key => <Button key={key} type="button" variant="outline" disabled={busy || !frame?.image}
                onClick={() => { if (directEnabled && typingState.phase !== 'idle') direct.current?.key(key); else command({ action: 'key', key }); }}>{key === 'Enter' && <ArrowBendDownLeft size={15} aria-hidden="true" />}{key}</Button>)}
            </div>
            <details className="business-browser-more">
              <summary>{t('browser.moreControls')}</summary>
              <div className="business-browser-keys">
                {['Shift+Tab', 'Escape', 'ControlOrMeta+A'].map(key => <Button key={key} type="button" variant="outline" disabled={busy || !frame?.image}
                  onClick={() => { if (directEnabled && typingState.phase !== 'idle' && key !== 'Escape') direct.current?.key(key); else command({ action: 'key', key }); }}>{key === 'ControlOrMeta+A' ? t('browser.selectAll') : key}</Button>)}
                <Button type="button" variant="outline" disabled={busy || !frame?.image} aria-label={t('browser.scrollUp')} onClick={() => void send({ action: 'scroll', deltaY: -500 })}><ArrowUp size={17} aria-hidden="true" />{t('browser.scrollUp')}</Button>
                <Button type="button" variant="outline" disabled={busy || !frame?.image} aria-label={t('browser.scrollDown')} onClick={() => void send({ action: 'scroll', deltaY: 500 })}><ArrowDown size={17} aria-hidden="true" />{t('browser.scrollDown')}</Button>
              </div>
            </details>
            <div className="business-browser-privacy"><ShieldCheck size={19} aria-hidden="true" /><p>{t('browser.privacyShort')}</p></div>
            <p className="business-browser-lease"><Clock size={15} aria-hidden="true" />{t('browser.expires')}</p>
          </aside>}
        </div>
      </div>
      <footer className="business-browser-footer">
        <div className="business-browser-footer-note">
          {controlled || state.paused ? <ShieldCheck size={21} aria-hidden="true" /> : <Globe size={21} aria-hidden="true" />}
          <div><strong>{t(controlled || state.paused ? 'browser.paused' : 'browser.footer.title')}</strong>
            <p>{t(controlled || state.paused ? 'browser.footer.paused' : 'browser.available')}</p></div>
        </div>
        <div className="business-browser-control-actions">
          {!controlled && <Button type="button" variant={state.paused ? 'outline' : 'primary'} disabled={busy || statusLoading}
            onClick={() => command({ action: 'claim' })}><CursorClick size={18} aria-hidden="true" />{t('browser.takeControl')}</Button>}
          {/* Also recover a durable pause left by an abandoned/expired controller. */}
          {(controlled || state.paused) && <Button type="button" disabled={busy || statusLoading}
            onClick={() => command({ action: 'release' })}>{t('browser.handBack')}<ArrowRight size={18} aria-hidden="true" /></Button>}
        </div>
      </footer>
    </dialog>, document.body)}
  </>;
}
