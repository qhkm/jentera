import type { Env } from '../env';
import { withTenant } from '../db';
import { getRuntimeAccess } from '../agent-runtime';
import { hasBusiness, resolveTenant } from '../tenancy';
import { can } from '../permissions';
import { DESKTOP_TTL_MS, LEGACY_DESKTOP_TTL_MS, desktopControlProtocol, desktopEnabledFor, desktopTicket } from '../runtime/desktop';

/** Sprites owns the transport. We terminate the init/auth prefaces here so the
 * browser receives ONLY RFB bytes, never a provider token or runner ticket.
 * Both peers and all buffers have hard limits; failed handshakes fail closed. */
export function bridgeSpritesDesktop(upstream: WebSocket, downstream: WebSocket, ticket: Awaited<ReturnType<typeof desktopTicket>>,
  diagnostic: (phase: string, reason: string) => void = (phase, reason) => {
    console.warn('[business-desktop]', JSON.stringify({ stage: 'handshake', phase, reason }));
  }): Promise<void> {
  return new Promise((resolve, reject) => {
    let phase: 'proxy' | 'lease' | 'ready' | 'closed' = 'proxy';
    let preface = new Uint8Array(0);
    let inputBytes = 0;
    let inputWindow = Date.now();
    let outputBytes = 0;
    let outputWindow = Date.now();
    let handshake: ReturnType<typeof setTimeout>;
    let lifetime: ReturnType<typeof setTimeout>;
    const stop = (code = 1011, reason = 'unknown') => {
      if (phase === 'closed') return;
      const pending = phase !== 'ready';
      if (pending) diagnostic(phase, reason);
      phase = 'closed'; preface = new Uint8Array(0);
      clearTimeout(handshake); clearTimeout(lifetime);
      for (const socket of [upstream, downstream]) try { socket.close(code, 'Desktop disconnected'); } catch { /* already closed */ }
      if (pending) reject(new Error('Desktop unavailable'));
    };
    const binary = (data: unknown): Uint8Array | null => data instanceof ArrayBuffer ? new Uint8Array(data) : null;
    const output = (bytes: Uint8Array) => {
      if (Date.now() - outputWindow >= 1000) { outputBytes = 0; outputWindow = Date.now(); }
      outputBytes += bytes.byteLength;
      /* Bound every rolling second rather than total lifetime traffic. A
         lifetime cap disconnected healthy, actively changing desktops after
         64 MiB. workerd closes the socket itself if its outgoing buffer fills;
         our message and rate caps keep one viewer from flooding the isolate. */
      if (outputBytes > 8 * 1024 * 1024) { stop(1009, 'output_rate'); return; }
      downstream.send(bytes);
    };
    upstream.addEventListener('message', event => {
      try {
        if (phase === 'closed') return;
        if (phase === 'proxy') {
          if (typeof event.data !== 'string') { stop(1011, 'proxy_ack_type'); return; }
          if (event.data.length > 256) { stop(1011, 'proxy_ack_size'); return; }
          let ack: unknown;
          try { ack = JSON.parse(event.data); }
          catch { stop(1011, 'proxy_ack_json'); return; }
          /* Sprites may report a resolved loopback address in `target`
             (for example 127.0.0.1 rather than the `localhost` we sent).
             Their official SDK treats that field as informational and
             admits the tunnel from `status` alone. The destination remains
             fixed by our server-authored init message immediately below; no
             browser-controlled host or port reaches this connection. */
          if (!ack || typeof ack !== 'object' || (ack as { status?: unknown }).status !== 'connected') {
            stop(1011, 'proxy_ack_status'); return;
          }
          phase = 'lease';
          upstream.send(new TextEncoder().encode(`${JSON.stringify(ticket)}\n`));
          return;
        }
        const bytes = binary(event.data);
        if (!bytes) { stop(1011, phase === 'lease' ? 'lease_reply_type' : 'output_type'); return; }
        if (bytes.byteLength > 256 * 1024) { stop(1009, phase === 'lease' ? 'lease_reply_size' : 'output_size'); return; }
        if (phase === 'lease') {
          const joined = new Uint8Array(preface.length + bytes.length);
          if (joined.length > 256 * 1024) { stop(1009, 'lease_reply_size'); return; }
          joined.set(preface); joined.set(bytes, preface.length); preface = joined;
          const end = preface.indexOf(10);
          if (end < 0) { if (preface.length > 32) stop(1011, 'lease_reply_prefix'); return; }
          if (end > 32 || new TextDecoder().decode(preface.slice(0, end)) !== '{"ok":true}') {
            stop(1011, 'lease_reply_invalid'); return;
          }
          phase = 'ready'; clearTimeout(handshake);
          const remainder = preface.slice(end + 1); preface = new Uint8Array(0);
          if (remainder.length) output(remainder);
          resolve(); return;
        }
        output(bytes);
      } catch { stop(1011, 'upstream_handler'); }
    });
    downstream.addEventListener('message', event => {
      try {
        if (phase !== 'ready') { stop(1011, 'client_input_before_ready'); return; }
        const bytes = binary(event.data);
        if (!bytes) { stop(1011, 'client_input_type'); return; }
        if (Date.now() - inputWindow >= 1000) { inputBytes = 0; inputWindow = Date.now(); }
        inputBytes += bytes.byteLength;
        if (bytes.byteLength > 64 * 1024 || inputBytes > 256 * 1024) { stop(1009, 'client_input_rate'); return; }
        upstream.send(bytes);
      } catch { stop(1011, 'client_handler'); }
    });
    upstream.addEventListener('close', () => stop(1000, 'upstream_close'));
    upstream.addEventListener('error', () => stop(1011, 'upstream_error'));
    downstream.addEventListener('close', () => stop(1000, 'client_close'));
    downstream.addEventListener('error', () => stop(1011, 'client_error'));
    handshake = setTimeout(() => stop(1011, 'timeout'), 8000);
    // Renewals re-run cookie/session, membership, pilot gate and runner lease.
    lifetime = setTimeout(() => stop(1000), Math.min(DESKTOP_TTL_MS, ticket.expiresAt - Date.now()));
    // Recent compatibility dates default to Blob. Decode synchronously and
    // preserve frame order rather than racing asynchronous Blob conversions.
    upstream.binaryType = 'arraybuffer'; downstream.binaryType = 'arraybuffer';
    upstream.accept(); downstream.accept();
    try { upstream.send(JSON.stringify({ host: 'localhost', port: 5901 })); }
    catch { stop(1011, 'proxy_init_send'); }
  });
}

