import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configRejection, createConfigChannel, renderHermesEnv } from '../src/server.mjs';

const GOOD = Object.freeze({
  schema: 2,
  version: 'fbd722a39cdc8738',
  release: '2026.09.10-5',
  hermes: { web: { backend: 'ddgs', search_backend: 'ddgs', extract_backend: 'firecrawl' } },
  hermesEnv: {
    FIRECRAWL_API_URL: 'https://extract.kitakod.com',
    FIRECRAWL_API_KEY: 'k'.repeat(64),
  },
  specialists: [{
    profile: 'sp-pastry',
    name: 'Pastry R&D',
    description: 'Develop recipes and test lamination.',
    instructions: 'Prefer local ingredients.',
  }],
});

const doc = (over = {}) => ({ ...structuredClone(GOOD), ...over });

test('a well-formed document is accepted', () => {
  assert.equal(configRejection(GOOD), null);
});

test('an unknown hermes key rejects the whole document, not part of it', () => {
  /* Merging the half it understood would leave a configuration nobody
     designed, on a machine nobody is watching. */
  const withExtra = doc({ hermes: { web: { backend: 'ddgs' }, agent: { max_turns: 99 } } });
  assert.match(configRejection(withExtra), /hermes\.agent/);
  const withExtraKey = doc({ hermes: { web: { backend: 'ddgs', danger: 'yes' } } });
  assert.match(configRejection(withExtraKey), /hermes\.web\.danger/);
});

test('a backend Hermes does not implement is refused', () => {
  assert.match(configRejection(doc({
    hermes: { web: { extract_backend: 'camoufox' } },
  })), /camoufox is not implemented/);
});

test('firecrawl without an endpoint is refused', () => {
  /* Naming a backend with nothing to serve it trades a working fallback for
     a hard failure — the same rule the sprite's Python configure applies. */
  assert.match(configRejection(doc({ hermesEnv: {} })), /without an endpoint/);
});

test('an env name outside the closed list is refused', () => {
  assert.match(configRejection(doc({
    hermesEnv: { ...GOOD.hermesEnv, OPENROUTER_API_KEY: 'stolen' },
  })), /OPENROUTER_API_KEY is not allowed/);
});

test('a newline in a value is refused, because the file is dotenv', () => {
  /* A newline would let one value forge another line, which is how a config
     channel becomes a way to set arbitrary environment. */
  assert.match(configRejection(doc({
    hermesEnv: { ...GOOD.hermesEnv, FIRECRAWL_API_KEY: 'a\nOPENROUTER_API_KEY=stolen' },
  })), /contains a newline/);
});

test('a non-https or path-bearing extract URL is refused', () => {
  for (const url of ['http://extract.kitakod.com', 'https://x.test/v2', 'not-a-url']) {
    assert.match(
      configRejection(doc({ hermesEnv: { ...GOOD.hermesEnv, FIRECRAWL_API_URL: url } })),
      /bare https origin/,
      url,
    );
  }
});

test('an unsupported schema is refused rather than guessed at', () => {
  assert.match(configRejection(doc({ schema: 3 })), /schema 3 unsupported/);
});

test('the dotenv rendering is sorted and newline-terminated', () => {
  assert.equal(
    renderHermesEnv({ B: '2', A: '1' }),
    'A=1\nB=2\n',
  );
});

function channel(over = {}) {
  const files = new Map();
  const config = {
    configUrl: 'https://api.jentera.ai/v1/runtime/config',
    configKey: 'sk-jentera-v1.abc',
    configLkgFile: '/tmp/lkg.json',
    hermesEnvFile: '/tmp/hermes.env',
    ...over.config,
  };
  const deps = {
    writeFile: async (path, body) => { files.set(path, body); },
    rename: async (from, to) => { files.set(to, files.get(from)); files.delete(from); },
    readFile: async (path) => {
      if (!files.has(path)) throw new Error('ENOENT');
      return files.get(path);
    },
    ...over.deps,
  };
  return { channel: createConfigChannel(config, deps), files };
}

