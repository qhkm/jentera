import { describe, expect, it } from 'vitest';
import {
  FlySpriteProvider,
  LocalRuntimeProvider,
  type DesiredRuntime,
  type ObservedRuntime,
  type RuntimeProvider,
} from '../src/runtime';

const desired: DesiredRuntime = {
  businessId: '11111111-1111-4111-8111-111111111111',
  name: 'aisar-b-abc123',
  release: '2026.08.27-1',
};

async function lifecycle(provider: RuntimeProvider) {
  const first = await provider.create(desired);
  const second = await provider.create(desired);
  expect(second.id).toBe(first.id);
  expect(second.name).toBe(first.name);

  const awake = await provider.wake(first);
  expect(awake.state).toBe('ready');

  const checkpoint = await provider.checkpoint(awake, 'baseline');
  expect(checkpoint).toBeTruthy();
  await provider.restore(awake, checkpoint);
  await provider.stop(awake);
  await provider.destroy(awake);
}

describe('LocalRuntimeProvider', () => {
  it('satisfies the provider lifecycle contract', async () => {
    await lifecycle(new LocalRuntimeProvider());
  });

  it('does not restore a checkpoint that belongs nowhere', async () => {
    const provider = new LocalRuntimeProvider();
    const runtime = await provider.create(desired);
    await expect(provider.restore(runtime, 'v999')).rejects.toThrow(/unknown checkpoint/);
  });
});

describe('FlySpriteProvider', () => {
  it('creates a private Sprite with capacity confirmed', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const provider = fly(async (url, init) => {
      seen.push({ url: String(url), init: init ?? {} });
      return spriteResponse('cold', 201);
    });

    const runtime = await provider.create(desired);
    expect(runtime.state).toBe('cold');
    expect(seen[0].url).toBe('https://sprites.test/v1/sprites');
    expect(header(seen[0].init, 'Authorization')).toBe('Bearer secret-token');
    expect(JSON.parse(String(seen[0].init.body))).toEqual({
      name: desired.name,
      wait_for_capacity: true,
      url_settings: { auth: 'sprite' },
    });
  });

  it('makes create idempotent without hiding an invalid request', async () => {
    let calls = 0;
    const provider = fly(async () => {
      calls += 1;
      return calls === 1
        ? new Response('name already exists', { status: 400 })
        : spriteResponse('running');
    });
    expect((await provider.create(desired)).state).toBe('ready');
    expect(calls).toBe(2);

    const invalid = fly(async () => new Response('invalid name', { status: 400 }));
    await expect(invalid.create(desired)).rejects.toThrow(/get Sprite failed \(400\)/);
  });

  it('wakes through the authenticated private runner URL', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const provider = fly(async (url, init) => {
      seen.push({ url: String(url), init: init ?? {} });
      return new Response('{}');
    });
    const awake = await provider.wake(observed('cold'));
    expect(awake.state).toBe('ready');
    expect(seen[0].url).toBe('https://aisar-b-abc123.example/healthz');
    expect(header(seen[0].init, 'Authorization')).toBe('Bearer secret-token');
  });

  it('takes the structured checkpoint id after a successful stream', async () => {
    let calls = 0;
    const provider = fly(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(
          '{"type":"info","data":"creating"}\n{"type":"complete","data":"done"}\n',
        );
      }
      return Response.json([
        { id: 'v1', create_time: '2026-08-26T00:00:00Z' },
        { id: 'v2', create_time: '2026-08-27T00:00:00Z' },
      ]);
    });
    expect(await provider.checkpoint(observed('ready'))).toBe('v2');
  });

  it('writes bootstrap data only below the AISAR runtime directory', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const provider = fly(async (url, init) => {
      seen.push({ url: String(url), init: init ?? {} });
      return new Response(null, { status: 201 });
    });
    await provider.writeFile(
      observed('cold'),
      '/home/sprite/aisar/bootstrap.env.in',
      'encoded-data',
      0o600,
    );
    expect(seen[0].url).toContain('/fs/write?');
    expect(seen[0].url).toContain('mode=0600');
    expect(seen[0].init.method).toBe('PUT');
    expect(seen[0].init.body).toBe('encoded-data');
    await expect(provider.writeFile(observed('cold'), '/etc/passwd', 'x', 0o600))
      .rejects.toThrow(/not allowed/);
    await expect(provider.writeFile(
      observed('cold'),
      '/home/sprite/aisar/../../etc/passwd',
      'x',
      0o600,
    )).rejects.toThrow(/not allowed/);
  });

  it('executes a bounded non-TTY bootstrap over the official stream protocol', async () => {
    const socket = new FakeSocket();
    const seen: { url: string; init: RequestInit }[] = [];
    const provider = fly(async (url, init) => {
      seen.push({ url: String(url), init: init ?? {} });
      setTimeout(() => {
        socket.emit(new Uint8Array([1, ...new TextEncoder().encode('ready')]).buffer);
        socket.emit(new Uint8Array([3, 0]).buffer);
      }, 0);
      return {
        status: 101,
        ok: false,
        webSocket: socket,
        text: async () => '',
      } as unknown as Response;
    });
    const result = await provider.exec(
      observed('cold'),
      '/home/sprite/aisar/runner/bootstrap-runtime.sh',
      ['/home/sprite/aisar/bootstrap.env.in'],
      { env: ['AISAR_BOOTSTRAP_CONTROL_PLANE=1'] },
    );
    expect(result).toEqual({ exitCode: 0, stdout: 'ready', stderr: '' });
    expect(socket.accepted).toBe(true);
    expect([...new Uint8Array(socket.sent[0])]).toEqual([4]);
    expect(seen[0].url).toContain('/exec?');
    expect(seen[0].url).toContain('stdin=false');
    expect(header(seen[0].init, 'Authorization')).toBe('Bearer secret-token');
    expect(header(seen[0].init, 'Upgrade')).toBe('websocket');
  });

  it('surfaces an error carried inside a 200 streaming response', async () => {
    const provider = fly(async () =>
      new Response('{"type":"error","error":"disk full"}\n'),
    );
    await expect(provider.restore(observed('ready'), 'v1')).rejects.toThrow('disk full');
  });

  it('treats an already-absent Sprite as destroyed', async () => {
    const provider = fly(async () => new Response(null, { status: 404 }));
    await expect(provider.destroy(observed('cold'))).resolves.toBeUndefined();
  });
});

function fly(fetcher: typeof fetch) {
  return new FlySpriteProvider({
    token: 'secret-token',
    apiOrigin: 'https://sprites.test',
    fetch: fetcher,
  });
}

function observed(state: ObservedRuntime['state']): ObservedRuntime {
  return {
    provider: 'fly-sprite',
    id: 'sprite-id',
    name: desired.name,
    url: `https://${desired.name}.example`,
    state,
  };
}

function spriteResponse(status: string, responseStatus = 200) {
  return Response.json(
    {
      id: 'sprite-id',
      name: desired.name,
      url: `https://${desired.name}.example`,
      status,
    },
    { status: responseStatus },
  );
}

function header(init: RequestInit, name: string): string | null {
  return new Headers(init.headers).get(name);
}

class FakeSocket extends EventTarget {
  accepted = false;
  sent: ArrayBuffer[] = [];

  accept() {
    this.accepted = true;
  }

  close() {}

  send(data: ArrayBuffer | ArrayBufferView) {
    const bytes = data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    this.sent.push(bytes.slice().buffer);
  }

  emit(data: ArrayBuffer) {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
}
