#!/usr/bin/env node
/* move-runtime-region.mjs — move one tenant's sprite to the region the
   control plane now provisions into, keeping the agent's memory.
 *
 * Fly places a sprite near whoever created it, and the creator is our queue
 * consumer. Until 3fbf487 (10 September) that consumer ran in LAX and SJC, so
 * every sprite made before it sits in the United States; every sprite made
 * since lands beside Neon in Singapore. There is no way to move a sprite, so
 * moving one means deleting it and provisioning again — which is exactly what
 * the control plane already knows how to do, through the `delete` and
 * `provision` runtime tasks.
 *
 * What moves is the agent's own memory and conversation history. What does
 * NOT move is anything a fresh sprite mints for itself: the runner key, the
 * model key, auth.json, every .env. Carrying those forward would put revoked
 * credentials on a new machine. The browser profile does not move either --
 * it holds live logged-in sessions, and this script is run by an operator on
 * a laptop, which is not a place another business's cookies belong. The owner
 * signs in again the next time the agent needs a site.
 *
 * A sprite keeps its name across the move: the name is a hash of the business
 * id, so the replacement is called exactly what the old one was.
 *
 * Phases, each run on purpose:
 *   plan      read-only: what would move, and every reason not to
 *   survey    make each candidate call the config channel, so the control
 *             plane records where it egresses from; read the answer back
 *   backup    tar the allowlist on the sprite, pull it, verify it
 *   move      --yes: enqueue delete, wait, enqueue provision, wait for ready
 *   restore   push the verified backup into the new sprite
 *
 * Usage:
 *   node scripts/move-runtime-region.mjs --all                  # what would move
 *   node scripts/move-runtime-region.mjs --all --survey         # record egress
 *   node scripts/move-runtime-region.mjs --all --yes            # move every US sprite
 *   node scripts/move-runtime-region.mjs --sprite aisar-b-… --backup
 *   node scripts/move-runtime-region.mjs --sprite aisar-b-… --move --yes
 *   node scripts/move-runtime-region.mjs --sprite aisar-b-… --restore
 *
 * --all runs backup, move and restore for each candidate in turn, quietest
 * business first, so the rehearsal happens on a sprite nobody is using. One
 * sprite failing stops the batch: the rest are still where they were, and the
 * failure is reported against the sprite it happened on.
 *
 * Env: AISAR_NEON_OWNER_URL (pooled owner), SPRITE_BIN, SPRITE_ORG.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const run = promisify(execFile);

export const SPRITE_NAME = /^aisar-[bp]-[0-9a-f]{20,32}$/;
export const HERMES = '/home/sprite/.hermes';

/* The archive may contain these and nothing else. Anything outside the list
   is a file we did not intend to carry onto a new machine, so an archive
   holding one is refused rather than filtered: a filter that silently drops
   something is a filter nobody reads the output of. */
export const ALLOWED = [
  /^memories\/(MEMORY|USER)\.md$/,
  /* The directory itself as well as what is under it: the snippet hands tar
     the bare name, and tar emits both. A pattern that only matched the
     children would refuse the archive it had just asked for. */
  /^sessions(\/(?:[^/]+\/)*[^/]*)?$/,
  /^profiles\/[a-z][a-z0-9-]{0,47}\/memories\/[^/]+\.md$/,
  /^profiles\/[a-z][a-z0-9-]{0,47}\/sessions(\/(?:[^/]+\/)*[^/]*)?$/,
  /^profiles\/[a-z][a-z0-9-]{0,47}\/state\.db(-shm|-wal)?$/,
];

/* Belt and braces over the allowlist above. These names have never been
   movable and never will be; if one ever matches, the allowlist is wrong. */
export const FORBIDDEN = /(^|\/)(\.env|auth\.json|config\.yaml|[^/]*\.lock|pairing)(\/|$)/;

/** Every entry in the archive, judged. Returns the refusals, empty when the
 *  archive is safe to carry. A directory entry ends in / and is fine. */
