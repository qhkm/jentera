import { Link } from 'react-router';
import { LandingFooter, LandingHeader } from '@/components/landing/LandingChrome';

export default function NotFound() {
  return <div className="marketing-page min-h-dvh bg-bg text-text">
    <LandingHeader />
    <main id="main-content" className="lp-container lp-section flex min-h-[60dvh] flex-col justify-center gap-5">
      <p className="lp-eyebrow">404 · Page not found</p>
      <h1 className="font-pixel text-4xl">This page isn’t here.</h1>
      <p className="text-text-secondary">The link may have changed. You can head back to Jentera from here.</p>
      <Link className="btn btn-primary self-start" to="/">Back to Jentera</Link>
    </main>
    <LandingFooter />
  </div>;
}
