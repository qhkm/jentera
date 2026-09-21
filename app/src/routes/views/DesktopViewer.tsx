import { useEffect, useRef, useState } from 'react';
import { Keyboard, ArrowsOut, ArrowClockwise, HandPalm } from '@phosphor-icons/react';
import type RFB from '@novnc/novnc';
import { useRepository } from '@/lib/repo';
import { useT } from '@/i18n/I18nProvider';

const SENTINEL = '\u200b';
const KEYS: Record<string, number> = { Enter: 0xff0d, Tab: 0xff09, Backspace: 0xff08,
  Delete: 0xffff, Escape: 0xff1b, ArrowLeft: 0xff51, ArrowUp: 0xff52, ArrowRight: 0xff53, ArrowDown: 0xff54 };
// A phone remains a phone after rotation. Width-only detection made an
// 844px-wide landscape phone start in fit mode, shrinking 1280px controls
// until they were too small to target.
const PHONE_VIEWPORT = '(max-width: 640px), (pointer: coarse) and (max-width: 960px), (pointer: coarse) and (max-height: 960px)';

function defaultFit() {
  return typeof window === 'undefined' || !window.matchMedia
    ? true
    : !window.matchMedia(PHONE_VIEWPORT).matches;
}

/** Only mounted after an explicit successful owner claim. noVNC renders the
 * real Chrome window/taskbar and supplies native pointer/drag/wheel/keyboard.
 * Never sync either clipboard or replay input across a dropped connection. */
