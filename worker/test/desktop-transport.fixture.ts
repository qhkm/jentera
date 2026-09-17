// workerd transport integration fixture ONLY; never deployed. Route security
// uses the real handleBrowserDesktop tests separately with tenant fixtures.
import { bridgeSpritesDesktop } from '../src/routes/browser-desktop';
import { desktopControlProtocol, desktopTicket } from '../src/runtime/desktop';
export default {
  async fetch(request: Request) {
    const url = new URL(request.url);
    const controlId = desktopControlProtocol(request.headers.get('Sec-WebSocket-Protocol'));
    if (url.pathname !== '/api/browser/desktop' || !controlId || request.headers.get('Upgrade') !== 'websocket' ||
        request.headers.get('Origin') !== 'http://127.0.0.1:3982' || !request.headers.get('Cookie')?.includes('fixture-owner=1')) return new Response('Fixture refused', { status: 403 });
    const response = await fetch('http://127.0.0.1:3980/sprites/test/proxy', {
      headers: { Upgrade: 'websocket', Authorization: 'Bearer isolated-sprites-token' }, redirect: 'manual',
    });
    if (!response.webSocket) return new Response('Fixture unavailable', { status: 503 });
    const pair = new WebSocketPair();
    try {
      const ticket = await desktopTicket('isolated-desktop-runner-key-'.repeat(2),
        '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', controlId);
      void bridgeSpritesDesktop(response.webSocket, pair[1], ticket).catch(() => {});
      return new Response(null, { status: 101, webSocket: pair[0], headers: { 'Sec-WebSocket-Protocol': 'binary' } });
    } catch { return new Response('Fixture unavailable', { status: 503 }); }
  },
};