export function archiveRefusals(entries) {
  const refusals = [];
  for (const raw of entries) {
    const entry = raw.trim();
    if (!entry) continue;
    if (entry.startsWith('/') || entry.includes('..')) {
      refusals.push(`absolute or escaping path: ${entry}`);
      continue;
    }
    if (FORBIDDEN.test(entry)) {
      refusals.push(`must never move: ${entry}`);
      continue;
    }
    const name = entry.endsWith('/') ? entry.slice(0, -1) : entry;
    if (entry.endsWith('/')) continue;
    if (!ALLOWED.some((re) => re.test(name))) refusals.push(`not in the allowlist: ${entry}`);
  }
  return refusals;
}

/** The snippet that builds the archive, written here rather than on the
 *  sprite so that what is collected is reviewable in this file. */
export function collectScript(tarPath) {
  return `set -eu
cd ${HERMES}
list=$(mktemp)
for p in memories/MEMORY.md memories/USER.md; do [ -f "$p" ] && printf '%s\\n' "$p" >> "$list"; done
[ -d sessions ] && printf '%s\\n' sessions >> "$list"
for d in profiles/*/; do
  p=\${d%/}
  for f in "$p"/memories/*.md; do [ -f "$f" ] && printf '%s\\n' "$f" >> "$list"; done
  [ -d "$p/sessions" ] && printf '%s\\n' "$p/sessions" >> "$list"
  for s in state.db state.db-shm state.db-wal; do [ -f "$p/$s" ] && printf '%s\\n' "$p/$s" >> "$list"; done
done
if [ ! -s "$list" ]; then echo "NOTHING_TO_COLLECT"; rm -f "$list"; exit 0; fi
tar -czf ${tarPath} --files-from "$list"
rm -f "$list"
echo "SHA256 $(sha256sum ${tarPath} | cut -d' ' -f1)"
echo "BYTES $(wc -c < ${tarPath})"
tar -tzf ${tarPath}`;
}

/** Reasons this sprite must not be moved right now. */
export function preflightRefusals(state, placementChangedAt = Date.parse('2026-09-10T07:22:00Z')) {
  const refusals = [];
  if (!state.runtime) refusals.push('no runtime row for this business');
  else {
    if (state.runtime.status !== 'ready') refusals.push(`runtime is ${state.runtime.status}, not ready`);
    if (Date.parse(state.runtime.created_at) >= placementChangedAt) {
      refusals.push('created after the placement change — it is already provisioned from the placed invocation');
    }
  }
  if (state.activeRuns > 0) refusals.push(`${state.activeRuns} runs are queued, working or awaiting approval`);
  if (state.openTasks > 0) refusals.push(`${state.openTasks} runtime tasks are queued or leased`);
  return refusals;
}

/** Which sprites are in the wrong place. Created before the placement change
 *  is the necessary condition; `egress_country` is the evidence, and a sprite
 *  that has never called us has none yet — hence `--survey`. */
export function isCandidate(row, placementChangedAt = Date.parse('2026-09-10T07:22:00Z')) {
  if (Date.parse(row.created_at) >= placementChangedAt) return false;
  return row.egress_country === 'US' || row.egress_country === null;
}

/* ------------------------------------------------------------------ */

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

const ORG = process.env.SPRITE_ORG ?? 'aisar';
const SPRITE_BIN = process.env.SPRITE_BIN ?? 'sprite';
const TAR_PATH = '/tmp/jentera-memory-move.tgz';

async function sprite(name, argv, options = {}) {
  return run(SPRITE_BIN, ['-o', ORG, '-s', name, ...argv], { maxBuffer: 64 * 1024 * 1024, ...options });
}
async function spriteExec(name, snippet) {
  const { stdout } = await sprite(name, ['exec', '--', 'bash', '-c', snippet], { stdio: ['ignore', 'pipe', 'pipe'] });
  return stdout;
}

