#!/usr/bin/env node
// Refuses a deploy while production lacks a table, column or function that a
// migration in worker/migrations creates.
//
// Nothing applies migrations to production automatically; each is run by
// hand. 045_native_login_handoff.sql was skipped while its code shipped, and
// for ten days every magic link and every password-signup verification
// answered an empty 500 (fixed 2026-09-25). This check runs in `predeploy` and
// in ship-runtime.sh, so code that needs a migration cannot reach production
// ahead of it.
//
// It reads the migrations in order, following drops and renames, and compares
// the result with production over a read-only transaction. It cannot see
// indexes, policies or constraints. The connection comes from
// AISAR_NEON_OWNER_URL, or from neonctl (logged in). It fails closed when
// production cannot be reached. AISAR_SKIP_MIGRATION_CHECK=1 skips it, loudly,
// for an emergency.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PROJECT_ID = process.env.AISAR_NEON_PROJECT_ID ?? 'red-haze-10375483';
const PRODUCTION_HOSTS = new Set([
  'ep-sparkling-violet-b3l9d7un.c-4.ap-southeast-1.aws.neon.tech',
  'ep-sparkling-violet-b3l9d7un-pooler.c-4.ap-southeast-1.aws.neon.tech',
]);
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

const IDENT = '"?([a-z_][a-z0-9_]*)"?';
/** Optional schema: unqualified or public counts; another schema is not ours to check. */
const SCHEMA = '(?:"?([a-z_][a-z0-9_]*)"?\\.)?';
const EVENT = new RegExp([
  `\\bcreate\\s+(?:unlogged\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?${SCHEMA}${IDENT}`,
  `\\bdrop\\s+table\\s+(?:if\\s+exists\\s+)?([^;]+);`,
  `\\balter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?${SCHEMA}${IDENT}\\s+([^;]*);`,
  `\\bcreate\\s+(?:or\\s+replace\\s+)?function\\s+${SCHEMA}${IDENT}\\s*\\(`,
  `\\bdrop\\s+function\\s+(?:if\\s+exists\\s+)?${SCHEMA}${IDENT}`,
].map((part) => `(?:${part})`).join('|'), 'gi');

const ours = (schema) => !schema || schema.toLowerCase() === 'public';
const stripComments = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');

