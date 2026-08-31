/* ============================================================
   Choosing a runtime for a piece of work.

   One implementation today, so the choice is trivial — but it is a
   function rather than a constructor call at each site, which is the
   whole point. A second runtime becomes a branch here instead of an
   edit everywhere work is started.
   ============================================================ */

import type { Env } from '../env';
import { InlineRuntime } from './inline';
import type { RuntimeAdapter } from './types';

export type { RuntimeAdapter, RetrievedFact, PriorWork } from './types';
export { InlineRuntime } from './inline';
export type {
  DesiredRuntime,
  ObservedRuntime,
  RuntimeProvider,
  RuntimeState,
} from './provider';
export { LocalRuntimeProvider } from './local-provider';
export { FlySpriteProvider } from './fly-sprite-provider';
export { ensureProviderRuntime, runtimeProviderFor } from './provision';
export {
  handleRuntimeMessage,
  handleRuntimeQueueMessage,
  publishRuntimeTask,
  signalRuntimeTask,
  signalTelegramIntake,
} from './consumer';
export type {
  RuntimeQueueMessage,
  RuntimeMessageResult,
  RuntimeQueueMessageResult,
} from './consumer';
export { RunnerClient } from './runner-client';
export { dispatchRuntimeRun } from './run-task';

/**
 * The runtime for this business.
 *
 * Takes the business id it does not yet use, deliberately: the first
 * Browser-only and test execution use this adapter. Managed Telegram and
 * production agent work are admitted separately and never substitute this
 * lightweight path for an unavailable Sprite.
 */
export function runtimeFor(env: Env, _businessId: string): RuntimeAdapter {
  return new InlineRuntime(env);
}