async function connect() {
  const { default: postgres } = await import('postgres');
  const expectedHost = 'ep-sparkling-violet-b3l9d7un-pooler.c-4.ap-southeast-1.aws.neon.tech';
  const connection = process.env.AISAR_NEON_OWNER_URL;
  if (!connection) throw new Error('AISAR_NEON_OWNER_URL is required');
  const target = new URL(connection);
  if ((target.protocol !== 'postgresql:' && target.protocol !== 'postgres:') ||
      target.hostname !== expectedHost || target.pathname !== '/neondb' ||
      target.username !== 'neondb_owner' || !target.password) {
    throw new Error('AISAR_NEON_OWNER_URL does not match the reviewed production owner target');
  }
  return postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
}

async function readState(sql, spriteName) {
  const [runtime] = await sql`
    select r.business_id, r.provider_name, r.status, r.created_at, r.egress_colo, r.egress_country,
           b.name as business_name
      from agent_runtime r join business b on b.id = r.business_id
     where r.provider_name = ${spriteName} and r.deleted_at is null`;
  if (!runtime) return { runtime: null, activeRuns: 0, openTasks: 0 };
  const [runs] = await sql`select count(*)::int as n from run
     where business_id = ${runtime.business_id} and status in ('queued','working','needs_approval')`;
  const [tasks] = await sql`select count(*)::int as n from runtime_task
     where business_id = ${runtime.business_id} and status in ('queued','leased')`;
  return { runtime, activeRuns: runs.n, openTasks: tasks.n };
}

async function listCandidates(sql) {
  const rows = await sql`
    select r.provider_name, r.created_at, r.egress_colo, r.egress_country, r.status,
           b.name as business_name, b.id as business_id,
           (select count(*)::int from run where business_id = b.id) as runs
      from agent_runtime r join business b on b.id = r.business_id
     where r.deleted_at is null
     order by runs asc, r.created_at asc`;
  return rows.filter((row) => isCandidate(row));
}

/** A sprite cannot tell us where it is; our own edge can, on any call the
 *  sprite makes with its own credential. The config channel is the cheapest
 *  of those — no model spend, no side effect — and `recordEgress` on that
 *  route stores what `request.cf` saw. */
async function survey(sql, rows) {
  for (const row of rows) {
    try {
      const out = await spriteExec(row.provider_name, `set -a; . /home/sprite/aisar/runner.env; set +a
curl -s -o /dev/null -w "%{http_code}" --max-time 20 -H "Authorization: Bearer $AISAR_CONFIG_KEY" "$AISAR_CONFIG_URL"`);
      process.stdout.write(`${row.provider_name} http=${out.trim()} `);
    } catch (err) {
      process.stdout.write(`${row.provider_name} unreachable(${String(err.message ?? err).split('\n')[0].slice(0, 60)}) `);
    }
    const [seen] = await sql`select egress_colo, egress_country from agent_runtime
       where provider_name = ${row.provider_name}`;
    console.log(`-> ${seen?.egress_colo ?? '?'}/${seen?.egress_country ?? '?'}`);
  }
}

async function enqueue(sql, businessId, kind, dedupeKey) {
  return sql.begin(async (tx) => {
    const [task] = await tx`
      insert into runtime_task (business_id, kind, payload, dedupe_key)
      values (${businessId}, ${kind}, '{}'::jsonb, ${dedupeKey})
      returning id`;
    await tx`insert into runtime_task_outbox (business_id, task_id, not_before)
             values (${businessId}, ${task.id}, now())`;
    return task.id;
  });
}

