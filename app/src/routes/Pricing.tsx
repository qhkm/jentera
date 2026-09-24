import { Link } from 'react-router';
import { ArrowUpRight, Check, Plus } from '@phosphor-icons/react';
import { LandingFooter, LandingHeader } from '@/components/landing/LandingChrome';
import { FAQS } from '@/lib/landing-content';
import { launchOffer, launchPlanBenefits } from '@/lib/launch-offer';

/* The questions a pricing page has to answer. Selected from the landing FAQs
   by exact text rather than restated here, so an answer can never drift
   between the two pages; pricingFaqs() returns fewer entries if one is
   renamed, and the test beside this file fails on that. */
export const PRICING_QUESTIONS = [
  'Can I try Jentera before paying?',
  'How does the launch offer work?',
  'Is AI usage unlimited?',
  'How many computer tasks can run at once?',
  'Can Jentera run work on a schedule?',
] as const;

export function pricingFaqs() {
  return PRICING_QUESTIONS.map((question) => FAQS.find((faq) => faq.question === question)).filter((faq) => !!faq);
}

const SAVING = (launchOffer.renewalPrice - launchOffer.monthlyPrice) * launchOffer.introductoryMonths;

export default function Pricing() {
  return (
    <div className="marketing-page marketing-page--v3 min-h-dvh bg-bg text-text">
      <LandingHeader />
      <main id="main-content">
        <section className="lp-container lp-section">
          <div className="lp-section-heading">
            <span className="lp-eyebrow"><span className="lp-dot" /> Early-user launch offer</span>
            <h1>One price.<br /><span className="text-brand">One AI staff member.</span></h1>
            <p>
              RM{launchOffer.monthlyPrice} a month for your first {launchOffer.introductoryMonths} monthly
              billing periods, then RM{launchOffer.renewalPrice} a month from month four. No setup fee, and
              nothing to install.
            </p>
            <p>{launchOffer.availability}</p>
          </div>
        </section>

        <section className="lp-container lp-section lp-pricing" aria-labelledby="pricing-plan">
          <div className="lp-section-heading">
            <h2 id="pricing-plan">What you get.</h2>
            <p>
              A subscription is one AI staff member with one dedicated computer. It works through your web
              workspace and, once you pair it, your private Telegram chat.
            </p>
            <p>
              Before you subscribe you can create an account and send{' '}
              <strong>10 free chat requests</strong>. The allowance is shared across all your chats and
              businesses — it is not 10 per conversation.
            </p>
          </div>
          <div className="lp-launch-plan">
            <span className="lp-launch-badge">Early-user launch offer</span>
            <h3>Your first AI staff</h3>
            <p className="lp-launch-price"><span>RM{launchOffer.monthlyPrice}</span><span>/month</span></p>
            <p className="lp-launch-renewal">
              For your first {launchOffer.introductoryMonths} months. Then RM{launchOffer.renewalPrice}/month from month 4.
            </p>
            <p className="lp-launch-saving">
              Save RM{SAVING} over your first {launchOffer.introductoryMonths} months compared with the regular monthly price.
            </p>
            <ul aria-label="Launch plan inclusions">
              {launchPlanBenefits.map((feature) => <li key={feature}><Check size={18} aria-hidden="true" /><span>{feature}</span></li>)}
            </ul>
            <Link to={launchOffer.href} className="btn btn-primary">
              {launchOffer.cta} <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
            <p className="lp-launch-terms">{launchOffer.terms}</p>
          </div>
        </section>

        {/* The limits belong on the pricing page, not buried in terms. Someone
            comparing plans is deciding on exactly these sentences. */}
        <section className="lp-container lp-section mp-limits" aria-labelledby="pricing-limits">
          <div className="lp-section-heading">
            <h2 id="pricing-limits">What the price does not include.</h2>
            <p>Read these before you subscribe.</p>
          </div>
          <ul>
            <li><span>AI usage is not unlimited. Standard usage is included, subject to fair-use limits, and a multi-step job uses more than a simple question.</span></li>
            <li><span>One computer task at a time. The plan includes one dedicated computer, not several AI staff working in parallel.</span></li>
            <li><span>Customer-facing WhatsApp automation is not available. Founder WhatsApp support is human onboarding, not a connector.</span></li>
            <li><span>E-invoicing is not available. Jentera does not submit to MyInvois or connect to LHDN today.</span></li>
            <li><span>Recurring routines are a limited pilot and are not enabled for every account.</span></li>
          </ul>
        </section>

        <section className="lp-container lp-section lp-faq-section" aria-labelledby="pricing-questions">
          <div className="lp-section-heading">
            <span className="lp-eyebrow"><span className="lp-dot" /> Before you subscribe</span>
            <h2 id="pricing-questions">Questions about the price.</h2>
            <a href="mailto:hello@kitakodventures.com" className="lp-text-link">
              Talk to a person <ArrowUpRight size={16} aria-hidden="true" />
            </a>
          </div>
          <div className="lp-faq-list">
            {pricingFaqs().map((faq) => (
              <details key={faq.question}>
                <summary>{faq.question}<Plus size={17} aria-hidden="true" /></summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="lp-container connections-request">
          <div>
            <span className="lp-eyebrow">Keep reading</span>
            <h2>Related</h2>
            <ul className="mp-related">
              <li><Link to="/connect" className="lp-text-link">What Jentera connects to <ArrowUpRight size={16} aria-hidden="true" /></Link></li>
              <li><Link to="/about" className="lp-text-link">Who builds Jentera <ArrowUpRight size={16} aria-hidden="true" /></Link></li>
              <li><Link to="/terms" className="lp-text-link">Terms of service <ArrowUpRight size={16} aria-hidden="true" /></Link></li>
            </ul>
          </div>
          <Link to={launchOffer.href} className="btn btn-primary">
            {launchOffer.cta} <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </section>
      </main>
      <LandingFooter />
    </div>
  );
}
