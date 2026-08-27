import type {
  DesiredRuntime,
  ObservedRuntime,
  RuntimeProvider,
  RuntimeState,
} from './provider';

/**
 * Deterministic provider for development and contract tests.
 *
 * It models lifecycle only. It does not pretend to run Hermes; that is
 * the Local RuntimeAdapter's responsibility when one is introduced.
 */
export class LocalRuntimeProvider implements RuntimeProvider {
  readonly id = 'local' as const;
  private readonly runtimes = new Map<string, ObservedRuntime>();
  private readonly checkpoints = new Map<string, Set<string>>();

  async create(desired: DesiredRuntime): Promise<ObservedRuntime> {
    const existing = this.runtimes.get(desired.name);
    if (existing) return existing;
    const runtime: ObservedRuntime = {
      provider: this.id,
      id: desired.name,
      name: desired.name,
      url: `http://localhost/${encodeURIComponent(desired.name)}`,
      state: 'cold',
    };
    this.runtimes.set(desired.name, runtime);
    this.checkpoints.set(desired.name, new Set());
    return runtime;
  }

  async wake(runtime: ObservedRuntime): Promise<ObservedRuntime> {
    return this.setState(runtime, 'ready');
  }

  async stop(runtime: ObservedRuntime): Promise<void> {
    this.setState(runtime, 'cold');
  }

  async status(runtime: ObservedRuntime): Promise<ObservedRuntime> {
    return this.require(runtime.name);
  }

  async checkpoint(runtime: ObservedRuntime): Promise<string> {
    this.require(runtime.name);
    const ids = this.checkpoints.get(runtime.name)!;
    const id = `v${ids.size + 1}`;
    ids.add(id);
    return id;
  }

  async restore(runtime: ObservedRuntime, checkpointId: string): Promise<void> {
    this.require(runtime.name);
    if (!this.checkpoints.get(runtime.name)?.has(checkpointId)) {
      throw new Error(`unknown checkpoint ${checkpointId}`);
    }
  }

  async destroy(runtime: ObservedRuntime): Promise<void> {
    this.runtimes.delete(runtime.name);
    this.checkpoints.delete(runtime.name);
  }

  private require(name: string): ObservedRuntime {
    const runtime = this.runtimes.get(name);
    if (!runtime) throw new Error(`unknown local runtime ${name}`);
    return runtime;
  }

  private setState(runtime: ObservedRuntime, state: RuntimeState): ObservedRuntime {
    const current = this.require(runtime.name);
    const next = { ...current, state };
    this.runtimes.set(runtime.name, next);
    return next;
  }
}

