/* ============================================================
   Landing header and footer.

   Deliberately not the app Shell: the marketing page has its own
   owner-focused navigation and no theme/language toggles.
   ============================================================ */

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, List, X } from '@phosphor-icons/react';
import { Link } from 'react-router';
import { FOOTER, NAV_LINKS } from '@/lib/landing-content';
import { JenteraMark } from '@/components/JenteraMark';

interface MarketingLink {
  href: string;
  label: string;
}

function ActionLink({
  href,
  className,
  children,
  onClick,
}: MarketingLink & {
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

/* Every string the header renders, so a page in another language can hand
   over its own set. A Malay page with an English "Sign in" and "Skip to
   content" reads as a translated copy of someone else's site, and the skip
   link and aria-labels are the part a screen reader announces first. */
export interface ChromeLabels {
  skip: string;
  signIn: string;
  menu: string;
  brand: string;
  nav: string;
  mobileNav: string;
  parent: string;
}

const CHROME_LABELS: ChromeLabels = {
  skip: 'Skip to content',
  signIn: 'Sign in',
  menu: 'Menu',
  brand: 'Jentera home',
  nav: 'Main navigation',
  mobileNav: 'Mobile navigation',
  parent: 'by AISAR',
};

export function LandingHeader({
  navLinks = NAV_LINKS,
  primaryAction = { href: '/signin?mode=signup', label: 'Get started' },
  showSignIn = true,
  labels: given,
}: {
  navLinks?: readonly MarketingLink[];
  primaryAction?: MarketingLink;
  showSignIn?: boolean;
  labels?: Partial<ChromeLabels>;
} = {}) {
  const labels = { ...CHROME_LABELS, ...given };
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header className="marketing-header sticky z-50">
      <a href="#main-content" className="marketing-skip-link">
        {labels.skip}
      </a>
      <div className="marketing-header-bar">
        <div className="marketing-brand">
          <Link
            to="/"
            aria-label={labels.brand}
            className="jentera-wordmark font-pixel text-2xl tracking-tight text-brand"
          >
            <JenteraMark size={32} />
            Jentera
          </Link>
          <a href="https://aisar.ai" className="marketing-parent">
            {labels.parent}
          </a>
        </div>

        <nav
          aria-label={labels.nav}
          className="hidden flex-row items-center justify-center gap-1 lg:flex"
        >
          {navLinks.map((l) => (
            <ActionLink key={l.href} href={l.href} label={l.label} className="marketing-nav-link">
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
            <Link to="/signin" className="marketing-nav-link hidden sm:inline-flex">
              {labels.signIn}
            </Link>
          ) : null}
          <ActionLink
            href={primaryAction.href}
            label={primaryAction.label}
            className="btn btn-primary hidden sm:inline-flex"
          >
            {primaryAction.label}
            <ArrowUpRight size={14} aria-hidden="true" />
          </ActionLink>
          <button
            type="button"
            ref={menuButton}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex size-11 items-center justify-center rounded-item border border-rail lg:hidden"
            aria-label={labels.menu}
            aria-expanded={open}
            aria-controls="landing-mobile-menu"
          >
            {open ? <X size={20} aria-hidden="true" /> : <List size={20} aria-hidden="true" />}
          </button>
        </div>
      </div>

      {open ? (
        <div id="landing-mobile-menu" className="border-t border-rail bg-bg lg:hidden">
          <nav
            aria-label={labels.mobileNav}
            className="mx-auto flex w-full max-w-[1250px] flex-col px-6 py-4"
          >
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
                {labels.signIn}
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

export function LandingFooter({
  tagline = FOOTER.tagline,
  links = FOOTER.links,
  label = 'Company links',
  brandLabel = CHROME_LABELS.brand,
  contactLabel = 'Let\u2019s talk \u2197',
}: {
  tagline?: string;
  links?: readonly MarketingLink[];
  label?: string;
  brandLabel?: string;
  contactLabel?: string;
} = {}) {
  return (
    <footer className="marketing-footer w-full border-t border-rail">
      <div className="lp-container">
        <div className="marketing-footer-top">
          <div className="flex flex-col gap-3">
            <Link
              to="/"
              aria-label={brandLabel}
              className="jentera-wordmark font-pixel text-2xl text-brand"
            >
              <JenteraMark size={36} />
              Jentera
            </Link>
            <p className="text-sm text-text-secondary">{tagline}</p>
          </div>
          <nav
            aria-label={label}
            className="flex flex-wrap items-center gap-6 text-sm text-text-secondary"
          >
            {links.map((l) => l.href.startsWith('/') ? (
              <Link key={l.href} className="transition-colors hover:text-text" to={l.href}>
                {l.label}
              </Link>
            ) : (
              <a
                key={l.href}
                className="transition-colors hover:text-text"
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {l.label}
              </a>
            ))}
          </nav>
        </div>
        <div className="marketing-footer-bottom">
          <p>
            {FOOTER.copyright} <span>{FOOTER.registration}</span>
          </p>
          <a href={`mailto:${FOOTER.email}`}>{contactLabel}</a>
        </div>
      </div>
    </footer>
  );
}
