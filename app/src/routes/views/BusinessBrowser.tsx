import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Globe, ArrowDown, ArrowUp, X } from '@phosphor-icons/react';
import { Button, Card, Eyebrow, Input } from '@/components/ui';
import { useRepository } from '@/lib/repo';
import type { BrowserCommand, BusinessBrowserState } from '@/lib/repo/types';
import { useT } from '@/i18n/I18nProvider';
import '@/styles/business-browser.css';

type Action = BrowserCommand extends infer C ? C extends BrowserCommand ? Omit<C, 'controlId'> : never : never;

export default function BusinessBrowser({
  appearance = 'card',
  openRequest = 0,
  onPauseChange,
}: {
  appearance?: 'card' | 'chat-tool';
  openRequest?: number;
  onPauseChange?: (paused: boolean) => void;
}) {
  const repo = useRepository();
  const t = useT();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const controlId = useRef(crypto.randomUUID());
  const inFlight = useRef(false);
  const frameFlight = useRef<Promise<BusinessBrowserState> | null>(null);
  const actionBusy = useRef(false);
  const live = useRef(true);
  const [open, setOpen] = useState(false);
  const [controlled, setControlled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [state, setState] = useState<BusinessBrowserState>({});
  const [frame, setFrame] = useState<BusinessBrowserState | null>(null);
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');

  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    if (!openRequest) return;
    setError(''); setOpen(true);
  }, [openRequest]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStatusLoading(true);
    dialog.current?.showModal();
    void repo.businessBrowser().then((s) => {
      if (!cancelled && live.current) { setState(s); if (typeof s.paused === 'boolean') onPauseChange?.(s.paused); }
    })
      .catch((e: Error) => { if (!cancelled && live.current) setError(e.message); })
      .finally(() => { if (!cancelled && live.current) setStatusLoading(false); });
    return () => { cancelled = true; };
  }, [open, repo, onPauseChange]);

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
          if (!cancelled) setFrame(next);
        } catch (e) {
          if (!cancelled) {
            setError((e as Error).message);
            setControlled(false);
            setFrame(null);
          }
        } finally { inFlight.current = false; frameFlight.current = null; }
      }
      if (!cancelled) timer = setTimeout(() => void refresh(), 1500);
    }
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, controlled, repo]);

  async function send(action: Action) {
    if (actionBusy.current) return;
    actionBusy.current = true;
    setBusy(true);
    setError('');
    try {
      // A screenshot may be in flight when the owner clicks. Wait for it;
      // never silently drop a click or password because a poll held the slot.
      await frameFlight.current?.catch(() => undefined);
      inFlight.current = true;
      const next = await repo.businessBrowser({ ...action, controlId: controlId.current } as BrowserCommand);
      if (!live.current) return;
      if (action.action === 'claim') { setState(next); setControlled(true); onPauseChange?.(true); }
      if (action.action === 'release') {
        setState(next); setControlled(false); setFrame(null); setText('');
        onPauseChange?.(false);
      }
    } catch (e) {
      if (live.current) {
        const message = (e as Error).message;
        setError(message);
        /* A lost lease is not a transient error, and treating it as one is what
           trapped the owner: the toolbar kept offering Hand back, the only
           button it had, and that button could now only fail. Dropping the
           local claim puts Take control back within reach. */
        if (/expired|controlling this browser/i.test(message)) { setControlled(false); setFrame(null); }
      }
    }
    finally { inFlight.current = false; actionBusy.current = false; if (live.current) setBusy(false); }
  }

  function close() {
    // Closing the viewer does NOT silently hand a half-completed login to
    // the agent. The durable pause remains until an explicit hand-back.
    // The local claim does not survive, though: it goes stale while the dialog
    // is shut, and reopening on a stale one showed a Hand back that could only
    // 409. Reopening re-reads the real state and offers both doors.
    dialog.current?.close(); setOpen(false); setControlled(false); setFrame(null); setText(''); setUrl('');
  }

  const openBrowser = () => { setError(''); setOpen(true); };
  const trigger = appearance === 'chat-tool' ? (
    <button type="button" className="ask-context-link" onClick={openBrowser}
      aria-label={t('browser.open')} title={t('browser.open')}>
      <Globe size={15} aria-hidden="true" /><span>{t('browser.title')}</span>
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
    {open && createPortal(<dialog ref={dialog} className="business-browser-dialog" aria-labelledby={titleId}
      // Portals escape the composer DOM, but React events still bubble through it.
      onSubmit={(event) => event.stopPropagation()}
      onCancel={(e) => { e.preventDefault(); close(); }}>
      <header className="business-browser-toolbar">
        <h2 id={titleId}>{t('browser.title')}</h2>
        <button type="button" className="ask-inline-action" aria-label={t('browser.close')} onClick={close}><X size={20} /></button>
      </header>
      <p>{t('browser.privacy')}</p>
      <p role="status">{t(statusLoading ? 'browser.loading' : controlled || state.paused ? 'browser.paused' : 'browser.available')}</p>
      {error && <p role="alert" className="text-red">{error}</p>}
      <div className="business-browser-toolbar">
        {!controlled ? <Button disabled={busy || statusLoading} onClick={() => void send({ action: 'claim' })}>{t('browser.takeControl')}</Button>
          : <Button disabled={busy} onClick={() => void send({ action: 'release' })}>{t('browser.handBack')}</Button>}
        {/* A browser left paused by a session that ended is the state the owner
            most needs a way out of, and it is exactly the state that offered
            none: no live claim, so no Hand back, while the agent refused every
            task behind it. Whenever it is paused, handing back is one click. */}
        {!controlled && state.paused && <Button variant="outline" disabled={busy || statusLoading}
          onClick={() => void send({ action: 'release' })}>{t('browser.handBack')}</Button>}
        {controlled && <span>{t('browser.expires')}</span>}
      </div>
      {controlled && <>
        <form className="business-browser-toolbar" onSubmit={(e) => { e.preventDefault(); void send({ action: 'navigate', url }); }}>
          <Input aria-label={t('browser.address')} placeholder="https://example.com" type="url" value={url}
            onChange={(e) => setUrl(e.target.value)} autoComplete="off" spellCheck={false} />
          <Button variant="outline" disabled={busy || !url}>{t('browser.go')}</Button>
        </form>
        {frame?.tabs && <div className="business-browser-toolbar" aria-label={t('browser.tabs')}>
          {frame.tabs.map((tab) => <button type="button" className="ask-inline-action" key={tab.index}
            aria-pressed={tab.selected} disabled={busy} onClick={() => void send({ action: 'tab', index: tab.index })}>
            {tab.index + 1}. {tab.origin === 'null' ? t('browser.blank') : tab.origin}
          </button>)}
        </div>}
        {frame?.image ? <button type="button" className="business-browser-screen" disabled={busy}
          aria-label={t('browser.screen')} onClick={(e) => {
            const bounds = e.currentTarget.getBoundingClientRect();
            void send({ action: 'click', x: Math.min(1279, Math.max(0, (e.clientX - bounds.left) * 1280 / bounds.width)),
              y: Math.min(799, Math.max(0, (e.clientY - bounds.top) * 800 / bounds.height)) });
          }}>
          <img src={`data:image/jpeg;base64,${frame.image}`} alt={t('browser.screen')} draggable={false} />
        </button> : <p>{t('browser.loading')}</p>}
        <form className="business-browser-toolbar" onSubmit={(e) => {
          e.preventDefault(); const value = text; setText(''); void send({ action: 'text', text: value });
        }}>
          <Input aria-label={t('browser.type')} placeholder={t('browser.type')} type="password" value={text}
            onChange={(e) => setText(e.target.value)} autoComplete="off" spellCheck={false} />
          <Button variant="outline" disabled={busy || !text}>{t('browser.sendText')}</Button>
        </form>
        <div className="business-browser-toolbar">
          {['Tab', 'Shift+Tab', 'Enter', 'Backspace', 'Escape', 'ControlOrMeta+A'].map((key) =>
            <Button key={key} variant="outline" disabled={busy} onClick={() => void send({ action: 'key', key })}>
              {key === 'ControlOrMeta+A' ? t('browser.selectAll') : key}
            </Button>)}
          <Button variant="outline" disabled={busy} aria-label={t('browser.scrollUp')} onClick={() => void send({ action: 'scroll', deltaY: -500 })}><ArrowUp size={18} /></Button>
          <Button variant="outline" disabled={busy} aria-label={t('browser.scrollDown')} onClick={() => void send({ action: 'scroll', deltaY: 500 })}><ArrowDown size={18} /></Button>
        </div>
      </>}
      <p className="text-sm text-text-secondary">{t('browser.closeNote')}</p>
    </dialog>, document.body)}
  </>;
}
