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
  useEffect(() => {
    if (!open) { setFrame(null); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let flight: AbortController | undefined;
    let generation = 0;
    let finished = false;
    let failures = 0;
    setFailure('');
    const hide = () => { generation++; flight?.abort(); setFrame(null); };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('offline', hide);
    async function poll() {
      const current = generation;
      if (!document.hidden && navigator.onLine !== false) {
        // A failed or slow refresh must not leave an old image looking live.
        setFrame(null);
        flight = new AbortController();
        const controller = flight;
        const timeout = setTimeout(() => controller.abort(), 12000);
        try {
          const next = await repo.businessBrowser({ action: 'preview', runId, controlId: crypto.randomUUID() }, flight.signal);
          if (!cancelled && current === generation && !document.hidden) {
            setFrame(controller.signal.aborted ? { previewStatus: 'unavailable' } : next);
            finished = next.previewStatus === 'inactive';
            if (controller.signal.aborted || !next.previewStatus || next.previewStatus === 'unavailable') failures++;
            else failures = 0;
          }
        } catch (error) {
          if (!cancelled && current === generation && !document.hidden) {
            setFrame({ previewStatus: 'unavailable' });
            failures++;
            const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
            if (status === 401 || status === 403) {
              finished = true;
              setFailure(status === 401 ? 'Sign in again to view the computer.' : 'Computer previews require owner access.');
            }
          }
        } finally { clearTimeout(timeout); flight = undefined; }
      }
      if (!cancelled && !finished && failures >= 3) {
        finished = true;
        setFailure('Preview updates paused after repeated errors. This does not stop the task.');
      }
      if (!cancelled && !finished) timer = setTimeout(() => void poll(), Math.min(30000, 8000 * (failures + 1)));
    }
    void poll();
    return () => { cancelled = true; flight?.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', hide); window.removeEventListener('offline', hide); };
  }, [open, runId, repo, retry]);
  const image = frame?.previewStatus === 'ready' && frame.image && frame.capturedAt;
  return <div className="computer-preview">
    <button type="button" className="ask-inline-action" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      <Desktop size={16} aria-hidden="true" />{open ? 'Hide computer preview' : 'Preview computer'}
    </button>
    {open && <div id={id} className={`computer-preview-panel${expanded ? ' is-expanded' : ''}`}>
      <p>Owner-only browser snapshots. May contain business information. Login and form pages are suppressed, but sensitive-content detection is not guaranteed.</p>
      {image ? <>
        <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-label={expanded ? 'Shrink browser snapshot' : 'Expand browser snapshot'}>
          <img src={`data:image/jpeg;base64,${frame.image}`} alt="Browser snapshot from this task" onError={() => { setFrame({ previewStatus: 'unavailable' }); }} />
        </button>
        <p>Captured at {new Date(frame.capturedAt!).toLocaleTimeString()} · refreshes about every 8 seconds</p>
      </> : <p role="status">{failure || (!frame ? 'Checking for a browser snapshot…'
        : frame.previewStatus === 'private' || frame.previewStatus === 'paused' ? 'Preview paused for privacy or owner control.'
          : frame.previewStatus === 'inactive' ? 'This task is no longer active.'
            : 'No browser preview available right now. Terminal work is not shown.')}</p>}
      {failure && <button type="button" className="ask-inline-action" onClick={() => setRetry(n => n + 1)}>Retry preview</button>}
    </div>}
  </div>;
}
