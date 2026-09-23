import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, ArrowUpRight, List, X, Play, PaperPlaneTilt, CalendarBlank, Browser, Check, Clock, FileText } from '@phosphor-icons/react';
import { launchOffer, launchPlanBenefits } from '@/lib/launch-offer';
import { JenteraMark } from '@/components/JenteraMark';
import '@/styles/landing-v3.css';

const STAFF = [
  { name: 'General assistant', detail: 'Research, plan, and follow up.' },
  { name: 'Sales', detail: 'Research leads and prepare outreach.' },
  { name: 'Marketing', detail: 'Draft content and plan campaigns.' },
  { name: 'Support', detail: 'Prepare replies for your review.' },
  { name: 'Operations', detail: 'Organise the details of your day.' },
  { name: 'Finance', detail: 'Review invoices and business records.' },
];

const APP_LOGOS = [
  { name: 'WhatsApp', file: 'whatsapp.svg' },
  { name: 'Email', file: 'gmail.svg' },
  { name: 'TikTok', file: 'tiktok.svg' },
  { name: 'Shopee', file: 'shopee.svg' },
  { name: 'Lazada', file: 'lazada.png' },
  { name: 'Bukku', file: 'bukku.png' },
  { name: 'MyInvois', file: 'myinvois.png' },
  { name: 'Excel', file: 'excel.svg' },
  { name: 'Slack', file: 'slack.svg' },
];

function Mascot() {
  return <img src="/images/jentera-character-glossy-v1.webp" alt="" className="lv3-mascot" width={512} height={512} />;
}

