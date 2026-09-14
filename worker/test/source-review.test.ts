import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { approvedSource, reviewSources, supportedReview } from '../src/source-review';
import { guardAnswer } from '../src/answer-guardrails';

const claim = 'The API supports tool calls.';
const passage = 'The API supports tool calls. This is documented behavior.';
const answer = `${claim} [Docs](https://api-docs.deepseek.com/guides/tool_calls)`;
const valid = { coversAll: true, claims: [{ claim, source: 0, quote: passage, supported: true }] };
const env = (run: (...args: unknown[]) => Promise<unknown>) => ({ AI: { run } }) as unknown as Env;
const page = () => new Response(passage, { headers: { 'content-type': 'text/plain' } });

describe('bounded public source review', () => {
  it.each(['https://127.0.0.1/', 'https://[::1]/', 'https://api-docs.deepseek.com.evil.com/',
    'https://user:secret@api-docs.deepseek.com/', 'https://api-docs.deepseek.com/?token=secret',
    'https://api-docs.deepseek.com:8443/', 'http://api-docs.deepseek.com/', 'https://unknown.example/'])('rejects unsafe or unapproved URL %s', url => {
    expect(approvedSource(url)).toBe(false);
  });
  it('requires exact answer and source quotations, not model confidence', () => {
    expect(supportedReview(valid, answer, [passage])).toBe(true);
    expect(supportedReview(valid, answer, ['Something else entirely.'])).toBe(false);
    expect(supportedReview({ ...valid, coversAll: false }, answer, [passage])).toBe(false);
    expect(supportedReview({ ...valid, claims: [] }, answer, [passage])).toBe(false);
    expect(supportedReview('not JSON', answer, [passage])).toBe(false);
  });
  it('reads approved public sources without credentials and checks supplied passages', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => page());
    const run = vi.fn(async () => ({ response: JSON.stringify(valid) }));
    expect(await reviewSources(env(run), 'Latest API features?', answer, { fetch: fetcher }))
      .toEqual({ status: 'checked', sources: 1 });
    expect(fetcher).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirect: 'manual' }));
    const headers = new Headers(fetcher.mock.calls[0][1]?.headers);
    expect(headers.has('Authorization')).toBe(false);
    expect(headers.has('Cookie')).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('does not follow redirects, fetch unknown hosts, or call a reviewer without source content', async () => {
    const run = vi.fn();
    const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { Location: 'http://localhost/' } }));
    expect((await reviewSources(env(run), 'Latest?', answer, { fetch: fetcher })).status).toBe('incomplete');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
    await reviewSources(env(run), 'Latest?', 'https://unknown.example/', { fetch: fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('fails visibly on fabricated support, but never rewrites the claim itself', async () => {
    const review = await reviewSources(env(async () => ({ response: JSON.stringify({ ...valid, claims: [{ ...valid.claims[0], quote: 'Invented quote with enough characters' }] }) })),
      'Latest?', answer, { fetch: async () => page() });
    expect(review.status).toBe('unsupported');
    const guarded = guardAnswer(answer, 'Latest?', null, review);
    expect(guarded.warnings).toContain('source_support_missing');
    expect(guarded.result).toContain(claim);
  });
  it('times out without retrying or blocking final delivery', async () => {
    const run = vi.fn(() => new Promise<unknown>(() => {}));
    expect((await reviewSources(env(run), 'Latest?', answer, { fetch: async () => page(), budgetMs: 10 })).status).toBe('incomplete');
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('skips drafts and flags partial coverage', async () => {
    const run = vi.fn(async () => ({ response: JSON.stringify(valid) }));
    expect((await reviewSources(env(run), 'Draft marketing ideas', answer)).status).toBe('not_applicable');
    expect(run).not.toHaveBeenCalled();
    const review = await reviewSources(env(run), 'Latest?', answer + ' https://unknown.example/', { fetch: async () => page() });
    expect(review.status).toBe('incomplete');
  });
});
