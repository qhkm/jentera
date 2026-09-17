import type postgres from 'postgres';
import type { Env } from './env';
import { withTenant, withUser } from './db';
import { ACCESS_OWNER } from './access-owner';

export const CHAT_PREVIEW_LIMIT = 10;
export const chatPreviewEnabled = (env: Env) => env.ACCESS_MODE === 'waitlist' && env.CHAT_PREVIEW_ENABLED === 'true';
export interface ChatPreview { limit: number; used: number; remaining: number }
const quota = (used: number): ChatPreview => ({ limit: CHAT_PREVIEW_LIMIT, used, remaining: CHAT_PREVIEW_LIMIT - used });

/** Call only after verified identity; never infer identity from client data. */
export async function previewForEmail(env: Env, email: string): Promise<ChatPreview | null> {
  if (!chatPreviewEnabled(env)) return null;
  return withUser(env, async sql => {
    const [account] = await sql<{ requests_used: number }[]>`
      insert into chat_preview_account (user_id)
      select u.id from app_user u where lower(u.email)=${email.toLowerCase()} and u.email_verified=true
        and not exists(select 1 from platform_access a where a.email=lower(u.email))
        and not exists(select 1 from trial_redemption r where r.user_id=u.id)
      on conflict (user_id) do update set requests_used=chat_preview_account.requests_used
      returning requests_used`;
    return account ? quota(account.requests_used) : null;
  });
}

type Reservation = { kind: 'new'; preview: ChatPreview } | { kind: 'replay'; runId: string; taskId: string; preview: ChatPreview }
  | { kind: 'blocked' | 'busy' | 'failed' | 'conflict' } | null;
/** Reserve before file conversion/model work. Concurrent tabs share one lock.
 * A prepared request may only be replayed, never converted/executed twice.
 * Valid accepted requests count once, including a later execution failure. */
export async function reservePreview(env: Env, userId: string, businessId: string, requestId: string): Promise<Reservation> {
  if (!chatPreviewEnabled(env)) return null;
  return withUser(env, sql => sql.begin(async tx => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${userId}, 5))`;
    const [user] = await tx<{ email: string; email_verified: boolean; kind: string | null; revoked_at: Date | null; expires_at: Date | null }[]>`
      select u.email,u.email_verified,a.kind,a.revoked_at,a.expires_at from app_user u
      left join platform_access a on a.email=lower(u.email) where u.id=${userId}`;
    if (!user?.email_verified) return { kind: 'blocked' } as const;
    if (user.email.toLowerCase() === ACCESS_OWNER) return null;
    if (user.kind) {
      return !user.revoked_at && (!user.expires_at || new Date(user.expires_at).getTime()>Date.now())
        ? null : { kind: 'blocked' } as const;
    }
    const [account] = await tx<{ requests_used: number }[]>`select requests_used from chat_preview_account where user_id=${userId} for update`;
    // Unknown admission state must never fall through to unlimited execution.
    if (!account) return { kind: 'blocked' } as const;
    const [previous] = await tx<{ business_id: string; run_id: string | null; task_id: string | null; status: string }[]>`
      select business_id,run_id,task_id,status from chat_preview_request where user_id=${userId} and request_id=${requestId}`;
    if (previous) {
      if (previous.business_id !== businessId) return { kind: 'conflict' } as const;
      if (previous.status === 'created' && previous.run_id && previous.task_id) {
        return { kind: 'replay', runId: previous.run_id, taskId: previous.task_id, preview: quota(account.requests_used) } as const;
      }
      return { kind: previous.status === 'failed' ? 'failed' : 'busy' } as const;
    }
    if (account.requests_used >= CHAT_PREVIEW_LIMIT) return { kind: 'blocked' } as const;
    const [updated] = await tx<{ requests_used: number }[]>`
      update chat_preview_account set requests_used=requests_used+1 where user_id=${userId} and requests_used<10 returning requests_used`;
    if (!updated) return { kind: 'blocked' } as const;
    await tx`insert into chat_preview_request (user_id,request_id,business_id) values (${userId},${requestId},${businessId})`;
    return { kind: 'new', preview: quota(updated.requests_used) } as const;
  }).then(result => result as Reservation));
}

export async function bindPreview(tx: postgres.TransactionSql, userId: string, businessId: string, requestId: string, runId: string, taskId: string): Promise<void> {
  const [bound] = await tx`update chat_preview_request set status='created',run_id=${runId},task_id=${taskId}
    where user_id=${userId} and request_id=${requestId} and business_id=${businessId} and status='reserved' returning request_id`;
  if (!bound) throw new Error('Preview reservation was not bound');
}

export async function failPreview(env: Env, userId: string, requestId: string): Promise<void> {
  await withUser(env, sql => sql`update chat_preview_request set status='failed' where user_id=${userId} and request_id=${requestId} and status='reserved'`);
}

/** Onboarding creates a separate provision task before the first chat request.
 * Admit only that trusted lifecycle task for a verified, unexhausted preview
 * owner. This is not platform access and never admits run/resume/scheduled work.
 * Check the task under tenant RLS; an ID from another business is not authority. */
export async function previewProvisioningAccess(env: Env, businessId: string, taskId: string): Promise<boolean> {
  if (!chatPreviewEnabled(env)) return false;
  return withTenant(env, businessId, async tx => {
    const [row] = await tx<{ allowed: boolean }[]>`select exists(
      select 1 from runtime_task t join business b on b.id=t.business_id
      join membership m on m.business_id=b.id and m.role='owner'
      join app_user u on u.id=m.user_id
      join chat_preview_account p on p.user_id=u.id
      where t.id=${taskId}::uuid and t.business_id=${businessId}::uuid
        and t.kind='provision' and t.status in ('queued','failed','leased')
        and b.onboarded=true and u.email_verified=true
        and p.requests_used<${CHAT_PREVIEW_LIMIT}
        and not exists(select 1 from platform_access a where a.email=lower(u.email))
        and not exists(select 1 from trial_redemption r where r.user_id=u.id)
    ) as allowed`;
    return row?.allowed === true;
  });
}

/** Model calls require a live lease on a quota-admitted preview task.
 * Scheduling and Telegram do not receive this exception. Budgets still apply. */
export async function previewModelAccess(env: Env, businessId: string): Promise<boolean> {
  if (!chatPreviewEnabled(env)) return false;
  return withTenant(env, businessId, async tx => {
    const [row] = await tx<{ allowed: boolean }[]>`select exists(
      select 1 from chat_preview_request p join runtime_task t on t.id=p.task_id and t.business_id=p.business_id
      join app_user u on u.id=p.user_id join membership m on m.user_id=u.id and m.business_id=p.business_id
      where p.business_id=${businessId} and p.status='created' and u.email_verified=true and m.role='owner'
        and t.status='leased' and t.lease_expires_at>now()
        and not exists(select 1 from platform_access a where a.email=lower(u.email))
    ) as allowed`;
    return row?.allowed === true;
  });
}
