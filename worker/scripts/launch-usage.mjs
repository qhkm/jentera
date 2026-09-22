#!/usr/bin/env node
// One read-only, non-waking launch snapshot. launchd owns recurring execution.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

export function databaseEnvironment(connection) {
  const target = new URL(connection.trim());
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol));
  assert.equal(target.hostname, 'ep-sparkling-violet-b3l9d7un.c-4.ap-southeast-1.aws.neon.tech');
  assert.equal(target.pathname, '/neondb');
  assert.equal(decodeURIComponent(target.username), 'neondb_owner');
  assert.ok(target.password);
  assert.ok(!target.port || target.port === '5432');
  return {
    ...process.env,
    PGHOST: target.hostname, PGPORT: '5432', PGDATABASE: 'neondb',
    PGUSER: decodeURIComponent(target.username), PGPASSWORD: decodeURIComponent(target.password),
    PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '10',
    PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=20000',
  };
}

export function alertsFor(snapshot, health) {
  const alerts = [];
  if (health.some(check => !check.ok)) alerts.push('public_health_check_failed');
  if (snapshot.stale_due_tasks > 0) alerts.push('customer_tasks_stale_over_15_minutes');
  if (snapshot.runtime_errors > 0) alerts.push('customer_runtime_error');
  if (snapshot.runs_today.failed_last_hour > 0) alerts.push('customer_run_failed_in_last_hour');
  if (snapshot.trial.intake_failed_today > 0) alerts.push('customer_trial_intake_failed_today');
  return alerts;
}

async function checkHealth(url) {
  const started = performance.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const ok = response.ok && (url.endsWith('/api/health') ? (await response.json()).ok === true : true);
    return { url, ok, status: response.status, elapsed_ms: Math.round(performance.now() - started) };
  } catch {
    return { url, ok: false, status: null, elapsed_ms: Math.round(performance.now() - started) };
  }
}

export async function snapshotOnce() {
  // Reuse existing operator credentials, never copy them into source, plist or logs.
  // Fail closed rather than launching an interactive OAuth login from launchd.
  const connection = readFileSync(`${homedir()}/.config/neon/owner-url`, 'utf8');
  const env = databaseEnvironment(connection);
  const query = readFileSync(new URL('./launch-usage.sql', import.meta.url), 'utf8');
  const output = execFileSync('/opt/homebrew/bin/psql', ['-X', '-q', '-t', '-A',
    '-v', 'ON_ERROR_STOP=1', '-c', query], {
    env, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const snapshot = JSON.parse(output);
  assert.equal(snapshot.database, 'neondb');
  assert.equal(snapshot.role, 'neondb_owner');
  assert.equal(snapshot.read_only, 'on');
  const health = await Promise.all([
    'https://jentera.ai/', 'https://jentera.ai/onboard',
    'https://jentera.ai/setup', 'https://jentera.ai/app',
    'https://api.jentera.ai/api/health',
  ].map(checkHealth));
  return { ...snapshot, health, alerts: alertsFor(snapshot, health) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const snapshot = await snapshotOnce();
    console.log(JSON.stringify(snapshot));
    if (snapshot.alerts.length) process.exitCode = 1;
  } catch {
    // Never print caught exceptions: a malformed credential or driver error can contain secrets.
    console.log(JSON.stringify({ observed_at: new Date().toISOString(),
      ok: false, alerts: ['monitor_collection_failed'], metrics_available: false }));
    process.exitCode = 2;
  }
}
