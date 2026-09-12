/* ============================================================
   Artifacts: files the agent hands the owner.

   The runner collects whatever the agent saved in the task's output folder
   and uploads each file before it reports the task complete; the bytes go
   to R2 and a row here indexes them under the tenant. The chat, the task
   page and the Files view read the rows; the download route resolves the
   row under RLS before it ever touches the bucket.
   ============================================================ */
import type postgres from 'postgres';
import { visibleRunPredicate } from './chat-sessions';

/** One file, one request; larger deliverables are the agent's job to split. */
export const MAX_ARTIFACT_BYTES = 20 * 1024 * 1024;
/** Per run. Enough for a report with its data; not a dumping ground. */
export const MAX_ARTIFACTS_PER_RUN = 20;

/* A bare file name: letters, digits, dot, dash, underscore; starts with a
   letter or digit so `.`, `..` and dotfiles are out; no separators. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const MEDIA_TYPE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;

export interface ArtifactRow {
  id: string;
  run_id: string;
  name: string;
  content_type: string;
  size_bytes: number | string;
  r2_key: string;
  created_at: Date;
}

/** The shape the app receives. */
export interface ArtifactJson {
  id: string;
  runId: string;
  name: string;
  contentType: string;
  size: number;
  createdAt: string;
}

export function artifactJson(row: ArtifactRow): ArtifactJson {
  return {
    id: row.id,
    runId: row.run_id,
    name: row.name,
    contentType: row.content_type,
    size: Number(row.size_bytes),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export function safeArtifactName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return NAME.test(name) ? name : null;
}

/** `type/subtype` in lower case with parameters dropped; anything else is
    served as opaque bytes rather than trusted as the type it claims. */
export function safeContentType(value: unknown): string {
  if (typeof value !== 'string') return 'application/octet-stream';
  const type = value.split(';')[0].trim().toLowerCase();
  return MEDIA_TYPE.test(type) && type.length <= 120 ? type : 'application/octet-stream';
}

export function artifactKey(businessId: string, runId: string, id: string, name: string): string {
  return `${businessId}/${runId}/${id}/${name}`;
}

export async function recordArtifact(
  tx: postgres.TransactionSql,
  businessId: string,
  input: {
    id: string;
    runId: string;
    taskId?: string | null;
    name: string;
    contentType: string;
    size: number;
    r2Key: string;
    sha256?: string | null;
  },
): Promise<ArtifactRow> {
  const [row] = await tx<ArtifactRow[]>`
    insert into artifact (id, business_id, run_id, task_id, name, content_type, size_bytes, r2_key, sha256)
    values (${input.id}, ${businessId}, ${input.runId}, ${input.taskId ?? null}, ${input.name},
            ${input.contentType}, ${input.size}, ${input.r2Key}, ${input.sha256 ?? null})
    returning id, run_id, name, content_type, size_bytes, r2_key, created_at`;
  return row;
}

export async function countArtifactsForRun(
  tx: postgres.TransactionSql,
  businessId: string,
  runId: string,
): Promise<number> {
  const [row] = await tx<{ n: string }[]>`
    select count(*)::text as n from artifact where business_id = ${businessId} and run_id = ${runId}`;
  return Number(row?.n ?? 0);
}

export async function listArtifacts(
  tx: postgres.TransactionSql,
  businessId: string,
  options: { runId?: string | null; limit?: number; viewer?: string } = {},
): Promise<ArtifactRow[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  const runId = options.runId ?? null;
  /* Files follow their run: a colleague's private chat keeps its files
     out of this person's list (chat-sessions.ts states the rule). */
  const viewer = options.viewer ?? null;
  return tx<ArtifactRow[]>`
    select a.id, a.run_id, a.name, a.content_type, a.size_bytes, a.r2_key, a.created_at
      from artifact a
      join run r on r.id = a.run_id and r.business_id = a.business_id
      left join chat_session c on c.business_id = r.business_id and c.id = r.session_id
     where a.business_id = ${businessId}
       and (${runId}::uuid is null or a.run_id = ${runId}::uuid)
       and ${visibleRunPredicate(tx, viewer)}
     order by a.created_at desc, a.id desc limit ${limit}`;
}

export async function getArtifact(
  tx: postgres.TransactionSql,
  businessId: string,
  id: string,
): Promise<ArtifactRow | null> {
  const [row] = await tx<ArtifactRow[]>`
    select id, run_id, name, content_type, size_bytes, r2_key, created_at from artifact
     where business_id = ${businessId} and id = ${id}`;
  return row ?? null;
}

/** The files of one run, oldest first, as the run detail hands them out. */
export async function artifactsForRun(
  tx: postgres.TransactionSql,
  businessId: string,
  runId: string,
): Promise<ArtifactJson[]> {
  const rows = await tx<ArtifactRow[]>`
    select id, run_id, name, content_type, size_bytes, r2_key, created_at from artifact
     where business_id = ${businessId} and run_id = ${runId}
     order by created_at, id`;
  return rows.map(artifactJson);
}
