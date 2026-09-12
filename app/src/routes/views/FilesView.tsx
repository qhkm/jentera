import { useEffect, useState } from 'react';
import { FileText } from '@phosphor-icons/react';
import { ArtifactPreview } from '@/components/ArtifactPreview';
import { Button, Card, Eyebrow, LoadingState } from '@/components/ui';
import { useT } from '@/i18n/I18nProvider';
import { useRepository } from '@/lib/repo';
import type { Artifact } from '@/lib/repo';
import { formatBytes } from '@/lib/artifacts';

/**
 * Everything Jentera produced for the owner as a file, newest first. Each
 * entry downloads on its own and opens the task that produced it, so the
 * file is never separated from the work it came from.
 */
export default function FilesView({ onOpenTask }: { onOpenTask: (runId: string) => void }) {
  const t = useT();
  const repo = useRepository();
  const [files, setFiles] = useState<Artifact[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<Artifact | null>(null);

  useEffect(() => {
    let live = true;
    setFailed(false);
    const load = repo.listArtifacts ? repo.listArtifacts({ limit: 100 }) : Promise.resolve([]);
    load.then((list) => { if (live) setFiles(list); })
      .catch(() => { if (live) { setFailed(true); setFiles([]); } });
    return () => { live = false; };
  }, [repo]);

  return (
    <section className="files-view flex flex-col gap-5" aria-labelledby="files-heading">
      <header className="flex flex-col gap-2">
        <Eyebrow>{t('files.title')}</Eyebrow>
        <h1 id="files-heading" className="font-pixel text-3xl tracking-tight">{t('files.title')}</h1>
        <p className="text-text-secondary">{t('files.intro')}</p>
      </header>
      {failed && <p role="alert" className="text-[var(--color-red-400)]">{t('files.error')}</p>}
      {files === null ? (
        <Card><LoadingState title={t('files.loading')} /></Card>
      ) : files.length === 0 && !failed ? (
        <Card className="items-start gap-1">
          <strong>{t('files.empty')}</strong>
          <p className="m-0 text-text-secondary">{t('files.empty.detail')}</p>
        </Card>
      ) : files.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={t('files.title')}>
          {files.map((file) => (
            <li key={file.id} className="card flex-row flex-wrap items-center gap-3 px-4 py-3">
              <FileText size={22} weight="duotone" aria-hidden="true" className="shrink-0 text-brand" />
              <div className="min-w-0 flex-1">
                <button type="button" className="block max-w-full truncate text-left text-[14px] font-semibold text-text hover:underline" onClick={() => setOpen(file)}>
                  {file.name}
                </button>
                <span className="text-[12px] text-text-muted">
                  {formatBytes(file.size)} · {new Date(file.createdAt).toLocaleString()}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  className="btn"
                  href={repo.artifactUrl?.(file.id) ?? '#'}
                  download={file.name}
                  target="_blank"
                  rel="noopener"
                >
                  {t('files.download')}
                </a>
                <Button variant="outline" onClick={() => onOpenTask(file.runId)}>{t('files.openTask')}</Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {open && <ArtifactPreview artifact={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
