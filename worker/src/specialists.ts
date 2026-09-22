/* Customer-defined specialist profiles. `profile` is an internal, immutable
   Hermes directory key; the owner controls every other field. */
import type postgres from 'postgres';
import type { BotAvatarId } from '../../shared/bot-avatars';

export interface SpecialistDefinition {
  id: string;
  profile: string;
  name: string;
  description: string;
  instructions: string;
  enabled: boolean;
  avatar?: BotAvatarId;
}

export type SpecialistProfile = string;

export const DEFAULT_SPECIALISTS = [
  { profile: 'operations', name: 'Operations', description: 'Processes, planning, stock, suppliers and follow-through.' },
  { profile: 'customers', name: 'Customer communications', description: 'Enquiries, replies, bookings and service recovery.' },
  { profile: 'growth', name: 'Growth and marketing', description: 'Research, campaigns, content, sales and retention.' },
  { profile: 'records', name: 'Finance and records', description: 'Invoices, expenses, cash flow, documents and summaries.' },
] as const;

export const specialistProfileValid = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(value);

export async function listSpecialists(
  tx: postgres.TransactionSql,
  options: { enabledOnly?: boolean } = {},
): Promise<SpecialistDefinition[]> {
  const rows = options.enabledOnly
    ? await tx`select id, profile_key, name, description, instructions, enabled, avatar
                 from specialist_profile where enabled = true
                order by sort_order, created_at`
    : await tx`select id, profile_key, name, description, instructions, enabled, avatar
                 from specialist_profile order by enabled desc, sort_order, created_at`;
  return rows.map((row: Record<string, unknown>) => ({
    id: String(row.id),
    profile: String(row.profile_key),
    name: String(row.name),
    description: String(row.description),
    instructions: String(row.instructions ?? ''),
    enabled: Boolean(row.enabled),
    avatar: row.avatar as BotAvatarId,
  }));
}

const STOP = new Set([
  'and', 'atau', 'dan', 'for', 'from', 'into', 'kepada', 'my', 'of', 'please',
  'saya', 'the', 'this', 'to', 'untuk', 'with', 'yang', 'your',
]);

function tokens(value: string): Set<string> {
  return new Set(value.toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !STOP.has(word)));
}

/**
 * Pick one specialist only when the request has one clear domain.
 *
 * A tie is intentionally left with the Chief of Staff: silently choosing one
 * specialist for cross-functional work would lose the coordination benefit
 * this feature exists to provide.
 */
export function specialistProfileForRequest(
  input: string,
  specialists: readonly SpecialistDefinition[],
): SpecialistDefinition | undefined {
  const requested = tokens(input);
  const scores = specialists.filter((specialist) => specialist.enabled).map((specialist) => {
    const role = tokens(`${specialist.name} ${specialist.description} ${specialist.instructions}`);
    let score = 0;
    for (const word of requested) if (role.has(word)) score += 1;
    return { specialist, score };
  }).sort((a, b) => b.score - a.score);

  if (!scores.length || scores[0].score === 0 || scores[0].score === scores[1]?.score) {
    return undefined;
  }
  return scores[0].specialist;
}

export function specialistRunInstructions(specialist: SpecialistDefinition): string {
  return `Internal assignment: the Chief of Staff has routed this request to the ${specialist.name} ` +
    `specialist profile. Apply that profile's durable expertise and memory. Return one coherent, ` +
    `owner-facing Jentera answer; do not expose internal profile names, routing, delegation, or ` +
    `handoffs. Your business-defined remit is: ${specialist.description}\n` +
    `${specialist.instructions ? `Business-owner instructions: ${specialist.instructions}\n` : ''}` +
    `If the request materially crosses another domain, state the dependency plainly without ` +
    `pretending it was completed.`;
}

/** How long a chat keeps the specialist that last answered in it. Hermes
    keeps each profile's conversation in its own store, so a turn that lands
    on a different specialist cannot see the turns before it: on 2026-09-12
    "yes run the test run" reached the Chief of Staff, who had never seen the
    digest request the Growth specialist had just scheduled. A Telegram chat
    is one session for life, so the window is what lets it re-route once a
    thread has gone quiet. */
export const STICKY_SPECIALIST_WINDOW_MS = 6 * 60 * 60 * 1000;

/** The profile that answered the most recent turn of this session inside
    the window: a profile key for a specialist, `null` for the Chief of
    Staff, `undefined` when there is no such turn. */
export async function previousProfileInSession(
  tx: postgres.TransactionSql,
  businessId: string,
  sessionId: string,
  now = new Date(),
  allHistory = false,
): Promise<string | null | undefined> {
  const since = new Date(allHistory ? 0 : now.getTime() - STICKY_SPECIALIST_WINDOW_MS);
  const [row] = await tx<{ profile: string | null }[]>`
    select t.payload->>'profile' as profile
      from run r left join runtime_task t on t.run_id = r.id and t.business_id = r.business_id
     where r.business_id = ${businessId} and r.trigger_ref->>'sessionId' = ${sessionId}
       and r.created_at > ${since}
       and (t.id is not null or ${allHistory})
     order by r.created_at desc limit 1`;
  if (!row) return undefined;
  return row.profile ?? null;
}

/** Web chats supply a personal default and keep their previous profile
    regardless of age. Telegram callers omit the preference and retain
    six-hour sticky routing followed by request scoring. */
export async function specialistForTurn(
  tx: postgres.TransactionSql,
  businessId: string,
  sessionId: string | undefined,
  input: string,
  specialists: readonly SpecialistDefinition[],
  preferredProfile?: string,
): Promise<SpecialistDefinition | undefined> {
  if (sessionId) {
    const previous = await previousProfileInSession(tx, businessId, sessionId, new Date(), preferredProfile !== undefined);
    if (previous === null) return undefined;
    if (previous) {
      const same = specialists.find((specialist) => specialist.enabled && specialist.profile === previous);
      if (same) return same;
      if (preferredProfile !== undefined) return undefined;
    }
  }
  if (preferredProfile === 'default') return undefined;
  if (preferredProfile !== undefined) return specialists.find(s => s.enabled && s.profile === preferredProfile);
  return specialistProfileForRequest(input, specialists);
}

export async function botPreference(tx: postgres.TransactionSql, userId: string) {
  const [row] = await tx`select default_profile, coordinator_avatar from bot_preference where user_id = ${userId}`;
  return { defaultBotProfile: String(row?.default_profile ?? 'default'), coordinatorAvatar: String(row?.coordinator_avatar ?? 'original') };
}
