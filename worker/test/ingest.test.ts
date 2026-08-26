/* ============================================================
   Reading a website.

   Two things carry risk here and neither is the model. The first is
   that a user-supplied URL is fetched by our infrastructure, which is
   the shape of an SSRF. The second is that whatever the model returns
   is parsed and written to a business's memory — so the parser, not
   the prompt, is what stands between a bad response and bad data.

   The model itself is faked throughout. What a model says is not a
   property worth pinning; what the code does with an unexpected answer
   very much is, and that is what broke first in production.
   ============================================================ */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractFacts, fetchPage, htmlToText, urlProblem } from '../src/ingest';
import type { Env } from '../src/env';

/** An Env whose model returns exactly what a test dictates. */
const withModel = (response: unknown): Env =>
  ({ AI: { run: async () => response } }) as unknown as Env;

describe('refusing a URL before fetching it', () => {
  it('accepts ordinary public addresses', () => {
    for (const u of [
      'https://warung.example.com',
      'http://example.com/menu',
      'https://example.com:8443/a/b?c=d',
    ]) {
      expect(urlProblem(u), u).toBeNull();
    }
  });

  it('refuses anything that is not http', () => {
    /* file: would read the Worker's own filesystem if one existed;
       data: and javascript: are not addresses at all. */
    for (const u of ['file:///etc/passwd', 'data:text/html,<b>x', 'javascript:alert(1)', 'ftp://x.com']) {
      expect(urlProblem(u), u).toMatch(/http/i);
    }
  });

  it('refuses addresses that only exist inside a network', () => {
    for (const u of [
      'http://localhost/x',
      'http://127.0.0.1/x',
      'http://0.0.0.0/',
      'http://10.0.0.1/',
      'http://192.168.1.1/',
      'http://172.16.0.1/',
      'http://172.31.255.255/',
      // The cloud metadata endpoint, the classic SSRF target.
      'http://169.254.169.254/latest/meta-data/',
      'http://db.internal/',
      'http://printer.local/',
    ]) {
      expect(urlProblem(u), u).toMatch(/not reachable/i);
    }
  });

  it('allows 172.x that is outside the private range', () => {
    // 172.15 and 172.32 are public; only 172.16–172.31 are not.
    expect(urlProblem('http://172.15.0.1/')).toBeNull();
    expect(urlProblem('http://172.32.0.1/')).toBeNull();
  });

  it('refuses nonsense', () => {
    for (const u of ['', '   ', 'not a url', null, undefined, 42, {}]) {
      expect(urlProblem(u)).not.toBeNull();
    }
  });
});

describe('stripping a page to text', () => {
  it('drops script and style bodies entirely', () => {
    const out = htmlToText(
      '<style>.a{color:red}</style><p>Open daily</p><script>alert("hi")</script>',
    );
    expect(out).toContain('Open daily');
    expect(out).not.toContain('color:red');
    expect(out).not.toContain('alert');
  });

  it('keeps the words and loses the tags', () => {
    expect(htmlToText('<h1>Warung</h1><p>Nasi <b>lemak</b></p>')).toMatch(/Warung\s+Nasi\s+lemak/);
  });

  it('decodes the entities a business page actually contains', () => {
    expect(htmlToText('<p>Fish &amp; chips &quot;special&quot; &#39;today&#39;</p>')).toContain(
      `Fish & chips "special" 'today'`,
    );
  });

  it('drops comments, which is where stale prices hide', () => {
    expect(htmlToText('<p>RM12</p><!-- old price RM8 -->')).not.toContain('RM8');
  });

  it('caps its output', () => {
    expect(htmlToText(`<p>${'x'.repeat(50_000)}</p>`).length).toBeLessThanOrEqual(12_000);
  });
});

