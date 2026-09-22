import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Check, List, X, Play, ShieldCheck, Sun, Moon, CalendarBlank, PaperPlaneTilt, Browser, Storefront, ForkKnife, FirstAid, Briefcase } from '@phosphor-icons/react';
import { launchOffer } from '@/lib/launch-offer';
import '@/styles/landing-v2.css';

const THEME_KEY = 'jentera-landing-v2-theme';
type Theme = 'light' | 'dark';

function initialTheme(): Theme {
  // This design preview intentionally has its own preference, not the app's theme.
  try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; }
  catch { return 'light'; }
}

const STAFF = [
  { name: 'General assistant', detail: 'Plan, research, follow up.', hue: 0 },
  { name: 'Sales', detail: 'Research leads. Prepare the next conversation.', hue: 45 },
  { name: 'Marketing', detail: 'Shape ideas, draft content and plan campaigns.', hue: -110 },
  { name: 'Support', detail: 'Prepare thoughtful replies for your review.', hue: 155 },
  { name: 'Operations', detail: 'Organise the details. Keep work moving.', hue: 85 },
  { name: 'Finance & records', detail: 'Review invoices and organise business records.', hue: -145 },
];

function Character({ hue = 0, className = '' }: { hue?: number; className?: string }) {
  return <img className={`lv2-character ${className}`} style={{ '--v2-hue': `${hue}deg` } as CSSProperties}
    src="/images/jentera-character-glossy-v1.webp" alt="" width={512} height={512} draggable={false} />;
}

function Brand() {
  return <Link className="lv2-brand" to="/landing-v2" aria-label="Jentera version 2 home">
    <Character /><span>Jentera<small>YOUR AI STAFF</small></span>
  </Link>;
}

