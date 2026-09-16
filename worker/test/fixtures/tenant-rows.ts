import type postgres from 'postgres';

/**
 * Ids shared across fixtures that reference each other's rows. `runId`,
 * `routineId` and `runtimeTaskId` are inserted with an explicit id by the
 * fixture that owns that table (run, routine, runtime_task respectively),
 * so a later fixture — artifact, routine_change, runtime_usage — can point
 * at a row it knows already exists, rather than having to look it up.
 */
export interface FixtureContext {
  businessId: string;
  userId: string;
  runId: string;
  routineId: string;
  runtimeTaskId: string;
}

/** A fresh context for one purge-test business. Every id below is random,
 *  so calling this twice (or seeding on top of another helper's data for
 *  the same business) never collides with an existing row. */
export function newFixtureContext(businessId: string, userId: string): FixtureContext {
  return {
    businessId,
    userId,
    runId: crypto.randomUUID(),
    routineId: crypto.randomUUID(),
    runtimeTaskId: crypto.randomUUID(),
  };
}

/** 64 lowercase hex characters — the shape `token_hash` / `request_hash`
 *  columns check for (sha256 hex digest length), without hashing anything
 *  real. */
function hex64(): string {
  return (crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')).slice(0, 64);
}

/**
 * One row per tenant table, so the purge test runs against a business that
 * is genuinely full. The catalog test fails when a table has no entry here,
 * which is what stops "assert nothing remains" from passing vacuously.
 *
 * Declaration order is dependency order: run before artifact/run_event
 * (which point at it), routine before routine_change/routine_occurrence,
 * runtime_task before runtime_usage/runtime_task_outbox. `applyTenantFixtures`
 * below relies on that order — it walks `Object.values` in this same
 * declared sequence, not the catalog test's alphabetical one.
 */
export const TENANT_FIXTURES: Record<
  string,
  (sql: postgres.Sql, ctx: FixtureContext) => Promise<void>
> = {
  run: async (sql, { businessId, runId, userId }) => {
    await sql`insert into run (id, business_id, kind, trigger_shape, runtime, requested_by)
              values (${runId}, ${businessId}, 'ask', 'owner.ask', 'inline', ${userId})`;
  },
  artifact: async (sql, { businessId, runId }) => {
    await sql`insert into artifact (business_id, run_id, name, content_type, size_bytes, r2_key)
              values (${businessId}, ${runId}, 'note.txt', 'text/plain', 12, ${`fixtures/${runId}`})`;
  },
  run_event: async (sql, { businessId, runId }) => {
    await sql`insert into run_event (run_id, business_id, seq, type, payload)
              values (${runId}, ${businessId}, 1, 'fixture', '{}'::jsonb)`;
  },
  work_record: async (sql, { businessId, runId }) => {
    await sql`insert into work_record (business_id, run_id, objective, status)
              values (${businessId}, ${runId}, 'Fixture objective', 'completed')`;
  },
  membership: async (sql, { businessId, userId }) => {
    await sql`insert into membership (business_id, user_id, role) values (${businessId}, ${userId}, 'owner')
              on conflict do nothing`;
  },
  approval: async (sql, { businessId, userId }) => {
    await sql`insert into approval (business_id, connector, op, args, risk, status, decided_by)
              values (${businessId}, 'fixture', 'noop', '{}'::jsonb, 'low', 'approved', ${userId})`;
  },
  business_fact: async (sql, { businessId, userId }) => {
    await sql`insert into business_fact (business_id, key, value, source, confirmed_by)
              values (${businessId}, ${`fixture.${crypto.randomUUID()}`}, '"x"'::jsonb, 'owner', ${userId})`;
  },
  action_policy: async (sql, { businessId, userId }) => {
    await sql`insert into action_policy (business_id, op, policy, updated_by)
              values (${businessId}, ${`fixture.${crypto.randomUUID()}`}, 'approval', ${userId})
              on conflict do nothing`;
  },
  work_done: async (sql, { businessId }) => {
    await sql`insert into work_done (business_id, playbook_key, idx)
              values (${businessId}, 'fixture', ${crypto.randomUUID()})
              on conflict do nothing`;
  },
  learn: async (sql, { businessId }) => {
    await sql`insert into learn (business_id, playbook_key, pick)
              values (${businessId}, 'fixture', ${crypto.randomUUID()})
              on conflict do nothing`;
  },
  connection: async (sql, { businessId, userId }) => {
    await sql`insert into connection (business_id, connector, method, status, external_id, connected_by)
              values (${businessId}, 'fixture', 'bot_token', 'connected', ${crypto.randomUUID()}, ${userId})`;
  },
  agent_runtime: async (sql, { businessId }) => {
    await sql`insert into agent_runtime (business_id, provider, provider_name, desired_release)
              values (${businessId}, 'fly-sprite', ${`fixture-${businessId}`}, 'r1')
              on conflict (business_id) do nothing`;
  },
  runtime_budget: async (sql, { businessId }) => {
    await sql`insert into runtime_budget (business_id) values (${businessId})
              on conflict (business_id) do nothing`;
  },
  runtime_task: async (sql, { businessId, runtimeTaskId }) => {
    await sql`insert into runtime_task (id, business_id, kind, status, dedupe_key)
              values (${runtimeTaskId}, ${businessId}, 'reconcile', 'queued', ${crypto.randomUUID()})`;
  },
  runtime_usage: async (sql, { businessId, runtimeTaskId }) => {
    await sql`insert into runtime_usage
                (business_id, runtime_task_id, reserved_input_tokens, reserved_output_tokens, model)
              values (${businessId}, ${runtimeTaskId}, 0, 0, 'fixture-model')`;
  },
  /* Not in the plan's original 29 — found by the catalog query itself
     (migrations/019_runtime_task_recovery.sql): business_id references
     business(id) on delete cascade, so it already cascades correctly, but
     it still needs a fixture or the completeness test fails on it. A
     `runtime_task` insert with status 'queued' auto-creates this row via
     the `runtime_task_queue_wake` trigger; this upserts on the same
     conflict target the trigger uses, so it is correct whether or not
     that row already exists. */
  runtime_task_outbox: async (sql, { businessId, runtimeTaskId }) => {
    await sql`insert into runtime_task_outbox (business_id, task_id, not_before)
              values (${businessId}, ${runtimeTaskId}, now())
              on conflict (task_id) where sent_at is null
              do update set not_before = excluded.not_before`;
  },
  specialist_profile: async (sql, { businessId }) => {
    await sql`insert into specialist_profile (business_id, profile_key, name, description)
              values (${businessId}, ${`fixture-${crypto.randomUUID().slice(0, 8)}`}, 'Fixture',
                      'Fixture profile for the purge test.')`;
  },
  push_subscription: async (sql, { businessId, userId }) => {
    await sql`insert into push_subscription (business_id, user_id, endpoint, p256dh, auth)
              values (${businessId}, ${userId}, ${`https://push.example.com/${crypto.randomUUID()}`},
                      ${'A'.repeat(87)}, ${'B'.repeat(22)})`;
  },
  push_outbox: async (sql, { businessId, userId }) => {
    await sql`insert into push_outbox (business_id, user_id, title, body)
              values (${businessId}, ${userId}, 'Fixture', 'Fixture body.')`;
  },
  reminder: async (sql, { businessId, userId }) => {
    await sql`insert into reminder (id, business_id, user_id, message, due_at, time_zone)
              values (${crypto.randomUUID()}, ${businessId}, ${userId}, 'Fixture reminder',
                      now() + interval '1 day', 'Asia/Kuala_Lumpur')`;
  },
  invitation: async (sql, { businessId, userId }) => {
    await sql`insert into invitation (business_id, email, token_hash, invited_by, expires_at)
              values (${businessId}, ${`${crypto.randomUUID()}@fixture.example.com`}, ${hex64()},
                      ${userId}, now() + interval '7 days')`;
  },
  routine: async (sql, { businessId, userId, routineId }) => {
    await sql`insert into routine
                (id, business_id, name, task_kind, frequency, time_of_day, time_zone, status,
                 created_by, authorised_by, create_request_id)
              values (${routineId}, ${businessId}, 'Fixture routine', 'business_summary', 'daily',
                      '09:00', 'Asia/Kuala_Lumpur', 'active', ${userId}, ${userId}, ${crypto.randomUUID()})`;
  },
  routine_change: async (sql, { businessId, userId, routineId }) => {
    await sql`insert into routine_change
                (business_id, routine_id, request_id, operation, request_hash, revision_after, actor)
              values (${businessId}, ${routineId}, ${crypto.randomUUID()}, 'create', ${hex64()}, 1, ${userId})`;
  },
  routine_occurrence: async (sql, { businessId, routineId }) => {
    await sql`insert into routine_occurrence
                (business_id, routine_id, routine_revision, trigger, scheduled_for, status, snapshot)
              values (${businessId}, ${routineId}, 1, 'manual', now(), 'completed', '{}'::jsonb)`;
  },
  notification: async (sql, { businessId, userId }) => {
    await sql`insert into notification (business_id, recipient_user_id, kind, title, body, source_key)
              values (${businessId}, ${userId}, 'routine_completed', 'Fixture', 'Fixture body.',
                      ${crypto.randomUUID()})`;
  },
  workspace: async (sql, { businessId, userId }) => {
    await sql`insert into workspace (business_id, name, created_by)
              values (${businessId}, 'Fixture workspace', ${userId})`;
  },
  chat_session: async (sql, { businessId, userId }) => {
    await sql`insert into chat_session (id, business_id, created_by)
              values (${crypto.randomUUID()}, ${businessId}, ${userId})`;
  },
  goal: async (sql, { businessId, userId }) => {
    await sql`insert into goal (business_id, created_by, title, success_criteria)
              values (${businessId}, ${userId}, 'Fixture goal', 'Fixture success criteria.')`;
  },
  activation_milestone: async (sql, { businessId, userId }) => {
    await sql`insert into activation_milestone (business_id, user_id, kind)
              values (${businessId}, ${userId}, 'installed_app_opened')
              on conflict do nothing`;
  },
  session: async (sql, { businessId, userId }) => {
    await sql`insert into session (id, user_id, business_id, expires_at)
              values (${crypto.randomUUID()}, ${userId}, ${businessId}, now() + interval '1 hour')`;
  },
};

/** Applies every fixture, in the registry's declared (dependency) order. */
export async function applyTenantFixtures(sql: postgres.Sql, ctx: FixtureContext): Promise<void> {
  for (const fixture of Object.values(TENANT_FIXTURES)) {
    await fixture(sql, ctx);
  }
}
