import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { handleRuns } from '../src/routes/runs';
import { liveFacts, recordFact } from '../src/facts';
import { retrieve } from '../src/ask';
import { asOwner, asTenant, jsonOf, req, signIn, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
let cookie: string;

/** A model that answers the extractor with the facts a test dictates, and a
    converter that turns any document into the Markdown a test dictates. */
function env(facts: { key: string; value: string; confidence?: number }[], markdown = '# Converted\n\nOpens 9 to 6.'): Env {
  const converted: { data: string }[] = [];
  return testEnv({
    AI: {
      run: async () => ({ response: JSON.stringify({ facts }) }),
      toMarkdown: async (files: { name: string }[]) => {
        converted.push(...files.map(() => ({ data: markdown })));
        return files.map((file) => ({ name: file.name, mimeType: 'text/markdown', format: 'markdown', tokens: 10, data: markdown }));
      },
    },
  });
}

beforeEach(async () => {
  await truncateAll();
  const userId = await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key) values (${A}, 'Kedai', 'restaurant')`;
    const [u] = await sql<{ id: string }[]>`insert into app_user (email, email_verified) values ('owner@example.com', true) returning id`;
    await sql`insert into membership (user_id, business_id, role) values (${u.id}, ${A}, 'owner')`;
    return u.id;
  });
  cookie = await signIn(userId);
});

async function upload(name: string, body: string | Uint8Array, contentType: string, useEnv: Env, sessionCookie: string | null = cookie) {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const request = new Request('https://api.test/api/runs/ingest/file', {
    method: 'POST',
    headers: {
      ...(sessionCookie ? { Cookie: sessionCookie } : {}),
      'Content-Type': contentType,
      'Content-Length': String(bytes.byteLength),
      'X-Aisar-File-Name': name,
    },
    body: bytes,
  });
  const response = await handleRuns(request, useEnv, new URL(request.url), {});
  if (!response) throw new Error('ingest file route did not match');
  return response;
}

describe('learning from an uploaded document', () => {
  it('an old price list becomes a proposal without displacing the approved price', async () => {
    const [member] = await asTenant(A, (tx) => tx<{ user_id: string }[]>`select user_id from membership where business_id = ${A} and role = 'owner'`);
    await asTenant(A, (tx) => recordFact(tx, A, { key: 'service.price', value: 'RM 100', source: 'owner', confirmedBy: member.user_id }));
    const response = await upload('old-prices.txt', 'Service RM 80.', 'text/plain',
      env([{ key: 'service.price', value: 'RM 80', confidence: 0.9 }]));
    expect(await jsonOf(response)).toMatchObject({ ok: true, facts: 1 });
    expect(await asTenant(A, liveFacts)).toEqual([expect.objectContaining({ value: 'RM 80', pending: true, currentValue: 'RM 100' })]);
    expect((await asTenant(A, (tx) => retrieve(tx, 'price')))[0].value).toBe('RM 100');
  });
  it('reads a text file, suggests its facts for confirmation, and records the reading as work', async () => {
    const response = await upload('opening-hours.txt', 'We open 9am to 6pm, closed Sundays. Call 03-1234 5678.', 'text/plain',
      env([{ key: 'hours.weekdays', value: '9am to 6pm', confidence: 0.9 }, { key: 'phone', value: '03-1234 5678', confidence: 0.8 }]));
    expect(response.status).toBe(200);
    const body = await jsonOf<{ ok: boolean; facts: number; keys: string[]; chars: number; source: string }>(response);
    expect(body).toMatchObject({ ok: true, facts: 2, keys: ['hours.weekdays', 'phone'], source: 'opening-hours.txt' });
    expect(body.chars).toBeGreaterThan(40);
    const rows = await asTenant(A, (tx) => tx<{ key: string; source: string; source_ref: string; confirmed_at: Date | null }[]>`
      select key, source, source_ref, confirmed_at from business_fact order by key`);
    expect(rows.map((r) => [r.key, r.source, r.source_ref, r.confirmed_at])).toEqual([
      ['hours.weekdays', 'agent', 'opening-hours.txt', null], ['phone', 'agent', 'opening-hours.txt', null],
    ]);
    const [work] = await asTenant(A, (tx) => tx<{ objective: string; status: string; function: string; channel: string }[]>`
      select objective, status, function, channel from work_record`);
    expect(work).toMatchObject({ objective: 'Read opening-hours.txt and learn about the business', status: 'completed', function: 'ingest', channel: 'upload' });
  });

  it('converts a PDF to text first, and says how much text it found', async () => {
    const response = await upload('price-list.pdf', new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), 'application/pdf',
      env([{ key: 'prices.coffee', value: 'RM 6', confidence: 0.7 }], '# Price list\n\nCoffee RM 6.'));
    expect(response.status).toBe(200);
    const body = await jsonOf<{ ok: boolean; facts: number; chars: number }>(response);
    expect(body).toMatchObject({ ok: true, facts: 1 });
    expect(body.chars).toBe('# Price list\n\nCoffee RM 6.'.length);
  });

  it('refuses what it cannot read: no file name, an unknown type, an empty or oversized body, or no session', async () => {
    const e = env([]);
    expect((await upload('', 'x', 'text/plain', e)).status).toBe(400);
    expect((await upload('notes.exe', 'x', 'application/x-msdownload', e)).status).toBe(415);
    expect((await upload('empty.txt', '', 'text/plain', e)).status).toBe(400);
    expect((await upload('big.txt', 'x'.repeat(1_048_577), 'text/plain', e)).status).toBe(413);
    expect((await upload('notes.txt', 'x', 'text/plain', e, null)).status).toBe(401);
    expect(await asTenant(A, (tx) => tx`select 1 from business_fact`)).toHaveLength(0);
  });

  it('records a failed conversion as failed work and answers ok:false, like a page that would not read', async () => {
    const broken = testEnv({ AI: { run: async () => ({ response: '{"facts":[]}' }), toMarkdown: async () => { throw new Error('conversion failed'); } } });
    const response = await upload('scan.pdf', new Uint8Array([1, 2, 3]), 'application/pdf', broken);
    expect(response.status).toBe(200);
    expect(await jsonOf(response)).toMatchObject({ ok: false, err: 'conversion failed' });
    const [work] = await asTenant(A, (tx) => tx<{ status: string }[]>`select status from work_record`);
    expect(work.status).toBe('failed');
  });
});
