#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

const connection = process.env.AISAR_NEON_OWNER_URL;
if (!connection) throw new Error('AISAR_NEON_OWNER_URL is required');
let target;
try { target = new URL(connection); }
catch { throw new Error('Invalid database configuration; connection details are withheld'); }
const hosts = new Set(['ep-sparkling-violet-b3l9d7un-pooler.c-4.ap-southeast-1.aws.neon.tech',
  'ep-sparkling-violet-b3l9d7un.c-4.ap-southeast-1.aws.neon.tech']);
if (!['postgres:', 'postgresql:'].includes(target.protocol) || !hosts.has(target.hostname)
  || target.pathname !== '/neondb' || target.username !== 'neondb_owner' || !target.password) {
  throw new Error('Database does not match the reviewed production owner target');
}
const body = await readFile(new URL('../migrations/057_chat_preview.sql',import.meta.url),'utf8');
const sql = postgres(connection,{ max:1,fetch_types:false,ssl:'require' });
try {
  await sql.begin(async tx => {
    await tx.unsafe(body);
    const [verified] = await tx`select
      has_table_privilege('aisar_app','public.chat_preview_account','select')
        and has_table_privilege('aisar_app','public.chat_preview_account','insert')
        and has_table_privilege('aisar_app','public.chat_preview_account','update') as account_access,
      has_table_privilege('aisar_app','public.chat_preview_request','select')
        and has_table_privilege('aisar_app','public.chat_preview_request','insert')
        and has_table_privilege('aisar_app','public.chat_preview_request','update') as request_access,
      not has_table_privilege('aisar_app','public.chat_preview_account','delete')
        and not has_table_privilege('aisar_app','public.chat_preview_request','delete') as no_delete_privilege,
      exists(select 1 from pg_trigger where tgrelid='public.chat_preview_account'::regclass
        and tgname='chat_preview_no_reset' and tgenabled='O') as no_reset_guard,
      exists(select 1 from pg_constraint where conrelid='public.chat_preview_account'::regclass and contype='c'
        and pg_get_constraintdef(oid) like '%requests_used%10%') as lifetime_cap`;
    if (Object.values(verified).some(value => value !== true)) throw new Error('Preview schema verification failed');
  });
  console.log(JSON.stringify({ ok:true,migration:'057_chat_preview.sql',previewEnabled:false }));
} catch {
  console.error('[chat-preview] migration failed; no launch flags were changed');
  process.exitCode=1;
} finally { await sql.end({ timeout:5 }); }
