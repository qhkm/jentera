import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteRepository } from '@/lib/repo/remote';

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('RemoteRepository files', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('lists the files the agent produced, for one run or for the business', async () => {
    const artifact = { id: 'a1', runId: 'r1', name: 'digest.md', contentType: 'text/markdown', size: 8, createdAt: '2026-09-12T01:00:00.000Z' };
    const fetch = vi.fn().mockImplementation(async () => response({ ok: true, artifacts: [artifact] }));
    vi.stubGlobal('fetch', fetch);
    const repo = new RemoteRepository();
    await expect(repo.listArtifacts({ runId: 'r1' })).resolves.toEqual([artifact]);
    expect(String(fetch.mock.calls[0][0])).toBe('/api/artifacts?runId=r1');
    await expect(repo.listArtifacts({ limit: 20 })).resolves.toEqual([artifact]);
    expect(String(fetch.mock.calls[1][0])).toBe('/api/artifacts?limit=20');
  });

  it('points a download at the API, where the session cookie travels with the click', () => {
    expect(new RemoteRepository().artifactUrl('a1')).toBe('/api/artifacts/a1');
  });
});