test('a fetched document is applied when the slot is empty', async () => {
  const { channel: c, files } = channel({
    deps: { fetch: async () => ({ ok: true, json: async () => GOOD }) },
  });
  assert.equal(await c.refresh(async () => false), 'applied');
  assert.equal(c.state().version, GOOD.version);
  assert.equal(c.state().source, 'control-plane');
  assert.match(files.get('/tmp/hermes.env'), /FIRECRAWL_API_URL=https:\/\/extract\.kitakod\.com/);
  assert.ok(files.get('/tmp/lkg.json'));
  assert.deepEqual(c.profiles(), ['sp-pastry']);
});

test('a customer-defined role becomes an isolated Hermes profile', async () => {
  const { channel: c, files } = channel({
    config: {
      hermesConfigFile: '/tmp/hermes/config.yaml',
      hermesProfilesDir: '/tmp/hermes/profiles',
    },
    deps: {
      fetch: async () => ({ ok: true, json: async () => GOOD }),
      mkdir: async () => {},
      copyFile: async (from, to) => { files.set(to, `copied:${from}`); },
    },
  });
  await c.refresh(async () => false);
  assert.equal(
    files.get('/tmp/hermes/profiles/sp-pastry/config.yaml'),
    'copied:/tmp/hermes/config.yaml',
  );
  assert.match(files.get('/tmp/hermes/profiles/sp-pastry/SOUL.md'), /Pastry R&D/);
  assert.match(files.get('/tmp/hermes/profiles/sp-pastry/SOUL.md'), /Prefer local ingredients/);
});

test('config refresh preserves bootstrap model credentials for the chief and specialists, but removes disconnected tokens', async () => {
  const { channel: c, files } = channel({
    config: { hermesConfigFile: '/tmp/hermes/config.yaml', hermesProfilesDir: '/tmp/hermes/profiles' },
    deps: {
      fetch: async () => ({ ok: true, json: async () => GOOD }),
      mkdir: async () => {},
      copyFile: async () => {},
    },
  });
  files.set('/tmp/hermes.env', 'OPENROUTER_API_KEY=test-model-key\nOPENROUTER_BASE_URL=https://api.jentera.ai/v1/model\nCLOUDFLARE_API_TOKEN=disconnected-token\n');
  assert.equal(await c.refresh(async () => false), 'applied');
  for (const path of ['/tmp/hermes.env', '/tmp/hermes/profiles/sp-pastry/.env']) {
    assert.match(files.get(path), /^OPENROUTER_API_KEY=test-model-key$/m);
    assert.match(files.get(path), /^OPENROUTER_BASE_URL=https:\/\/api.jentera.ai\/v1\/model$/m);
    assert.match(files.get(path), /FIRECRAWL_API_KEY=/);
    assert.doesNotMatch(files.get(path), /CLOUDFLARE_API_TOKEN|disconnected-token/);
  }
});

test('a connected token is delivered and refreshed, while model auth is left alone', async () => {
  /* The other half of the rule above. That test proves a *disconnected*
     token is removed; this one proves a connected one arrives and keeps
     arriving, because the two together are what makes connecting and
     revoking a service both mean something. */
  const withToken = {
    ...GOOD,
    version: 'a1b2c3d4e5f60718',
    hermesEnv: { ...GOOD.hermesEnv, CLOUDFLARE_API_TOKEN: 'cf-live-token' },
  };
  const { channel: c, files } = channel({
    config: { hermesConfigFile: '/tmp/hermes/config.yaml', hermesProfilesDir: '/tmp/hermes/profiles' },
    deps: {
      fetch: async () => ({ ok: true, json: async () => withToken }),
      mkdir: async () => {},
      copyFile: async () => {},
    },
  });
  files.set('/tmp/hermes.env', 'OPENROUTER_API_KEY=test-model-key\nOPENROUTER_BASE_URL=https://api.jentera.ai/v1/model\n');
  assert.equal(await c.refresh(async () => false), 'applied');

  for (const path of ['/tmp/hermes.env', '/tmp/hermes/profiles/sp-pastry/.env']) {
    const body = files.get(path);
    /* The connector credential the document carries. */
    assert.match(body, /^CLOUDFLARE_API_TOKEN=cf-live-token$/m);
    /* Bootstrap's, untouched and not duplicated: the document cannot carry
       it, because CONFIG_ALLOWED_ENV refuses the name. */
    assert.match(body, /^OPENROUTER_API_KEY=test-model-key$/m);
    assert.equal(body.match(/^OPENROUTER_API_KEY=/gm).length, 1);
  }
});

