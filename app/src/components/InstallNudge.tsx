import { useEffect, useState } from 'react';
import { DeviceMobile } from '@phosphor-icons/react';
import { Button } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { useSignedIn } from '@/lib/repo/gate';
import { usePwaInstall } from '@/pwa/install';

/** When the owner last said "not now"; the nudge stays quiet for a month. */
export const INSTALL_NUDGE_KEY = 'jentera-install-nudge-v1';
const QUIET_MS = 30 * 24 * 60 * 60 * 1000;
/* Not on first paint: an owner who just arrived is reading, not deciding. */
const DEFAULT_DELAY_MS = 6_000;

function dismissedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(INSTALL_NUDGE_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < QUIET_MS;
  } catch {
    return false;
  }
}

/**
 * The visible invitation to install, for signed-in owners on a browser
 * that can. Chromium gets its own install sheet from the Install button;
 * an iPhone gets the Share → Add to Home Screen instructions, because no
 * browser there ever prompts. Gone once the app runs from the home screen.
 */
export function InstallNudge({ delayMs = DEFAULT_DELAY_MS }: { delayMs?: number }) {
  const { t } = useI18n();
  const signedIn = useSignedIn();
  const install = usePwaInstall();
  const [settled, setSettled] = useState(delayMs === 0);
  const [dismissed, setDismissed] = useState(dismissedRecently);

  useEffect(() => {
    if (settled) return;
    const timer = window.setTimeout(() => setSettled(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, settled]);

  const eligible = signedIn && settled && !dismissed && !install.standalone && (install.canPrompt || install.iosHint);
  if (!eligible) return null;

  function dismiss() {
    try {
      localStorage.setItem(INSTALL_NUDGE_KEY, String(Date.now()));
    } catch {
      /* Private mode: it comes back next visit, which is acceptable. */
    }
    setDismissed(true);
  }

  async function installNow() {
    const outcome = await install.promptInstall();
    /* Declining the browser's sheet counts as "not now" too. */
    if (outcome === 'dismissed') dismiss();
  }

  return (
    <div className="mx-auto max-w-[1250px] px-4 pt-4 lg:px-6">
      <section
        className="card flex-row flex-wrap items-center gap-3 px-4 py-3"
        aria-label={t('pwa.nudge.title')}
      >
        <DeviceMobile size={22} weight="duotone" aria-hidden="true" className="shrink-0 text-brand" />
        <div className="min-w-0 flex-1">
          <strong className="block text-[14px]">{t('pwa.nudge.title')}</strong>
          <p className="m-0 text-[13px] text-text-secondary">
            {install.canPrompt ? t('pwa.nudge.body') : t('pwa.nudge.ios')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {install.canPrompt ? (
            <>
              <Button onClick={() => void installNow()}>{t('pwa.nudge.install')}</Button>
              <Button variant="outline" onClick={dismiss}>{t('pwa.nudge.later')}</Button>
            </>
          ) : (
            <Button variant="outline" onClick={dismiss}>{t('pwa.nudge.gotIt')}</Button>
          )}
        </div>
      </section>
    </div>
  );
}
