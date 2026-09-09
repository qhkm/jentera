export type ResponseMode = 'quick' | 'deep';

export interface ModelRoutingEnv {
  AISAR_MODEL_NAME?: string;
  AISAR_DEEP_MODEL_NAME?: string;
  /** Comma-separated extra model ids every sprite routes beside quick and deep. */
  AISAR_CANDIDATE_MODEL_NAMES?: string;
  /** Comma-separated `<businessId>=<modelId>`: that business's quick model. */
  AISAR_QUICK_MODEL_OVERRIDES?: string;
}

const MODEL_ID = /^[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._:~-]+)?$/;

/** Extra models the runtime must route (canary or A/B candidates). Every id
 * is validated here so a typo fails at provisioning, not on a sprite. */
export function candidateModelNames(env: ModelRoutingEnv): string[] {
  const names = (env.AISAR_CANDIDATE_MODEL_NAMES ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  for (const name of names) {
    if (!MODEL_ID.test(name)) throw new Error('candidate model id is invalid');
  }
  return names;
}

/** Quick, deep, then candidates; each exactly once. This is the full set a
 * sprite is provisioned to accept, so it is also the set an override may name. */
export function routedModelNames(env: ModelRoutingEnv): string[] {
  const quick = env.AISAR_MODEL_NAME?.trim() ?? '';
  const deep = env.AISAR_DEEP_MODEL_NAME?.trim() || quick;
  const routed: string[] = [];
  for (const name of [quick, deep, ...candidateModelNames(env)]) {
    if (name && !routed.includes(name)) routed.push(name);
  }
  return routed;
}

function quickModelOverride(env: ModelRoutingEnv, businessId: string): string | undefined {
  const pairs = (env.AISAR_QUICK_MODEL_OVERRIDES ?? '')
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean);
  for (const pair of pairs) {
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    if (pair.slice(0, separator).trim() !== businessId) continue;
    const model = pair.slice(separator + 1).trim();
    if (!routedModelNames(env).includes(model)) {
      throw new Error('quick model override is not a routed model');
    }
    return model;
  }
  return undefined;
}

export function modelForResponseMode(
  env: ModelRoutingEnv,
  mode: ResponseMode,
  businessId?: string,
): string {
  const quick = env.AISAR_MODEL_NAME?.trim() ?? '';
  const deep = env.AISAR_DEEP_MODEL_NAME?.trim() || quick;
  const override = mode === 'quick' && businessId ? quickModelOverride(env, businessId) : undefined;
  const selected = override ?? (mode === 'quick' ? quick : deep);
  if (!selected) throw new Error('runtime model is not configured');
  return selected;
}

/** Ordinary business chat is quick. Deep reasoning is opt-in with `/deep`
 * or `/research`; `/quick` is the escape hatch the other way.
 *
 * A wording heuristic ("deep dive", "comprehensive", "research…") used to
 * pick deep on its own. The two Telegram replies it triggered in the week
 * to 2026-09-09 took nine and ten minutes on deepseek while the owner
 * waited for a chat answer. Ten minutes is a cost an owner should choose
 * by typing the command, not incur by phrasing. */
export function responseModeFor(input: string): ResponseMode {
  const text = input.trim().toLowerCase();
  if (/^\/quick(?:\s|$)/.test(text)) return 'quick';
  if (/^\/(?:deep|research)(?:\s|$)/.test(text)) return 'deep';
  return 'quick';
}
