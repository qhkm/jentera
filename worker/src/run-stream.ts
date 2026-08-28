import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';

export const RUN_PROGRESS_TYPES = [
  'queued',
  'waking',
  'working',
  'retrying',
  'completed',
  'failed',
  'cancelled',
] as const;

export type RunProgressType = (typeof RUN_PROGRESS_TYPES)[number];

export interface RunProgressEvent {
  version: 1;
  seq: number;
  type: RunProgressType;
  at: string;
}

interface StreamIdentity {
  businessId: string;
  runId: string;
}

const MAX_EVENTS = 64;
const MAX_CONNECTIONS = 8;
const MAX_CONNECTIONS_PER_USER = 2;
const RETENTION_MS = 24 * 60 * 60 * 1_000;
const TERMINAL = new Set<RunProgressType>(['completed', 'failed', 'cancelled']);

/**
 * One hibernating WebSocket broadcaster per business/run pair.
 *
 * The object has no public route. The authenticated Worker is the only caller through
 * the RUN_STREAMS binding, and it supplies the session-derived tenant and user identity.
 * No prompt, model output, credential, provider id, or customer data is stored here.
 */
export class RunStream extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/publish' && request.method === 'POST') {
      return this.publish(request);
    }
    if (url.pathname === '/subscribe' && request.method === 'GET') {
      return this.subscribe(request);
    }
    return new Response('not found', { status: 404 });
  }

  async alarm(): Promise<void> {
    for (const socket of this.ctx.getWebSockets()) {
      safeClose(socket, 1001, 'stream expired');
    }
    await this.ctx.storage.deleteAll();
  }

  webSocketMessage(socket: WebSocket): void {
    /* This is a server-to-browser event stream, not an input channel. Closing clients
       that send data prevents a compromised page from turning it into an echo/CPU API. */
    safeClose(socket, 1008, 'read only');
  }

  webSocketClose(socket: WebSocket, code: number, reason: string): void {
    safeClose(socket, code, reason);
  }

  webSocketError(socket: WebSocket): void {
    safeClose(socket, 1011, 'stream error');
  }

  private async publish(request: Request): Promise<Response> {
    const body = await boundedJson(request);
    const identity = streamIdentity(body);
    const type = progressType(body.type);
    if (!identity || !type) return new Response('invalid event', { status: 400 });

    const event = await this.ctx.storage.transaction(async (tx) => {
      const existing = await tx.get<StreamIdentity>('identity');
      if (existing &&
          (existing.businessId !== identity.businessId || existing.runId !== identity.runId)) {
        return null;
      }
      const seq = (await tx.get<number>('seq') ?? 0) + 1;
      const next: RunProgressEvent = {
        version: 1,
        seq,
        type,
        at: new Date().toISOString(),
      };
      await tx.put({
        identity,
        seq,
        [eventKey(seq)]: next,
      });
      if (seq > MAX_EVENTS) await tx.delete(eventKey(seq - MAX_EVENTS));
      await tx.setAlarm(Date.now() + RETENTION_MS);
      return next;
    });
    if (!event) return new Response('stream identity conflict', { status: 409 });

    const encoded = JSON.stringify(event);
    for (const socket of this.ctx.getWebSockets()) {
      safeSend(socket, encoded);
      if (TERMINAL.has(event.type)) safeClose(socket, 1000, 'run finished');
    }
    return Response.json({ ok: true, seq: event.seq });
  }

  private async subscribe(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('websocket required', { status: 426 });
    }
    const identity = streamIdentity({
      businessId: request.headers.get('X-AISAR-Business'),
      runId: request.headers.get('X-AISAR-Run'),
    });
    const userId = request.headers.get('X-AISAR-User') ?? '';
    if (!identity || !uuid(userId)) return new Response('invalid subscriber', { status: 400 });

    const stored = await this.ctx.storage.get<StreamIdentity>('identity');
    if (stored &&
        (stored.businessId !== identity.businessId || stored.runId !== identity.runId)) {
      return new Response('stream identity conflict', { status: 409 });
    }
    /* A client may subscribe before the queue consumer publishes its first event.
       Arm retention here too, otherwise that empty stream identity could survive
       forever if the task never starts. */
    await this.ctx.storage.put('identity', identity);
    await this.ctx.storage.setAlarm(Date.now() + RETENTION_MS);

    const userTag = `user:${userId}`;
    if (this.ctx.getWebSockets().length >= MAX_CONNECTIONS ||
        this.ctx.getWebSockets(userTag).length >= MAX_CONNECTIONS_PER_USER) {
      return new Response('too many stream connections', {
        status: 429,
        headers: { 'Retry-After': '60' },
      });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment({ businessId: identity.businessId, runId: identity.runId, userId });
    this.ctx.acceptWebSocket(server, [userTag]);

    const events = await this.ctx.storage.list<RunProgressEvent>({ prefix: 'event:' });
    let terminal = false;
    for (const event of events.values()) {
      safeSend(server, JSON.stringify(event));
      terminal ||= TERMINAL.has(event.type);
    }
    if (terminal) safeClose(server, 1000, 'run finished');

    return new Response(null, { status: 101, webSocket: client });
  }
}

function eventKey(seq: number): string {
  return `event:${String(seq).padStart(12, '0')}`;
}

async function boundedJson(request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get('Content-Length') ?? 0);
  if (declared > 2_048) return {};
  const text = await request.text();
  if (text.length > 2_048) return {};
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function streamIdentity(value: Record<string, unknown>): StreamIdentity | null {
  const businessId = typeof value.businessId === 'string' ? value.businessId : '';
  const runId = typeof value.runId === 'string' ? value.runId : '';
  return uuid(businessId) && uuid(runId) ? { businessId, runId } : null;
}

function progressType(value: unknown): RunProgressType | null {
  return typeof value === 'string' && RUN_PROGRESS_TYPES.includes(value as RunProgressType)
    ? value as RunProgressType
    : null;
}

function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}

function safeSend(socket: WebSocket, message: string): void {
  try {
    socket.send(message);
  } catch {
    /* A disconnect racing a publish is normal and must not fail the run. */
  }
}

function safeClose(socket: WebSocket, code: number, reason: string): void {
  try {
    socket.close(code, reason.slice(0, 100));
  } catch {
    /* Already closed. */
  }
}
