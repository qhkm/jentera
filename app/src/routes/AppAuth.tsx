import { useEffect } from 'react';
import { Link } from 'react-router';
import { LandingFooter, LandingHeader } from '@/components/landing/LandingChrome';

/* Where the sign-in callback lands when the Jentera app did not take it —
 * the app is not installed, or Android could not verify the association and
 * opened the browser instead. The one-time code in the query string is not
 * usable here and expires by itself, but it should not sit in history or be
 * carried into a referrer, so the first thing this does is drop it. */
export default function AppAuth() {
  useEffect(() => {
    if (window.location.search) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  return <div className="marketing-page min-h-dvh bg-bg text-text">
    <LandingHeader />
    <main id="main-content" className="lp-container lp-section flex min-h-[60dvh] flex-col justify-center gap-5">
      <p className="lp-eyebrow">Sign-in</p>
      <h1 className="font-pixel text-4xl">Open the Jentera app to finish.</h1>
      <p className="text-text-secondary">
        This link is meant to be opened by the Jentera app on this device. If the app is
        installed, open it and sign in again from there. Nothing was signed in here.
      </p>
      <Link className="btn btn-primary self-start" to="/signin">Sign in on the web instead</Link>
    </main>
    <LandingFooter />
  </div>;
}
