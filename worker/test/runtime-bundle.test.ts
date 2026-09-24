import { describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { testEnv } from './harness';
import { handleRuntimeBundle, bundleKey } from '../src/routes/runtime-bundle';
import { issueBundleTicket, bundleTicketIsValid } from '../src/runtime/bundle-token';
import { downloadRuntimeBundle, RUNTIME_BUNDLE_ASSETS } from '../src/runtime/provision';

/* A sprite used to build its runner directory from 24 anonymous curls against
   raw.githubusercontent.com. That is the one thing that kept this repository
   public: raw.github serves public repositories and nothing else, so flipping
   visibility answered 404 to every bootstrap and killed the next fresh
   provision with curl exit 22. These cover the replacement. */

const COMMIT = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const SHA = '1'.repeat(64);
const BODY = new Uint8Array([0x1f, 0x8b, 8, 0, 0, 0, 0, 0]);

class FakeBucket {
  objects = new Map<string, Uint8Array>();
  async get(key: string) {
    const found = this.objects.get(key);
    if (!found) return null;
    return { key, size: found.byteLength, body: new Response(found).body };
  }
}

function bundleEnv(over: Record<string, unknown> = {}): { env: Env; bucket: FakeBucket } {
  const bucket = new FakeBucket();
  bucket.objects.set(bundleKey(COMMIT), BODY);
  const env = testEnv({
    CREDENTIAL_KEY: 'a-test-credential-key',
    API_ORIGIN: 'https://api.test',
    RUNTIME_BUNDLE_SHA256: SHA,
    RUNTIME_BUNDLES: bucket,
    ...over,
  });
  return { env, bucket };
}

const fetchBundle = (env: Env, commit: string, ticket?: string, method = 'GET') =>
  handleRuntimeBundle(
    new Request(`https://api.test/v1/runtime/bundle/${commit}.tar.gz`, {
      method,
      headers: ticket ? { authorization: `Bearer ${ticket}` } : {},
    }),
    env,
    new URL(`https://api.test/v1/runtime/bundle/${commit}.tar.gz`),
  );

describe('the bundle route', () => {
  it('serves the commit its ticket names', async () => {
    const { env } = bundleEnv();
    const response = await fetchBundle(env, COMMIT, await issueBundleTicket(env, COMMIT));
    expect(response?.status).toBe(200);
    expect(response?.headers.get('content-type')).toBe('application/gzip');
    expect(new Uint8Array(await response!.arrayBuffer())).toEqual(BODY);
  });

  it('ignores a path that is not its own, so other routes still see it', async () => {
    const { env } = bundleEnv();
    const url = new URL('https://api.test/api/health');
    expect(await handleRuntimeBundle(new Request(url), env, url)).toBeNull();
  });

  /* Every refusal below is 404, never 403. A 403 would confirm that a commit
     exists and that its bundle is there to be had; runVisibleTo answers 404
     for a colleague's private run for the same reason. */
  it('refuses an unticketed request without admitting the bundle exists', async () => {
    const { env } = bundleEnv();
    expect((await fetchBundle(env, COMMIT))?.status).toBe(404);
  });

  it('refuses a ticket minted for a different commit', async () => {
    const { env, bucket } = bundleEnv();
    bucket.objects.set(bundleKey(OTHER), BODY);
    // The whole point of binding the ticket: one that leaks cannot be aimed
    // at a bundle it was not issued for.
    expect((await fetchBundle(env, OTHER, await issueBundleTicket(env, COMMIT)))?.status).toBe(404);
  });

  it('refuses an expired ticket', async () => {
    const { env } = bundleEnv();
    const long_ago = Math.floor(Date.now() / 1000) - 3600;
    expect((await fetchBundle(env, COMMIT, await issueBundleTicket(env, COMMIT, long_ago)))?.status)
      .toBe(404);
  });

  it('refuses a ticket signed with someone else’s key', async () => {
    const { env } = bundleEnv();
    const foreign = testEnv({ CREDENTIAL_KEY: 'a-different-key' });
    expect((await fetchBundle(env, COMMIT, await issueBundleTicket(foreign, COMMIT)))?.status)
      .toBe(404);
  });

  it('refuses a tampered expiry, which is the cheap forgery to try', async () => {
    const { env } = bundleEnv();
    const ticket = await issueBundleTicket(env, COMMIT);
    const signature = ticket.slice(ticket.indexOf('.') + 1);
    const far = Math.floor(Date.now() / 1000) + 86400;
    expect((await fetchBundle(env, COMMIT, `${far}.${signature}`))?.status).toBe(404);
  });

  it('refuses anything that is not a full commit sha', async () => {
    const { env } = bundleEnv();
    // Uppercase included: the key is built from this string, and a bucket is
    // case-sensitive where a careless comparison is not.
    for (const bad of ['HEAD', 'a'.repeat(39), 'A'.repeat(40), 'a'.repeat(41)]) {
      expect((await fetchBundle(env, bad, await issueBundleTicket(env, COMMIT)))?.status).toBe(404);
    }
  });

  it('never sees a traversal, because the URL was normalised before it got here', async () => {
    const { env } = bundleEnv();
    const url = new URL('https://api.test/v1/runtime/bundle/../secrets.tar.gz');
    expect(url.pathname).toBe('/v1/runtime/secrets.tar.gz');
    // null, not 404: the path is no longer this route's, so it must fall
    // through to the router rather than answer for someone else's path.
    expect(await handleRuntimeBundle(new Request(url), env, url)).toBeNull();
  });

  it('404s a commit with no object rather than serving an empty body', async () => {
    const { env } = bundleEnv();
    expect((await fetchBundle(env, OTHER, await issueBundleTicket(env, OTHER)))?.status).toBe(404);
  });

  it('404s when no bucket is bound, keeping the failure in the bootstrap output', async () => {
    const { env } = bundleEnv({ RUNTIME_BUNDLES: undefined });
    expect((await fetchBundle(env, COMMIT, await issueBundleTicket(env, COMMIT)))?.status).toBe(404);
  });

  it('answers GET and nothing else', async () => {
    const { env } = bundleEnv();
    const ticket = await issueBundleTicket(env, COMMIT);
    expect((await fetchBundle(env, COMMIT, ticket, 'GET'))?.status).toBe(200);
    // HEAD included: supporting it would mean adding it to
    // Access-Control-Allow-Methods, which test/cors.test.ts enforces, to
    // serve a request nothing makes.
    for (const method of ['HEAD', 'POST', 'PUT', 'DELETE']) {
      expect((await fetchBundle(env, COMMIT, ticket, method))?.status).toBe(404);
    }
  });
});

describe('the ticket', () => {
  it('is valid for the commit it names and no other', async () => {
    const { env } = bundleEnv();
    const ticket = await issueBundleTicket(env, COMMIT);
    expect(await bundleTicketIsValid(env, COMMIT, ticket)).toBe(true);
    expect(await bundleTicketIsValid(env, OTHER, ticket)).toBe(false);
    expect(await bundleTicketIsValid(env, COMMIT, undefined)).toBe(false);
    expect(await bundleTicketIsValid(env, COMMIT, 'nonsense')).toBe(false);
  });

  it('will not mint for anything but a full commit sha', async () => {
    const { env } = bundleEnv();
    await expect(issueBundleTicket(env, 'HEAD')).rejects.toThrow(/invalid/);
  });
});

describe('what the control plane tells a sprite to run', () => {
  function recordingProvider() {
    const commands: string[] = [];
    return {
      provider: {
        exec: async (_o: unknown, _bin: string, args: string[]) => {
          commands.push(args[args.length - 1]);
          return { exitCode: 0, stdout: '', stderr: '' };
        },
      },
      commands,
    };
  }
  const observed = { provider: 'fly-sprite', id: 'i', name: 'n', url: 'https://x.sprites.app', state: 'ready' };

  it('fetches one object, checks it against the pin, and unpacks it', async () => {
    const { env } = bundleEnv();
    const { provider, commands } = recordingProvider();
    await downloadRuntimeBundle(env, provider as never, observed as never, COMMIT);

    const script = commands[0];
    expect(script).toContain(`https://api.test/v1/runtime/bundle/${COMMIT}.tar.gz`);
    expect(script).toContain('Authorization: Bearer ');
    // The pin, not a digest read back from the bucket: that is what catches
    // the right key holding the wrong bytes.
    expect(script).toContain(`echo '${SHA}  `);
    expect(script).toContain('sha256sum -c -');
    expect(script).toContain('tar -xzf');
    // raw.github is the whole reason this route exists.
    expect(script).not.toContain('githubusercontent');
    // One request replaces 24.
    expect(script.match(/curl /g)?.length).toBe(1);
  });

  it('carries a live ticket for that commit', async () => {
    const { env } = bundleEnv();
    const { provider, commands } = recordingProvider();
    await downloadRuntimeBundle(env, provider as never, observed as never, COMMIT);
    const ticket = /Authorization: Bearer ([^']+)'/.exec(commands[0])?.[1];
    expect(await bundleTicketIsValid(env, COMMIT, ticket)).toBe(true);
  });

  it('refuses to provision without the pins it must assert', async () => {
    const { provider } = recordingProvider();
    for (const missing of [{ RUNTIME_BUNDLE_SHA256: undefined }, { RUNTIME_BUNDLE_SHA256: 'nope' }]) {
      const { env } = bundleEnv(missing);
      await expect(downloadRuntimeBundle(env, provider as never, observed as never, COMMIT))
        .rejects.toThrow(/RUNTIME_BUNDLE_SHA256/);
    }
    const { env } = bundleEnv({ API_ORIGIN: '' });
    await expect(downloadRuntimeBundle(env, provider as never, observed as never, COMMIT))
      .rejects.toThrow(/API_ORIGIN/);
  });

  it('still installs the bootstrap the control plane executes by name', () => {
    expect(RUNTIME_BUNDLE_ASSETS).toContain('runner/bin/bootstrap-runtime.sh');
  });
});