/** Everything the migrations leave behind, in order: `{ key, kind, migration }`. */
export function expectedObjects(files) {
  const objects = new Map();
  const put = (key, kind, migration) => objects.set(key, { key, kind, migration });
  const renameTable = (from, to) => {
    for (const [key, value] of [...objects]) {
      if (key === `table ${from}`) { objects.delete(key); put(`table ${to}`, 'table', value.migration); }
      if (key.startsWith(`column ${from}.`)) {
        objects.delete(key);
        put(`column ${to}.${key.slice(`column ${from}.`.length)}`, 'column', value.migration);
      }
    }
  };
  for (const { name, sql } of files) {
    for (const m of stripComments(sql).matchAll(EVENT)) {
      const [, cSchema, cTable, dropList, aSchema, aTable, aBody, fSchema, fName, dSchema, dName] =
        m.map((part) => part?.toLowerCase());
      if (cTable && ours(cSchema)) put(`table ${cTable}`, 'table', name);
      if (dropList) {
        for (const item of dropList.replace(/\b(cascade|restrict)\b/g, '').split(',')) {
          const [schema, table] = item.trim().includes('.') ? item.trim().split('.') : [null, item.trim()];
          const clean = table?.replace(/"/g, '');
          if (clean && ours(schema)) deleteTable(objects, clean);
        }
      }
      if (aTable && ours(aSchema)) {
        for (const add of aBody.matchAll(new RegExp(`\\badd\\s+column\\s+(?:if\\s+not\\s+exists\\s+)?${IDENT}`, 'g'))) {
          put(`column ${aTable}.${add[1]}`, 'column', name);
        }
        for (const drop of aBody.matchAll(new RegExp(`\\bdrop\\s+column\\s+(?:if\\s+exists\\s+)?${IDENT}`, 'g'))) {
          objects.delete(`column ${aTable}.${drop[1]}`);
        }
        const column = aBody.match(new RegExp(`\\brename\\s+column\\s+${IDENT}\\s+to\\s+${IDENT}`));
        if (column) {
          const was = objects.get(`column ${aTable}.${column[1]}`);
          objects.delete(`column ${aTable}.${column[1]}`);
          put(`column ${aTable}.${column[2]}`, 'column', was?.migration ?? name);
        }
        const table = aBody.match(new RegExp(`^\\s*rename\\s+to\\s+${IDENT}`));
        if (table) renameTable(aTable, table[1]);
      }
      if (fName && ours(fSchema)) put(`function ${fName}`, 'function', name);
      if (dName && ours(dSchema)) objects.delete(`function ${dName}`);
    }
  }
  return [...objects.values()];
}

function deleteTable(objects, table) {
  for (const key of [...objects.keys()]) {
    if (key === `table ${table}` || key.startsWith(`column ${table}.`)) objects.delete(key);
  }
}

/** The expected objects `actual` lacks. `actual` holds sets of table names, "table.column" and function names. */
export function missingObjects(expected, actual) {
  return expected.filter(({ key, kind }) => {
    const name = key.slice(kind.length + 1);
    return kind === 'table' ? !actual.tables.has(name)
      : kind === 'column' ? !actual.columns.has(name)
        : !actual.functions.has(name);
  }).sort((a, b) => a.migration.localeCompare(b.migration) || a.key.localeCompare(b.key));
}

/** Why a URL is not one to check against, or null. */
export function targetProblem(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return 'not a database URL';
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') return 'not a database URL';
  if (PRODUCTION_HOSTS.has(parsed.hostname) || LOCAL_HOSTS.has(parsed.hostname)) return null;
  return `${parsed.hostname} is not the reviewed production database`;
}

function connectionUrl() {
  if (process.env.AISAR_NEON_OWNER_URL) return process.env.AISAR_NEON_OWNER_URL;
  try {
    /* neonctl opens a browser and waits when its login has expired; the
       timeout turns that into a clear refusal instead of a hung deploy. */
    return execFileSync('neonctl', [
      'connection-string', 'production', '--project-id', PROJECT_ID,
      '--role-name', 'neondb_owner', '--database-name', 'neondb',
    ], { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

async function productionObjects(url) {
  const { default: postgres } = await import('postgres');
  const local = LOCAL_HOSTS.has(new URL(url).hostname);
  const sql = postgres(url, { max: 1, fetch_types: false, ssl: local ? false : 'require', connect_timeout: 15 });
  try {
    return await sql.begin('read only', async (tx) => {
      const tables = await tx`select table_name from information_schema.tables where table_schema = 'public'`;
      const columns = await tx`select table_name, column_name from information_schema.columns where table_schema = 'public'`;
      const functions = await tx`
        select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`;
      return {
        tables: new Set(tables.map((row) => row.table_name)),
        columns: new Set(columns.map((row) => `${row.table_name}.${row.column_name}`)),
        functions: new Set(functions.map((row) => row.proname)),
      };
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main() {
  if (process.env.AISAR_SKIP_MIGRATION_CHECK === '1') {
    console.error('SKIPPED  migration check (AISAR_SKIP_MIGRATION_CHECK=1): production was not compared with worker/migrations');
    return 0;
  }
  const dir = new URL('../migrations/', import.meta.url);
  const files = readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()
    .map((name) => ({ name, sql: readFileSync(new URL(name, dir), 'utf8') }));
  const expected = expectedObjects(files);

  const url = connectionUrl();
  if (!url) {
    console.error('FAIL  migration check: no production connection. Run `neonctl auth` or set AISAR_NEON_OWNER_URL.');
    return 1;
  }
  const problem = targetProblem(url);
  if (problem) {
    console.error(`FAIL  migration check: ${problem}`);
    return 1;
  }
  let actual;
  try {
    actual = await productionObjects(url);
  } catch (error) {
    console.error(`FAIL  migration check: could not read the database (${error instanceof Error ? error.message : error})`);
    return 1;
  }
  const missing = missingObjects(expected, actual);
  if (missing.length > 0) {
    console.error(`FAIL  production lacks ${missing.length} object(s) that migrations create; apply the migration before deploying:`);
    for (const { migration, key } of missing) console.error(`        ${migration}  ${key}`);
    return 1;
  }
  console.log(`ok    every migration's tables, columns and functions are in the database (${expected.length} objects)`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
