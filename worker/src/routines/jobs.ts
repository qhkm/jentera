/**
 * The three v1 jobs. All deterministic: SQL over the tenant's own records,
 * rendered as fixed-format text in the business's language. No model, no
 * sprite, no budget. A job states its source window and observation time so
 * the reader knows what it covers and when it looked.
 */
import type postgres from 'postgres';

export type TaskKind = 'business_summary' | 'weekly_summary' | 'approval_reminder' | 'agent_task';
export const TASK_KINDS: readonly TaskKind[] = [
  'business_summary',
  'weekly_summary',
  'approval_reminder',
  'agent_task',
];

export type Lang = 'en' | 'bm';

export interface JobResult {
  /** Full report text, capped for the work record and the occurrence. */
  text: string;
  /** Machine-readable inputs for the work record. */
  inputs: Record<string, unknown>;
}

export interface JobSkip {
  skipped: true;
  reason: 'nothing_pending';
}

const LINE_CAP = 40;
const TEXT_CAP = 20_000;

function windowHours(kind: TaskKind): number {
  return kind === 'weekly_summary' ? 7 * 24 : 24;
}

function formatInZone(instant: Date, timeZone: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === 'bm' ? 'ms-MY' : 'en-MY', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Work recorded in [end − window, end), counted in full and listed in part. */
export async function summaryReport(
  tx: postgres.TransactionSql,
  kind: 'business_summary' | 'weekly_summary',
  end: Date,
  timeZone: string,
  lang: Lang,
): Promise<JobResult> {
  const hours = windowHours(kind);
  const start = new Date(end.getTime() - hours * 3_600_000);
  const [totals] = await tx<{
    total: string; completed: string; failed: string; minutes: string;
  }[]>`
    select count(*)::text as total,
           count(*) filter (where status = 'completed')::text as completed,
           count(*) filter (where status = 'failed')::text as failed,
           coalesce(sum(minutes_saved), 0)::text as minutes
      from work_record
     where occurred_at >= ${start.toISOString()}::timestamptz
       and occurred_at < ${end.toISOString()}::timestamptz`;
  const rows = await tx<{ objective: string; outcome: string | null; status: string }[]>`
    select objective, outcome, status
      from work_record
     where occurred_at >= ${start.toISOString()}::timestamptz
       and occurred_at < ${end.toISOString()}::timestamptz
     order by occurred_at desc
     limit ${LINE_CAP}`;
  const total = Number(totals.total);
  const completed = Number(totals.completed);
  const failed = Number(totals.failed);
  const other = total - completed - failed;
  const minutes = Number(totals.minutes);
  const endLabel = formatInZone(end, timeZone, lang);
  const lines = rows.map((row) =>
    `- ${row.objective}${row.outcome ? ` — ${row.outcome}` : ''}`);
  const more = total - rows.length;

  let text: string;
  if (lang === 'bm') {
    const title = kind === 'weekly_summary'
      ? `Ringkasan mingguan bagi 7 hari sehingga ${endLabel} (${timeZone}).`
      : `Ringkasan harian bagi 24 jam sehingga ${endLabel} (${timeZone}).`;
    const counts = total === 0
      ? 'Tiada kerja direkodkan dalam tempoh ini.'
      : `${total} kerja direkodkan: ${completed} selesai, ${failed} gagal` +
        `${other > 0 ? `, ${other} lain` : ''}. ${minutes} minit dijimatkan.`;
    text = [title, '', counts, ...(lines.length ? ['', ...lines] : []),
      ...(more > 0 ? ['', `…dan ${more} lagi.`] : [])].join('\n');
  } else {
    const title = kind === 'weekly_summary'
      ? `Weekly summary for the 7 days to ${endLabel} (${timeZone}).`
      : `Daily summary for the 24 hours to ${endLabel} (${timeZone}).`;
    const counts = total === 0
      ? 'No work was recorded in this window.'
      : `${plural(total, 'piece of work', 'pieces of work')} recorded: ${completed} completed, ` +
        `${failed} failed${other > 0 ? `, ${other} other` : ''}. ${plural(minutes, 'minute', 'minutes')} saved.`;
    text = [title, '', counts, ...(lines.length ? ['', ...lines] : []),
      ...(more > 0 ? ['', `…and ${more} more.`] : [])].join('\n');
  }
  return {
    text: text.slice(0, TEXT_CAP),
    inputs: { window: { from: start.toISOString(), to: end.toISOString() }, total, completed, failed, minutes },
  };
}

/** Approvals still pending when the job looks, labelled with that time. */
export async function approvalReminder(
  tx: postgres.TransactionSql,
  observedAt: Date,
  timeZone: string,
  lang: Lang,
): Promise<JobResult | JobSkip> {
  const [totals] = await tx<{ total: string }[]>`
    select count(*)::text as total from approval where status = 'pending'`;
  const total = Number(totals.total);
  if (total === 0) return { skipped: true, reason: 'nothing_pending' };
  const rows = await tx<{ connector: string; op: string; risk: string; created_at: Date }[]>`
    select connector, op, risk, created_at
      from approval where status = 'pending'
     order by created_at asc
     limit ${LINE_CAP}`;
  const observed = formatInZone(observedAt, timeZone, lang);
  const lines = rows.map((row) =>
    `- ${row.connector}: ${row.op} (${row.risk}, ${formatInZone(row.created_at, timeZone, lang)})`);
  const more = total - rows.length;
  const text = lang === 'bm'
    ? [`${total} tindakan menunggu semakan anda (disemak ${observed}, ${timeZone}).`, '', ...lines,
      ...(more > 0 ? ['', `…dan ${more} lagi.`] : [])].join('\n')
    : [`${plural(total, 'action', 'actions')} waiting for your review (checked ${observed}, ${timeZone}).`, '',
      ...lines, ...(more > 0 ? ['', `…and ${more} more.`] : [])].join('\n');
  return {
    text: text.slice(0, TEXT_CAP),
    inputs: { observedAt: observedAt.toISOString(), pending: total },
  };
}