export default function LandingV3() {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  return <div className="lv3" lang="en">
    <a href="#lv3-main" className="lv3-skip">Skip to content</a>
    <header className="lv3-header lv3-wrap">
      <Link className="lv3-brand lv3-original-brand" to="/" aria-label="Jentera home"><JenteraMark size={36} /><span>Jentera</span></Link>
      <nav className="lv3-nav" aria-label="Main navigation"><a href="#lv3-product">Product</a><a href="#lv3-team">Use cases</a><a href="#lv3-how">How it works</a><a href="#lv3-pricing">Pricing</a></nav>
      <div className="lv3-header-actions"><Link className="lv3-login" to="/signin">Log in</Link><Link className="lv3-button" to={launchOffer.href}>Get started <ArrowRight size={15} /></Link></div>
      <button className="lv3-menu-button" ref={menuButton} type="button" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} aria-controls="lv3-mobile-menu" onClick={() => setMenuOpen(value => !value)}>{menuOpen ? <X size={24} /> : <List size={24} />}</button>
    </header>
    {menuOpen && <nav className="lv3-mobile-menu" id="lv3-mobile-menu" aria-label="Mobile navigation" onClick={() => setMenuOpen(false)} onKeyDown={event => { if (event.key === 'Escape') { setMenuOpen(false); menuButton.current?.focus(); } }}><a href="#lv3-product">Product</a><a href="#lv3-team">Use cases</a><a href="#lv3-how">How it works</a><a href="#lv3-pricing">Pricing</a><Link to="/signin">Log in</Link></nav>}
    <main id="lv3-main">
      <section className="lv3-hero" aria-labelledby="lv3-title">
        <div className="lv3-hero-copy lv3-wrap">
          <Link className="lv3-launch-pill" to="/blog/meet-jentera"><img className="lv3-brand-emoji" src="/images/jentera-character-glossy-v1.webp" alt="" width={28} height={28} /><strong>Jentera is here</strong><span aria-hidden="true">·</span><span>Read the launch post</span><span className="lv3-launch-pill-icon" aria-hidden="true"><ArrowUpRight size={14} weight="bold" /></span></Link>
          <h1 id="lv3-title">Your AI staff,<br className="lv3-mobile-break" /> ready for work.</h1>
          <p>Give Jentera real work to do. It uses your business workspace and connected tools,<br className="lv3-desktop-break" /> prepares the work, and brings it back for your review.</p>
          <div className="lv3-actions"><Link className="lv3-button" to={launchOffer.href}>Get started <ArrowRight size={18} /></Link><a className="lv3-button lv3-button-secondary" href="#lv3-how"><Play size={16} weight="fill" />See how it works</a></div>
          <p className="lv3-yc-note"><span className="lv3-yc-mark" aria-hidden="true">Y</span><span>Not backed by Y Combinator. Yet.</span></p>
        </div>
        <figure className="lv3-scene">
          <img src="/images/jentera-landing-v3-background-v1.webp" width={1536} height={1024} fetchPriority="high" alt="Illustrated Jentera workspace with a smiling emerald character, a supplier comparison and floating tool icons." />
          <span className="lv3-handnote" aria-hidden="true">A little help.<br />A lot less busywork.</span>
          <figcaption>Illustrative workspace concept</figcaption>
        </figure>
        <section className="lv3-team lv3-wrap" id="lv3-team" aria-labelledby="lv3-team-title">
          <div className="lv3-team-intro"><h2 id="lv3-team-title">Meet your AI staff</h2><p>One team. Different jobs.</p></div>
          <div className="lv3-team-grid">{STAFF.map((staff, index) => <a href="#lv3-how" key={staff.name} className="lv3-staff"><div className="lv3-staff-avatar" aria-hidden="true" style={{ backgroundPosition: `${(index % 3) * 50}% ${Math.floor(index / 3) * 100}%` }} /><h3>{staff.name}</h3><span>{staff.detail}</span></a>)}</div>
        </section>
        <p className="lv3-team-note">Roles you can configure, sharing one dedicated business workspace.</p>
      </section>
      <section className="lv3-teammate lv3-wrap" aria-labelledby="lv3-teammate-title">
        <div className="lv3-teammate-copy"><span className="lv3-eyebrow">JUST START A CONVERSATION</span><h2 id="lv3-teammate-title">Talk to Jentera<br />like a teammate.</h2><p>Give it a task in your own words, from your computer or phone. Share the context, add your files, and follow the work in chat. Jentera brings the result back for your review and asks when it needs your input.</p><Link className="lv3-text-action" to={launchOffer.href}>Start a conversation <ArrowRight size={18} /></Link></div>
        <div className="lv3-teammate-art" aria-hidden="true"><Mascot /></div>
      </section>
      <section className="lv3-capabilities lv3-wrap" id="lv3-product" aria-labelledby="lv3-capabilities-title">
        <div className="lv3-capabilities-heading"><span className="lv3-eyebrow">MORE WAYS TO GET WORK DONE</span><h2 id="lv3-capabilities-title">Different jobs.<br />One business workspace.</h2><p>Start with Jentera and add a specialist when you need one. Keep your tasks, business context, and results together as the work grows.</p></div>
        <div className="lv3-capability-grid">
          <article className="lv3-capability-card"><h3>A computer for your business</h3><p>Open Jentera’s private computer to sign in to your tools. Take control when you need to, then hand the computer back to continue the task.</p><div className="lv3-feature-preview lv3-browser-preview" aria-label="Illustrative business computer preview"><div className="lv3-preview-title"><Browser size={17} /><span>Jentera’s computer</span><span className="lv3-preview-chip">You’re in control</span></div><div className="lv3-browser-window"><div className="lv3-browser-chrome"><i /><i /><i /><span>Your business workspace</span></div><div className="lv3-browser-content"><div className="lv3-browser-sidebar"><JenteraMark size={25} /><i /><i /><i /></div><div className="lv3-browser-document"><span>Supplier comparison</span><div><i /><i /><i /></div><div><i /><i /><i /></div><div><i /><i /><i /></div><span className="lv3-document-ready"><Check size={14} />Ready for review</span></div></div></div></div></article>
          <article className="lv3-capability-card"><h3>Give repeat work a routine</h3><p>Set up recurring work with a clear schedule. See the next run, check the latest result, and pause a routine when plans change.</p><div className="lv3-feature-preview lv3-routine-preview" aria-label="Illustrative routine preview"><div className="lv3-preview-title"><CalendarBlank size={18} /><span>Weekly business summary</span><span className="lv3-preview-chip">Scheduled</span></div><div className="lv3-week-days" aria-hidden="true">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => <span key={index} className={index === 4 ? 'lv3-day-selected' : ''}>{day}</span>)}</div><div className="lv3-preview-row"><Clock size={17} /><span>Every Friday · 9:00 am</span></div><div className="lv3-preview-row"><FileText size={17} /><span>Latest result ready to open</span><Check size={16} /></div></div></article>
          <article className="lv3-capability-card"><h3>Keep your business context close</h3><p>Share the details that shape your work. Review what Jentera knows about your business and update it as things change.</p><div className="lv3-feature-preview lv3-context-preview" aria-label="Illustrative business context conversation"><div className="lv3-context-bubble">Use a friendly tone, and include our opening hours in the draft.</div><div className="lv3-context-answer"><JenteraMark size={28} /><span>I’ll use those details in the reply.<small>Your business context, ready for the next task.</small></span></div><div className="lv3-context-tags"><span>Business details</span><span>Tone of voice</span><span>Opening hours</span></div></div></article>
          <article className="lv3-capability-card"><h3>A bot for each kind of work</h3><p>Choose a default assistant and add bots with different instructions and skills. Give each a focus while keeping them in the same business workspace.</p><div className="lv3-feature-preview lv3-specialist-preview" aria-label="Illustrative specialist bot roles"><div className="lv3-role-lineup">{[{index:1,name:'Sales',task:'Research leads'},{index:2,name:'Marketing',task:'Draft content'},{index:5,name:'Finance',task:'Review invoices'}].map(role => <div key={role.name}><div className="lv3-staff-avatar" aria-hidden="true" style={{backgroundPosition:`${(role.index % 3) * 50}% ${Math.floor(role.index / 3) * 100}%`}} /><strong>{role.name}</strong><span>{role.task}</span></div>)}</div><div className="lv3-shared-workspace"><span /><span>One shared business workspace</span><span /></div></div></article>
        </div>
        <p className="lv3-capabilities-note">Illustrative previews with example tasks.</p>
      </section>
      <section className="lv3-tools lv3-wrap" id="lv3-tools" aria-labelledby="lv3-tools-title">
        <span className="lv3-badge">Made for Malaysian businesses</span>
        <h2 id="lv3-tools-title">Works with your everyday tools</h2>
        <p>Your everyday apps, files, and browser-based work—all part of the conversation.</p>
        <div className="lv3-tool-grid lv3-brand-grid">
          {APP_LOGOS.map(app => <div className="lv3-brand-item" key={app.name}><span className={`lv3-brand-tile lv3-brand-${app.name.toLowerCase()}`}><img src={`/images/brands/${app.file}`} alt="" width={44} height={44} loading="lazy" /></span><strong>{app.name}</strong></div>)}
        </div>
        <p className="lv3-app-note">App examples. Direct connections and browser access vary by service. <Link to="/connect">See available connections <ArrowRight size={13} /></Link></p>
      </section>
      <section className="lv3-how-band" id="lv3-how" aria-labelledby="lv3-how-title"><div className="lv3-start-grid lv3-wrap">
        <div className="lv3-start-intro"><span className="lv3-badge">Simple as 1, 2, 3</span><h2 id="lv3-how-title">Your AI staff.<br />A few steps away.</h2><p>No server to manage. No technical setup to learn. Start with your business and a job to do.</p><Link className="lv3-button" to={launchOffer.href}>Get started <ArrowRight size={18} /></Link></div>
        <article className="lv3-start-card"><span className="lv3-step-number">1</span><h3>Make Jentera yours</h3><p>Introduce your business. Pick your default bot, or add a specialist for a different kind of work.</p><div className="lv3-mini-team" aria-hidden="true">{[0, 4, 5].map(index => <div key={index} className="lv3-staff-avatar" style={{ backgroundPosition: `${(index % 3) * 50}% ${Math.floor(index / 3) * 100}%` }} />)}</div></article>
        <article className="lv3-start-card"><span className="lv3-step-number">2</span><h3>Connect your tools</h3><p>Choose supported apps and permissions. Bring your everyday work into your business workspace.</p><div className="lv3-mini-tools" aria-hidden="true"><span className="lv3-tool-tile lv3-tool-blue"><PaperPlaneTilt weight="fill" /></span><span className="lv3-tool-tile lv3-tool-mint">B</span><span className="lv3-tool-tile lv3-tool-purple"><CalendarBlank /></span></div></article>
        <article className="lv3-start-card"><span className="lv3-step-number">3</span><h3>Give it a task</h3><p>Describe what you need. Follow the work, review the result, and decide what happens next.</p><div className="lv3-task-example"><span>Compare these three supplier quotes.</span><ArrowRight size={18} aria-hidden="true" /></div></article>
      </div></section>
      <section className="lv3-pricing lv3-wrap" id="lv3-pricing" aria-labelledby="lv3-pricing-title">
        <div className="lv3-pricing-heading"><span className="lv3-eyebrow">SIMPLE PRICING</span><h2 id="lv3-pricing-title">Start with one clear plan.</h2><p>Your AI staff, its own computer, and day-to-day AI usage in one monthly plan.</p></div>
        <div className="lv3-pricing-card">
          <div className="lv3-pricing-offer"><span className="lv3-badge">Early-user launch offer</span><div className="lv3-price"><strong>RM{launchOffer.monthlyPrice}</strong><span>/month</span></div><p>For your first {launchOffer.introductoryMonths} monthly billing periods.<br />Then RM{launchOffer.renewalPrice}/month from month 4.</p><div className="lv3-pricing-actions"><Link className="lv3-button" to={launchOffer.href}>{launchOffer.cta}<ArrowRight size={18} /></Link><Link className="lv3-pricing-details" to="/pricing">See full pricing and usage limits <ArrowUpRight size={15} /></Link></div></div>
          <div className="lv3-pricing-includes"><span>What’s included</span><ul>{launchPlanBenefits.map(benefit => <li key={benefit}><Check size={17} weight="bold" aria-hidden="true" /><span>{benefit}</span></li>)}</ul></div>
          <p className="lv3-pricing-terms">{launchOffer.terms}</p>
        </div>
      </section>
      <section className="lv3-story lv3-wrap" aria-labelledby="lv3-story-title"><div className="lv3-story-art"><Mascot /></div><div><span className="lv3-eyebrow">A LITTLE HELP, EVERY DAY</span><h2 id="lv3-story-title">Less busywork.<br />More of what matters.</h2><p>Give Jentera the research, the first draft, and the details to organise. Keep your time for your customers, your ideas, and the decisions only you can make.</p><div className="lv3-story-actions"><span className="lv3-story-signature">Your next pair of helping hands.</span><Link className="lv3-button" to={launchOffer.href}>Get started <ArrowRight size={18} /></Link></div></div><span className="lv3-story-note" aria-hidden="true">Pass je kerja<br />dekat Jentera.</span></section>
    </main>
    <footer className="lv3-footer lv3-wrap"><Link className="lv3-brand" to="/"><Mascot /><span>Jentera</span></Link><span>Built in 🇲🇾.</span><nav aria-label="Footer navigation"><a href="#lv3-pricing">Pricing</a><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link></nav></footer>
  </div>;
}
