import type { Artifact } from '@/lib/repo/types';

export function isArtifact(value: unknown): value is Artifact {
  if (!value || typeof value !== 'object') return false;
  const a = value as Record<string, unknown>;
  return typeof a.id === 'string' && typeof a.runId === 'string' && typeof a.name === 'string' &&
    typeof a.contentType === 'string' && typeof a.size === 'number' && typeof a.createdAt === 'string';
}

export function artifactsOf(value: unknown): Artifact[] | undefined {
  return Array.isArray(value) && value.length > 0 && value.every(isArtifact) ? value : undefined;
}

/** 640 B, 5.2 KB, 1.3 MB: enough precision to tell a note from a dataset. */
export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return '';
  if (size < 1024) return `${Math.round(size)} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