export default function DesktopViewer({ controlId, onControlLost }: { controlId: string; onControlLost: () => void }) {
  const repo = useRepository();
  const t = useT();
  const canvas = useRef<HTMLDivElement>(null);
  const keyboard = useRef<HTMLInputElement>(null);
  const rfb = useRef<RFB | null>(null);
  const ready = useRef(false);
  const composing = useRef(false);
  const generation = useRef(0);
  const compositionGeneration = useRef(0);
  const lost = useRef(onControlLost); lost.current = onControlLost;
  const [phase, setPhase] = useState<'connecting' | 'ready' | 'reconnecting' | 'failed'>('connecting');
  const [attempt, setAttempt] = useState(0);
  // A 1280px desktop fitted into a phone is too small to target reliably.
  // Phones start at 1:1 and can pan the clipped viewport; larger screens keep
  // the convenient fit-to-window default.
  const [fit, setFit] = useState(defaultFit);
  const [pan, setPan] = useState(false);

  function clearInput() {
    composing.current = false; generation.current++;
    if (keyboard.current) { keyboard.current.value = SENTINEL; keyboard.current.blur(); }
  }
  function consume(input: HTMLInputElement) {
    const value = input.value.replaceAll(SENTINEL, ''); input.value = SENTINEL; input.setSelectionRange(1, 1);
    if (!ready.current || value.length > 4096) return;
    // Unicode key events, NOT remote clipboard insertion. Pasted newlines do
    // not submit forms; use the explicit Enter control when ready to submit.
    for (const char of value) {
      const point = char.codePointAt(0)!;
      if (point < 32 || point === 127) continue;
      rfb.current?.sendKey(point <= 255 ? point : 0x01000000 | point);
    }
  }

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let current: RFB | null = null;
    let failures = 0;
    let connectedAt = 0;
    const disconnect = () => {
      ready.current = false; clearInput(); rfb.current = null;
      current?.disconnect(); current = null;
    };
    async function connect() {
      if (!canvas.current || cancelled) return;
      try {
        const { default: Client } = await import('@novnc/novnc');
        if (cancelled || !canvas.current) return;
        const connection = repo.desktopConnection?.(controlId);
        if (!connection) throw new Error('Desktop unavailable');
        current = new Client(canvas.current, connection.url, { wsProtocols: connection.protocols });
        rfb.current = current;
        current.scaleViewport = fit; current.clipViewport = !fit; current.dragViewport = !fit && pan;
        current.resizeSession = false; current.focusOnClick = true;
        current.qualityLevel = 7; current.compressionLevel = 2; current.background = '#101412';
        // Authentication renews with the ten-minute idle-control window. A reconnect never acquires a
        // lease, claims another window, resumes the agent, or replays text.
        current.addEventListener('connect', () => {
          if (cancelled) return;
          connectedAt = Date.now(); ready.current = true; setPhase('ready');
        });
        current.addEventListener('disconnect', () => {
          ready.current = false; clearInput(); rfb.current = null; current = null;
          if (cancelled) return;
          if (connectedAt > 0 && Date.now() - connectedAt > 40_000) failures = 0;
          connectedAt = 0;
          if (++failures > 2) { setPhase('failed'); lost.current(); return; }
          setPhase('reconnecting'); timer = setTimeout(() => void connect(), failures * 1000);
        });
      } catch { if (!cancelled) { disconnect(); setPhase('failed'); lost.current(); } }
    }
    setPhase('connecting'); void connect();
    return () => { cancelled = true; clearTimeout(timer); disconnect(); };
  }, [repo, controlId, attempt]);

  useEffect(() => {
    let firstFrame = 0;
    let secondFrame = 0;
    const applyViewport = () => {
      if (!rfb.current) return;
      rfb.current.scaleViewport = fit;
      rfb.current.clipViewport = !fit;
      rfb.current.dragViewport = !fit && pan;
    };
    // noVNC observes its container too, but mobile browsers can emit the
    // orientation event before CSS has settled. Reapply on the next two paint
    // frames so clipping/scaling uses the rotated stage dimensions without
    // reconnecting the desktop.
    const refreshViewport = () => {
      cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame);
      firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(applyViewport);
      });
    };
    applyViewport();
    window.addEventListener('resize', refreshViewport);
    window.addEventListener('orientationchange', refreshViewport);
    window.visualViewport?.addEventListener('resize', refreshViewport);
    return () => {
      cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame);
      window.removeEventListener('resize', refreshViewport);
      window.removeEventListener('orientationchange', refreshViewport);
      window.visualViewport?.removeEventListener('resize', refreshViewport);
    };
  }, [fit, pan, phase]);

  useEffect(() => {
    const input = keyboard.current;
    if (!input) return;
    const beforeInput = (event: InputEvent) => {
      if (event.isComposing || composing.current) return;
      const key = event.inputType === 'deleteContentBackward' ? 'Backspace'
        : event.inputType === 'deleteContentForward' ? 'Delete' : null;
      if (key) { event.preventDefault(); event.stopPropagation(); if (ready.current) rfb.current?.sendKey(KEYS[key]); }
    };
    input.addEventListener('beforeinput', beforeInput);
    return () => input.removeEventListener('beforeinput', beforeInput);
  }, []);

  return <section className={`business-desktop${pan && !fit ? ' is-panning' : ''}`} aria-label={t('browser.desktop.screen')}
    onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}>
    <div className="business-desktop-stage" ref={canvas} aria-label={t('browser.desktop.screen')} />
    {phase !== 'ready' && <div className="business-desktop-status" role="status">
      <p>{t(`browser.desktop.${phase}`)}</p>
      {phase === 'failed' && <button type="button" onClick={() => setAttempt(value => value + 1)}><ArrowClockwise size={17} />{t('loading.retry')}</button>}
    </div>}
    <div className="business-desktop-toolbar">
      <span>{t('browser.desktop.hint')}</span>
      <div className="business-desktop-actions">
        <button type="button" disabled={phase !== 'ready'} aria-pressed={!fit} onClick={() => setFit(value => {
          const next = !value;
          if (next) setPan(false);
          return next;
        })}><ArrowsOut size={17} />{t(fit ? 'browser.desktop.actualSize' : 'browser.fitView')}</button>
        {!fit && <button type="button" disabled={phase !== 'ready'} aria-pressed={pan} onClick={() => setPan(value => !value)}>
          <HandPalm size={17} />{t(pan ? 'browser.desktop.interact' : 'browser.desktop.pan')}
        </button>}
        <div className="business-desktop-mobile-keyboard">
          <Keyboard size={17} aria-hidden="true" />
          <input ref={keyboard} aria-label={t('browser.desktop.keyboard')} type="password" defaultValue={SENTINEL}
            disabled={phase !== 'ready'} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            onFocus={event => event.currentTarget.setSelectionRange(1, 1)}
            onInput={event => { event.stopPropagation(); if (!composing.current && !(event.nativeEvent as InputEvent).isComposing) consume(event.currentTarget); }}
            onCompositionStart={() => { composing.current = true; compositionGeneration.current = generation.current; }}
            onCompositionEnd={event => { composing.current = false; if (compositionGeneration.current === generation.current) consume(event.currentTarget); else event.currentTarget.value = SENTINEL; }}
            onBlur={event => { composing.current = false; generation.current++; event.currentTarget.value = SENTINEL; }}
            onKeyDown={event => {
              event.stopPropagation();
              if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === 'Escape') { event.preventDefault(); event.currentTarget.blur(); return; }
              if ((event.ctrlKey || event.metaKey) && ['c', 'x'].includes(event.key.toLowerCase())) { event.preventDefault(); return; }
              if (KEYS[event.key]) { event.preventDefault(); if (ready.current) rfb.current?.sendKey(KEYS[event.key]); }
            }} />
          <span aria-hidden="true">{t('browser.desktop.keyboard')}</span>
        </div>
        {['Tab', 'Enter', 'Backspace'].map(key => <button type="button" key={key} disabled={phase !== 'ready'}
          onClick={() => { if (ready.current) rfb.current?.sendKey(KEYS[key]); }}>{key}</button>)}
      </div>
    </div>
  </section>;
}
