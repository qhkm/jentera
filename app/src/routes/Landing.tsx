import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  ChatCircle,
  FileText,
  Coffee,
  FirstAid,
  ForkKnife,
  LockSimple,
  MagnifyingGlass,
  Plus,
  ShieldCheck,
  Storefront,
} from "@phosphor-icons/react";
import {
  LandingFooter,
  LandingHeader,
} from "@/components/landing/LandingChrome";
import { useScrollReveal } from "@/hooks/useScrollReveal";
import { JenteraMark } from "@/components/JenteraMark";
import { ProductTour } from "@/components/landing/ProductTour";
import { LandingInstallNudge } from "@/components/InstallNudge";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import {
  BUSINESS_EXAMPLES,
  EVERYDAY_WORK,
  FIRST_WORKFLOW_EXAMPLES,
  FAQS,
  HERO,
} from "@/lib/landing-content";
import { launchOffer, launchPlanBenefits } from '@/lib/launch-offer';
import { LaunchAnnouncement } from '@/components/LaunchAnnouncement';

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="lp-eyebrow">
      <span className="lp-dot" />
      {children}
    </span>
  );
}

function BusinessPreview() {
  const [selected, setSelected] = useState(0);
  const [showDraft, setShowDraft] = useState(false);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const draftHeading = useRef<HTMLHeadingElement>(null);
  const draftButton = useRef<HTMLButtonElement>(null);
  const restoreDraftFocus = useRef(false);
  const business = BUSINESS_EXAMPLES[selected];
  const BusinessIcon = [Coffee, FirstAid, ForkKnife, Storefront][selected];

  useEffect(() => {
    if (showDraft) draftHeading.current?.focus({ preventScroll: true });
    else if (restoreDraftFocus.current) {
      draftButton.current?.focus({ preventScroll: true });
      restoreDraftFocus.current = false;
    }
  }, [showDraft]);

  function choose(index: number) {
    setSelected(index);
    setShowDraft(false);
  }

  return (
    <div id="example" className="business-preview">
      <div className="preview-controls">
        <div className="preview-caption">
          <span className="preview-caption-index">01 — 04</span> Choose a
          business. See Jentera at work.
        </div>
        <div
          className="preview-tabs"
          role="tablist"
          aria-label="Choose a business example"
        >
          {BUSINESS_EXAMPLES.map((example, index) => (
            <button
              type="button"
              role="tab"
              key={example.id}
              id={`tab-${example.id}`}
              ref={(node) => {
                tabs.current[index] = node;
              }}
              aria-selected={selected === index}
              aria-controls="business-example-panel"
              tabIndex={selected === index ? 0 : -1}
              onClick={() => choose(index)}
              onKeyDown={(event) => {
                let next = index;
                if (event.key === "ArrowRight")
                  next = (index + 1) % BUSINESS_EXAMPLES.length;
                else if (event.key === "ArrowLeft")
                  next =
                    (index + BUSINESS_EXAMPLES.length - 1) %
                    BUSINESS_EXAMPLES.length;
                else if (event.key === "Home") next = 0;
                else if (event.key === "End")
                  next = BUSINESS_EXAMPLES.length - 1;
                else return;
                event.preventDefault();
                choose(next);
                tabs.current[next]?.focus();
              }}
            >
              {index === 0 ? (
                <Coffee size={16} weight="duotone" aria-hidden="true" />
              ) : index === 1 ? (
                <FirstAid size={16} weight="duotone" aria-hidden="true" />
              ) : index === 2 ? (
                <ForkKnife size={16} weight="duotone" aria-hidden="true" />
              ) : (
                <Storefront size={16} weight="duotone" aria-hidden="true" />
              )}
              {example.label}
            </button>
          ))}
        </div>
      </div>
      <div className="preview-window">
        <div className="preview-topbar">
          <span className="jentera-wordmark font-pixel text-brand">
            <JenteraMark size={24} />
            Jentera
          </span>
          <span>
            <LockSimple size={12} aria-hidden="true" /> Private workspace
          </span>
        </div>
        <div className="preview-business">
          <span className="preview-avatar">
            <BusinessIcon size={23} weight="duotone" aria-hidden="true" />
          </span>
          <div>
            <h2>{business.name}</h2>
            <p>{business.location}</p>
          </div>
          <span className="tag">Example</span>
        </div>
        <div
          role="tabpanel"
          id="business-example-panel"
          aria-labelledby={`tab-${business.id}`}
          className="preview-content"
          tabIndex={0}
        >
          {showDraft ? (
            <div className="preview-draft" key={`${business.id}-draft`}>
              <span className="preview-kicker">Prepared for your review</span>
              <h3 ref={draftHeading} tabIndex={-1}>
                {business.draftTitle}
              </h3>
              <blockquote>{business.draft}</blockquote>
              <p className="preview-context">{business.context}</p>
              <button
                type="button"
                className="preview-back"
                onClick={() => {
                  restoreDraftFocus.current = true;
                  setShowDraft(false);
                }}
              >
                ← Back to the example
              </button>
            </div>
          ) : (
            <div key={business.id}>
              <div className="preview-request">
                <span className="preview-business-art" aria-hidden="true">
                  <BusinessIcon size={66} weight="duotone" />
                </span>
                <span>You</span>
                <p>{business.request}</p>
              </div>
              <div className="preview-answer">
                <span className="preview-kicker">Jentera’s plan</span>
                <h3>
                  Here is what I can <br />
                  prepare for you.
                </h3>
                <ul>
                  {business.tasks.map((task, index) => (
                    <li key={task}>
                      <span className="preview-task-number">0{index + 1}</span>
                      <span>{task}</span>
                      <FileText size={14} aria-hidden="true" />
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  ref={draftButton}
                  className="preview-open"
                  onClick={() => setShowDraft(true)}
                >
                  See an example draft{" "}
                  <ArrowUpRight size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="preview-bottom">
          <ShieldCheck size={13} aria-hidden="true" /> An illustration. Your
          work uses the details you confirm.
        </div>
      </div>
    </div>
  );
}

const TRUST_SIGNALS = [
  {
    icon: LockSimple,
    title: "Confirmed business knowledge",
    body: "Review and correct the details Jentera uses. Your business data is scoped to your account.",
  },
  {
    icon: ShieldCheck,
    title: "Approval when it matters",
    body: "Important actions pause for your decision.",
  },
  {
    icon: FileText,
    title: "A clear activity history",
    body: "See what ran and what still needs your attention.",
  },
] as const;

function TrustProof() {
  return (
    <section id="control" className="lp-proof-section" aria-labelledby="proof-heading">
      <div className="lp-container">
        <div className="lp-proof-shell">
          <figure className="lp-control-screen">
            <img src="/images/product-tour/knowledge-mobile-v1.png" width="366" height="543" loading="lazy" alt="Demo business knowledge showing confirmed details and a suggested update for review." />
            <figcaption>Actual product screen · fictional business details</figcaption>
          </figure>

          <div className="lp-proof-copy">
            <Eyebrow>Your business, your decisions</Eyebrow>
            <h2 id="proof-heading">
              You stay in control.<br /><span>Of important actions.</span>
            </h2>
            <p>
              Review the business details Jentera uses, inspect important actions before approving them, and check the outcome. AI can make mistakes; verify important information.
            </p>
            <ul className="lp-trust-signals">
              {TRUST_SIGNALS.map(({ icon: SignalIcon, title, body }) => (
                <li key={title}>
                  <span className="lp-trust-icon">
                    <SignalIcon size={18} weight="duotone" aria-hidden="true" />
                  </span>
                  <span>
                    <strong>{title}</strong>
                    <small>{body}</small>
                  </span>
                </li>
              ))}
            </ul>
          </div>


        </div>
      </div>
    </section>
  );
}

const WORK_ICONS = {
  chat: ChatCircle,
  document: FileText,
  search: MagnifyingGlass,
  shield: ShieldCheck,
};

export default function Landing() {
  useScrollReveal();
  /* The public site stays browsable even after sign-in or preview exhaustion.
     /signin chooses the workspace; the API and app gate enforce paid access. */

  return (
    <div className="marketing-page landing-home min-h-dvh bg-bg text-text">
      <LaunchAnnouncement />
      <LandingHeader primaryAction={{ href: launchOffer.href, label: launchOffer.cta }} />
      <main id="main-content">
        <section className="lp-hero hero-stage">
          <div className="lp-hero-grid" aria-hidden="true" />
          <div className="lp-container lp-hero-layout">
            <div className="lp-hero-copy">
              <div className="hero-signature" aria-hidden="true">
                <span className="signature-tile signature-tile-left">
                  <ChatCircle size={26} weight="duotone" />
                </span>
                <span className="signature-line" />
                <JenteraMark size={72} />
                <span className="signature-line" />
                <span className="signature-tile signature-tile-right">
                  <FileText size={26} weight="duotone" />
                </span>
              </div>
              <Eyebrow>{HERO.eyebrow}</Eyebrow>
              <h1>
                {HERO.headline.lead.replace("24/7", "")}
                <em className="hero-hours">24/7</em>{" "}
                <span>
                  {HERO.headline.preposition}{" "}
                  <span className="hero-country">
                    <span role="img" aria-label="Malaysia">{HERO.headline.flag}</span>{" "}
                    {HERO.headline.country}
                  </span>{" "}
                  {HERO.headline.audience}
                </span>
              </h1>
              <p className="lp-hero-description">{HERO.detail}</p>
              <div className="lp-actions">
                <Link to={launchOffer.href} className="btn btn-primary">
                  {HERO.ctaPrimary}
                  <ArrowUpRight size={16} aria-hidden="true" />
                </Link>
                <a href="#product-tour" className="lp-text-link">
                  {HERO.ctaSecondary}
                  <ArrowDown size={15} aria-hidden="true" />
                </a>
              </div>
              <p className="lp-hero-offer">Try 10 chats free. Then RM99/month for your first 3 months, RM199/month thereafter.</p>
              <p className="lp-hero-note">
                <Check size={14} aria-hidden="true" /> Bahasa &amp; English
                <span aria-hidden="true">·</span> You decide before anything
                important goes out
              </p>
            </div>
            <BusinessPreview />
          </div>
          <div className="lp-container lp-region-line">
            <span>Built in Malaysia. For businesses like yours.</span>
            <span>Kedai · Klinik · Kopitiam · Catering · You</span>
          </div>
        </section>

        <section id="first-workflow" className="lp-container lp-section" aria-labelledby="workflow-examples-title">
          <div className="lp-section-heading">
            <Eyebrow>Start with one task</Eyebrow>
            <h2 id="workflow-examples-title">What can I ask<br /><span className="text-brand">Jentera to do?</span></h2>
            <p>Too much of your day goes to small, repetitive work. Check an order. Update a spreadsheet. Prepare a report. Then do it all again tomorrow.</p>
            <p>You don’t need to build complicated workflows or learn automation tools. Just explain the work like you would to a staff member.</p>
          </div>
          <div className="lp-workflow-examples">{FIRST_WORKFLOW_EXAMPLES.map(example => <article key={example.title}><h3>{example.title}</h3><blockquote>{example.request}</blockquote></article>)}</div>
          <p className="lp-workflow-note">Examples to set up together, not active automations. Recurring routines are currently in a limited pilot. Connected accounts and your approval are needed where applicable; customer WhatsApp automation is not available.</p>
        </section>

        <ProductTour />

        <section id="how" className="lp-how-section" aria-labelledby="computer-heading">
          <div className="lp-container lp-section">
            <div className="lp-section-heading">
              <Eyebrow>Less prompting. More delegating.</Eyebrow>
              <h2 id="computer-heading">Your AI staff.<br /><span className="text-brand">Its own computer.</span></h2>
              <p>You already have enough software. Someone still needs to do the work between those tools. Jentera can open supported websites, work with files and complete multi-step jobs on its own computer. You don’t need to keep your laptop open.</p>
            </div>
            <div className="lp-steps lp-difference-grid">
              <article><span className="lp-step-number">01 / YOUR COMPUTER</span><h3>A place to get work done.</h3><p>A dedicated cloud workspace for browser tasks and working files. We prepare the computer for you—no technical setup to figure out.</p></article>
              <article><span className="lp-step-number">02 / YOUR TOOLS</span><h3>Work across browser tabs.</h3><p>Research online and use supported websites and connections. Some services need your sign-in or permission; not every website allows automated access.</p></article>
              <article><span className="lp-step-number">03 / YOUR FILES</span><h3>Give it the real material.</h3><p>Upload a picture, document or spreadsheet. Ask Jentera to comment, compare, organise or prepare a file you can review.</p></article>
              <article><span className="lp-step-number">04 / YOUR BUSINESS</span><h3>Teach it how you work.</h3><p>Share your process, the things to check and what a good result looks like. Keep your business details and checklists in its workspace, ready for the next job—like training a new staff member.</p></article>
            </div>
            <p className="lp-difference-closing">Hand off the work. Come back to the result. Start with one task you don’t want to do again tomorrow. Some jobs need your sign-in, more information or an approval before they can continue.</p>
            <Link to="/connect" className="lp-text-link lp-try-link">See supported connections <ArrowUpRight size={16} aria-hidden="true" /></Link>
          </div>
        </section>

        <section id="work" className="lp-section lp-container">
          <div className="lp-section-heading">
            <Eyebrow>Take repetitive work off your plate</Eyebrow>
            <h2>
              Give it a job.<br /><span className="text-brand">Not another prompt.</span>
            </h2>
            <p>
              Sales research. Customer follow-up drafts. Admin. Reports. Give Jentera a clear job, the information it needs and the result you want back.
            </p>
            <p>
              These are jobs to set up with your files or supported access, not one-click integrations. Review customer-facing messages and financial documents before sending. Recurring routines are currently in a limited pilot.
            </p>
          </div>
          <div className="lp-job-grid">
            {EVERYDAY_WORK.map((work) => {
              const Glyph = WORK_ICONS[work.icon];
              return (
                <article
                  key={work.number}
                  className={`lp-work-row lp-work-${work.icon}`}
                >
                  <span className="lp-row-number">{work.number}</span>
                  <div className="lp-work-title">
                    <Glyph size={26} weight="duotone" aria-hidden="true" />
                    <div>
                      <span className="lp-work-kicker">{work.kicker}</span>
                      <h3>{work.title}</h3>
                    </div>
                  </div>
                  <div className="lp-work-description">
                    <p>{work.body}</p>
                  </div>
                  <p className="lp-job-example">{work.example}</p>
                </article>
              );
            })}
          </div>
        </section>

        <TrustProof />

        <section id="pricing" className="lp-container lp-section lp-pricing" aria-labelledby="launch-pricing-title">
          <div className="lp-section-heading">
            <Eyebrow>Join early. Get more than software.</Eyebrow>
            <h2 id="launch-pricing-title">Your AI staff.<br /><span className="text-brand">A special launch price.</span></h2>
            <p>Built in Malaysia, for small teams wearing too many hats and owners still doing too much themselves. We’re building Jentera with Malaysian businesses, not just for them.</p>
            <p>As a thank-you for supporting us early, paid launch members get direct founder access through our private WhatsApp support group. Ask questions, get help making the most of Jentera and share what you need. Your feedback will help shape what we build next. Your invitation appears in the platform after payment is confirmed.</p>
          </div>
          <div className="lp-launch-plan">
            <span className="lp-launch-badge">Early-user launch offer</span>
            <h3>Your first AI staff</h3>
            <p className="lp-launch-price"><span>RM{launchOffer.monthlyPrice}</span><span>/month</span></p>
            <p className="lp-launch-renewal">For your first {launchOffer.introductoryMonths} months. Then RM{launchOffer.renewalPrice}/month from month 4.</p>
            <p className="lp-launch-saving">Save RM{(launchOffer.renewalPrice - launchOffer.monthlyPrice) * launchOffer.introductoryMonths} over your first {launchOffer.introductoryMonths} months compared with the regular monthly price.</p>
            <ul aria-label="Launch plan inclusions">
              {launchPlanBenefits.map((feature) => <li key={feature}><Check size={18} aria-hidden="true" /><span>{feature}</span></li>)}
            </ul>
            <Link to={launchOffer.href} className="btn btn-primary">{launchOffer.cta} <ArrowUpRight size={16} aria-hidden="true" /></Link>
            <p className="lp-launch-terms">{launchOffer.terms}</p>
          </div>
        </section>

        <section
          id="questions"
          className="lp-container lp-section lp-faq-section"
        >
          <div className="lp-section-heading">
            <Eyebrow>What owners usually ask</Eyebrow>
            <h2>
              Before you
              <br />
              get started.
            </h2>
            <a href="mailto:hello@kitakodventures.com" className="lp-text-link">
              Talk to a person <ArrowUpRight size={16} aria-hidden="true" />
            </a>
          </div>
          <div className="lp-faq-list">
            {FAQS.map((faq) => (
              <details key={faq.question}>
                <summary>
                  {faq.question}
                  <Plus size={17} aria-hidden="true" />
                </summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="lp-closing">
          <div className="lp-container">
            <JenteraMark size={64} className="closing-mark" />
            <span className="lp-closing-label">
              Built in Malaysia. For the business you already run.
            </span>
            <h2>
              What are you still doing manually?
              <br />
              <span>Hand it to Jentera.</span>
            </h2>
            <Link to={launchOffer.href} className="btn btn-primary">
              {launchOffer.cta} <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
            <p>RM99/month for your first 3 months, then RM199/month.</p>
          </div>
        </section>
      </main>
      <LandingFooter />
      <LandingInstallNudge />
      <ServiceWorkerRegistration />
    </div>
  );
}
