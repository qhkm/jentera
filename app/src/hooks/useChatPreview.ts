import { useEffect, useState } from 'react';
import { useAccountKey } from '@/lib/repo/gate';
import { nativeAuthorizationHeaders } from '@/lib/native';

export interface ChatPreview { limit: number; used: number; remaining: number }
export const PREVIEW_CHANGE_EVENT = 'jentera:preview-change';
export function isChatPreview(value: unknown): value is ChatPreview {
  if (!value || typeof value !== 'object') return false;
  const item = value as ChatPreview;
  return item.limit === 10 && Number.isInteger(item.used) && item.used >= 0 && item.used <= 10
    && item.remaining === 10 - item.used;
}

/** Display only: the server owns quota and checks every request independently. */
export function useChatPreview(enabled: boolean): ChatPreview | null {
  const account = useAccountKey();
  const [preview, setPreview] = useState<ChatPreview | null>(null);
  useEffect(() => {
    setPreview(null);
    const api = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
    if (!enabled || !api) return;
    let stopped = false;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function refresh() {
      controller?.abort(); clearTimeout(timer);
      const current = new AbortController(); controller = current;
      timer = setTimeout(() => current.abort(), 12000);
      try {
        const response = await fetch(api + '/api/access', {
          credentials: 'include', signal: current.signal, headers: await nativeAuthorizationHeaders(),
        });
        if (!response.ok) return;
        const body = await response.json();
        if (stopped || current.signal.aborted) return;
        setPreview(body.signedIn === true && body.access?.kind === 'preview' && isChatPreview(body.access.preview) ? body.access.preview : null);
      } catch { /* Failed reads never grant extra requests; the server stays authoritative. */ }
      finally { if (controller === current) clearTimeout(timer); }
    }
    void refresh();
    const update = () => { void refresh(); };
    window.addEventListener(PREVIEW_CHANGE_EVENT, update);
    window.addEventListener('focus', update);
    return () => {
      stopped = true; controller?.abort(); clearTimeout(timer);
      window.removeEventListener(PREVIEW_CHANGE_EVENT, update);
      window.removeEventListener('focus', update);
    };
  }, [account, enabled]);
  return preview;
}
