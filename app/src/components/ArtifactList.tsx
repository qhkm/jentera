import { FileArrowDown } from '@phosphor-icons/react';
import { useRepository } from '@/lib/repo';
import type { Artifact } from '@/lib/repo';
import { formatBytes } from '@/lib/artifacts';

/** Files the agent produced, each a download. The link carries the
    session cookie on the click, so the API can answer with the bytes. */
export function ArtifactList({ artifacts, label, className = '' }: {
  artifacts: Artifact[];
  label: string;
  className?: string;
}) {
  const repo = useRepository();
  return (
    <ul className={`ask-files m-0 flex list-none flex-wrap gap-2 p-0 ${className}`} aria-label={label}>
      {artifacts.map((file) => (
        <li key={file.id}>
          <a
            className="inline-flex max-w-full items-center gap-2 rounded-lg border border-border bg-bg-card px-3 py-2 text-[13px] text-text no-underline hover:border-brand"
            href={repo.artifactUrl?.(file.id) ?? '#'}
            download={file.name}
            target="_blank"
            rel="noopener"
          >
            <FileArrowDown size={16} weight="duotone" aria-hidden="true" className="shrink-0 text-brand" />
            <span className="truncate">{file.name}</span>
            <span className="shrink-0 text-text-muted">{formatBytes(file.size)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
