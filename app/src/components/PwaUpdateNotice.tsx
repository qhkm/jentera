import { ArrowsClockwise } from '@phosphor-icons/react';
import { useEffect, useRef } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { useRegisterSW } from '@/pwa/register';
import { startUpdateChecks } from '@/pwa/update-checks';
import { isNative } from '@/lib/native';

/** Registers the service worker and, when a newer Jentera has been fetched
    in the background, offers a reload instead of forcing one mid-reply.
    Between launches it keeps looking: on every return to the foreground
    and once an hour while open. */
function WebPwaUpdateNotice() {
  const { t } = useI18n();
  const stopChecks = useRef<(() => void) | null>(null);
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      stopChecks.current?.();
      stopChecks.current = registration ? startUpdateChecks(registration) : null;
    },
    onRegisterError() { /* No worker, no install; the app is unaffected. */ },
  });
  useEffect(() => () => stopChecks.current?.(), []);
  if (!needRefresh) return null;
  return (
    <div
      role="status"
      className="card fixed bottom-20 left-1/2 z-[998] w-[min(92vw,420px)] -translate-x-1/2 flex-row flex-wrap items-center gap-3 px-4 py-3 shadow-lg"
    >
      <ArrowsClockwise size={18} weight="duotone" aria-hidden="true" className="text-brand" />
      <span className="min-w-0 flex-1 text-[13px]">{t('pwa.update')}</span>
      <button type="button" className="btn" onClick={() => void updateServiceWorker(true)}>
        {t('pwa.reload')}
      </button>
      <button type="button" className="nav-link text-sm normal-case tracking-normal" onClick={() => setNeedRefresh(false)}>
        {t('pwa.later')}
      </button>
    </div>
  );
}

/** A Capacitor binary is updated through its store version gate, never by a
    web service worker that could leave its frozen bundle in a split state. */
export function PwaUpdateNotice() {
  return isNative() ? null : <WebPwaUpdateNotice />;
}
