import { useState } from 'react';
import { DownloadSimple, FileText } from '@phosphor-icons/react';
import { ArtifactPreview } from '@/components/ArtifactPreview';
import { useT } from '@/i18n/I18nProvider';
import { useRepository } from '@/lib/repo';
import type { Artifact } from '@/lib/repo';
import { formatBytes } from '@/lib/artifacts';

/** Files the agent produced. A tap opens the file in place; the small
    arrow downloads it, with the session cookie riding on the click. */
export function ArtifactList({ artifacts, label, className = '' }: {
  artifacts: Artifact[];
  label: string;
  className?: string;
}) {
  const t = useT();
  const repo = useRepository();
  const [open, setOpen] = useState<Artifact | null>(null);
  return (
    <>
      <ul className={`ask-files m-0 flex list-none flex-wrap gap-2 p-0 ${className}`} aria-label={label}>
        {artifacts.map((file) => (
          <li key={file.id} className="inline-flex max-w-full items-stretch overflow-hidden rounded-lg border border-border bg-bg-card text-[13px]">
            <button
              type="button"
              className="inline-flex min-w-0 items-center gap-2 px-3 py-2 text-left text-text hover:bg-bg-card-hover"
              onClick={() => setOpen(file)}
            >
              <FileText size={16} weight="duotone" aria-hidden="true" className="shrink-0 text-brand" />
              <span className="truncate">{file.name}</span>
              <span className="shrink-0 text-text-muted">{formatBytes(file.size)}</span>
            </button>
            <a
              className="inline-flex items-center border-l border-border px-2 text-text-muted hover:text-text"
              href={repo.artifactUrl?.(file.id) ?? '#'}
              download={file.name}
              target="_blank"
              rel="noopener"
              aria-label={t('files.downloadNamed', { name: file.name })}
            >
              <DownloadSimple size={15} aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
      {open && <ArtifactPreview artifact={open} onClose={() => setOpen(null)} />}
    </>
  );
}
