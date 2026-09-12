import type { RuntimeOverview } from '@/lib/repo';

export function computerStatus(data: RuntimeOverview) {
  const runtime = data.runtime;
  if (!runtime) {
    if (['queued', 'leased', 'failed'].includes(data.setupStatus ?? '')) return 'settingUp';
    if (['exhausted', 'cancelled', 'cancel_requested', 'completed'].includes(data.setupStatus ?? '')) return 'attention';
    return 'missing';
  }
  if (runtime.status === 'error') return 'attention';
  if (runtime.status === 'deleting') return 'unavailable';
  if (runtime.status === 'provisioning') return 'settingUp';
  if (['upgrading', 'migrating'].includes(runtime.status)) return 'updating';
  if (runtime.status === 'waking') return 'waking';
  // A row is not readiness: require a successful readiness observation on the target release.
  if (!runtime.lastReadyAt) return 'settingUp';
  if (!runtime.desiredRelease || runtime.observedRelease !== runtime.desiredRelease) return 'updating';
  if (runtime.status === 'cold') return 'asleep';
  if (runtime.status === 'busy') return 'busy';
  if (['ready', 'idle'].includes(runtime.status)) return 'ready';
  return 'checking';
}
