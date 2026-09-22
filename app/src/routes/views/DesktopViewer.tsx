import { useEffect, useRef, useState } from 'react';
import { Keyboard, CornersIn, ArrowClockwise, HandPalm, Minus, Plus, CaretDown, ClipboardText } from '@phosphor-icons/react';
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
const MIN_ZOOM = .25;
const MAX_ZOOM = 2.5;

type NoVncDisplay = {
  scale: number;
  width: number;
  height: number;
};
type ZoomableRfb = RFB & {
  _canvas?: HTMLCanvasElement;
  _display?: NoVncDisplay;
  _screen?: HTMLElement;
};
type ZoomAnchor = { clientX: number; clientY: number; remoteX: number; remoteY: number };
type NoVncGesture = Event & { detail?: {
  type?: string;
  clientX?: number;
  clientY?: number;
  magnitudeX?: number;
  magnitudeY?: number;
} };

function defaultFit() {
  return typeof window === 'undefined' || !window.matchMedia
    ? true
    : !window.matchMedia(PHONE_VIEWPORT).matches;
}

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

// noVNC only exposes fit-to-container or 1:1 publicly. Its own Display scale
// is required for arbitrary local zoom because Display also translates pointer
// coordinates back into framebuffer pixels. A CSS transform would make taps
// land in the wrong place. Keep this version-pinned adapter in one place.
function internals(client: RFB | null) {
  const current = client as ZoomableRfb | null;
  if (!current?._display || !current._screen || !current._canvas) return null;
  return { display: current._display, screen: current._screen, canvas: current._canvas };
}

function anchorAt(client: RFB, clientX: number, clientY: number): ZoomAnchor | null {
  const viewer = internals(client);
  if (!viewer || viewer.display.scale <= 0) return null;
  const rect = viewer.canvas.getBoundingClientRect();
  return {
    clientX,
    clientY,
    remoteX: Math.min(viewer.display.width, Math.max(0, (clientX - rect.left) / viewer.display.scale)),
    remoteY: Math.min(viewer.display.height, Math.max(0, (clientY - rect.top) / viewer.display.scale)),
  };
}

