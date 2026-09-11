import { useEffect } from 'react';
import { useNavigate } from 'react-router';

/**
 * Send a visitor who is already signed in from a public page to the app.
 *
 * The public pages sit outside the repository gate on purpose: first paint
 * must not wait on a cross-origin request. So the check runs after paint,
 * in the background, and only a 2xx from /api/me moves the visitor. A 401,
 * a network error, or the demo (no API configured) leave the page alone.
 */
export function useSignedInRedirect(to = '/app'): void {
  const navigate = useNavigate();
  useEffect(() => {
    const api = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
    if (!api) return;
    const controller = new AbortController();
    void fetch(`${api}/api/me`, { credentials: 'include', signal: controller.signal })
      .then((res) => {
        if (res.ok && !controller.signal.aborted) navigate(to, { replace: true });
      })
      .catch(() => {
        /* Signed out, offline, or unmounted: stay where we are. */
      });
    return () => controller.abort();
  }, [navigate, to]);
}
