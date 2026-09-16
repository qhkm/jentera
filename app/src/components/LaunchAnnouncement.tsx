import { useState } from 'react';
import { ArrowUpRight, Sparkle, X } from '@phosphor-icons/react';
import { Link } from 'react-router';
import { launchOffer } from '@/lib/launch-offer';
import '@/styles/launch-welcome.css';

/** Public launch information, never a payment or entitlement signal. */
export function LaunchAnnouncement() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return <aside className="launch-announcement" aria-label="Jentera launch announcement">
    <div className="launch-announcement__inner">
      <span className="launch-announcement__badge"><Sparkle size={14} aria-hidden="true" /> EARLY ACCESS</span>
      <p className="launch-announcement__copy">
        <span>RM{launchOffer.monthlyPrice}/month for your first {launchOffer.introductoryMonths} months, then RM{launchOffer.renewalPrice}/month.</span>
      </p>
      <Link className="launch-announcement__link" to="/#pricing" reloadDocument>
        View launch offer <ArrowUpRight size={14} aria-hidden="true" />
      </Link>
      <button className="launch-announcement__close" type="button"
        aria-label="Dismiss launch announcement" onClick={() => setDismissed(true)}>
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  </aside>;
}
