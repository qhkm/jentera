import { useRegisterSW } from '@/pwa/register';

function ClientRegistration() {
  useRegisterSW({ onRegisterError() { /* No worker, no install; the page is unaffected. */ } });
  return null;
}

/** Registers the service worker on pages that show no update notice, so
    a browser judging installability finds one. Renders nothing, and
    nothing at all at build time. */
export function ServiceWorkerRegistration() {
  return typeof window === 'undefined' ? null : <ClientRegistration />;
}
