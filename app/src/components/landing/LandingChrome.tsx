/* ============================================================
   Landing header and footer.

   Deliberately not the app Shell: the marketing page has its own
   anchor nav and no theme/language toggles, matching index.html.
   ============================================================ */

import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { FOOTER, NAV_LINKS } from '@/lib/landing-content';

export function LandingHeader() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-rail bg-bg/80 backdrop-blur-lg">
      <div className="mx-auto flex h-16 w-full max-w-[1250px] items-center justify-between px-6">
        <Link to="/" aria-label="Jentera home">
          <span className="font-pixel font-pixel-logo text-xl tracking-wide text-brand md:text-2xl">
            Jentera
          </span>
        </Link>

        <nav className="hidden flex-row items-center justify-center gap-6 md:flex">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="nav-link text-sm normal-case tracking-normal"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center justify-end gap-3">
          {/* The /signin route existed but nothing linked to it, so the
              only way in was to type the URL. A text link rather than a
              second .btn: two adjacent buttons would compete with the
              primary CTA, and .btn carries the shared control height. */}
          <Link to="/signin" className="nav-link hidden text-sm normal-case tracking-normal md:inline-flex">
            Sign in
          </Link>
          <Link to="/onboard" className="btn btn-primary hidden px-5 py-2 text-sm md:inline-flex">
            Start now
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex size-10 items-center justify-center rounded-item border border-rail md:hidden"
            aria-label="Menu"
            aria-expanded={open}
            aria-controls="landing-mobile-menu"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
              <path d="M3 6h14M3 10h14M3 14h14" />
            </svg>
          </button>
        </div>
      </div>

      {open ? (
        <div id="landing-mobile-menu" className="border-b border-rail bg-bg md:hidden">
          <nav className="mx-auto flex w-full max-w-[1250px] flex-col px-6 py-4">
            {NAV_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="nav-link py-3 text-sm normal-case tracking-normal"
              >
                {l.label}
              </a>
            ))}
            <Link
              to="/signin"
              onClick={() => setOpen(false)}
              className="nav-link py-3 text-sm normal-case tracking-normal"
            >
              Sign in
            </Link>
            <Link
              to="/onboard"
              onClick={() => setOpen(false)}
              className="btn btn-primary mt-3 w-full justify-center"
            >
              Start now
            </Link>
          </nav>
        </div>
      ) : null}
    </header>
  );
}

export function LandingFooter() {
  return (
    <footer className="w-full border-t border-rail">
      <div className="mx-auto flex w-full max-w-[1250px] flex-col gap-6 px-6 py-10 md:flex-row md:items-center md:justify-between md:px-12">
        <div className="flex flex-col gap-2">
          <span className="font-pixel text-lg tracking-wide text-brand">Jentera</span>
          <p className="text-xs text-text-muted">{FOOTER.tagline}</p>
        </div>
        <div className="flex flex-col gap-3 text-xs text-text-muted md:items-end">
          <a className="transition-colors hover:text-text" href={`mailto:${FOOTER.email}`}>
            {FOOTER.email}
          </a>
          <div className="flex items-center gap-4">
            {FOOTER.links.map((l) => (
              <a
                key={l.href}
                className="transition-colors hover:text-text"
                href={l.href}
                target="_blank"
                rel="noopener"
              >
                {l.label}
              </a>
            ))}
          </div>
          <p>{FOOTER.copyright}</p>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted/60">
            {FOOTER.registration}
          </p>
        </div>
      </div>
    </footer>
  );
}
