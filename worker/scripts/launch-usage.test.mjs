import assert from 'node:assert/strict';
import test from 'node:test';
import { alertsFor, databaseEnvironment } from './launch-usage.mjs';

const connection = 'postgresql://neondb_owner:fictional-password@ep-sparkling-violet-b3l9d7un.c-4.ap-southeast-1.aws.neon.tech/neondb';
const healthy = { stale_due_tasks: 0, runtime_errors: 0,
  runs_today: { failed_last_hour: 0 }, trial: { intake_failed_today: 0 } };

test('production session is read-only, bounded and does not use credentials in argv', () => {
  const env = databaseEnvironment(connection);
  assert.match(env.PGOPTIONS, /default_transaction_read_only=on/);
  assert.match(env.PGOPTIONS, /statement_timeout=20000/);
  assert.equal(env.PGSSLMODE, 'require');
  assert.equal(env.PGPASSWORD, 'fictional-password');
});

test('rejects other projects, branches, roles, databases, ports and missing passwords', () => {
  for (const invalid of [
    connection.replace('ep-sparkling-violet-b3l9d7un', 'ep-other-branch'),
    connection.replace('neondb_owner:', 'aisar_app:'),
    connection.replace('/neondb', '/otherdb'),
    connection.replace('/neondb', ':5555/neondb'),
    connection.replace(':fictional-password', ''),
  ]) assert.throws(() => databaseEnvironment(invalid));
});

test('normal activity and an empty day do not generate alerts', () => {
  assert.deepEqual(alertsFor(healthy, [{ ok: true }]), []);
});

test('flags failures without including any customer text', () => {
  assert.deepEqual(alertsFor({ stale_due_tasks: 1, runtime_errors: 1,
    runs_today: { failed_last_hour: 2 }, trial: { intake_failed_today: 1 } }, [{ ok: false }]), [
    'public_health_check_failed', 'customer_tasks_stale_over_15_minutes',
    'customer_runtime_error', 'customer_run_failed_in_last_hour', 'customer_trial_intake_failed_today',
  ]);
});
