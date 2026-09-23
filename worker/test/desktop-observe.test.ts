import { expect, it } from 'vitest';
import { DESKTOP_TTL_MS, desktopControlProtocol, desktopObserveProtocol, desktopObserveTicket, desktopTicket,
  releaseAtLeast } from '../src/runtime/desktop';
import { handleBrowserObserve } from '../src/routes/browser-desktop';
import type { Env } from '../src/env';

/* Watching the agent work. The contract is
   `docs/plans/2026-09-23-desktop-observe.md`: same owner gates as control,
   no lease, and a purpose that cannot be swapped for the other one. */

const businessId = '11111111-1111-4111-8111-111111111111';
const ownerId = '22222222-2222-4222-8222-222222222222';
const runId = '44444444-4444-4444-8444-444444444444';
const runnerKey = 'observe-runner-key-'.repeat(3);

it('the observe subprotocol and the control subprotocol refuse each other', () => {
  expect(desktopObserveProtocol(`binary, jentera-observe.${runId}`)).toBe(runId);
  expect(desktopControlProtocol(`binary, jentera-control.${runId}`)).toBe(runId);

  // Neither parser accepts the other's prefix, so a control socket cannot be
  // opened by relabelling an observe request or the reverse.
  expect(desktopObserveProtocol(`binary, jentera-control.${runId}`)).toBeNull();
  expect(desktopControlProtocol(`binary, jentera-observe.${runId}`)).toBeNull();

  for (const bad of [null, '', 'binary', `jentera-observe.${runId}`, 'binary, jentera-observe.nope',
    `binary, jentera-observe.${runId}, extra`, `binary,jentera-observe.${runId.toUpperCase()}x`]) {
    expect(desktopObserveProtocol(bad)).toBeNull();
  }
});

it('an observe ticket is purpose-bound and carries a run, never a lease', async () => {
  const ticket = await desktopObserveTicket(runnerKey, businessId, ownerId, runId);
  expect(ticket.purpose).toBe('jentera-desktop-observe-v1');
  expect(ticket.runId).toBe(runId);
  // A lease has no meaning for a session that commands nothing; the runner
  // refuses an observe ticket that carries one.
  expect('controlId' in ticket).toBe(false);
  expect(ticket.expiresAt - ticket.issuedAt).toBe(DESKTOP_TTL_MS);

  const control = await desktopTicket(runnerKey, businessId, ownerId, runId);
  expect(control.purpose).toBe('jentera-desktop-v1');
  expect(ticket.signature).not.toBe(control.signature);
});

function env(extra: Partial<Env> = {}) {
  return { ALLOWED_ORIGINS: 'https://jentera.ai', DESKTOP_VIEW_ENABLED: 'true',
    DESKTOP_VIEW_BUSINESS_IDS: businessId, ...extra } as unknown as Env;
}
function ws(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { headers: { Upgrade: 'websocket', Origin: 'https://jentera.ai',
    'Sec-WebSocket-Protocol': `binary, jentera-observe.${runId}`, ...headers } });
}

it('refuses anything that is not a same-origin websocket for a run', async () => {
  const url = 'https://api.jentera.ai/api/browser/observe';
  const cases: [Request, number][] = [
    [new Request(url, { headers: { Origin: 'https://jentera.ai' } }), 426],
    [ws(url, { Origin: 'https://evil.example' }), 403],
    [ws(url, { Origin: '' }), 403],
    [ws(`${url}?run=1`), 400],
    [ws(url, { 'Sec-WebSocket-Protocol': `binary, jentera-control.${runId}` }), 400],
    [ws(url, { 'Sec-WebSocket-Protocol': 'binary' }), 400],
  ];
  for (const [request, status] of cases) {
    const response = await handleBrowserObserve(request, env(), new URL(request.url));
    expect(response?.status).toBe(status);
  }
});

it('answers null for any other path, so it never shadows a sibling route', async () => {
  const request = ws('https://api.jentera.ai/api/browser/desktop');
  expect(await handleBrowserObserve(request, env(), new URL(request.url))).toBeNull();
});

it('a business outside the pilot list is not told the pilot exists', async () => {
  const request = ws('https://api.jentera.ai/api/browser/observe');
  // No session at all resolves first: an unauthenticated probe learns nothing
  // about eligibility.
  const response = await handleBrowserObserve(request, env({ DESKTOP_VIEW_ENABLED: 'false' }), new URL(request.url));
  expect(response?.status).toBe(401);
});

it('compares releases by their parts, so a tenth release is not older than a second', () => {
  expect(releaseAtLeast('2026.09.23-2', '2026.09.23-2')).toBe(true);
  expect(releaseAtLeast('2026.09.23-3', '2026.09.23-2')).toBe(true);
  // The reason this is not a string compare.
  expect(releaseAtLeast('2026.09.23-10', '2026.09.23-2')).toBe(true);
  expect(releaseAtLeast('2026.09.24-1', '2026.09.23-2')).toBe(true);
  expect(releaseAtLeast('2026.10.01-1', '2026.09.23-2')).toBe(true);

  expect(releaseAtLeast('2026.09.23-1', '2026.09.23-2')).toBe(false);
  expect(releaseAtLeast('2026.09.22-9', '2026.09.23-2')).toBe(false);
  expect(releaseAtLeast('2025.12.31-9', '2026.09.23-2')).toBe(false);
  // An unreadable or absent release is older than everything: fail closed.
  for (const bad of [null, undefined, '', 'Current', '2026.09.23', 'v64']) {
    expect(releaseAtLeast(bad, '2026.09.23-2')).toBe(false);
  }
});
