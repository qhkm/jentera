/* ============================================================
   Landing header and footer.

   Deliberately not the app Shell: the marketing page has its own
   anchor nav and no theme/language toggles, matching index.html.
   ============================================================ */

import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { FOOTER, NAV_LINKS } from '@/lib/landing-content';

interface MarketingLink {
  href: string;
  label: string;
}

function ActionLink({ href, className, children, onClick }: MarketingLink & {
  className: string;
  children?: React.ReactNode;
  onClick?: () => void;
}) {
  if (href.startsWith('/') && !href.includes('#')) {
    return (
      <Link to={href} className={className} onClick={onClick}>
        {children ?? href}
      </Link>
    );
  }

  return (
    <a href={href} className={className} onClick={onClick}>
      {children ?? href}
    </a>
  );
}

export function LandingHeader({
  navLinks = NAV_LINKS,
  primaryAction = { href: '/signin?mode=signup', label: 'Start now' },
  showSignIn = true,
}: {
  navLinks?: readonly MarketingLink[];
  primaryAction?: MarketingLink;
  showSignIn?: boolean;
} = {}) {
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
        <Link to="/" aria-label="Jentera home" className="flex items-center">
          <img
            src="/jentera-logo.jpg"
            alt="Jentera"
            width={160}
            height={67}
            className="h-9 w-auto rounded-lg bg-white object-contain md:h-10"
          />
        </Link>

        <nav className="hidden flex-row items-center justify-center gap-6 md:flex">
          {navLinks.map((l) => (
            <ActionLink
              key={l.href}
              href={l.href}
              label={l.label}
              className="nav-link text-sm normal-case tracking-normal"
            >
              {l.label}
            </ActionLink>
          ))}
        </nav>

        <div className="flex items-center justify-end gap-3">
          {/* The /signin route existed but nothing linked to it, so the
              only way in was to type the URL. A text link rather than a
              second .btn: two adjacent buttons would compete with the
              primary CTA, and .btn carries the shared control height. */}
          {showSignIn ? (
            <Link to="/signin" className="nav-link hidden text-sm normal-case tracking-normal md:inline-flex">
              Sign in
            </Link>
          ) : null}
          <ActionLink
            href={primaryAction.href}
            label={primaryAction.label}
            className="btn btn-primary hidden px-5 py-2 text-sm md:inline-flex"
          >
            {primaryAction.label}
          </ActionLink>
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
            {navLinks.map((l) => (
              <ActionLink
                key={l.href}
                href={l.href}
                label={l.label}
                onClick={() => setOpen(false)}
                className="nav-link py-3 text-sm normal-case tracking-normal"
              >
                {l.label}
              </ActionLink>
            ))}
            {showSignIn ? (
              <Link
                to="/signin"
                onClick={() => setOpen(false)}
                className="nav-link py-3 text-sm normal-case tracking-normal"
              >
                Sign in
              </Link>
            ) : null}
            <ActionLink
              href={primaryAction.href}
              label={primaryAction.label}
              onClick={() => setOpen(false)}
              className="btn btn-primary mt-3 w-full justify-center"
            >
              {primaryAction.label}
            </ActionLink>
          </nav>
        </div>
      ) : null}
    </header>
  );
}

export function LandingFooter({ tagline = FOOTER.tagline }: { tagline?: string } = {}) {
  return (
    <footer className="w-full border-t border-rail">
      <div className="mx-auto flex w-full max-w-[1250px] flex-col gap-6 px-6 py-10 md:flex-row md:items-center md:justify-between md:px-12">
        <div className="flex flex-col gap-2">
          <img
            src="/jentera-logo.jpg"
            alt="Jentera"
            width={120}
            height={50}
            className="h-7 w-auto rounded-md bg-white object-contain"
          />
          <p className="text-xs text-text-muted">{tagline}</p>
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
