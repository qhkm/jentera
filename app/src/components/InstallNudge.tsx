import { useEffect, useState, type ReactNode } from 'react';
import { DeviceMobile } from '@phosphor-icons/react';
import { Button } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { useSignedIn } from '@/lib/repo/gate';
import { usePwaInstall } from '@/pwa/install';

/** When the owner last said "not now"; every nudge stays quiet for a month. */
export const INSTALL_NUDGE_KEY = 'jentera-install-nudge-v1';
const QUIET_MS = 30 * 24 * 60 * 60 * 1000;
/* Not on first paint: someone who just arrived is reading, not deciding. */
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
 * Whether to show an install invitation right now, and the two moves.
 * `mode` is 'prompt' where the browser will show its own install sheet and
 * 'ios' on an iPhone, where no browser ever prompts and the Share steps
 * are the only path. Gone once the app runs from the home screen.
 */
export function useInstallNudge({ delayMs = DEFAULT_DELAY_MS, requireSignedIn = false } = {}) {
  const signedIn = useSignedIn();
  const install = usePwaInstall();
  const [settled, setSettled] = useState(delayMs === 0);
  const [dismissed, setDismissed] = useState(dismissedRecently);

  useEffect(() => {
    if (settled) return;
    const timer = window.setTimeout(() => setSettled(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, settled]);

  const mode = install.canPrompt ? 'prompt' as const : install.iosHint ? 'ios' as const : null;
  const visible = settled && !dismissed && !install.standalone && mode !== null && (signedIn || !requireSignedIn);

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

  return { visible, mode, installNow, dismiss };
}

export interface InstallNudgeCopy {
  title: string;
  body: string;
  iosBody: string;
  install: string;
  later: string;
  gotIt: string;
}

export function InstallNudgeCard({ copy, mode, onInstall, onDismiss, className = '' }: {
  copy: InstallNudgeCopy;
  mode: 'prompt' | 'ios';
  onInstall: () => void;
  onDismiss: () => void;
  className?: string;
}): ReactNode {
  return (
    <section className={`card flex-row flex-wrap items-center gap-3 px-4 py-3 ${className}`} aria-label={copy.title}>
      <DeviceMobile size={22} weight="duotone" aria-hidden="true" className="shrink-0 text-brand" />
      <div className="min-w-0 flex-1">
        <strong className="block text-[14px]">{copy.title}</strong>
        <p className="m-0 text-[13px] text-text-secondary">{mode === 'prompt' ? copy.body : copy.iosBody}</p>
      </div>
      <div className="flex items-center gap-2">
        {mode === 'prompt' ? (
          <>
            <Button onClick={onInstall}>{copy.install}</Button>
            <Button variant="outline" onClick={onDismiss}>{copy.later}</Button>
          </>
        ) : (
          <Button variant="outline" onClick={onDismiss}>{copy.gotIt}</Button>
        )}
      </div>
    </section>
  );
}

/** The workspace's invitation, under the header, for signed-in owners. */
export function InstallNudge({ delayMs = DEFAULT_DELAY_MS }: { delayMs?: number }) {
  const { t } = useI18n();
  const nudge = useInstallNudge({ delayMs, requireSignedIn: true });
  if (!nudge.visible || !nudge.mode) return null;
  return (
    <div className="mx-auto max-w-[1250px] px-4 pt-4 lg:px-6">
      <InstallNudgeCard
        mode={nudge.mode}
        onInstall={() => void nudge.installNow()}
        onDismiss={nudge.dismiss}
        copy={{
          title: t('pwa.nudge.title'),
          body: t('pwa.nudge.body'),
          iosBody: t('pwa.nudge.ios'),
          install: t('pwa.nudge.install'),
          later: t('pwa.nudge.later'),
          gotIt: t('pwa.nudge.gotIt'),
        }}
      />
    </div>
  );
}

/* The landing page is English-only and renders without the app's
   providers (it is prerendered at build time), so this copy is plain. */
const VISITOR_COPY: InstallNudgeCopy = {
  title: 'Get Jentera on your phone',
  body: 'Install the app for one-tap access and notifications when Jentera finishes something for you.',
  iosBody: 'In Safari, tap Share, then Add to Home Screen. Notifications work once it is installed.',
  install: 'Install',
  later: 'Not now',
  gotIt: 'Got it',
};

/** The marketing page's invitation: floats at the bottom, for anyone. */
export function LandingInstallNudge({ delayMs = DEFAULT_DELAY_MS }: { delayMs?: number }) {
  const nudge = useInstallNudge({ delayMs });
  if (!nudge.visible || !nudge.mode) return null;
  return (
    <div className="fixed inset-x-4 bottom-4 z-40 sm:left-auto sm:right-6 sm:max-w-md">
      <InstallNudgeCard
        mode={nudge.mode}
        onInstall={() => void nudge.installNow()}
        onDismiss={nudge.dismiss}
        copy={VISITOR_COPY}
        className="shadow-lg"
      />
    </div>
  );
}
