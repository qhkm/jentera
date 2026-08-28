/* ============================================================
   Compute lifecycle, independent of agent semantics.

   RuntimeProvider creates and recovers the isolated box. The existing
   RuntimeAdapter decides how a run is performed inside that box. The
   split is what lets Jentera replace Fly without changing task history,
   approvals, connectors, or the frontend.
   ============================================================ */

export const RUNTIME_STATES = [
  'provisioning',
  'ready',
  'cold',
  'waking',
  'idle',
  'busy',
  'error',
  'upgrading',
  'migrating',
  'deleting',
] as const;

export type RuntimeState = (typeof RUNTIME_STATES)[number];

export interface DesiredRuntime {
  businessId: string;
  name: string;
  release: string;
}

export interface ObservedRuntime {
  provider: 'local' | 'fly-sprite';
  id: string;
  name: string;
  url: string;
  state: RuntimeState;
}

export interface RuntimeProvider {
  readonly id: ObservedRuntime['provider'];

  /** Idempotent: an existing resource with this name is success. */
  create(runtime: DesiredRuntime): Promise<ObservedRuntime>;

  /** Wake-on-request providers probe the authenticated runner URL. */
  wake(runtime: ObservedRuntime): Promise<ObservedRuntime>;

  /** Release active work. Providers may sleep automatically. */
  stop(runtime: ObservedRuntime): Promise<void>;

  status(runtime: ObservedRuntime): Promise<ObservedRuntime>;
  checkpoint(runtime: ObservedRuntime, comment?: string): Promise<string>;
  restore(runtime: ObservedRuntime, checkpointId: string): Promise<void>;
  destroy(runtime: ObservedRuntime): Promise<void>;
}

export interface RuntimeExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Extra capabilities needed only while installing an immutable release. */
export interface BootstrapRuntimeProvider extends RuntimeProvider {
  writeFile(runtime: ObservedRuntime, path: string, data: string, mode: number): Promise<void>;
  exec(
    runtime: ObservedRuntime,
    command: string,
    args?: string[],
    options?: { env?: string[]; dir?: string },
  ): Promise<RuntimeExecResult>;
}

export function canBootstrap(provider: RuntimeProvider): provider is BootstrapRuntimeProvider {
  const candidate = provider as Partial<BootstrapRuntimeProvider>;
  return typeof candidate.writeFile === 'function' && typeof candidate.exec === 'function';
}
