#!/usr/bin/env node

/* The runtime-facing Calendar tool. It knows only Jentera's narrow endpoint
   and the runtime credential already used for model transport; Google OAuth
   material never enters the Sprite. */

import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Hermes terminal subprocesses need not inherit its model transport variables.
// Read only these two bootstrap-owned values, never evaluate a dotenv as shell.
export async function loadRuntimeEnv(env = process.env, reader = readFile) {
  if (env.OPENROUTER_API_KEY?.trim() && env.OPENROUTER_BASE_URL?.trim()) return env;
  const result = { ...env };
  const body = await reader(join(env.HERMES_HOME || join(homedir(), '.hermes'), '.env'), 'utf8')
    .catch(() => '');
  for (const line of body.split(/\r?\n/)) {
    const match = /^(OPENROUTER_API_KEY|OPENROUTER_BASE_URL)=(.*)$/.exec(line);
    if (!match || result[match[1]]?.trim()) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[match[1]] = value;
  }
  return result;
}

function endpoint(env = process.env) {
  const explicit = env.JENTERA_CALENDAR_API?.trim();
  if (explicit) {
    const url = new URL(explicit);
    if (url.protocol !== 'https:') throw new Error('Calendar API must use HTTPS.');
    return url.toString().replace(/\/$/, '');
  }
  const model = new URL(env.OPENROUTER_BASE_URL?.trim() || '');
  if (model.protocol !== 'https:' || !model.pathname.endsWith('/v1/model')) {
    throw new Error('Jentera Calendar is unavailable on this runtime.');
  }
  return `${model.origin}/v1/connectors/google-calendar`;
}

function stableRequestId(event) {
  const canonical = JSON.stringify({
    summary: event.summary,
    start: event.start,
    end: event.end,
    timeZone: event.timeZone,
    location: event.location ?? '',
    description: event.description ?? '',
  });
  return `agent_${createHash('sha256').update(canonical).digest('hex').slice(0, 32)}`;
}

async function call(path, init, env = process.env, fetcher = fetch) {
  const key = env.OPENROUTER_API_KEY?.trim();
  if (!key) throw new Error('Jentera Calendar is unavailable on this runtime.');
  const response = await fetcher(`${endpoint(env)}${path}`, {
    ...init,
    signal: AbortSignal.timeout(20_000),
    headers: {
      Authorization: `Bearer ${key}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const text = await response.text();
  if (text.length > 256_000) throw new Error('Calendar response was too large.');
  const body = text ? JSON.parse(text) : {};
  if (!response.ok || body.ok === false) {
    throw new Error(typeof body.err === 'string' ? body.err : `Calendar request failed (${response.status}).`);
  }
  return body;
}

export async function run(argv, env = process.env, fetcher = fetch) {
  const [command, ...args] = argv;
  if (command === 'setup' && !args.length) return call('/setup', { method: 'GET' }, env, fetcher);
  if (command === 'events') {
    if (args.length !== 2) throw new Error('Usage: jentera-calendar events <timeMin> <timeMax>');
    const query = new URLSearchParams({ timeMin: args[0], timeMax: args[1] });
    return call(`/events?${query}`, { method: 'GET' }, env, fetcher);
  }
  if (command === 'propose') {
    if (args.length !== 1) throw new Error("Usage: jentera-calendar propose '<event JSON>'");
    const event = JSON.parse(args[0]);
    if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Event must be a JSON object.');
    event.requestId = typeof event.requestId === 'string' && event.requestId
      ? event.requestId
      : stableRequestId(event);
    return call('/proposals', { method: 'POST', body: JSON.stringify(event) }, env, fetcher);
  }
  throw new Error('Usage: jentera-calendar <setup|events|propose> …');
}

async function main() {
  try {
    const result = await run(process.argv.slice(2), await loadRuntimeEnv());
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Calendar command failed.'}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
