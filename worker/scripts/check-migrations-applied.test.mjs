import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { expectedObjects, missingObjects, targetProblem } from './check-migrations-applied.mjs';

const keys = (objects) => objects.map((o) => o.key).sort();
const migrate = (...files) => expectedObjects(files.map(([name, sql]) => ({ name, sql })));

test('finds the tables, columns and functions a migration creates', () => {
  const objects = migrate(['001_a.sql', `
    create table if not exists public.booking (id uuid primary key);
    create table app_slug (slug text);
    alter table if exists only public.booking
      add column if not exists status text not null default 'pending',
      add column note text;
    create or replace function public.bookings_by_slug(p_slug text) returns table (id uuid) as $$ select 1 $$ language sql;
  `]);
  assert.deepEqual(keys(objects), [
    'column booking.note', 'column booking.status', 'function bookings_by_slug', 'table app_slug', 'table booking',
  ]);
  assert.equal(objects.find((o) => o.key === 'column booking.status').migration, '001_a.sql');
});

test('ignores what is only in comments', () => {
  assert.deepEqual(keys(migrate(['001_a.sql', `
    -- create table ghost (id int);
    /* alter table x add column ghost int;
       create function ghost() */
    create table real (id int); -- create table other (id int);
  `])), ['table real']);
});

test('follows drops and renames in migration order, so nothing removed on purpose is expected', () => {
  const objects = migrate(
    ['001_a.sql', 'create table old_name (id int); alter table old_name add column gone int, add column kept int; create function f() returns int as $$ select 1 $$ language sql;'],
    ['002_b.sql', 'alter table old_name rename to new_name; alter table new_name drop column if exists gone; alter table new_name rename column kept to held;'],
    ['003_c.sql', 'drop function if exists public.f(); create table temp_t (id int); drop table if exists temp_t;'],
    ['004_d.sql', 'drop function if exists public.g(text); create function public.g(p text) returns int as $$ select 1 $$ language sql;'],
  );
  assert.deepEqual(keys(objects), ['column new_name.held', 'function g', 'table new_name']);
});

test('names what the database lacks, and nothing it has', () => {
  const expected = migrate(['045_x.sql', 'create table login_token (h text); alter table login_token add column native_state text; create function due() returns int as $$ select 1 $$ language sql;']);
  const actual = { tables: new Set(['login_token']), columns: new Set(['login_token.h']), functions: new Set() };
  assert.deepEqual(missingObjects(expected, actual).map((o) => `${o.migration} ${o.key}`), [
    '045_x.sql column login_token.native_state',
    '045_x.sql function due',
  ]);
  const complete = { tables: new Set(['login_token']), columns: new Set(['login_token.native_state']), functions: new Set(['due']) };
  assert.deepEqual(missingObjects(expected, complete), []);
});

test('reads every real migration and expects objects that are known to exist', () => {
  const dir = new URL('../migrations/', import.meta.url);
  const files = readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()
    .map((name) => ({ name, sql: readFileSync(new URL(name, dir), 'utf8') }));
  const found = new Set(keys(expectedObjects(files)));
  for (const key of ['column login_token.native_state', 'table booking', 'function bookings_by_slug', 'function booking_calendar_due']) {
    assert.ok(found.has(key), key);
  }
  assert.ok(found.size > 100, `only ${found.size} objects`);
});

test('checks only the reviewed production database, or a local one', () => {
  assert.equal(targetProblem('postgresql://neondb_owner:p@ep-sparkling-violet-b3l9d7un.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require'), null);
  assert.equal(targetProblem('postgres://aisar_app:x@127.0.0.1:5432/aisar_bookings'), null);
  assert.match(targetProblem('postgres://neondb_owner:p@ep-other.neon.tech/neondb'), /not the reviewed production/);
  assert.match(targetProblem('not a url'), /not a database URL/);
});
