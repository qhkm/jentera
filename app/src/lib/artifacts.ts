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

/** Text bigger than this is downloaded, not rendered in the preview. */
export const PREVIEW_TEXT_LIMIT = 2 * 1024 * 1024;

export type PreviewKind = 'markdown' | 'csv' | 'text' | 'image' | 'pdf' | 'none';

/** How a file is shown in place. SVG counts as none: it is a document that
    can run script, and a download is the only safe way to hand it over. */
export function previewKind(contentType: string, name: string): PreviewKind {
  const type = contentType.toLowerCase();
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (type === 'text/markdown' || ext === 'md' || ext === 'markdown') return 'markdown';
  if (type === 'text/csv' || ext === 'csv') return 'csv';
  if (type === 'application/pdf') return 'pdf';
  if (type.startsWith('image/') && type !== 'image/svg+xml') return 'image';
  if (type.startsWith('text/') || ['application/json', 'application/yaml', 'application/xml'].includes(type)) return 'text';
  return 'none';
}

/** RFC 4180 enough for what an agent writes: quoted fields, doubled quotes,
    commas inside quotes, CRLF or LF. Rows beyond `maxRows` are dropped. */
export function parseCsv(text: string, maxRows = 200): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
      if (rows.length >= maxRows) return rows;
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((cell) => cell !== '')) rows.push(row); }
  return rows;
}