function centerAnchor(client: RFB): ZoomAnchor | null {
  const viewer = internals(client);
  if (!viewer) return null;
  const rect = viewer.screen.getBoundingClientRect();
  return anchorAt(client, rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function restoreAnchor(client: RFB, anchor: ZoomAnchor) {
  const viewer = internals(client);
  if (!viewer) return;
  const rect = viewer.canvas.getBoundingClientRect();
  viewer.screen.scrollLeft += rect.left + anchor.remoteX * viewer.display.scale - anchor.clientX;
  viewer.screen.scrollTop += rect.top + anchor.remoteY * viewer.display.scale - anchor.clientY;
}

function applyView(client: RFB, zoom: number | null, anchor?: ZoomAnchor | null) {
  const viewer = internals(client);
  client.dragViewport = false;
  if (zoom === null) {
    client.clipViewport = false;
    client.scaleViewport = true;
    if (viewer) { viewer.screen.scrollLeft = 0; viewer.screen.scrollTop = 0; }
    return;
  }

  // Avoid assigning false repeatedly: noVNC's setter resets Display.scale to
  // 1 on every assignment, which would make a pinch visibly jump.
  if (client.scaleViewport) client.scaleViewport = false;
  if (client.clipViewport) client.clipViewport = false;
  if (!viewer || Math.abs(viewer.display.scale - zoom) < .001) return;
  viewer.display.scale = zoom;
  if (anchor) restoreAnchor(client, anchor);
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
  // Phones start at 1:1 and can move around the scrollable desktop; larger screens keep
  // the convenient fit-to-window default.
  const [zoom, setZoom] = useState<number | null>(() => defaultFit() ? null : 1);
  const [pan, setPan] = useState(false);
  const [showKeys, setShowKeys] = useState(defaultFit);
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
  const panRef = useRef(pan); panRef.current = pan;
  const pinch = useRef<{ magnitude: number; zoom: number; anchor: ZoomAnchor } | null>(null);
  const panGesture = useRef<{ clientX: number; clientY: number; scrollLeft: number; scrollTop: number } | null>(null);

  function clearInput() {
    composing.current = false; generation.current++;
    if (keyboard.current) { keyboard.current.value = SENTINEL; keyboard.current.blur(); }
  }
  function typeText(value: string) {
    if (!ready.current || !value || value.length > 4096) return false;
    // Type the pasted value into the already-focused remote field. This is
    // deliberately not clipboard sync: nothing is retained on either side,
    // and a reconnect can never replay it.
    for (const char of value) {
      const point = char.codePointAt(0)!;
      if (point < 32 || point === 127) continue;
      rfb.current?.sendKey(point <= 255 ? point : 0x01000000 | point);
    }
    return true;
  }
  function consume(input: HTMLInputElement) {
    const value = input.value.replaceAll(SENTINEL, ''); input.value = SENTINEL; input.setSelectionRange(1, 1);
    // Pasted newlines do not submit forms; use the explicit Enter control.
    typeText(value);
  }
  async function pasteLocalClipboard() {
    if (!ready.current) return;
    try {
      const text = await navigator.clipboard.readText();
      typeText(text);
    } catch {
      // Clipboard reads can be denied by iOS or browser permissions. Focus the
      // input so the platform's native Paste menu remains a reliable fallback.
      keyboard.current?.focus();
    }
  }

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let current: RFB | null = null;
    let failures = 0;
    let connectedAt = 0;
    const disconnect = () => {
      ready.current = false; pinch.current = null; panGesture.current = null; clearInput(); rfb.current = null;
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
        applyView(current, zoomRef.current);
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
      applyView(rfb.current, zoomRef.current);
    };
    // noVNC observes its container too, but mobile browsers can emit the
    // orientation event before CSS has settled. Reapply on the next two paint
    // frames so clipping/scaling uses the rotated stage dimensions without
    // reconnecting the desktop.
    const refreshViewport = () => {
      const current = rfb.current;
      const preserved = current && zoomRef.current !== null ? centerAnchor(current) : null;
      cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame);
      firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => {
          applyViewport();
          if (current && preserved) {
            const viewer = internals(current);
            if (viewer) {
              const rect = viewer.screen.getBoundingClientRect();
              restoreAnchor(current, { ...preserved, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 });
            }
          }
        });
      });
    };
    applyViewport();
    window.addEventListener('resize', refreshViewport);
    window.addEventListener('orientationchange', refreshViewport);
    window.visualViewport?.addEventListener('resize', refreshViewport);
    const observer = typeof ResizeObserver === 'undefined' || !canvas.current ? null : new ResizeObserver(refreshViewport);
    if (canvas.current) observer?.observe(canvas.current);
    return () => {
      cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame);
      window.removeEventListener('resize', refreshViewport);
      window.removeEventListener('orientationchange', refreshViewport);
      window.visualViewport?.removeEventListener('resize', refreshViewport);
      observer?.disconnect();
    };
  }, [phase]);

  useEffect(() => {
    const stage = canvas.current;
    if (!stage) return;
    const handleGesture = (raw: Event) => {
      const event = raw as NoVncGesture;
      const detail = event.detail;
      const current = rfb.current;
      if (!detail || !current) return;

      if (detail.type === 'pinch') {
        // noVNC normally turns pinch into remote Ctrl+wheel. Stop it in the
        // capture phase and magnify the viewer instead, leaving page zoom and
        // the remote browser's Ctrl state untouched.
        event.preventDefault(); event.stopPropagation();
        const magnitude = Math.hypot(detail.magnitudeX ?? 0, detail.magnitudeY ?? 0);
        if (raw.type === 'gesturestart') {
          const viewer = internals(current);
          const startZoom = viewer?.display.scale || zoomRef.current || 1;
          const anchor = anchorAt(current, detail.clientX ?? 0, detail.clientY ?? 0);
          pinch.current = magnitude > 0 && anchor ? { magnitude, zoom: startZoom, anchor } : null;
        } else if (raw.type === 'gesturemove' && pinch.current && magnitude > 0) {
          const next = clampZoom(pinch.current.zoom * magnitude / pinch.current.magnitude);
          zoomRef.current = next; setZoom(next); applyView(current, next, pinch.current.anchor);
        } else if (raw.type === 'gestureend') {
          pinch.current = null;
        }
        return;
      }

      if (detail.type !== 'drag' || zoomRef.current === null || !panRef.current) return;
      event.preventDefault(); event.stopPropagation();
      const viewer = internals(current);
      if (!viewer) return;
      if (raw.type === 'gesturestart') {
        panGesture.current = {
          clientX: detail.clientX ?? 0,
          clientY: detail.clientY ?? 0,
          scrollLeft: viewer.screen.scrollLeft,
          scrollTop: viewer.screen.scrollTop,
        };
      } else if (raw.type === 'gesturemove' && panGesture.current) {
        viewer.screen.scrollLeft = panGesture.current.scrollLeft - ((detail.clientX ?? 0) - panGesture.current.clientX);
        viewer.screen.scrollTop = panGesture.current.scrollTop - ((detail.clientY ?? 0) - panGesture.current.clientY);
      } else if (raw.type === 'gestureend') {
        panGesture.current = null;
      }
    };
    const options = { capture: true };
    stage.addEventListener('gesturestart', handleGesture, options);
    stage.addEventListener('gesturemove', handleGesture, options);
    stage.addEventListener('gestureend', handleGesture, options);
    return () => {
      stage.removeEventListener('gesturestart', handleGesture, options);
      stage.removeEventListener('gesturemove', handleGesture, options);
      stage.removeEventListener('gestureend', handleGesture, options);
    };
  }, []);

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

  const useZoom = (next: number) => {
    const current = rfb.current;
    const anchor = current ? centerAnchor(current) : null;
    const value = clampZoom(next);
    zoomRef.current = value; setZoom(value);
    if (current) applyView(current, value, anchor);
  };
  const nudgeZoom = (direction: -1 | 1) => {
    const current = rfb.current;
    const scale = zoomRef.current ?? internals(current)?.display.scale ?? 1;
    const next = direction > 0 ? Math.ceil((scale + .01) * 4) / 4 : Math.floor((scale - .01) * 4) / 4;
    useZoom(next);
  };
  const useFit = () => {
    zoomRef.current = null; panRef.current = false; setZoom(null); setPan(false);
    if (rfb.current) applyView(rfb.current, null);
  };

  return <section className={`business-desktop${pan && zoom !== null ? ' is-panning' : ''}`} aria-label={t('browser.desktop.screen')}
    onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}>
    <div className="business-desktop-stage-shell">
      <div className="business-desktop-stage" ref={canvas} aria-label={t('browser.desktop.screen')} />
      {phase !== 'ready' && <div className="business-desktop-status" role="status">
        {phase !== 'failed' && <span className="business-desktop-loading-indicator" aria-hidden="true" />}
        <p>{t(`browser.desktop.${phase}`)}</p>
        {phase === 'failed' && <button type="button" onClick={() => setAttempt(value => value + 1)}><ArrowClockwise size={17} />{t('loading.retry')}</button>}
      </div>}
    </div>
    <div className="business-desktop-toolbar">
      <div className="business-desktop-primary-actions">
        <button className="business-desktop-fit" type="button" disabled={phase !== 'ready' || zoom === null} onClick={useFit}>
          <CornersIn size={18} aria-hidden="true" /><span>{t('browser.desktop.fit')}</span>
        </button>
        <div className="business-desktop-zoom" role="group" aria-label={t('browser.zoomControls')}>
          <button type="button" aria-label={t('browser.zoomOut')} disabled={phase !== 'ready' || (zoom !== null && zoom <= MIN_ZOOM)} onClick={() => nudgeZoom(-1)}><Minus size={16} aria-hidden="true" /></button>
          <button type="button" className="business-desktop-zoom-value" aria-label={t('browser.desktop.actualSize')} disabled={phase !== 'ready'} onClick={() => useZoom(1)}>{zoom === null ? t('browser.desktop.fit') : `${Math.round(zoom * 100)}%`}</button>
          <button type="button" aria-label={t('browser.zoomIn')} disabled={phase !== 'ready' || (zoom !== null && zoom >= MAX_ZOOM)} onClick={() => nudgeZoom(1)}><Plus size={16} aria-hidden="true" /></button>
        </div>
        <button className="business-desktop-move" type="button" disabled={phase !== 'ready' || zoom === null} aria-pressed={pan}
          aria-label={t(pan ? 'browser.desktop.interact' : 'browser.desktop.pan')} onClick={() => setPan(value => !value)}>
          <HandPalm size={18} aria-hidden="true" /><span>{t('browser.desktop.move')}</span>
        </button>
        <div className="business-desktop-mobile-keyboard">
          <Keyboard size={18} aria-hidden="true" />
          <input ref={keyboard} aria-label={t('browser.desktop.keyboard')} type="password" defaultValue={SENTINEL}
            disabled={phase !== 'ready'} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            onFocus={event => { setShowKeys(true); event.currentTarget.setSelectionRange(1, 1); }}
            onPaste={event => {
              const text = event.clipboardData.getData('text/plain');
              if (!text) return;
              event.preventDefault(); event.stopPropagation(); typeText(text);
              event.currentTarget.value = SENTINEL; event.currentTarget.setSelectionRange(1, 1);
            }}
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
      </div>
      <div className={`business-desktop-secondary-actions${showKeys ? ' has-keys' : ''}`}>
        <span>{t(pan ? 'browser.desktop.hint.pan' : 'browser.desktop.hint.interact')}</span>
        <div className="business-desktop-keys" role="group" aria-label={t('browser.keys')}>
          <button type="button" className="business-desktop-paste" disabled={phase !== 'ready'} onClick={() => void pasteLocalClipboard()}>
            <ClipboardText size={17} aria-hidden="true" /><span>{t('browser.desktop.paste')}</span>
          </button>
          {showKeys && <>
            {['Tab', 'Enter', 'Backspace'].map(key => <button type="button" key={key} disabled={phase !== 'ready'}
              onClick={() => { if (ready.current) rfb.current?.sendKey(KEYS[key]); }}>{key}</button>)}
            <button type="button" className="business-desktop-hide-keys" aria-label={t('browser.desktop.hideKeys')} onClick={() => {
              keyboard.current?.blur(); setShowKeys(false);
            }}><CaretDown size={17} aria-hidden="true" /></button>
          </>}
        </div>
      </div>
    </div>
  </section>;
}
