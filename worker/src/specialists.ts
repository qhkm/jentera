/* Customer-defined specialist profiles. `profile` is an internal, immutable
   Hermes directory key; the owner controls every other field. */
import type postgres from 'postgres';

export interface SpecialistDefinition {
  id: string;
  profile: string;
  name: string;
  description: string;
  instructions: string;
  enabled: boolean;
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
    ? await tx`select id, profile_key, name, description, instructions, enabled
                 from specialist_profile where enabled = true
                order by sort_order, created_at`
    : await tx`select id, profile_key, name, description, instructions, enabled
                 from specialist_profile order by enabled desc, sort_order, created_at`;
  return rows.map((row: Record<string, unknown>) => ({
    id: String(row.id),
    profile: String(row.profile_key),
    name: String(row.name),
    description: String(row.description),
    instructions: String(row.instructions ?? ''),
    enabled: Boolean(row.enabled),
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