export async function handleBrowserDesktop(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/browser/desktop') return null;
  const fail = (status: number, err: string) => new Response(JSON.stringify({ err }), { status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } });
  if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return fail(426, 'WebSocket required');
  const origin = request.headers.get('Origin');
  if (!origin || !env.ALLOWED_ORIGINS.split(',').map(value => value.trim()).includes(origin)) return fail(403, 'origin not allowed');
  if (url.search) return fail(400, 'invalid connection');
  const controlId = desktopControlProtocol(request.headers.get('Sec-WebSocket-Protocol'));
  if (!controlId) return fail(400, 'invalid connection');
  const identity = await resolveTenant(env, request);
  if (!identity) return fail(401, 'not signed in');
  if (!hasBusiness(identity)) return fail(404, 'no business');
  if (!can(identity, 'browser.control')) return fail(403, 'owner access required');
  if (!desktopEnabledFor(env, identity.businessId)) return fail(404, 'Desktop pilot is not enabled');
  let upstream: WebSocket | undefined;
  try {
    const { runtime, secrets } = await withTenant(env, identity.businessId, tx => getRuntimeAccess(env, tx, identity.businessId));
    if (runtime.provider !== 'fly-sprite' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(runtime.providerName) ||
        !env.SPRITES_TOKEN || !['ready', 'cold', 'idle'].includes(runtime.status)) return fail(503, 'Desktop unavailable');
    /* Fixed provider + port, never a client-selected URL, ID, host or service.
       The timeout is for the upgrade handshake only. AbortSignal.timeout()
       remains live after fetch resolves and was terminating the upgraded
       WebSocket about twenty seconds into an otherwise healthy desktop. */
    const controller = new AbortController();
    const wakeTimeout = setTimeout(() => controller.abort(), 20_000);
    let response: Response;
    try {
      response = await fetch(`https://api.sprites.dev/v1/sprites/${encodeURIComponent(runtime.providerName)}/proxy`, {
        headers: { Upgrade: 'websocket', Authorization: `Bearer ${env.SPRITES_TOKEN}` },
        redirect: 'manual', signal: controller.signal,
      });
    } finally {
      clearTimeout(wakeTimeout);
    }
    upstream = response.webSocket ?? undefined;
    if (response.status !== 101 || !upstream) {
      try { upstream?.close(1011, 'Desktop unavailable'); } catch { /* already closed */ }
      return fail(503, 'Desktop unavailable');
    }
    const pair = new WebSocketPair();
    // The rolled-back 2026.09.18-6 runner enforces its original one-minute
    // ticket contract. Mint that bounded lifetime until the runner receives
    // the matching ten-minute gateway; otherwise every ticket is rejected
    // before x11vnc starts. Reconnection revalidates the owner session/lease.
    const ticketTtl = runtime.observedRelease === '2026.09.18-6' ? LEGACY_DESKTOP_TTL_MS : DESKTOP_TTL_MS;
    const ticket = await desktopTicket(secrets.runnerKey, identity.businessId, identity.userId, controlId, ticketTtl);
    // Return the upgraded connection first. workerd dispatches WebSocket
    // events after this response; awaiting the private handshake here would
    // deadlock. The bridge emits NO pixels until the runner verifies the live
    // owner lease, and closes both peers on any failed/expired handshake.
    void bridgeSpritesDesktop(upstream, pair[1], ticket).catch(() => {});
    return new Response(null, { status: 101, webSocket: pair[0],
      headers: { 'Sec-WebSocket-Protocol': 'binary', 'Cache-Control': 'private, no-store' } });
  } catch {
    try { upstream?.close(1011, 'Desktop unavailable'); } catch { /* already closed */ }
    // Fixed label only: no exception, endpoint, identity, ticket, input or pixels.
    console.warn('[business-desktop] connection unavailable');
    return fail(503, 'Desktop unavailable');
  }
}
