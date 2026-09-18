#!/usr/bin/env node

// Use real gws discovery/request preparation, not its provider authentication.
// Executing the prepared request is a separate, narrow control-plane operation.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadRuntimeEnv, run as calendar } from './jentera-calendar.mjs';

const execute = promisify(execFile);
const eventsUrl = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const help = 'Usage: jentera-gws auth login | calendar events <list|insert> --params \'<JSON>\' [--json \'<JSON>\'] [--dry-run]';

function object(raw, label) {
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a JSON object.`);
  return value;
}

function keys(value, allowed, label) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error(`${label} contains options not supported by Jentera yet.`);
  }
}

function flags(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (!['--params', '--json', '--dry-run'].includes(name) || Object.hasOwn(result, name)) throw new Error(help);
    if (name === '--dry-run') result[name] = true;
    else {
      if (!args[i + 1] || args[i + 1].length > 16_384) throw new Error(help);
      result[name] = object(args[++i], name);
    }
  }
  return result;
}

export async function prepareRequest(args, env, exec = execute) {
  const home = env.HOME || homedir();
  try {
    const { stdout } = await exec(
      env.JENTERA_GWS_BINARY || join(home, '.local/lib/jentera-gws/gws'),
      [...args, '--dry-run'],
      {
        timeout: 20_000,
        maxBuffer: 256_000,
        // No model key, Google token, client secret, or user's gws auth store.
        env: { PATH: env.PATH || '/usr/bin:/bin', HOME: home,
          GOOGLE_WORKSPACE_CLI_CONFIG_DIR: join(home, '.cache/jentera-gws') },
      },
    );
    return JSON.parse(stdout);
  } catch {
    throw new Error('gws could not prepare the Calendar request. Check the CLI installation or discovery connection.');
  }
}

export async function run(argv, env = process.env, deps = {}) {
  const fetcher = deps.fetch || fetch;
  if (argv.join(' ') === 'auth login') return calendar(['setup'], env, fetcher);
  const [service, resource, method, ...args] = argv;
  if (service !== 'calendar' || resource !== 'events' || !['list', 'insert'].includes(method)) throw new Error(help);
  const opts = flags(args);
  const params = opts['--params'];
  if (!params || params.calendarId !== 'primary') throw new Error('Only calendarId "primary" is supported.');
  let command;
  if (method === 'list') {
    keys(params, ['calendarId', 'timeMin', 'timeMax', 'singleEvents', 'orderBy'], 'Calendar parameters');
    if (opts['--json'] || (params.singleEvents !== undefined && params.singleEvents !== true) ||
        (params.orderBy !== undefined && params.orderBy !== 'startTime')) throw new Error(help);
    const min = Date.parse(params.timeMin);
    const max = Date.parse(params.timeMax);
    if (typeof params.timeMin !== 'string' || typeof params.timeMax !== 'string' ||
        !Number.isFinite(min) || !Number.isFinite(max) || max <= min || max - min > 31 * 86400_000) {
      throw new Error('Provide timeMin and timeMax for a range of 31 days or less.');
    }
    command = ['events', params.timeMin, params.timeMax];
  } else {
    keys(params, ['calendarId'], 'Calendar parameters');
    const body = opts['--json'];
    if (!body) throw new Error(help);
    keys(body, ['summary', 'start', 'end', 'location', 'description'], 'Event');
    for (const field of ['start', 'end']) {
      const time = body[field];
      if (!time || typeof time !== 'object' || Array.isArray(time)) throw new Error(`${field} must contain dateTime and timeZone.`);
      keys(time, ['dateTime', 'timeZone'], field);
      if (typeof time.dateTime !== 'string' || typeof time.timeZone !== 'string') throw new Error(`${field} must contain dateTime and timeZone.`);
    }
    if (body.start.timeZone !== body.end.timeZone) throw new Error('Use the same timeZone for start and end.');
    command = ['propose', JSON.stringify({ ...body, start: body.start.dateTime,
      end: body.end.dateTime, timeZone: body.start.timeZone })];
  }
  const cliArgs = ['calendar', 'events', method, '--params', JSON.stringify(params),
    ...(opts['--json'] ? ['--json', JSON.stringify(opts['--json'])] : [])];
  const plan = await (deps.prepare || prepareRequest)(cliArgs, env);
  if (plan?.dry_run !== true || plan.url !== eventsUrl || plan.is_multipart_upload !== false ||
      plan.method !== (method === 'list' ? 'GET' : 'POST')) {
    throw new Error('gws prepared an unexpected request; nothing was executed.');
  }
  if (opts['--dry-run']) return { ...plan, execution: method === 'insert' ? 'owner_approval_required' : 'read_only' };
  return calendar(command, env, fetcher);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(await run(process.argv.slice(2), await loadRuntimeEnv()), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Google Workspace command failed.'}\n`);
    process.exitCode = 1;
  }
}
