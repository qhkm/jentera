import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import {
  ArrowDown,
  ArrowRight,
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
import { useSignedInRedirect } from "@/hooks/useSignedInRedirect";
import { JenteraMark } from "@/components/JenteraMark";
import { DataIcon } from "@/components/Icon";
import { WorkIllustration } from "@/components/landing/WorkIllustration";
import { ProductTour } from "@/components/landing/ProductTour";
import { LandingInstallNudge } from "@/components/InstallNudge";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import {
  BUSINESS_EXAMPLES,
  EVERYDAY_WORK,
  FAQS,
  HERO,
  SETUP_STEPS,
  TRADE_TYPES,
} from "@/lib/landing-content";

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
    title: "Private workspace",
    body: "Your business data is scoped to your account.",
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
          <div className="lp-proof-art" aria-hidden="true">
            <img
              src="/images/jentera-malaysian-business-poster-v1-768.webp"
              srcSet="/images/jentera-malaysian-business-poster-v1-768.webp 768w, /images/jentera-malaysian-business-poster-v1-1536.webp 1536w"
              sizes="(max-width: 800px) 100vw, 520px"
              width="1536"
              height="1024"
              loading="lazy"
              decoding="async"
              alt=""
            />
          </div>

          <div className="lp-proof-copy">
            <Eyebrow>Built for owner control</Eyebrow>
            <h2 id="proof-heading">
              The work moves.
              <br />
              <span>You stay in control.</span>
            </h2>
            <p>
              Jentera shows what it handled, pauses when your input is needed,
              and keeps the outcome in one place.
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

          <div className="lp-proof-demo" aria-label="Illustrative Jentera workflow">
            <header>
              <span className="lp-proof-demo-brand">
                <JenteraMark size={28} />
                <span>
                  <small>Illustrative workflow</small>
                  <strong>Friday supplier brief</strong>
                </span>
              </span>
              <span className="tag tag-green">Scheduled</span>
            </header>

            <div className="lp-proof-request">
              <span>You asked</span>
              <p>
                Every Friday, review the supplier pages I share and prepare a
                short price-change brief.
              </p>
            </div>

            <ol className="lp-proof-timeline">
              <li>
                <span className="lp-proof-step is-done">
                  <Check size={13} aria-hidden="true" />
                </span>
                <span>
                  <small>8:00 AM</small>
                  <strong>Scheduled task started</strong>
                </span>
              </li>
              <li>
                <span className="lp-proof-step is-done">
                  <Check size={13} aria-hidden="true" />
                </span>
                <span>
                  <small>8:02 AM</small>
                  <strong>Supplier pages reviewed</strong>
                </span>
              </li>
              <li>
                <span className="lp-proof-step">
                  <FileText size={13} aria-hidden="true" />
                </span>
                <span>
                  <small>8:03 AM</small>
                  <strong>Price-change brief prepared</strong>
                </span>
              </li>
            </ol>

            <div className="lp-proof-review">
              <span>Needs your attention</span>
              <p>Choose which supplier change should go into next week’s plan.</p>
              <span className="lp-proof-review-action">
                Review result <ArrowUpRight size={15} aria-hidden="true" />
              </span>
            </div>

            <footer>
              <FileText size={14} aria-hidden="true" /> Saved to Activity with
              its status and result.
            </footer>
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
  /* An owner who is already signed in belongs in the workspace, not on the
     marketing page. Checked after paint so the page never waits on it. */
  useSignedInRedirect("/app");

  return (
    <div className="marketing-page landing-home min-h-dvh bg-bg text-text">
      <LandingHeader />
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
                    <span role="img" aria-label="Malaysia">
                      {HERO.headline.flag}
                    </span>{" "}
                    {HERO.headline.country}
                  </span>{" "}
                  {HERO.headline.audience}
                </span>
              </h1>
              <p className="lp-hero-description">{HERO.detail}</p>
              <div className="lp-actions">
                <Link to="/signin?mode=signup" className="btn btn-primary">
                  {HERO.ctaPrimary}
                  <ArrowUpRight size={16} aria-hidden="true" />
                </Link>
                <a href="#product-tour" className="lp-text-link">
                  {HERO.ctaSecondary}
                  <ArrowDown size={15} aria-hidden="true" />
                </a>
              </div>
              <p className="lp-hero-note">
                <Check size={14} aria-hidden="true" /> Bahasa &amp; English
                <span aria-hidden="true">·</span> You decide before anything
                important goes out
              </p>
            </div>
            <BusinessPreview />
          </div>
          <div className="lp-container lp-region-line">
            <span>Built in Malaysia. Made for Southeast Asia.</span>
            <span>Kedai · Klinik · Kopitiam · Catering · You</span>
          </div>
        </section>

        <ProductTour />
        <TrustProof />

        <section id="work" className="lp-section lp-container">
          <div className="lp-section-heading">
            <Eyebrow>For the work that keeps coming back</Eyebrow>
            <h2>
              Less time on admin.
              <br />
              <span className="text-brand">More time for the business.</span>
            </h2>
            <p>
              Give Jentera the enquiries, follow-ups, and paperwork that keep
              landing on your desk.
            </p>
          </div>
          <div className="lp-work-list">
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
                  <WorkIllustration kind={work.icon} />
                </article>
              );
            })}
          </div>
        </section>

        <section id="how" className="lp-how-section">
          <div className="lp-container lp-section">
            <div className="lp-section-heading lp-heading-split">
              <div>
                <Eyebrow>Simple to get started</Eyebrow>
                <h2>
                  Tell us about the business.
                  <br />
                  <span className="text-brand">Give Jentera a job.</span>
                </h2>
              </div>
              <p>
                Start with the business you already know.
                <br />
                Jentera handles the setup behind the scenes.
              </p>
            </div>
            <div className="lp-steps">
              {SETUP_STEPS.map((step) => (
                <article key={step.number}>
                  <span className="lp-step-number">
                    {step.number}
                    <ArrowRight size={18} aria-hidden="true" />
                  </span>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </article>
              ))}
            </div>
            <Link to="/onboard" className="lp-text-link lp-try-link">
              Try the setup without an account{" "}
              <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </section>

        <section className="lp-container lp-section lp-local-section">
          <div className="lp-section-heading">
            <Eyebrow>Why here is different</Eyebrow>
            <h2>
              Built for the way business
              <br />
              works here.
            </h2>
            <p>
              The late-night enquiry. The family helping behind the counter. The
              order details scattered across chats. We’re building around the
              way businesses here already work.
            </p>
            <Link to="/connect" className="lp-text-link">
              See what connects today{" "}
              <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
          </div>
          <div className="lp-local-details">
            <article>
              <span className="lp-local-index">01 / THE WAY YOU TALK</span>
              <h3>Start with a conversation.</h3>
              <p>
                Work with Jentera on the web or in your private Telegram chat.
                WhatsApp is part of our direction, because that’s where so much
                business happens.
              </p>
              <span className="lp-availability">
                <span className="lp-status-dot" /> Web + private Telegram
                available
              </span>
            </article>
            <article>
              <span className="lp-local-index">02 / THE WAY YOU WORK</span>
              <h3>Your business comes first.</h3>
              <p>
                Your menu, your services, your opening hours. Jentera works from
                the details you confirm, in a workspace private to your
                business.
              </p>
            </article>
            <article>
              <span className="lp-local-index">03 / THE WAY WE BUILD</span>
              <h3>Made for smaller teams.</h3>
              <p>
                A five-person business deserves useful AI too. We build the
                technology behind Jentera to make everyday help practical for
                smaller teams.
              </p>
            </article>
          </div>
        </section>

        <section className="lp-trades-section">
          <div className="lp-container lp-section">
            <div className="lp-section-heading lp-heading-split">
              <div>
                <Eyebrow>Made for businesses here</Eyebrow>
                <h2>
                  Built around the work
                  <br />
                  <span className="text-brand">you already do.</span>
                </h2>
              </div>
              <p>
                From the first order to the last appointment. Jentera starts
                with your trade and the way your business already runs.
              </p>
            </div>
            <ul
              className="lp-trade-grid"
              aria-label="Businesses Jentera is designed for"
            >
              {TRADE_TYPES.map(([symbol, name]) => (
                <li key={name}>
                  <DataIcon emoji={symbol} size={20} />
                  {name}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="aisar" className="lp-about-section">
          <div className="lp-container lp-about-layout">
            <div>
              <Eyebrow>Built by AISAR</Eyebrow>
              <h2>
                Good technology should work
                <br />
                for a small business too.
              </h2>
            </div>
            <div>
              <p>
                AISAR builds AI agents that run Southeast Asian businesses.
                Jentera is how you put that work to use in yours.
              </p>
              <p>
                One product to learn your business, help with the daily work,
                and give you room to focus on what comes next.
              </p>
              <a
                href="https://aisar.ai"
                className="lp-text-link"
                target="_blank"
                rel="noopener noreferrer"
              >
                Meet AISAR <ArrowUpRight size={16} aria-hidden="true" />
              </a>
            </div>
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
              For the business you already run
            </span>
            <h2>
              More time for the business.
              <br />
              <span>Less time on the admin.</span>
            </h2>
            <Link to="/signin?mode=signup" className="btn btn-primary">
              Set up Jentera <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
            <p>Start with one job that keeps taking up your time.</p>
          </div>
        </section>
      </main>
      <LandingFooter />
      <LandingInstallNudge />
      <ServiceWorkerRegistration />
    </div>
  );
}
