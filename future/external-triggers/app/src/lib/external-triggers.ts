import { nativeAuthorizationHeaders } from '@/lib/native';

export const TRIGGER_TASKS = ['business_summary', 'weekly_summary', 'approval_reminder'] as const;
export type TriggerTask = typeof TRIGGER_TASKS[number];
export interface ExternalTrigger {
  id: string; name: string; task: TriggerTask; timeZone: 'Asia/Kuala_Lumpur';
  expiresAt: string; revokedAt: string | null; createdAt: string;
}
export interface TriggerList {
  available: boolean; triggers: ExternalTrigger[];
  limits: { maxActive: number; dailyEvents: number; bodyBytes: number };
}
export interface TriggerConfig {
  id: string; name: string; task: TriggerTask; timeZone: 'Asia/Kuala_Lumpur'; expiresAt: string;
}
export interface CreatedTrigger { trigger: ExternalTrigger; url: string; secret: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

/** Never render provider/server error text, signatures or secret-bearing URLs. */
export class TriggerError extends Error {
  constructor(public code = 'TRIGGER_UNAVAILABLE') { super('External trigger operation failed'); }
}
function base(): string {
  const url = new URL(API);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new TriggerError();
  return url.origin;
}
export function triggerEndpoint(id: string): string {
  if (!UUID.test(id)) throw new TriggerError('INVALID_RESPONSE');
  return base() + '/api/webhooks/external/' + id;
}
function trigger(value: unknown): ExternalTrigger {
  if (!object(value) || typeof value.id !== 'string' || !UUID.test(value.id)
      || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80
      || !TRIGGER_TASKS.includes(value.task as TriggerTask) || value.timeZone !== 'Asia/Kuala_Lumpur'
      || !date(value.expiresAt) || !date(value.createdAt) || !(value.revokedAt === null || date(value.revokedAt))) throw new TriggerError('INVALID_RESPONSE');
  // Select metadata only: never keep accidental server extras in component state.
  return { id: value.id, name: value.name, task: value.task as TriggerTask, timeZone: value.timeZone,
    expiresAt: value.expiresAt, createdAt: value.createdAt, revokedAt: value.revokedAt };
}
async function call(path: string, signal: AbortSignal, method = 'GET', body?: TriggerConfig): Promise<Record<string, unknown>> {
  const response = await fetch(base() + '/api/external-triggers' + path, {
    method, signal, credentials: 'include', cache: 'no-store', redirect: 'error',
    headers: { ...(await nativeAuthorizationHeaders()), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok || !object(data) || data.ok !== true) {
    const known = ['OWNER_REQUIRED', 'SIGNED_IN_BUSINESS_REQUIRED', 'TRIGGERS_DISABLED', 'LIMIT_OR_ID_CONFLICT', 'INVALID_CONFIG', 'NOT_FOUND'];
    throw new TriggerError(object(data) && typeof data.code === 'string' && known.includes(data.code) ? data.code : 'TRIGGER_UNAVAILABLE');
  }
  return data;
}
export async function fetchTriggers(signal: AbortSignal): Promise<TriggerList> {
  const data = await call('', signal);
  if (data.apiVersion !== 1 || typeof data.available !== 'boolean' || !Array.isArray(data.triggers) || data.triggers.length > 100
      || !object(data.limits) || data.limits.maxActive !== 3 || data.limits.dailyEvents !== 20 || data.limits.bodyBytes !== 2048
      || !Array.isArray(data.tasks) || data.tasks.length !== 3 || !TRIGGER_TASKS.every(task => (data.tasks as unknown[]).includes(task))) throw new TriggerError('INVALID_RESPONSE');
  const triggers = data.triggers.map(trigger);
  if (new Set(triggers.map(row => row.id)).size !== triggers.length) throw new TriggerError('INVALID_RESPONSE');
  return { available: data.available, triggers, limits: { maxActive: 3, dailyEvents: 20, bodyBytes: 2048 } };
}
export async function createTrigger(config: TriggerConfig, signal: AbortSignal): Promise<CreatedTrigger> {
  const data = await call('', signal, 'POST', config);
  const row = trigger(data.trigger);
  if (data.shownOnce !== true || row.id !== config.id || row.name !== config.name || row.task !== config.task
      || row.timeZone !== config.timeZone || Date.parse(row.expiresAt) !== Date.parse(config.expiresAt) || row.revokedAt !== null
      || data.url !== triggerEndpoint(config.id) || typeof data.secret !== 'string' || !/^[0-9a-f]{64}$/.test(data.secret)) throw new TriggerError('INVALID_RESPONSE');
  return { trigger: row, url: data.url, secret: data.secret };
}
export async function revokeTrigger(id: string, signal: AbortSignal): Promise<ExternalTrigger> {
  if (!UUID.test(id)) throw new TriggerError('INVALID_RESPONSE');
  const data = await call('/' + id, signal, 'DELETE');
  const row = trigger(data.trigger);
  if (row.id !== id || !row.revokedAt) throw new TriggerError('INVALID_RESPONSE');
  return row;
}
