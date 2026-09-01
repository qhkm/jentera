import type postgres from 'postgres';

const RESERVED_INPUT_TOKENS = 100_000;
const RESERVED_OUTPUT_TOKENS = 25_000;

export interface RuntimeBudget {
  monthlyInputTokens: number;
  monthlyOutputTokens: number;
  monthlyRuntimeSeconds: number;
  monthlyCostMicrousd: number;
  maxRunSeconds: number;
}

export interface RuntimeUsageReservation {
  startedAt: Date;
  maxRunSeconds: number;
}

export interface RuntimeUsageTotals {
  inputTokens: number;
  outputTokens: number;
  runtimeMs: number;
  costMicrousd: number;
}

interface BudgetRow {
  monthly_input_tokens: string;
  monthly_output_tokens: string;
  monthly_runtime_seconds: string;
  monthly_cost_microusd: string;
  max_run_seconds: number;
}

interface UsageRow {
  started_at: Date;
}

interface TotalsRow {
  input_tokens: string;
  output_tokens: string;
  runtime_ms: string;
  cost_microusd: string;
}

export class RuntimeBudgetExceeded extends Error {
  readonly code = 'RUNTIME_BUDGET_EXCEEDED';

  constructor(readonly dimension: 'input_tokens' | 'output_tokens' | 'runtime' | 'cost') {
    super(`runtime budget exceeded (${dimension})`);
    this.name = 'RuntimeBudgetExceeded';
  }
}

/**
 * Atomically admit one model task. Active work counts at its full reservation,
 * so a crash or delayed provider response cannot open an unmetered window.
 */
export async function reserveRuntimeUsage(
  tx: postgres.TransactionSql,
  businessId: string,
  taskId: string,
  model: string,
): Promise<RuntimeUsageReservation> {
  await tx`
    insert into runtime_budget (business_id) values (${businessId})
    on conflict (business_id) do nothing`;
  const [budgetRow] = await tx<BudgetRow[]>`
    select monthly_input_tokens::text, monthly_output_tokens::text,
           monthly_runtime_seconds::text, monthly_cost_microusd::text,
           max_run_seconds
      from runtime_budget
     where business_id = ${businessId}
     for update`;
  /* The idempotency lookup and monthly totals share one fresh snapshot after
     the budget-row lock. Keeping that lock as its own statement preserves
     cross-request serialization while removing one database round trip. */
  const state = await monthlyState(tx, businessId, budgetRow.max_run_seconds, taskId);
  if (state.existingStartedAt) {
    return { startedAt: state.existingStartedAt, maxRunSeconds: budgetRow.max_run_seconds };
  }

  const totals = state.usage;
  const reservedCost = modelCostMicrousd(
    model,
    RESERVED_INPUT_TOKENS,
    RESERVED_OUTPUT_TOKENS,
  );
  if (totals.inputTokens + RESERVED_INPUT_TOKENS > number(budgetRow.monthly_input_tokens)) {
    throw new RuntimeBudgetExceeded('input_tokens');
  }
  if (totals.outputTokens + RESERVED_OUTPUT_TOKENS > number(budgetRow.monthly_output_tokens)) {
    throw new RuntimeBudgetExceeded('output_tokens');
  }
  if (totals.runtimeMs + budgetRow.max_run_seconds * 1_000 >
      number(budgetRow.monthly_runtime_seconds) * 1_000) {
    throw new RuntimeBudgetExceeded('runtime');
  }
  if (totals.costMicrousd + reservedCost > number(budgetRow.monthly_cost_microusd)) {
    throw new RuntimeBudgetExceeded('cost');
  }

  const [created] = await tx<UsageRow[]>`
    insert into runtime_usage
      (business_id, runtime_task_id, reserved_input_tokens,
       reserved_output_tokens, model)
    values
      (${businessId}, ${taskId}, ${RESERVED_INPUT_TOKENS},
       ${RESERVED_OUTPUT_TOKENS}, ${model})
    returning started_at`;
  return { startedAt: created.started_at, maxRunSeconds: budgetRow.max_run_seconds };
}

/** Start the billed run window only after Hermes has accepted the task. */
export async function markRuntimeUsageStarted(
  tx: postgres.TransactionSql,
  businessId: string,
  taskId: string,
): Promise<void> {
  await tx`
    update runtime_usage
       set started_at = now(), updated_at = now()
     where business_id = ${businessId} and runtime_task_id = ${taskId}
       and status = 'reserved'`;
}

