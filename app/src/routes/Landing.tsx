import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChatCircle,
  FileText,
  LockSimple,
  MagnifyingGlass,
  Plus,
  ShieldCheck,
  Storefront,
} from '@phosphor-icons/react';
import { LandingFooter, LandingHeader } from '@/components/landing/LandingChrome';
import { useScrollReveal } from '@/hooks/useScrollReveal';
import { BUSINESS_EXAMPLES, EVERYDAY_WORK, FAQS, HERO, SETUP_STEPS } from '@/lib/landing-content';

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
          <span className="lp-status-dot" /> A little less on your plate.
        </div>
        <div className="preview-tabs" role="tablist" aria-label="Choose a business example">
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
                if (event.key === 'ArrowRight') next = (index + 1) % BUSINESS_EXAMPLES.length;
                else if (event.key === 'ArrowLeft')
                  next = (index + BUSINESS_EXAMPLES.length - 1) % BUSINESS_EXAMPLES.length;
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = BUSINESS_EXAMPLES.length - 1;
                else return;
                event.preventDefault();
                choose(next);
                tabs.current[next]?.focus();
              }}
            >
              {example.label}
            </button>
          ))}
        </div>
      </div>
      <div className="preview-window">
        <div className="preview-topbar">
          <span className="font-pixel text-brand">Jentera</span>
          <span>
            <LockSimple size={12} aria-hidden="true" /> Private workspace
          </span>
        </div>
        <div className="preview-business">
          <span className="preview-avatar">
            <Storefront size={23} weight="duotone" aria-hidden="true" />
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
                <span>You</span>
                <p>{business.request}</p>
              </div>
              <div className="preview-answer">
                <span className="preview-kicker">Jentera’s plan</span>
                <h3>
                  Let’s take a few things <br />
                  off your list.
                </h3>
                <ul>
                  {business.tasks.map((task, index) => (
                    <li key={task}>
                      <span className="preview-task-number">0{index + 1}</span>
                      <span>{task}</span>
                      <Check size={14} aria-label="Example task" />
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  ref={draftButton}
                  className="preview-open"
                  onClick={() => setShowDraft(true)}
                >
                  See an example draft <ArrowUpRight size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="preview-bottom">
          <ShieldCheck size={13} aria-hidden="true" /> An illustration. Your work uses the details
          you confirm.
        </div>
      </div>
    </div>
  );
}

const WORK_ICONS = { chat: ChatCircle, document: FileText, search: MagnifyingGlass };

export default function Landing() {
  useScrollReveal();

  return (
    <div className="marketing-page min-h-dvh bg-bg text-text">
      <LandingHeader />
      <main id="main-content">
        <section className="lp-hero hero-stage">
          <div className="lp-hero-grid" aria-hidden="true" />
          <div className="lp-container lp-hero-layout">
            <div className="lp-hero-copy">
              <Eyebrow>{HERO.eyebrow}</Eyebrow>
              <h1>
                {HERO.headline[0]}
                <span>{HERO.headline[1]}</span>
              </h1>
              <p className="lp-hero-description">{HERO.detail}</p>
              <div className="lp-actions">
                <Link to="/signin?mode=signup" className="btn btn-primary">
                  {HERO.ctaPrimary}
                  <ArrowUpRight size={16} aria-hidden="true" />
                </Link>
                <a href="#example" className="lp-text-link">
                  {HERO.ctaSecondary}
                  <ArrowDown size={15} aria-hidden="true" />
                </a>
              </div>
              <p className="lp-hero-note">
                <Check size={14} aria-hidden="true" /> Start with a description. No technical setup.
              </p>
            </div>
            <BusinessPreview />
          </div>
          <div className="lp-container lp-region-line">
            <span>Built in Malaysia. Made for Southeast Asia.</span>
            <span>Kedai · Klinik · Kopitiam · Catering · You</span>
          </div>
        </section>

        <section id="work" className="lp-section lp-container">
          <div className="lp-section-heading">
            <Eyebrow>For the business you already run</Eyebrow>
            <h2>
              The work doesn’t stop
              <br />
              when the shop closes.
            </h2>
            <p>
              You already have customers, a team, and a way of doing things. Jentera helps with the
              everyday work that keeps landing on your desk.
            </p>
          </div>
          <div className="lp-work-list">
            {EVERYDAY_WORK.map((work) => {
              const Glyph = WORK_ICONS[work.icon];
              return (
                <article key={work.number} className="lp-work-row">
                  <span className="lp-row-number">{work.number}</span>
                  <div className="lp-work-title">
                    <Glyph size={26} weight="duotone" aria-hidden="true" />
                    <h3>{work.title}</h3>
                  </div>
                  <div className="lp-work-description">
                    <p>{work.body}</p>
                    <span>{work.example}</span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section id="how" className="lp-how-section">
          <div className="lp-container lp-section">
            <div className="lp-section-heading lp-heading-split">
              <div>
                <Eyebrow>How it works</Eyebrow>
                <h2>
                  A description.
                  <br />A conversation.
                  <br />
                  <span className="text-brand">A job off your list.</span>
                </h2>
              </div>
              <p>
                You know your business. Start there.
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
              Try the setup without an account <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </section>

        <section className="lp-container lp-section lp-local-section">
          <div className="lp-section-heading">
            <Eyebrow>Built around life here</Eyebrow>
            <h2>
              Business here
              <br />
              has its own rhythm.
            </h2>
            <p>
              The late-night enquiry. The family helping behind the counter. The order details
              scattered across chats. We’re building for the way Southeast Asia actually works.
            </p>
            <Link to="/connect" className="lp-text-link">
              See what connects today <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
          </div>
          <div className="lp-local-details">
            <article>
              <span className="lp-local-index">01 / THE WAY YOU TALK</span>
              <h3>Start with a conversation.</h3>
              <p>
                Work with Jentera on the web or in your private Telegram chat. WhatsApp is part of
                our direction, because that’s where so much business happens.
              </p>
              <span className="lp-availability">
                <span className="lp-status-dot" /> Web + private Telegram available
              </span>
            </article>
            <article>
              <span className="lp-local-index">02 / THE WAY YOU WORK</span>
              <h3>Your business comes first.</h3>
              <p>
                Your menu, your services, your opening hours. Jentera works from the details you
                confirm, in a workspace private to your business.
              </p>
            </article>
            <article>
              <span className="lp-local-index">03 / THE WAY WE BUILD</span>
              <h3>Made to be within reach.</h3>
              <p>
                A five-person business deserves useful AI too. We build the technology behind
                Jentera to make everyday help practical for smaller teams.
              </p>
            </article>
          </div>
        </section>

        <section id="aisar" className="lp-about-section">
          <div className="lp-container lp-about-layout">
            <div>
              <Eyebrow>Jentera, by AISAR</Eyebrow>
              <h2>
                AI agents that run
                <br />
                Southeast Asian businesses.
              </h2>
            </div>
            <div>
              <p>That’s what AISAR builds. Jentera is how you put it to work in yours.</p>
              <p>
                One product to learn your business, help with the daily work, and give you room to
                focus on what comes next.
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

        <section id="questions" className="lp-container lp-section lp-faq-section">
          <div className="lp-section-heading">
            <Eyebrow>A few useful answers</Eyebrow>
            <h2>
              Before you
              <br />
              hand over a job.
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
            <span className="lp-closing-label">For the next chapter of your business</span>
            <h2>
              You’ve got a business to run.
              <br />
              <span>Let’s get to work.</span>
            </h2>
            <Link to="/signin?mode=signup" className="btn btn-primary">
              Put Jentera to work <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
            <p>Tell us about the business you already have.</p>
          </div>
        </section>
      </main>
      <LandingFooter />
    </div>
  );
}
