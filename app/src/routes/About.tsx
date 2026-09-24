import { Link } from 'react-router';
import { ArrowUpRight } from '@phosphor-icons/react';
import { LandingFooter, LandingHeader } from '@/components/landing/LandingChrome';
import { FAQS, FOOTER } from '@/lib/landing-content';

/* Every fact on this page is already published elsewhere on the site or in
   the SSM register. No founding story, no team size, no customer count —
   an About page is the easiest place to invent a number, and the hardest
   place for a reader to check one. */
const RELATIONSHIP = FAQS.find((faq) => faq.question === 'What is the relationship between AISAR and Jentera?');

export default function About() {
  return (
    <div className="marketing-page marketing-page--v3 min-h-dvh bg-bg text-text">
      <LandingHeader />
      <main id="main-content">
        <section className="lp-container lp-section">
          <div className="lp-section-heading">
            <span className="lp-eyebrow"><span className="lp-dot" /> Built in Malaysia</span>
            <h1>We build the AI staff<br /><span className="text-brand">for the business you already run.</span></h1>
            <p>
              Jentera is made by Kitakod Ventures, a company registered in Malaysia. We build for Malaysian
              small businesses and solopreneurs — shops, online sellers, clinics, agencies and service
              businesses — because that is the work we understand and the market we are in.
            </p>
          </div>
        </section>

        <section className="lp-container lp-section" aria-labelledby="about-relationship">
          <div className="lp-section-heading">
            <h2 id="about-relationship">AISAR and Jentera.</h2>
            {RELATIONSHIP ? <p>{RELATIONSHIP.answer}</p> : null}
            <p>
              In practice: AISAR is the parent and the engineering behind the agents. Jentera is the product
              you sign into, give work to, and review results in.
            </p>
          </div>
        </section>

        <section className="lp-container lp-section" aria-labelledby="about-position">
          <div className="lp-section-heading">
            <h2 id="about-position">How we build.</h2>
          </div>
          <div className="lp-job-grid">
            <article className="lp-work-row">
              <div className="lp-work-title"><div><h3>You approve what matters.</h3></div></div>
              <div className="lp-work-description">
                <p>
                  Jentera works on its own computer. Anything that reaches the outside world — a calendar
                  event, a message, a file sent on — waits on your decision. That gate is the product, not a
                  setting you can lose.
                </p>
              </div>
            </article>
            <article className="lp-work-row">
              <div className="lp-work-title"><div><h3>We publish what works.</h3></div></div>
              <div className="lp-work-description">
                <p>
                  Connections we have not built are marked planned, not sold as features. If a page here says
                  something is available, you can connect it today.
                </p>
              </div>
            </article>
            <article className="lp-work-row">
              <div className="lp-work-title"><div><h3>Bahasa and English.</h3></div></div>
              <div className="lp-work-description">
                <p>
                  Describe your business in either language. Your workspace, your privacy notice and your
                  terms are available in both.
                </p>
              </div>
            </article>
            <article className="lp-work-row">
              <div className="lp-work-title"><div><h3>Built with owners, early.</h3></div></div>
              <div className="lp-work-description">
                <p>
                  Paid launch members get a private support group and direct access to the founder. What they
                  ask for is what we build next.
                </p>
              </div>
            </article>
          </div>
        </section>

        <section className="lp-container lp-section mp-facts" aria-labelledby="about-company">
          <div className="lp-section-heading">
            <h2 id="about-company">Company details.</h2>
          </div>
          <dl>
            <div><dt>Registered name</dt><dd>Kitakod Ventures</dd></div>
            <div><dt>Registration</dt><dd>{FOOTER.registration}</dd></div>
            <div><dt>Country</dt><dd>Malaysia</dd></div>
            <div><dt>Parent brand</dt><dd><a href="https://aisar.ai" className="lp-text-link">AISAR <ArrowUpRight size={14} aria-hidden="true" /></a></dd></div>
            <div><dt>Contact</dt><dd><a href={`mailto:${FOOTER.email}`} className="lp-text-link">{FOOTER.email}</a></dd></div>
          </dl>
        </section>

        <section className="lp-container connections-request">
          <div>
            <span className="lp-eyebrow">Keep reading</span>
            <h2>Related</h2>
            <ul className="mp-related">
              <li><Link to="/pricing" className="lp-text-link">What it costs <ArrowUpRight size={16} aria-hidden="true" /></Link></li>
              <li><Link to="/connect" className="lp-text-link">What it connects to <ArrowUpRight size={16} aria-hidden="true" /></Link></li>
              <li><Link to="/privacy" className="lp-text-link">Privacy notice <ArrowUpRight size={16} aria-hidden="true" /></Link></li>
            </ul>
          </div>
          <Link to="/signin?mode=signup" className="btn btn-primary">
            Get started <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </section>
      </main>
      <LandingFooter />
    </div>
  );
}