test('a document is held, not applied, while a run is in flight', async () => {
  /* Hermes reads config when the agent is created; swapping mid-run would
     give one task two configurations. */
  const { channel: c, files } = channel({
    deps: { fetch: async () => ({ ok: true, json: async () => GOOD }) },
  });
  assert.equal(await c.refresh(async () => true), 'held');
  assert.equal(c.state().version, null);
  assert.equal(c.state().pendingVersion, GOOD.version);
  assert.equal(files.has('/tmp/hermes.env'), false);

  assert.equal(await c.applyPending(async () => true), 'held');
  assert.equal(await c.applyPending(async () => false), 'applied');
  assert.equal(c.state().version, GOOD.version);
  assert.equal(c.state().pendingVersion, undefined);
});

test('an unreachable control plane leaves the runtime exactly as it was', async () => {
  const { channel: c, files } = channel({
    deps: { fetch: async () => { throw new Error('offline'); } },
  });
  assert.equal(await c.refresh(async () => false), 'unreachable');
  assert.equal(c.state().version, null);
  assert.equal(c.state().source, 'bootstrap');
  assert.equal(files.size, 0);
  assert.ok(c.state().staleSince);
});

test('a refused document is reported rather than silently ignored', async () => {
  /* Keeping last known good quietly would hide a control plane sending
     something this runner cannot apply — the drift the channel exists to
     surface. */
  const { channel: c } = channel({
    deps: { fetch: async () => ({ ok: true, json: async () => doc({ schema: 9 }) }) },
  });
  assert.equal(await c.refresh(async () => false), 'rejected');
  assert.match(c.state().rejected, /schema 9 unsupported/);
  assert.equal(c.state().version, null);
});

test('last known good is restored on start', async () => {
  const { channel: c, files } = channel();
  files.set('/tmp/lkg.json', JSON.stringify({ document: GOOD, appliedAt: '2026-09-10T00:00:00Z' }));
  await c.loadLastKnownGood();
  assert.equal(c.state().version, GOOD.version);
  assert.equal(c.state().source, 'lkg');
});

test('an unchanged version does not rewrite anything', async () => {
  const { channel: c, files } = channel({
    deps: { fetch: async () => ({ ok: true, json: async () => GOOD }) },
  });
  await c.refresh(async () => false);
  const before = files.get('/tmp/hermes.env');
  assert.equal(await c.refresh(async () => false), 'unchanged');
  assert.equal(files.get('/tmp/hermes.env'), before);
});

test('a known desired version skips the request entirely', async () => {
  /* The worker already calls readiness before every run, so it can say "still
     this hash" for free. Fetching anyway would spend a round trip to learn
     what we were just told. */
  let calls = 0;
  const { channel: c } = channel({
    deps: { fetch: async () => { calls += 1; return { ok: true, json: async () => GOOD }; } },
  });
  await c.refresh(async () => false);
  assert.equal(calls, 1);
  assert.equal(await c.refresh(async () => false, GOOD.version), 'unchanged');
  assert.equal(calls, 1);
});

test('without a configured endpoint the channel does nothing at all', async () => {
  const { channel: c, files } = channel({ config: { configUrl: undefined } });
  assert.equal(await c.refresh(async () => false), 'not-configured');
  assert.equal(c.state().source, 'bootstrap');
  assert.equal(files.size, 0);
});
