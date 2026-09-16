import { useEffect, useState } from 'react';
import { ArrowUpRight, WhatsappLogo } from '@phosphor-icons/react';
import { useI18n } from '@/i18n/I18nProvider';
import { useRepository } from '@/lib/repo';
import { parseFounderGroup } from '@/lib/founder-group';
import { onboardingCopy } from '@/lib/onboarding-copy';

/** No stored URL, automatic navigation, group join or sharing of business data. */
export function FounderGroupInvite() {
  const repo = useRepository(); const { lang } = useI18n(); const c = onboardingCopy[lang];
  const [group, setGroup] = useState<{ url: string } | null>(null);
  useEffect(() => {
    let live = true;
    setGroup(null);
    void repo.founderGroup?.().then(value => { if (live) setGroup(parseFounderGroup(value)); }).catch(() => {
      // Optional support must never block onboarding or pretend eligibility.
      if (live) setGroup(null);
    });
    return () => { live = false; };
  }, [repo]);
  if (!group) return null;
  return <aside className="founder-group-invite" aria-label={c.groupTitle}>
    <WhatsappLogo size={28} aria-hidden="true" />
    <div><h2>{c.groupTitle}</h2><p>{c.groupIntro}</p><small>{c.groupPrivacy}</small></div>
    <a className="btn btn-outline" href={group.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{c.groupJoin}<ArrowUpRight size={16} aria-hidden="true" /></a>
  </aside>;
}
