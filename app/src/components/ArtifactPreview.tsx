import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DownloadSimple, X } from '@phosphor-icons/react';
import { Button } from '@/components/ui';
import { useT } from '@/i18n/I18nProvider';
import { useRepository } from '@/lib/repo';
import type { Artifact } from '@/lib/repo';
import { formatBytes, parseCsv, PREVIEW_TEXT_LIMIT, previewKind } from '@/lib/artifacts';
import { renderReplyMarkdown } from '@/lib/reply-markdown';

/* Headings, then the reply renderer for everything between them: a report
   the agent wrote reads like a document, not like a wall of text. */
function renderMarkdownDocument(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let buffer: string[] = [];
  let fenced = false;
  const flush = () => {
    const chunk = buffer.join('\n').trim();
    if (chunk) out.push(<div key={`p-${out.length}`}>{renderReplyMarkdown(chunk)}</div>);
    buffer = [];
  };
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced;
    if (fenced || line.startsWith('```')) { buffer.push(line); continue; }
    const heading = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      const key = `h-${out.length}`;
      if (level === 1) out.push(<h2 key={key}>{heading[2]}</h2>);
      else if (level === 2) out.push(<h3 key={key}>{heading[2]}</h3>);
      else out.push(<h4 key={key}>{heading[2]}</h4>);
    } else {
      buffer.push(line);
    }
  }
  flush();
  return out;
}

type Loaded =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'text'; text: string }
  | { state: 'too-large' }
  | { state: 'object'; url: string }
  | { state: 'none' };

/**
 * A file, opened in place. The bytes are fetched with the session and
 * rendered here, at the app's origin, never as a page at the API's: text
 * and markdown as a document, CSV as a table, images and PDFs from a blob
 * URL, and everything else as a download.
 */
export function ArtifactPreview({ artifact, onClose }: { artifact: Artifact; onClose: () => void }) {
  const t = useT();
  const repo = useRepository();
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [closing, setClosing] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const kind = previewKind(artifact.contentType, artifact.name);

  /* Leave the way it arrived, unless the owner asked for no motion, in
     which case (and wherever media queries are missing) close at once. */
  const requestClose = useCallback(() => {
    const animate = typeof window.matchMedia === 'function' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!animate) {
      onClose();
      return;
    }
    setClosing(true);
    window.setTimeout(onClose, 260);
  }, [onClose]);

  useEffect(() => {
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') requestClose(); };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [requestClose]);

  useEffect(() => {
    let live = true;
    let objectUrl: string | null = null;
    if (kind === 'none' || !repo.fetchArtifact) {
      setLoaded({ state: 'none' });
      return undefined;
    }
    repo.fetchArtifact(artifact.id).then(async (blob) => {
      if (!live) return;
      if (kind === 'image' || kind === 'pdf') {
        objectUrl = URL.createObjectURL(blob);
        setLoaded({ state: 'object', url: objectUrl });
        return;
      }
      if (blob.size > PREVIEW_TEXT_LIMIT) {
        setLoaded({ state: 'too-large' });
        return;
      }
      setLoaded({ state: 'text', text: await blob.text() });
    }).catch(() => { if (live) setLoaded({ state: 'error' }); });
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [artifact.id, kind, repo]);

  const body = useMemo<ReactNode>(() => {
    switch (loaded.state) {
      case 'loading':
        return <p className="text-text-muted">{t('files.preview.loading')}</p>;
      case 'error':
        return <p role="alert" className="text-[var(--color-red-400)]">{t('files.preview.error')}</p>;
      case 'too-large':
        return <p className="text-text-secondary">{t('files.preview.tooLarge')}</p>;
      case 'none':
        return <p className="text-text-secondary">{t('files.preview.noPreview')}</p>;
      case 'object':
        return kind === 'image'
          ? <img src={loaded.url} alt={artifact.name} className="max-h-[70vh] max-w-full rounded-lg" />
          : <iframe src={loaded.url} title={artifact.name} className="h-[70vh] w-full rounded-lg border border-border" />;
      case 'text':
        if (kind === 'markdown') return <div className="ask-reply-text">{renderMarkdownDocument(loaded.text)}</div>;
        if (kind === 'csv') {
          const rows = parseCsv(loaded.text, 200);
          const [head, ...rest] = rows;
          return (
            <div className="overflow-x-auto">
              <table className="min-w-full text-[13px]">
                <thead><tr>{(head ?? []).map((cell, i) => <th key={i} scope="col" className="border-b border-border px-2 py-1 text-left">{cell}</th>)}</tr></thead>
                <tbody>{rest.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c} className="border-b border-border px-2 py-1">{cell}</td>)}</tr>)}</tbody>
              </table>
            </div>
          );
        }
        return <pre className="whitespace-pre-wrap break-words text-[13px]">{loaded.text}</pre>;
      default:
        return null;
    }
  }, [artifact.name, kind, loaded, t]);

  return (
    <div
      className="file-preview-backdrop fixed inset-0 z-[1000] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-6"
      data-closing={closing || undefined}
      onClick={requestClose}
    >
      <div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={artifact.name}
        className="file-preview-dialog card max-h-[92dvh] w-full max-w-3xl gap-0 overflow-hidden rounded-b-none rounded-t-2xl p-0 outline-none sm:max-h-[85vh] sm:rounded-card"
        onClick={(event) => event.stopPropagation()}
      >
        {/* The grab bar a phone sheet carries; hidden on a desk, where
            the same dialog sits in the middle of the screen. */}
        <div className="file-preview-handle" aria-hidden="true" />
        <header className="flex items-center gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <strong className="block truncate text-[14px]">{artifact.name}</strong>
            <span className="text-[12px] text-text-muted">{formatBytes(artifact.size)}</span>
          </div>
          <a className="btn" href={repo.artifactUrl?.(artifact.id) ?? '#'} download={artifact.name} target="_blank" rel="noopener">
            <DownloadSimple size={16} aria-hidden="true" />
            {t('files.download')}
          </a>
          <Button variant="outline" aria-label={t('files.close')} onClick={requestClose}>
            <X size={18} aria-hidden="true" />
          </Button>
        </header>
        <div className="overflow-y-auto px-4 py-4">{body}</div>
      </div>
    </div>
  );
}
