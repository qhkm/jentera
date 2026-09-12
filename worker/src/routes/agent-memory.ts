/* ============================================================
   What the agent remembers, read from the business's own runner.

   GET  /api/agent/memory          the agent's memory entries, by specialist
   POST /api/agent/memory/forget   remove one entry: { profile, file, text }

   Owner only: the files hold what the agent noted about the people it
   talks to. The runner reads Hermes's two small memory files per profile
   and rewrites one without the entry asked for; it refuses while a task is
   running, because Hermes writes memory mid-run under its own lock. Like
   the business browser, only the runner's narrow DTO is relayed — never
   upstream headers or arbitrary content. A runtime that predates the
   endpoint answers 404, which the app reads as "not available yet".
   ============================================================ */
import type { Env } from '../env';
import { withTenant } from '../db';
import { hasBusiness, resolveTenant } from '../tenancy';
import { can } from '../permissions';
import { getRuntimeAccess } from '../agent-runtime';

const PROFILE = /^[a-z][a-z0-9-]{0,47}$/;
const FILES = new Set(['MEMORY.md', 'USER.md']);

function json(body: unknown, init: ResponseInit = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...headers, ...(init.headers ?? {}) },
  });
}

export interface AgentMemoryEntry { index: number; text: string }
export interface AgentMemoryFile { file: 'MEMORY.md' | 'USER.md'; entries: AgentMemoryEntry[] }
export interface AgentMemoryProfile { profile: string; files: AgentMemoryFile[] }

function sanitizeProfiles(value: unknown): AgentMemoryProfile[] {
  if (!Array.isArray(value)) return [];
  const out: AgentMemoryProfile[] = [];
  for (const raw of value.slice(0, 20)) {
    const p = raw as { profile?: unknown; files?: unknown };
    if (typeof p.profile !== 'string' || !(p.profile === 'default' || PROFILE.test(p.profile)) || !Array.isArray(p.files)) continue;
    const files: AgentMemoryFile[] = [];
    for (const f of p.files as { file?: unknown; entries?: unknown }[]) {
      if (typeof f.file !== 'string' || !FILES.has(f.file) || !Array.isArray(f.entries)) continue;
      const entries = (f.entries as { index?: unknown; text?: unknown }[])
        .filter((e) => typeof e.index === 'number' && typeof e.text === 'string')
        .slice(0, 200)
        .map((e) => ({ index: e.index as number, text: String(e.text).slice(0, 4000) }));
      files.push({ file: f.file as AgentMemoryFile['file'], entries });
    }
    out.push({ profile: p.profile, files });
  }
  return out;
}

export async function handleAgentMemory(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/agent/memory')) return null;
  const identity = await resolveTenant(env, request);
  if (!hasBusiness(identity)) return json({ ok: false, err: 'unauthorized' }, { status: 401 }, cors);
  if (!can(identity, 'agent.memory')) return json({ ok: false, err: 'owner access required' }, { status: 403 }, cors);
  const privateHeaders = { ...cors, 'Cache-Control': 'private, no-store' };

  const forget = url.pathname === '/api/agent/memory/forget';
  if (!forget && url.pathname !== '/api/agent/memory') return null;
  if (forget && request.method !== 'POST') return json({ ok: false, err: 'method not allowed' }, { status: 405 }, cors);
  if (!forget && request.method !== 'GET') return json({ ok: false, err: 'method not allowed' }, { status: 405 }, cors);

  let body: { profile?: unknown; file?: unknown; text?: unknown } | null = null;
  if (forget) {
    const origin = request.headers.get('Origin');
    if (!origin || origin !== cors['Access-Control-Allow-Origin']) return json({ ok: false, err: 'origin not allowed' }, { status: 403 }, cors);
    body = (await request.json().catch(() => null)) as { profile?: unknown; file?: unknown; text?: unknown } | null;
    if (!body || typeof body.profile !== 'string' || !(body.profile === 'default' || PROFILE.test(body.profile))
      || typeof body.file !== 'string' || !FILES.has(body.file)
      || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 4000) {
      return json({ ok: false, err: 'profile, file and text are required' }, { status: 400 }, cors);
    }
  }

  const { runtime, secrets } = await withTenant(env, identity.businessId, (tx) => getRuntimeAccess(env, tx, identity.businessId));
  if (!runtime.providerUrl || runtime.provider !== 'fly-sprite' || !env.SPRITES_TOKEN
    || !['ready', 'cold', 'idle', 'busy'].includes(runtime.status)) {
    return json({ ok: true, available: false, profiles: [] }, {}, privateHeaders);
  }
  const endpoint = new URL(forget ? '/v1/memory/forget' : '/v1/memory', runtime.providerUrl);
  if (endpoint.protocol !== 'https:') return json({ ok: true, available: false, profiles: [] }, {}, privateHeaders);
  let upstream: Response;
  try {
    upstream = await fetch(endpoint, {
      method: forget ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { 'X-Aisar-Runner-Key': secrets.runnerKey, Authorization: `Bearer ${env.SPRITES_TOKEN}`, 'Content-Type': 'application/json' },
      ...(forget ? { body: JSON.stringify({ profile: body!.profile, file: body!.file, text: body!.text }) } : {}),
    });
  } catch {
    return json({ ok: false, err: 'Jentera’s memory is not reachable right now. Try again shortly.' }, { status: 503 }, cors);
  }
  if (upstream.status === 404 && !forget) {
    /* A runtime on a release before the endpoint existed. */
    return json({ ok: true, available: false, profiles: [] }, {}, privateHeaders);
  }
  if (!upstream.ok) {
    const detail = await upstream.json().catch(() => ({})) as { error?: string };
    if (forget && upstream.status === 409) return json({ ok: false, err: 'Jentera is working right now. Try again when it is idle.' }, { status: 409 }, cors);
    if (forget && upstream.status === 404) return json({ ok: false, err: 'That entry is no longer there.' }, { status: 404 }, cors);
    console.warn('[agent-memory]', JSON.stringify({ status: upstream.status, error: detail.error ?? null }));
    return json({ ok: false, err: 'Jentera’s memory is not reachable right now. Try again shortly.' }, { status: 503 }, cors);
  }
  if (forget) return json({ ok: true }, {}, cors);
  const payload = await upstream.json().catch(() => ({})) as { profiles?: unknown };
  return json({ ok: true, available: true, profiles: sanitizeProfiles(payload.profiles) }, {}, privateHeaders);
}
