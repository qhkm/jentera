import { useEffect, useId, useState } from 'react';
import { Desktop } from '@phosphor-icons/react';
import { useRepository } from '@/lib/repo';
import type { BusinessBrowserState } from '@/lib/repo/types';

/** Frames are memory-only, opt-in and discarded on collapse/visibility loss. */
export function ComputerPreview({ runId }: { runId: string }) {
  const repo = useRepository();
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState(false);
  const [frame, setFrame] = useState<BusinessBrowserState | null>(null);
  const [failure, setFailure] = useState('');
  const [retry, setRetry] = useState(0);
  const [connection, setConnection] = useState('Connecting to browser…');
  const [transportError, setTransportError] = useState(false);
  const [displayError, setDisplayError] = useState(false);
  useEffect(() => {
    if (!open) { setFrame(null); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let flight: AbortController | undefined;
    let generation = 0;
    let finished = false;
    let failures = 0;
    setFailure('');
    setFrame(null);
    setTransportError(false);
    setDisplayError(false);
    setConnection(document.hidden || navigator.onLine === false
      ? 'Preview paused while this window is hidden or offline.' : 'Connecting to browser…');
    const hide = () => {
      generation++; flight?.abort(); setFrame(null);
      setConnection('Preview paused while this window is hidden or offline.');
    };
    const resume = () => {
      if (!document.hidden && navigator.onLine !== false) setRetry(n => n + 1);
      else hide();
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('offline', hide);
    window.addEventListener('online', resume);
    async function poll() {
      const current = generation;
      if (!document.hidden && navigator.onLine !== false) {
        setConnection('Connecting to browser…');
        flight = new AbortController();
        const controller = flight;
        let timeout = setTimeout(() => controller.abort(), 12000);
        try {
          if (repo.watchBrowser) {
            let received = false;
            await repo.watchBrowser(runId, next => {
              if (cancelled || current !== generation || document.hidden || controller.signal.aborted) return;
              received = true;
              clearTimeout(timeout);
              timeout = setTimeout(() => controller.abort(), 12000);
              failures = 0;
              setTransportError(false);
              setDisplayError(false);
              setFrame(previous => ['waiting', 'navigating'].includes(next.previewStatus ?? '') && previous?.previewStatus === 'ready' ? previous : next);
              setConnection(previous => next.previewStatus === 'ready' ? 'Live · read-only'
                : next.previewStatus === 'navigating' ? 'Navigating · last safe frame'
                  : next.previewStatus === 'waiting' ? previous : 'Waiting for browser activity…');
              finished = next.previewStatus === 'inactive';
            }, controller.signal);
            if (!received || controller.signal.aborted) throw new Error('Preview interrupted');
            if (!finished) setConnection('Reconnecting · last captured frame');
          } else {
            const next = await repo.businessBrowser({ action: 'preview', runId, controlId: crypto.randomUUID() }, flight.signal);
            if (!cancelled && current === generation && !document.hidden) {
              setTransportError(false);
              setDisplayError(false);
              const delivered = controller.signal.aborted ? { previewStatus: 'unavailable' as const } : next;
              setFrame(previous => ['waiting', 'navigating'].includes(delivered.previewStatus ?? '') && previous?.previewStatus === 'ready' ? previous : delivered);
              setConnection(previous => delivered.previewStatus === 'ready' ? 'Live · read-only'
                : delivered.previewStatus === 'navigating' ? 'Navigating · last safe frame'
                  : delivered.previewStatus === 'waiting' ? previous : 'Waiting for browser activity…');
              finished = next.previewStatus === 'inactive';
              if (controller.signal.aborted || !next.previewStatus || next.previewStatus === 'unavailable') failures++;
              else failures = 0;
            }
          }
        } catch (error) {
          if (!cancelled && current === generation && !document.hidden) {
            setConnection('Reconnecting · last captured frame');
            setTransportError(true);
            setFrame(previous => previous?.previewStatus === 'ready' ? previous : { previewStatus: 'unavailable' });
            failures++;
            const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
            if (status === 401 || status === 403) {
              finished = true;
              setFrame(null);
              setFailure(status === 401 ? 'Sign in again to view the computer.' : 'Computer previews require owner access.');
            }
          }
        } finally { clearTimeout(timeout); flight = undefined; }
      }
      if (!cancelled && !finished && failures >= 3) {
        finished = true;
        setFailure('Preview updates paused after repeated errors. This does not stop the task.');
      }
      if (!cancelled && !finished) timer = setTimeout(() => void poll(), Math.min(30000, (repo.watchBrowser ? 1000 : 8000) * (failures + 1)));
    }
    void poll();
    return () => { cancelled = true; flight?.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', resume); window.removeEventListener('offline', hide); window.removeEventListener('online', resume); };
  }, [open, runId, repo, retry]);
  const image = frame?.previewStatus === 'ready' && frame.image && frame.capturedAt;
  return <div className="computer-preview">
    <button type="button" className="ask-inline-action" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      <Desktop size={16} aria-hidden="true" />{open ? 'Hide computer preview' : 'Preview computer'}
    </button>
    {open && <div id={id} className={`computer-preview-panel${expanded ? ' is-expanded' : ''}`}>
      <p>Read-only browser preview · visible only to the owner. Sensitive pages are hidden where detected; detection is not guaranteed.</p>
      {image ? <>
        <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-label={expanded ? 'Shrink browser preview' : 'Expand browser preview'}>
          <img src={`data:image/jpeg;base64,${frame.image}`} alt="Browser view from this task" onError={() => { setDisplayError(true); setFrame({ previewStatus: 'unavailable' }); }} />
        </button>
        <p role="status">{failure || connection} · Captured at {new Date(frame.capturedAt!).toLocaleTimeString()}</p>
      </> : <p role="status">{failure || (!frame ? connection
        : frame.previewStatus === 'private' ? 'Preview hidden by the privacy filter. It will resume when the page passes the safety checks.'
          : frame.previewStatus === 'paused' ? 'Preview paused because the browser is under owner control. Hand control back to resume.'
          : frame.previewStatus === 'inactive' ? 'Browser work has ended. Jentera may still be preparing the final reply.'
            : frame.previewStatus === 'loading' ? 'Waiting for the task’s browser to become available…'
              : frame.previewStatus === 'navigating' ? 'The browser is navigating. Preview will resume on the next safe page…'
              : frame.previewStatus === 'waiting' ? 'Connected. Waiting for the browser view…'
                : displayError ? 'The browser view could not be displayed. Waiting for the next frame…'
                  : transportError ? 'Preview connection interrupted. Reconnecting without stopping the task…'
                    : 'The live browser feed is unavailable. Retrying without stopping the task…')}</p>}
      {failure && <button type="button" className="ask-inline-action" onClick={() => setRetry(n => n + 1)}>Retry preview</button>}
    </div>}
  </div>;
}
