import { Sparkle } from '@phosphor-icons/react';
import { onboardingCopy } from '@/lib/onboarding-copy';
import '@/styles/launch-welcome.css';

/** Mount only after a server-backed sign-in, not after an opaque signup 202. */
export function AccountWelcome({ lang = 'en', setup = false }: {
  lang?: 'en' | 'bm'; setup?: boolean;
}) {
  const c = onboardingCopy[lang];
  return <section className="account-welcome" aria-label={c.welcomeTitle}>
    <span className="account-welcome__icon" aria-hidden="true"><Sparkle size={24} weight="duotone" /></span>
    <div>
      <span className="account-welcome__eyebrow">{c.welcomeEyebrow}</span>
      <strong className="account-welcome__title">{c.welcomeTitle}</strong>
      <p>{setup ? c.welcomeSetup : c.welcomeAccess}</p>
    </div>
  </section>;
}
