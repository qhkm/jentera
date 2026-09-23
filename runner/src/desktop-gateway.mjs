import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, connect } from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { lstat, mkdir, chmod, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Match the browser's ten-minute idle-control window. The gateway still
// checks the live lease every 250 ms, so hand-back and displaced control close
// immediately without forcing an otherwise healthy viewer to reconnect every
// minute.
export const DESKTOP_TTL_MS = 10 * 60_000;

/** Tickets are purpose-bound, single-use and sent ONLY inside the server-side
 * Sprites tunnel, never a URL, client response, trace, or durable file.
 *
 * Two purposes exist and neither validator accepts the other's ticket. The
 * purpose is inside the signed payload, so a watcher cannot become a
 * controller by editing a field in flight. A control ticket names the lease it
 * belongs to (`controlId`); an observe ticket names the run being watched
 * (`runId`) and must carry no lease at all, because it commands nothing. */
function ticketValid(ticket, config, now, purpose, subject) {
  if (!ticket || ticket.purpose !== purpose || ticket.businessId !== config.businessId ||
      ![ticket.ownerId, ticket[subject], ticket.nonce].every(value => typeof value === 'string' && UUID.test(value)) ||
      !Number.isSafeInteger(ticket.issuedAt) || !Number.isSafeInteger(ticket.expiresAt) ||
      ticket.issuedAt > now + 5000 || ticket.issuedAt < now - DESKTOP_TTL_MS ||
      ticket.expiresAt <= now || ticket.expiresAt - ticket.issuedAt > DESKTOP_TTL_MS ||
      typeof ticket.signature !== 'string' || !/^[a-f0-9]{64}$/.test(ticket.signature)) return false;
  const { signature, ...payload } = ticket;
  const expected = createHmac('sha256', config.runnerKey).update(JSON.stringify(payload)).digest();
  return timingSafeEqual(Buffer.from(signature, 'hex'), expected);
}

export function desktopTicketValid(ticket, config, now = Date.now()) {
  return ticketValid(ticket, config, now, 'jentera-desktop-v1', 'controlId');
}

/** Watching only. Refuses a ticket carrying a control lease outright rather
 * than ignoring it, so a malformed or repurposed ticket fails closed. */
export function desktopObserveTicketValid(ticket, config, now = Date.now()) {
  if (ticket?.controlId !== undefined) return false;
  return ticketValid(ticket, config, now, 'jentera-desktop-observe-v1', 'runId');
}

export function desktopArgs({ display = ':99', socketPath, viewOnly = false } = {}) {
  return [
    '-display', display, '-unixsock', socketPath, '-rfbport', '0',
    '-once', '-nopw', '-quiet', '-noremote', '-nolookup', '-no6',
    '-nosel', '-noclipboard', '-nosetclipboard', '-nosetprimary', '-clear_keys', '-norepeat',
    /* The enforcement point for watching. x11vnc still speaks the whole RFB
       protocol with the client — it must, or no frames are ever requested —
       and discards KeyEvent and PointerEvent instead. */
    ...(viewOnly ? ['-viewonly'] : []),
  ];
}

/** VNC is a per-viewer process and a private UNIX socket, not a public TCP
 * listener. Normal shutdown runs x11vnc's -clear_keys before agent hand-back.
 * No desktop stdout/stderr, key data or screenshots are logged or stored. */
export async function openDesktop(config) {
  const socketPath = config.socketPath ?? '/home/sprite/aisar/desktop.sock';
  const viewOnly = config.viewOnly === true;
  await mkdir(dirname(socketPath), { recursive: true, mode: 0o700 });
  try {
    const previous = await lstat(socketPath);
    if (!previous.isSocket()) throw new Error('Desktop socket unavailable');
    await unlink(socketPath);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const child = spawn('/usr/bin/x11vnc',
    desktopArgs({ display: config.display ?? ':99', socketPath, viewOnly }), { stdio: 'ignore' });
  let exited = false;
  let spawnFailed = false;
  const done = new Promise(resolve => {
    child.once('error', () => { spawnFailed = true; exited = true; resolve(); });
    child.once('exit', () => { exited = true; resolve(); });
  });
  const releaseKeys = async () => {
    const local = new URL('./desktop-release-keys.py', import.meta.url);
    const script = existsSync(local) ? local : new URL('../bin/desktop-release-keys.py', import.meta.url);
    await promisify(execFile)('/usr/bin/python3', [fileURLToPath(script)], {
      timeout: 2000, maxBuffer: 1024, env: { ...process.env, DISPLAY: config.display ?? ':99' },
    });
  };
  const stop = async () => {
    if (!exited) child.kill('SIGTERM');
    let timer;
    const clean = await Promise.race([
      done.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 2000); }),
    ]);
    clearTimeout(timer);
    if (!clean) {
      child.kill('SIGKILL');
      let forceTimer;
      const stopped = await Promise.race([done.then(() => true), new Promise(resolve => { forceTimer = setTimeout(() => resolve(false), 2000); })]);
      clearTimeout(forceTimer);
      if (!stopped) throw new Error('Desktop cleanup unavailable');
    }
    // Native reset is verified AFTER the sole input producer has stopped.
    // x11vnc's cleanup is not sufficient on all Linux builds and doesn't
    // release a held drag button. Failure keeps the durable agent pause.
    //
    // A view-only session was never an input producer, so there is nothing to
    // release and nothing to verify. Skipping it is the point rather than an
    // optimisation: this script failing is what latches `cleanupBlocked`, and
    // a latched gateway is indistinguishable from a disabled one.
    if (!viewOnly) await releaseKeys();
    try { await unlink(socketPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  };
  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (exited) throw new Error('Desktop unavailable');
      try {
        if ((await lstat(socketPath)).isSocket()) break;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    await chmod(socketPath, 0o600);
    if (spawnFailed || exited) throw new Error('Desktop unavailable');
    const stream = connect({ path: socketPath });
    // Close is observed before attaching the stream, so early failure is safe.
    stream.on('error', () => {});
    await new Promise((resolve, reject) => {
      stream.once('connect', resolve); stream.once('error', reject);
    });
    return { stream, stop, done };
  } catch {
    await stop();
    throw new Error('Desktop unavailable');
  }
}

/** Fixed owner-only TCP endpoint behind Sprites' authenticated proxy. The
 * runner independently checks the current durable pause + exact live lease
 * for every input chunk. No generic destination or shell command is accepted. */
export function createDesktopGateway(config, deps = {}) {
  const now = deps.now ?? Date.now;
  const launch = deps.openDesktop ?? (options => openDesktop({ ...config, ...options }));
  const seen = new Map();
  const sockets = new Set();
  let viewer = null;
  let cleanupBlocked = false;
  let closing = false;
  let pendingCleanup = Promise.resolve();
  async function disconnect() {
    const old = viewer;
    viewer = null;
    if (old) {
      old.client.destroy(); old.desktop?.stream.destroy();
      pendingCleanup = pendingCleanup.then(async () => {
        const desktop = old.desktop ?? await old.opening;
        await desktop?.stop();
      }).catch(() => { cleanupBlocked = true; });
    }
    await pendingCleanup;
    if (cleanupBlocked) throw new Error('Desktop cleanup unavailable');
  }
  const unsubscribe = config.browser.onControlChanging(disconnect);
  const server = createServer(client => {
    if (closing || cleanupBlocked || sockets.size >= 16) { client.destroy(); return; }
    sockets.add(client);
    client.setNoDelay(true);
    client.setTimeout(3000, () => client.destroy());
    let preface = Buffer.alloc(0);
    let authorized = false;
    let ticket;
    let observing = false;
    let heartbeat;
    let deadline;
    let bytes = 0;
    let windowAt = now();
    /* An observe session holds no lease, so there is none to re-check. What
       keeps it honest instead: it ends the moment the owner takes control,
       through the same onControlChanging teardown a control session uses. */
    const valid = () => authorized && !closing && !cleanupBlocked && viewer?.client === client &&
      ticket.expiresAt > now() && (observing || config.browser.desktopControlValid(ticket));
    const reject = () => client.destroy();
    client.on('error', () => {});
    client.once('close', () => {
      sockets.delete(client); clearInterval(heartbeat); clearTimeout(deadline);
      if (viewer?.client === client) void disconnect().catch(() => {});
    });
    const onInput = chunk => {
      if (!valid()) { reject(); return; }
      if (now() - windowAt >= 1000) { bytes = 0; windowAt = now(); }
      bytes += chunk.length;
      /* Client bytes must flow even when watching: RFB carries its handshake,
         SetEncodings and every FramebufferUpdateRequest this way, so a viewer
         that sent nothing would receive nothing. `-viewonly` is what makes it
         safe — x11vnc processes those messages and discards KeyEvent and
         PointerEvent — and it is x11vnc's own enforcement, not ours. There is
         no lease to extend, so an observer never touches one. */
      if (bytes > 256 * 1024 || (!observing && !config.browser.touchDesktopControl(ticket))) { reject(); return; }
      if (!viewer.desktop.stream.write(chunk)) client.pause();
    };
    client.on('data', async function authenticate(chunk) {
      if (authorized) { onInput(chunk); return; }
      preface = Buffer.concat([preface, chunk]);
      if (preface.length > 1024) { reject(); return; }
      const end = preface.indexOf(10);
      if (end < 0) return;
      // Authentication and RFB input must be separate. Never queue unauth data.
      if (end !== preface.length - 1 || viewer) { reject(); return; }
      try { ticket = JSON.parse(preface.subarray(0, end).toString('utf8')); } catch { reject(); return; }
      preface = Buffer.alloc(0);
      for (const [nonce, expires] of seen) if (expires <= now()) seen.delete(nonce);
      observing = ticket?.purpose === 'jentera-desktop-observe-v1';
      const admitted = observing
        /* Watching needs neither the durable pause nor a lease, but it must
           not race a controller: while the owner holds the desktop, theirs is
           the only session. */
        ? desktopObserveTicketValid(ticket, config, now()) &&
          typeof config.browser.desktopObserveValid === 'function' && config.browser.desktopObserveValid()
        : desktopTicketValid(ticket, config, now()) && config.browser.desktopControlValid(ticket);
      if (!admitted || seen.has(ticket.nonce) || seen.size >= 128) { reject(); return; }
      seen.set(ticket.nonce, ticket.expiresAt);
      client.setTimeout(8000);
      const current = { client, desktop: null, opening: null };
      viewer = current;
      client.pause();
      try {
        await pendingCleanup;
        if (closing || cleanupBlocked || client.destroyed || viewer !== current) { reject(); return; }
        current.opening = launch({ viewOnly: observing });
        current.desktop = await current.opening;
        authorized = true;
        if (!valid() || client.destroyed) {
          reject();
          // A stale launch must not disconnect a newer viewer waiting for
          // its cleanup. The old viewer's cleanup already owns this process.
          if (viewer === current) await disconnect();
          return;
        }
        client.setTimeout(0);
        // Lease acknowledgement is consumed by the Worker, not by noVNC.
        client.write('{"ok":true}\n');
        current.desktop.stream.on('data', data => {
          if (!valid()) { reject(); return; }
          if (!client.write(data)) current.desktop.stream.pause();
        });
        current.desktop.stream.on('drain', () => { if (valid()) client.resume(); });
        client.on('drain', () => { if (valid()) current.desktop.stream.resume(); });
        current.desktop.stream.once('close', reject);
        current.desktop.done.then(reject);
        heartbeat = setInterval(() => { if (!valid()) reject(); }, 250);
        heartbeat.unref();
        deadline = setTimeout(reject, ticket.expiresAt - now()); deadline.unref();
        client.resume();
      } catch { reject(); if (viewer === current) await disconnect().catch(() => {}); }
    });
  });
  server.on('error', () => { closing = true; void disconnect().catch(() => {}); });
  server.desktopReady = () => server.listening && !closing && !cleanupBlocked;
  /* The reviewed recovery the latch is waiting for, rather than a way around
     it. What cleanupBlocked guards is a key or drag button left held by a
     session nobody can see any more; a restart replaces the browser outright,
     so the answer to that is the native reset, performed here and verified.
     The latch clears only if the reset actually ran. */
  server.recoverDesktop = async () => {
    await disconnect().catch(() => {});
    try {
      const local = new URL('./desktop-release-keys.py', import.meta.url);
      const script = existsSync(local) ? local : new URL('../bin/desktop-release-keys.py', import.meta.url);
      await promisify(execFile)('/usr/bin/python3', [fileURLToPath(script)], {
        timeout: 2000, maxBuffer: 1024, env: { ...process.env, DISPLAY: config.display ?? ':99' },
      });
    } catch { return false; }
    cleanupBlocked = false;
    return true;
  };
  server.closeDesktop = async () => {
    closing = true; unsubscribe(); for (const socket of sockets) socket.destroy();
    try { await disconnect(); }
    finally { if (server.listening) await new Promise(resolve => server.close(resolve)); }
  };
  return server;
}
