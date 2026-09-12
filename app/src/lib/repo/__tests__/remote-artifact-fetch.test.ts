import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteRepository } from '@/lib/repo/remote';

describe('RemoteRepository.fetchArtifact', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('fetches the bytes with the session and hands back a blob of the served type', async () => {
    const fetch = vi.fn(async () => new Response('# Digest', { status: 200, headers: { 'Content-Type': 'text/markdown' } }));
    vi.stubGlobal('fetch', fetch);
    const blob = await new RemoteRepository().fetchArtifact('a1');
    expect(blob.type).toBe('text/markdown');
    expect(await blob.text()).toBe('# Digest');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe('/api/artifacts/a1');
    expect(init.credentials).toBe('include');
  });

  it('turns a refusal into a plain error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    await expect(new RemoteRepository().fetchArtifact('a1')).rejects.toThrow(/could not be opened/i);
  });
});