export default function LandingV2() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  function toggleTheme() {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* Private browsing still supports this visit's toggle. */ }
  }
  return <div className="lv2" lang="en" data-theme={theme}>
    <a className="lv2-skip" href="#v2-main">Skip to content</a>
    <div className="lv2-comparison"><span>Design preview · Version 2</span><Link to="/">Compare with the original <ArrowRight size={14} /></Link></div>
    <header className="lv2-header lv2-wrap">
      <Brand />
      <nav className="lv2-nav" aria-label="Main navigation">
        <a href="#v2-product">Product</a><a href="#v2-team">Use cases</a><Link to="/pricing">Pricing</Link><a href="#v2-how">How it works</a>
      </nav>
      <div className="lv2-header-actions"><button type="button" className="lv2-theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>{theme === 'light' ? <Moon size={21} /> : <Sun size={21} />}</button><Link className="lv2-login" to="/signin">Log in</Link><Link className="lv2-button" to={launchOffer.href}>Get started <ArrowRight size={16} /></Link></div>
      <button type="button" className="lv2-menu-toggle" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} aria-controls="v2-mobile-menu" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={24} /> : <List size={24} />}</button>
    </header>
    {menuOpen && <nav id="v2-mobile-menu" className="lv2-mobile-menu" aria-label="Mobile navigation" onKeyDown={event => { if (event.key === 'Escape') { setMenuOpen(false); document.querySelector<HTMLButtonElement>('.lv2-menu-toggle')?.focus(); } }}>
      <a href="#v2-product" onClick={() => setMenuOpen(false)}>Product</a><a href="#v2-team" onClick={() => setMenuOpen(false)}>Use cases</a><Link to="/pricing">Pricing</Link><a href="#v2-how" onClick={() => setMenuOpen(false)}>How it works</a><Link to="/signin">Log in</Link>
    </nav>}

    <main id="v2-main">
      <section className="lv2-hero lv2-wrap" aria-labelledby="v2-title">
        <div className="lv2-hero-copy">
          <span className="lv2-pill"><span aria-hidden="true">🇲🇾</span> Built in Malaysia. For your business.</span>
          <h1 id="v2-title" lang="ms">Pass je kerja<br />dekat Jentera.</h1>
          <p>Your AI staff for the everyday work.<br />Give Jentera a task. It uses your connected tools, prepares the work, and brings you in when a decision is needed.</p>
          <div className="lv2-actions"><Link className="lv2-button" to={launchOffer.href}>Get started <ArrowRight size={18} /></Link><a className="lv2-button lv2-button-light" href="#v2-product"><Play size={16} weight="fill" />See it in action</a></div>
          <div className="lv2-reassurance"><span><Check size={15} />Your own business workspace</span><span><Check size={15} />You stay in control</span></div>
        </div>
        <div className="lv2-hero-art">
          <div className="lv2-halo" />
          <img className="lv2-hero-illustration" src="/images/jentera-landing-v2-hero-v1.webp" alt="Illustration of Jentera’s smiling green character helping prepare work on a laptop." width={1536} height={1024} fetchPriority="high" />
          <span className="lv2-art-caption">A little help. A lot less busywork. <span>Illustrative product concept</span></span>
        </div>
      </section>

      <div className="lv2-industries lv2-wrap" aria-label="Business examples"><span>Everyday work.<br /><strong>All kinds of businesses.</strong></span>{[[Storefront, 'Retail'], [ForkKnife, 'F&B'], [FirstAid, 'Clinics'], [Briefcase, 'Services']].map(([Icon, label]) => {
        const IndustryIcon = Icon as typeof Storefront;
        return <span key={String(label)}><IndustryIcon size={22} weight="duotone" />{String(label)}</span>;
      })}</div>

      <section className="lv2-section lv2-wrap" id="v2-team" aria-labelledby="v2-team-title">
        <div className="lv2-section-heading"><span className="lv2-pill">Different skills. Same team.</span><h2 id="v2-team-title">A familiar face for every kind of work.</h2><p>Start with Jentera. Add a specialist when you need one.<br />Your bots share one dedicated business workspace—not six separate computers.</p></div>
        <div className="lv2-staff">{STAFF.map(staff => <article key={staff.name}><Character hue={staff.hue} /><h3>{staff.name}</h3><p>{staff.detail}</p></article>)}</div>
        <p className="lv2-footnote">Example roles you can configure. Adding a bot doesn’t automatically connect apps or grant permissions.</p>
      </section>

      <section className="lv2-section lv2-tools-section" aria-labelledby="v2-tools-title"><div className="lv2-wrap">
        <div className="lv2-section-heading"><span className="lv2-pill">Fits the way you work</span><h2 id="v2-tools-title">Your business. Your everyday tools.</h2><p>Connect supported apps or use Jentera’s business browser.<br />No need to move everything into another system.</p></div>
        <div className="lv2-tools">
          <Link to="/connect/telegram"><span className="lv2-tool-icon lv2-blue"><PaperPlaneTilt size={30} weight="fill" /></span><strong>Telegram</strong><small>Private owner chat</small></Link>
          <Link to="/connect/bukku"><span className="lv2-tool-icon lv2-teal">B</span><strong>Bukku</strong><small>Read invoices & contacts</small></Link>
          <Link to="/connect/google-calendar"><span className="lv2-tool-icon lv2-lilac"><CalendarBlank size={30} /></span><strong>Google Calendar</strong><small>Pilot · approval-based</small></Link>
          <a href="#v2-product"><span className="lv2-tool-icon lv2-peach"><Browser size={30} /></span><strong>Business browser</strong><small>Website access varies</small></a>
        </div><Link className="lv2-text-link" to="/connect">Explore supported connections <ArrowRight size={16} /></Link>
      </div></section>

      <section className="lv2-how" id="v2-how" aria-labelledby="v2-how-title"><div className="lv2-wrap lv2-how-grid">
        <div><span className="lv2-pill">One task is a good start.</span><h2 id="v2-how-title">Less setup.<br />More getting things done.</h2><p>No server to manage. No agent framework to learn. Just tell Jentera what needs doing.</p><Link className="lv2-button" to={launchOffer.href}>Get started <ArrowRight size={16} /></Link></div>
        <article><span className="lv2-step">1</span><h3>Introduce your business</h3><p>Share your website, a document, or a few words. Check what Jentera learns.</p><div className="lv2-step-art"><Character /><span>“Here’s what we do…”</span></div></article>
        <article><span className="lv2-step">2</span><h3>Connect what you need</h3><p>Choose supported tools. Keep control of your accounts and permissions.</p><div className="lv2-step-icons" aria-hidden="true"><PaperPlaneTilt /><CalendarBlank /><ShieldCheck /></div></article>
        <article><span className="lv2-step">3</span><h3>Hand over a real task</h3><p>Ask in plain language. Follow the work, review decisions, and open the result.</p><blockquote>“Compare these three supplier quotes.”<ArrowRight size={18} /></blockquote></article>
      </div></section>

      <section className="lv2-section lv2-wrap lv2-product" id="v2-product" aria-labelledby="v2-product-title">
        <div><span className="lv2-pill">See the work, not just the answer</span><h2 id="v2-product-title">A result you can actually use.</h2><p>A comparison to review. A file to download. A clear record of what happened.</p><p>You can inspect the result and decide what happens next. Important decisions stay with you.</p><span className="lv2-demo-label">Illustrated concept · fictional example, not a customer result</span><Link className="lv2-text-link" to="/onboard">Give Jentera your first task <ArrowRight size={16} /></Link></div>
        <figure><img src="/images/jentera-landing-v2-result-v1.webp" alt="Illustration of Jentera presenting a supplier comparison ready for your review." width={1536} height={1024} loading="lazy" /><figcaption>From three supplier quotes to one useful comparison.</figcaption></figure>
      </section>

      <section className="lv2-closing lv2-wrap" aria-labelledby="v2-closing-title"><Character /><div><span className="lv2-pill">Your next pair of helping hands</span><h2 id="v2-closing-title">Let’s clear something<br />off your plate.</h2><p>Start with one job. See what Jentera can do for your business.</p><small>Launch plan: RM{launchOffer.monthlyPrice}/month for {launchOffer.introductoryMonths} months, then RM{launchOffer.renewalPrice}/month.</small></div><div className="lv2-closing-action"><Link className="lv2-button" to={launchOffer.href}>Get started <ArrowRight size={18} /></Link><Link to="/pricing">See pricing & usage limits</Link></div></section>
    </main>
    <footer className="lv2-footer lv2-wrap"><Brand /><nav aria-label="Footer navigation"><Link to="/about">About</Link><Link to="/pricing">Pricing</Link><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link></nav><span>Built in Malaysia <span aria-hidden="true">🇲🇾</span></span><div className="lv2-footer-bottom"><small>© {new Date().getFullYear()} Jentera by AISAR.</small><Link to="/">View original landing page ↗</Link></div></footer>
  </div>;
}
