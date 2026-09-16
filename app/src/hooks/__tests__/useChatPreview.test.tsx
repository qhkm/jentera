import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isChatPreview, PREVIEW_CHANGE_EVENT, useChatPreview } from '../useChatPreview';

const identity = vi.hoisted(() => ({ key: 'account-a' }));
vi.mock('@/lib/repo/gate', () => ({ useAccountKey: () => identity.key }));
vi.mock('@/lib/native', () => ({ nativeAuthorizationHeaders: async () => ({}) }));
const quota = (used = 0) => ({ limit: 10, used, remaining: 10 - used });
const response = (used = 0) => Response.json({ signedIn: true, access: { kind: 'preview', preview: quota(used) } });
beforeEach(() => { identity.key = 'account-a'; vi.stubEnv('VITE_API_URL', 'https://fixture.invalid'); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('server-owned chat preview display', () => {
  it('accepts only internally consistent ten-request quotas', () => {
    expect(isChatPreview(quota(0))).toBe(true);
    expect(isChatPreview(quota(10))).toBe(true);
    for (const value of [null, {}, quota(11), quota(-1), quota(0.5), { ...quota(), limit: 100 }, { ...quota(), remaining: 11 }]) {
      expect(isChatPreview(value)).toBe(false);
    }
  });
  it('never requests trial access while signed out', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(renderHook(() => useChatPreview(false)).result.current).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('reads account quota, including the exhausted state, without granting access locally', async () => {
    const fetch = vi.fn(async () => response(10)); vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useChatPreview(true));
    await waitFor(() => expect(result.current).toEqual(quota(10)));
    expect(fetch).toHaveBeenCalledWith('https://fixture.invalid/api/access', expect.objectContaining({ credentials: 'include', signal: expect.any(AbortSignal) }));
    expect(Object.values(localStorage).join('')).not.toContain('remaining');
  });
  it('refreshes when a request is admitted, then removes trial UI after paid activation', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(9)).mockResolvedValueOnce(response(10))
      .mockResolvedValueOnce(Response.json({ signedIn: true, access: { kind: 'paid' } }));
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useChatPreview(true));
    await waitFor(() => expect(result.current?.remaining).toBe(1));
    act(() => window.dispatchEvent(new Event(PREVIEW_CHANGE_EVENT)));
    await waitFor(() => expect(result.current?.remaining).toBe(0));
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(result.current).toBeNull());
  });
  it('does not reset an exhausted quota after a failed status read', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(10)).mockRejectedValueOnce(new Error('Offline'));
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useChatPreview(true));
    await waitFor(() => expect(result.current?.remaining).toBe(0));
    await act(async () => window.dispatchEvent(new Event(PREVIEW_CHANGE_EVENT)));
    expect(result.current).toEqual(quota(10));
  });
  it('ignores a stale account response and aborts its request on account switch', async () => {
    let resolveOld!: (value: Response) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce(response(0));
    vi.stubGlobal('fetch', fetch);
    const { result, rerender } = renderHook(() => useChatPreview(true));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const oldSignal = fetch.mock.calls[0][1].signal as AbortSignal;
    identity.key = 'account-b'; rerender();
    await waitFor(() => expect(result.current).toEqual(quota(0)));
    expect(oldSignal.aborted).toBe(true);
    await act(async () => resolveOld(response(10)));
    expect(result.current).toEqual(quota(0));
  });
  it('removes its listeners and cancels pending reads when unmounted', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response()); vi.stubGlobal('fetch', fetch);
    const { result, unmount } = renderHook(() => useChatPreview(true));
    await waitFor(() => expect(result.current?.remaining).toBe(10));
    const signal = fetch.mock.calls[0]![1]!.signal as AbortSignal;
    unmount(); window.dispatchEvent(new Event(PREVIEW_CHANGE_EVENT));
    expect(signal.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