export async function finalizeRuntimeUsage(
  tx: postgres.TransactionSql,
  businessId: string,
  taskId: string,
  status: 'completed' | 'failed' | 'cancelled',
  usage?: { inputTokens: number; outputTokens: number },
): Promise<void> {
  const [row] = await tx<{
    model: string;
    reserved_input_tokens: string;
    reserved_output_tokens: string;
  }[]>`
    select model, reserved_input_tokens::text, reserved_output_tokens::text
      from runtime_usage
     where business_id = ${businessId} and runtime_task_id = ${taskId}`;
  if (!row) return;
  /* Unknown abnormal termination is charged at the reserved ceiling. This is
     deliberately conservative: recording zero would create unmetered spend. */
  const inputTokens = usage
    ? tokenCount(usage.inputTokens)
    : number(row.reserved_input_tokens);
  const outputTokens = usage
    ? tokenCount(usage.outputTokens)
    : number(row.reserved_output_tokens);
  const cost = modelCostMicrousd(row.model, inputTokens, outputTokens);
  await tx`
    update runtime_usage
       set status = ${status}, input_tokens = ${inputTokens},
           output_tokens = ${outputTokens},
           runtime_ms = greatest(0, floor(extract(epoch from (now() - started_at)) * 1000)),
           cost_microusd = ${cost}, completed_at = now(), updated_at = now()
     where business_id = ${businessId} and runtime_task_id = ${taskId}
       and status = 'reserved'`;
}

export async function runtimeBudgetSnapshot(
  tx: postgres.TransactionSql,
  businessId: string,
): Promise<{ budget: RuntimeBudget; usage: RuntimeUsageTotals }> {
  await tx`
    insert into runtime_budget (business_id) values (${businessId})
    on conflict (business_id) do nothing`;
  const [row] = await tx<BudgetRow[]>`
    select monthly_input_tokens::text, monthly_output_tokens::text,
           monthly_runtime_seconds::text, monthly_cost_microusd::text,
           max_run_seconds
      from runtime_budget where business_id = ${businessId}`;
  return {
    budget: budget(row),
    usage: await monthlyTotals(tx, businessId, row.max_run_seconds),
  };
}

async function monthlyTotals(
  tx: postgres.TransactionSql,
  businessId: string,
  maxRunSeconds: number,
): Promise<RuntimeUsageTotals> {
  return (await monthlyState(tx, businessId, maxRunSeconds)).usage;
}

async function monthlyState(
  tx: postgres.TransactionSql,
  businessId: string,
  maxRunSeconds: number,
  taskId?: string,
): Promise<{ usage: RuntimeUsageTotals; existingStartedAt: Date | null }> {
  const [row] = await tx<(TotalsRow & { existing_started_at: Date | null })[]>`
    select
      coalesce(sum(case when status = 'reserved' then reserved_input_tokens else input_tokens end), 0)::text
        as input_tokens,
      coalesce(sum(case when status = 'reserved' then reserved_output_tokens else output_tokens end), 0)::text
        as output_tokens,
      coalesce(sum(case when status = 'reserved' then ${maxRunSeconds * 1_000} else runtime_ms end), 0)::text
        as runtime_ms,
      coalesce(sum(case when status = 'reserved'
        then ceil((reserved_input_tokens * 6 + reserved_output_tokens * 12)::numeric / 100)
        else cost_microusd end), 0)::text as cost_microusd,
      (select started_at
         from runtime_usage
        where business_id = ${businessId}
          and runtime_task_id = ${taskId ?? null}::uuid) as existing_started_at
    from runtime_usage
    where business_id = ${businessId}
      and started_at >= date_trunc('month', now())`;
  return {
    usage: {
      inputTokens: number(row.input_tokens),
      outputTokens: number(row.output_tokens),
      runtimeMs: number(row.runtime_ms),
      costMicrousd: number(row.cost_microusd),
    },
    existingStartedAt: row.existing_started_at,
  };
}

function budget(row: BudgetRow): RuntimeBudget {
  return {
    monthlyInputTokens: number(row.monthly_input_tokens),
    monthlyOutputTokens: number(row.monthly_output_tokens),
    monthlyRuntimeSeconds: number(row.monthly_runtime_seconds),
    monthlyCostMicrousd: number(row.monthly_cost_microusd),
    maxRunSeconds: row.max_run_seconds,
  };
}

/** Prices are micro-USD per 100 tokens for the pinned model routes. */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // DeepSeek V4 Flash: $0.06/M in, $0.12/M out
  'deepseek/deepseek-v4-flash-0731': { input: 6, output: 12 },
  'deepseek/deepseek-v4-flash-20260731': { input: 6, output: 12 },
  'deepseek-v4-flash': { input: 6, output: 12 },
  // MiniMax M3 on the customer-pinned router: $0.30/M in, $1.20/M out
  'MiniMax-M3': { input: 30, output: 120 },
};

function modelCostMicrousd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) throw new Error('runtime model pricing is not configured');
  return Math.ceil((inputTokens * pricing.input + outputTokens * pricing.output) / 100);
}

function tokenCount(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function number(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('runtime usage is out of range');
  return parsed;
}