describe('reading the model’s answer', () => {
  it('takes the facts out of a clean response', async () => {
    const out = await extractFacts(
      withModel({
        response: JSON.stringify({
          facts: [{ key: 'hours.monday', value: '9am to 6pm', confidence: 0.9 }],
        }),
      }),
      'page text',
      'Title',
    );
    expect(out).toEqual([{ key: 'hours.monday', value: '9am to 6pm', confidence: 0.9 }]);
  });

  it('survives prose wrapped around the JSON', async () => {
    /* Models do this constantly. Failing the whole run over a
       conversational preamble would make ingestion flaky for no
       reason. */
    const out = await extractFacts(
      withModel({
        response:
          'Sure! Here is what I found:\n```json\n{"facts":[{"key":"business.name","value":"Warung","confidence":0.8}]}\n```\nHope that helps.',
      }),
      'p',
      't',
    );
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe('business.name');
  });

  it('accepts the shapes Workers AI actually returns', async () => {
    /* The first real call failed because `res.response` was not a
       string. These are the forms seen or documented since. */
    const facts = { facts: [{ key: 'business.name', value: 'W', confidence: 0.9 }] };
    for (const shape of [
      { response: JSON.stringify(facts) },
      { response: facts },
      { choices: [{ message: { content: JSON.stringify(facts) } }] },
      { result: JSON.stringify(facts) },
      JSON.stringify(facts),
    ]) {
      expect(await extractFacts(withModel(shape), 'p', 't'), JSON.stringify(shape).slice(0, 40))
        .toHaveLength(1);
    }
  });

  it('returns nothing rather than throwing on an unusable answer', async () => {
    for (const shape of [null, undefined, {}, { response: '' }, { response: 'no json here' }, 42]) {
      expect(await extractFacts(withModel(shape), 'p', 't')).toEqual([]);
    }
  });

  it('drops a fact whose key would fragment retrieval', async () => {
    /* 'Hours.Monday' living beside 'hours.monday' is two records of one
       thing, and neither answers reliably. */
    const out = await extractFacts(
      withModel({
        response: JSON.stringify({
          facts: [
            { key: 'Hours.Monday', value: 'x', confidence: 0.9 },
            { key: 'hours with spaces', value: 'x', confidence: 0.9 },
            { key: '', value: 'x', confidence: 0.9 },
            { key: 'hours.monday', value: 'ok', confidence: 0.9 },
          ],
        }),
      }),
      'p',
      't',
    );
    expect(out.map((f) => f.key)).toEqual(['hours.monday']);
  });

  it('drops a guess too weak to be worth reviewing', async () => {
    const out = await extractFacts(
      withModel({
        response: JSON.stringify({
          facts: [
            { key: 'a.low', value: 'x', confidence: 0.2 },
            { key: 'b.ok', value: 'x', confidence: 0.5 },
            { key: 'c.bad', value: 'x', confidence: 'very sure' },
          ],
        }),
      }),
      'p',
      't',
    );
    expect(out.map((f) => f.key)).toEqual(['b.ok']);
  });

  it('keeps the first of a repeated key', async () => {
    const out = await extractFacts(
      withModel({
        response: JSON.stringify({
          facts: [
            { key: 'hours.monday', value: 'first', confidence: 0.9 },
            { key: 'hours.monday', value: 'second', confidence: 0.9 },
          ],
        }),
      }),
      'p',
      't',
    );
    expect(out).toHaveLength(1);
    expect(out[0].value).toBe('first');
  });

  it('refuses an empty or enormous value', async () => {
    const out = await extractFacts(
      withModel({
        response: JSON.stringify({
          facts: [
            { key: 'a.empty', value: '', confidence: 0.9 },
            { key: 'b.huge', value: 'x'.repeat(3000), confidence: 0.9 },
            { key: 'c.number', value: 150, confidence: 0.9 },
          ],
        }),
      }),
      'p',
      't',
    );
    // A number is legitimate — a price — and is kept as text.
    expect(out.map((f) => f.key)).toEqual(['c.number']);
    expect(out[0].value).toBe('150');
  });

  it('stops at thirty, because nobody reviews sixty', async () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      key: `k${i}.v`,
      value: 'x',
      confidence: 0.9,
    }));
    expect(await extractFacts(withModel({ response: JSON.stringify({ facts: many }) }), 'p', 't'))
      .toHaveLength(30);
  });

  it('ignores a response that is not shaped like facts at all', async () => {
    for (const body of [{ facts: 'nope' }, { facts: [1, 2, 3] }, { other: [] }]) {
      expect(await extractFacts(withModel({ response: JSON.stringify(body) }), 'p', 't')).toEqual([]);
    }
  });
});

describe('fetching the page', () => {
  afterEach(() => vi.unstubAllGlobals());

  const reply = (body: string, init: ResponseInit = {}) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { headers: { 'Content-Type': 'text/html' }, ...init })),
    );

  it('returns the text and the title', async () => {
    reply('<html><head><title>Warung Demo</title></head><body><p>Open daily</p></body></html>');
    const page = await fetchPage('https://example.com');
    expect(page.title).toBe('Warung Demo');
    expect(page.text).toContain('Open daily');
  });

  it('refuses anything that is not a web page', async () => {
    /* A PDF or an image would be fed to the model as mojibake and
       produce confident nonsense. */
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('%PDF-1.4', { headers: { 'Content-Type': 'application/pdf' } })),
    );
    await expect(fetchPage('https://example.com/menu.pdf')).rejects.toThrow(/not a web page/i);
  });

  it('reports what the site said when it refuses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 403 })));
    await expect(fetchPage('https://example.com')).rejects.toThrow(/403/);
  });

  it('identifies itself honestly', async () => {
    const spy = vi.fn(
      async () => new Response('<p>hi</p>', { headers: { 'Content-Type': 'text/html' } }),
    );
    vi.stubGlobal('fetch', spy);
    await fetchPage('https://example.com');
    const headers = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    // A site owner reading their logs should be able to tell what this was.
    expect(headers['User-Agent']).toMatch(/AISAR/);
    expect(headers['User-Agent']).toMatch(/jentera\.ai/);
  });
});
