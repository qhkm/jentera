/* ============================================================
   Cloudflare Turnstile on the sign-in page.

   With a site key in the build, a widget sits in the form and hands a
   token to the next request; the worker checks it against its secret.
   Without a key there is no widget and no token, and a worker with no
   secret asks for none — so the two halves can ship in either order
   as long as the secret is set last.
   ============================================================ */
import { useCallback, useEffect, useRef, useState } from 'react';

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
/** How long a submit waits for a token the widget is still working on. */
const TOKEN_WAIT_MS = 10_000;

export function turnstileSiteKey(): string {
  return (import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '').trim();
}

let loading: Promise<TurnstileApi | null> | null = null;

function loadApi(): Promise<TurnstileApi | null> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!loading) {
    loading = new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = SCRIPT;
      script.async = true;
      script.onload = () => resolve(window.turnstile ?? null);
      script.onerror = () => resolve(null);
      document.head.appendChild(script);
    });
  }
  return loading;
}

export function useTurnstile() {
  const siteKey = turnstileSiteKey();
  /* State, not a ref: the form that holds the widget unmounts after a
     successful request and comes back on correction, and the widget
     has to come back with it. */
  const [container, attach] = useState<HTMLDivElement | null>(null);
  const widget = useRef<string | null>(null);
  const token = useRef<string | null>(null);
  const waiting = useRef<((token: string | null) => void)[]>([]);

  const settle = (value: string | null) => {
    token.current = value;
    waiting.current.splice(0).forEach((resolve) => resolve(value));
  };

  useEffect(() => {
    if (!siteKey || !container) return;
    let live = true;
    void loadApi().then((api) => {
      if (!live || !api || !container.isConnected) return;
      widget.current = api.render(container, {
        sitekey: siteKey,
        appearance: 'interaction-only',
        callback: (value: string) => settle(value),
        'expired-callback': () => { token.current = null; },
        'error-callback': () => settle(null),
      });
    });
    return () => {
      live = false;
      token.current = null;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey, container]);

  /** The current token, or the next one the widget produces, or null
      when there is no widget or it stays silent. */
  const getToken = useCallback((): Promise<string | null> => {
    if (!siteKey) return Promise.resolve(null);
    if (token.current) return Promise.resolve(token.current);
    return new Promise((resolve) => {
      const done = (value: string | null) => {
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        waiting.current = waiting.current.filter((w) => w !== done);
        resolve(null);
      }, TOKEN_WAIT_MS);
      waiting.current.push(done);
    });
  }, [siteKey]);

  /** Tokens are single-use: call after every request that carried one. */
  const reset = useCallback(() => {
    token.current = null;
    if (widget.current) window.turnstile?.reset(widget.current);
  }, []);

  return { enabled: Boolean(siteKey), attach, getToken, reset };
}