async function waitFor(label, check, timeoutMs = 15 * 60 * 1000) {
  const started = Date.now();
  for (;;) {
    const done = await check();
    if (done) return done;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    process.stdout.write('.');
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

async function phaseBackup(spriteName, dir) {
  await mkdir(dir, { recursive: true });
  const out = await spriteExec(spriteName, collectScript(TAR_PATH));
  if (out.includes('NOTHING_TO_COLLECT')) {
    await writeFile(path.join(dir, 'manifest.json'),
      `${JSON.stringify({ sprite: spriteName, empty: true, at: new Date().toISOString() }, null, 2)}\n`);
    console.log('nothing to collect: this sprite has no agent memory yet');
    return { empty: true };
  }
  const lines = out.split('\n');
  const sha = lines.find((l) => l.startsWith('SHA256 '))?.slice(7).trim();
  const bytes = Number(lines.find((l) => l.startsWith('BYTES '))?.slice(6).trim());
  const entries = lines.slice(lines.findIndex((l) => l.startsWith('BYTES ')) + 1);
  if (!/^[0-9a-f]{64}$/.test(sha ?? '')) throw new Error('the sprite did not report a digest');

  const refusals = archiveRefusals(entries);
  if (refusals.length) {
    await spriteExec(spriteName, `rm -f ${TAR_PATH}`);
    throw new Error(`archive refused:\n  ${refusals.join('\n  ')}`);
  }

  await sprite(spriteName, ['file', 'pull', TAR_PATH, `${dir}/`]);
  const local = path.join(dir, path.basename(TAR_PATH));
  const digest = createHash('sha256').update(await readFile(local)).digest('hex');
  if (digest !== sha) throw new Error(`digest mismatch: sprite ${sha}, local ${digest}`);
  const size = (await stat(local)).size;
  if (size !== bytes) throw new Error(`size mismatch: sprite ${bytes}, local ${size}`);
  await spriteExec(spriteName, `rm -f ${TAR_PATH}`);

  const manifest = { sprite: spriteName, at: new Date().toISOString(), sha256: sha, bytes, entries: entries.filter(Boolean) };
  await writeFile(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`backed up ${entries.filter(Boolean).length} entries, ${bytes} bytes, verified by digest`);
  return manifest;
}

async function phaseRestore(spriteName, dir) {
  const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
  if (manifest.empty) { console.log('backup is empty; nothing to restore'); return; }
  const refusals = archiveRefusals(manifest.entries);
  if (refusals.length) throw new Error(`manifest refused:\n  ${refusals.join('\n  ')}`);
  const local = path.join(dir, path.basename(TAR_PATH));
  const digest = createHash('sha256').update(await readFile(local)).digest('hex');
  if (digest !== manifest.sha256) throw new Error('local backup no longer matches its manifest');

  await sprite(spriteName, ['file', 'push', local, TAR_PATH]);
  const out = await spriteExec(spriteName, `set -eu
test "$(sha256sum ${TAR_PATH} | cut -d' ' -f1)" = "${manifest.sha256}"
mkdir -p ${HERMES}
tar -xzf ${TAR_PATH} -C ${HERMES} --no-same-owner
chmod 600 ${HERMES}/memories/*.md ${HERMES}/profiles/*/memories/*.md 2>/dev/null || true
rm -f ${TAR_PATH}
echo RESTORED
find ${HERMES}/memories ${HERMES}/profiles -name '*.md' | wc -l`);
  if (!out.includes('RESTORED')) throw new Error('the sprite did not confirm the restore');
  console.log(`restored into ${spriteName}: ${out.trim().split('\n').pop()} memory files present`);
}

/** Back up one sprite, replace it, and put the memory back. The replacement
 *  carries the same name, because the name is a hash of the business id. */
async function moveOne(sql, spriteName, dir) {
  const state = await readState(sql, spriteName);
  const refusals = preflightRefusals(state);
  if (refusals.length && !flag('force')) throw new Error(`${spriteName}: ${refusals.join('; ')}`);
  const businessId = state.runtime.business_id;

  console.log(`\n${spriteName} (${state.runtime.business_name}) — backing up`);
  await phaseBackup(spriteName, dir);

  console.log('enqueuing delete');
  await enqueue(sql, businessId, 'delete', `move-region-delete-${Date.now()}`);
  await waitFor('the sprite to be deleted', async () => {
    const [row] = await sql`select count(*)::int as n from agent_runtime where business_id = ${businessId}`;
    return row.n === 0;
  });
  console.log('\ndeleted; enqueuing provision');
  await enqueue(sql, businessId, 'provision', `move-region-provision-${Date.now()}`);
  const ready = await waitFor('the new sprite to be ready', async () => {
    const [row] = await sql`select provider_name, status from agent_runtime where business_id = ${businessId}`;
    return row?.status === 'ready' ? row : null;
  });
  console.log(`\nprovisioned ${ready.provider_name}; restoring`);
  await phaseRestore(ready.provider_name, dir);
  await survey(sql, [{ provider_name: ready.provider_name }]);
  return ready;
}

function report(rows) {
  for (const row of rows) {
    console.log([
      row.provider_name,
      (row.business_name ?? '').slice(0, 28).padEnd(28),
      new Date(row.created_at).toISOString().slice(0, 10),
      `${row.egress_colo ?? '?'}/${row.egress_country ?? '?'}`.padEnd(8),
      `runs=${row.runs ?? '?'}`,
      row.status,
    ].join('  '));
  }
}

async function main() {
  const sql = await connect();
  try {
    if (flag('all')) {
      let rows = await listCandidates(sql);
      console.log(`${rows.length} sprites predate the placement change and are US or unknown:`);
      report(rows);
      if (flag('survey')) {
        console.log('\nsurveying — each sprite calls the config channel so its egress is recorded');
        await survey(sql, rows);
        rows = await listCandidates(sql);
        console.log(`\n${rows.length} still candidates after the survey:`);
        report(rows);
        return;
      }
      const unknown = rows.filter((row) => row.egress_country === null);
      if (unknown.length) {
        console.log(`\n${unknown.length} have never told us where they are. Run --all --survey first.`);
        if (!flag('force')) { process.exitCode = 1; return; }
      }
      if (!flag('yes')) {
        console.log('\nplan only. Add --yes to move all of them, quietest business first.');
        return;
      }
      const limit = Number(value('limit') ?? rows.length);
      for (const [index, row] of rows.slice(0, limit).entries()) {
        console.log(`\n=== ${index + 1}/${Math.min(limit, rows.length)} ===`);
        await moveOne(sql, row.provider_name, path.join(value('dir') ?? '.runtime-moves', row.provider_name));
      }
      console.log('\ndone. Remaining candidates:');
      report(await listCandidates(sql));
      return;
    }

    const spriteName = value('sprite');
    if (!spriteName || !SPRITE_NAME.test(spriteName)) throw new Error('--sprite <aisar-b-…> or --all is required');
    const dir = value('dir') ?? path.join('.runtime-moves', spriteName);
    const state = await readState(sql, spriteName);
    const refusals = preflightRefusals(state);
    console.log(JSON.stringify({
      sprite: spriteName,
      business: state.runtime?.business_name ?? null,
      status: state.runtime?.status ?? null,
      created: state.runtime?.created_at ?? null,
      egress: state.runtime ? `${state.runtime.egress_colo ?? '?'}/${state.runtime.egress_country ?? '?'}` : null,
      activeRuns: state.activeRuns,
      openTasks: state.openTasks,
      refusals,
    }, null, 2));

    if (flag('restore')) { await phaseRestore(spriteName, dir); return; }
    if (refusals.length && !flag('force')) {
      console.error('\nrefusing: ' + refusals.join('; '));
      process.exitCode = 1;
      return;
    }
    if (flag('backup')) { await phaseBackup(spriteName, dir); return; }
    if (!flag('move')) { console.log('\nplan only. --backup, then --move --yes, then --restore.'); return; }
    if (!flag('yes')) throw new Error('--move requires --yes: it deletes the sprite');
    await moveOne(sql, spriteName, dir);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(String(err.message ?? err)); process.exitCode = 1; });
}
