import type { Env } from '../env';
import { withTenant } from '../db';
import { getRuntimeAccess } from '../agent-runtime';
import { hasBusiness, resolveTenant } from '../tenancy';
import { can } from '../permissions';

const ACTIONS = new Set(['claim', 'release', 'frame', 'navigate', 'click', 'text', 'key', 'scroll', 'tab', 'preview', 'preview-stream']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MESSAGES: Record<string, string> = {
  runtime_busy: 'Jentera is still working. Let the current task finish, then take control.',
  browser_busy: 'The browser is handling another action. Try again.',
  browser_controlled: 'Another window is controlling this browser. Hand back there or wait for its control to expire.',
  browser_control_expired: 'Your browser control expired. Take control again to continue or hand back.',
  invalid_url: 'Enter a public HTTPS website address.',
};

/** Deliberately not a generic proxy. Identity selects both the business and
 * its sealed runner key. Never accept an origin, owner id, CDP URL or token
 * from the browser. Screens and input are ephemeral and must not be logged. */
export async function handleBrowser(request: Request, env: Env, url: URL, cors: Record<string, string>): Promise<Response | null> {
  if (url.pathname !== '/api/browser') return null;
  const headers = { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (!['GET', 'POST'].includes(request.method)) return json({ err: 'method not allowed' }, 405);
  const identity = await resolveTenant(env, request);
  if (!identity) return json({ err: 'not signed in' }, 401);
  if (!hasBusiness(identity)) return json({ err: 'no business' }, 404);
  if (!can(identity, 'browser.control')) return json({ err: 'owner access required' }, 403);
  let command: Record<string, unknown> | undefined;
  if (request.method === 'POST') {
    const origin = request.headers.get('Origin');
    if (!origin || !env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).includes(origin)) {
      return json({ err: 'origin not allowed' }, 403);
    }
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) return json({ err: 'JSON required' }, 415);
    try {
      const raw = await request.text();
      if (raw.length > 12000) return json({ err: 'command too large' }, 413);
      const body = JSON.parse(raw);
      if (!body || !ACTIONS.has(body.action) || !UUID.test(body.controlId ?? '')) return json({ err: 'invalid command' }, 400);
      command = { action: body.action, controlId: body.controlId, ownerId: identity.userId, businessId: identity.businessId };
      if (body.action === 'preview' || body.action === 'preview-stream') {
        if (!UUID.test(body.runId ?? '')) return json({ err: 'invalid run' }, 400);
        const tasks = await withTenant(env, identity.businessId, tx => tx`
          select id from runtime_task where business_id = ${identity.businessId}
          and run_id = ${body.runId} and status not in ('completed', 'failed', 'cancelled')
          order by created_at desc limit 1`);
        if (!tasks.length) return json({ previewStatus: 'inactive' });
        command.taskId = tasks[0].id;
      }
      for (const field of ['url', 'x', 'y', 'text', 'key', 'deltaY', 'index']) {
        if (body[field] !== undefined) command[field] = body[field];
      }
    } catch { return json({ err: 'invalid command' }, 400); }
  }
  let stage = 'credentials';
  try {
    const { runtime, secrets } = await withTenant(env, identity.businessId, (tx) => getRuntimeAccess(env, tx, identity.businessId));
    if (!runtime.providerUrl || runtime.provider !== 'fly-sprite' || !env.SPRITES_TOKEN ||
        !['ready', 'cold', 'idle', 'busy'].includes(runtime.status)) return json({ err: 'Business browser is not ready yet.' }, 503);
    const endpoint = new URL('/v1/browser', runtime.providerUrl);
    if (endpoint.protocol !== 'https:') return json({ err: 'Business browser is unavailable.' }, 503);
    stage = 'connect';
    const upstream = await fetch(endpoint, {
      method: request.method, redirect: 'error', signal: AbortSignal.any([request.signal, AbortSignal.timeout(command?.action === 'preview-stream' ? 55000 : command?.action === 'preview' ? 8000 : 25000)]),
      headers: { 'X-Aisar-Runner-Key': secrets.runnerKey, Authorization: `Bearer ${env.SPRITES_TOKEN}`,
        'Content-Type': 'application/json' },
      ...(command ? { body: JSON.stringify(command) } : {}),
    });
    if (!upstream.ok) {
      const body = await upstream.json().catch(() => ({})) as { error?: string };
      const code = typeof body.error === 'string' && Object.hasOwn(MESSAGES, body.error)
        ? body.error : 'browser_unavailable';
      console.warn('[business-browser]', JSON.stringify({ stage: 'upstream', status: upstream.status, code, action: command?.action ?? 'status' }));
      return json({ err: MESSAGES[code] ?? 'Business browser is unavailable. Try again shortly.', code },
        [400, 409].includes(upstream.status) ? upstream.status : 503);
    }
    // The private runner returns only its narrow browser DTO. Do not relay
    // upstream headers, Set-Cookie, server errors or arbitrary proxy content.
    stage = 'decode';
    if (command?.action === 'preview-stream') {
      if (!upstream.body || !upstream.headers.get('Content-Type')?.includes('application/x-ndjson')) {
        await upstream.body?.cancel();
        return json({ err: 'Browser stream is unavailable.' }, 503);
      }
      return new Response(sanitizePreviewStream(upstream.body), {
        headers: { ...headers, 'Content-Type': 'application/x-ndjson' },
      });
    }
    const body = await upstream.json() as Record<string, unknown>;
    if (command?.action === 'preview') return json(previewResponse(body));
    return json(Object.fromEntries(['enabled', 'paused', 'controlled', 'expiresAt', 'image', 'width', 'height', 'tabs', 'ok', 'previewStatus', 'capturedAt']
      .filter((key) => body[key] !== undefined).map((key) => [key, body[key]])));
  } catch (error) {
    // Never log exception messages, request bodies, URLs, controller IDs,
    // credentials, screenshots, or typed input. Only fixed diagnostic labels.
    const name = error instanceof Error && ['TypeError', 'TimeoutError', 'AbortError', 'OperationError', 'SyntaxError'].includes(error.name)
      ? error.name : 'Error';
    console.warn('[business-browser]', JSON.stringify({ stage, name, action: command?.action ?? 'status' }));
    return json({ err: 'Business browser is unavailable. Try again shortly.' }, 503);
  }
}

/** Bound framing and revalidate every image. Never relay arbitrary runtime data. */
export function sanitizePreviewStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  let buffer = '';
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        if (end > 671000) throw new Error('Invalid preview frame');
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        controller.enqueue(encoder.encode(`${JSON.stringify(previewResponse(JSON.parse(line)))}\n`));
      }
      if (buffer.length > 671000) throw new Error('Invalid preview frame');
    },
    flush() { if (buffer.trim()) throw new Error('Incomplete preview frame'); },
  }));
}

/** Preview DTO is narrower than the owner-control DTO; blocked or malformed
 * frames must never carry incidental upstream image/tab fields. */
export function previewResponse(body: Record<string, unknown> | null): Record<string, unknown> {
  const status = body?.previewStatus;
  if (status !== 'ready') return { previewStatus: ['inactive', 'paused', 'private', 'waiting', 'loading'].includes(String(status)) ? status : 'unavailable' };
  if (typeof body?.image !== 'string' || body.image.length < 4 || body.image.length > 670000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(body.image) || typeof body.capturedAt !== 'number' ||
      !Number.isFinite(body.capturedAt) || Math.abs(Date.now() - body.capturedAt) > 30000) {
    return { previewStatus: 'unavailable' };
  }
  return { previewStatus: 'ready', image: body.image, capturedAt: body.capturedAt };
}
