import { useEffect, useState } from 'react';
import { DownloadSimple, FileText } from '@phosphor-icons/react';
import { ArtifactPreview } from '@/components/ArtifactPreview';
import { useT } from '@/i18n/I18nProvider';
import { useRepository } from '@/lib/repo';
import type { Artifact } from '@/lib/repo';
import { formatBytes } from '@/lib/artifacts';

function InlineImage({ file, onOpen }: { file: Artifact; onOpen: () => void }) {
  const repo = useRepository();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let objectUrl: string | undefined;
    setUrl(null);
    if (file.size <= 20 * 1024 * 1024) void repo.fetchArtifact?.(file.id).then(blob => {
      if (!live) return;
      if (!/^image\/(png|jpeg|webp|gif)$/.test(blob.type) || blob.size > 20 * 1024 * 1024) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => {}); // The file chip remains available for retry/download.
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file.id, file.size, repo]);
  return url ? <button type="button" onClick={onOpen} className="block w-full p-2">
    <img src={url} alt={file.name} className="max-h-96 w-full rounded-lg object-contain" onError={() => setUrl(null)} />
  </button> : null;
}

/** Files the agent produced. A tap opens the file in place; the small
    arrow downloads it, with the session cookie riding on the click. */
export function ArtifactList({ artifacts, label, className = '', inlineImages = false }: {
  artifacts: Artifact[];
  label: string;
  className?: string;
  inlineImages?: boolean;
}) {
  const t = useT();
  const repo = useRepository();
  const [open, setOpen] = useState<Artifact | null>(null);
  return (
    <>
      <ul className={`ask-files m-0 flex list-none flex-wrap gap-2 p-0 ${className}`} aria-label={label}>
        {artifacts.map((file) => (
          <li key={file.id} className={`inline-flex max-w-full flex-wrap items-stretch overflow-hidden rounded-lg border border-border bg-bg-card text-[13px] ${inlineImages && /^image\/(png|jpeg|webp|gif)$/.test(file.contentType) ? 'w-full' : ''}`}>
            {inlineImages && /^image\/(png|jpeg|webp|gif)$/.test(file.contentType) && <InlineImage file={file} onOpen={() => setOpen(file)} />}
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
