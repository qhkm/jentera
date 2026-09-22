import { ArrowLeft, ArrowRight } from '@phosphor-icons/react';
import { Link } from 'react-router';
import { JenteraMark } from '@/components/JenteraMark';
import { launchOffer } from '@/lib/launch-offer';
import '@/styles/launch-post.css';

const STARTING_JOBS = [
  'Research suppliers and organise the options.',
  'Prepare a customer reply for your review.',
  'Turn notes and files into a useful first draft.',
  'Run recurring work on a schedule you control.',
];

export default function LaunchPost() {
  return (
    <div className="launch-post">
      <a className="launch-post-skip" href="#launch-article">Skip to article</a>
      <header className="launch-post-header">
        <Link className="launch-post-brand" to="/" aria-label="Jentera home">
          <JenteraMark size={34} />
          <span>Jentera</span>
        </Link>
        <nav aria-label="Launch post navigation">
          <Link to="/"><ArrowLeft size={16} />Back to Jentera</Link>
          <Link className="launch-post-header-cta" to={launchOffer.href}>Get started <ArrowRight size={15} /></Link>
        </nav>
      </header>

      <main id="launch-article">
        <article>
          <header className="launch-post-hero">
            <p className="launch-post-kicker">Launch · <time dateTime="2026-09-22">22 September 2026</time></p>
            <h1>Meet Jentera: AI staff for the work your business still does by hand.</h1>
            <p className="launch-post-deck">A private business workspace where you can hand off a job, follow the work, and get a result back for review.</p>
            <div className="launch-post-byline">
              <img src="/images/jentera-character-glossy-v1.webp" alt="" width={96} height={96} />
              <span><strong>From the Jentera team</strong><small>Built in Malaysia by Kitakod Ventures</small></span>
            </div>
          </header>

          <div className="launch-post-prose">
            <p className="launch-post-lead">Most businesses do not need another place to type prompts. They need help with the work already waiting: checking information, preparing documents, following up, and keeping routine jobs moving.</p>
            <p>That is why we built Jentera. You describe the outcome in ordinary language, share the context it needs, and let your AI staff work inside a dedicated business workspace. It comes back with work you can inspect—not just an answer that disappears into a chat.</p>

            <h2>From chat to finished work</h2>
            <p>Jentera starts as a conversation because delegation should feel natural. Tell it what needs doing, attach the relevant files, or choose a skill for the job. The conversation stays connected to the task, its progress, and the result.</p>
            <aside className="launch-post-quote">“Give Jentera one real job. Keep the decisions that matter to you.”</aside>

            <h2>A computer for the business—with you in control</h2>
            <p>Some useful work happens in websites that were built for people, not APIs. Jentera has a business browser for that work. When a sign-in, verification, or sensitive decision needs you, take control of the live browser. Hand it back when you are ready for Jentera to continue.</p>
            <p>Your access is intentional: the owner controls permissions, connections, and what happens next. Support varies by website, and some services may restrict automated access.</p>

            <h2>See the work, not just the answer</h2>
            <p>Delegation only works when it is understandable. Jentera keeps activity, approvals, and results visible in the workspace, so you can see what happened, what still needs attention, and where your input is required. Business context is reviewable too—you can correct it as your business changes.</p>

            <section className="launch-post-list" aria-labelledby="launch-start-title">
              <p className="launch-post-kicker">A practical place to begin</p>
              <h2 id="launch-start-title">Start with one job</h2>
              <ul>{STARTING_JOBS.map(job => <li key={job}><span aria-hidden="true">↗</span>{job}</li>)}</ul>
            </section>

            <h2>Built from Malaysia</h2>
            <p>Jentera is built for the way Malaysian businesses actually operate: across chat, files, browser-based tools, and the everyday details that rarely fit into a neat workflow. We are starting focused, learning from real work, and adding capabilities carefully.</p>
            <p>This launch is the beginning. Our goal is simple: make capable AI feel less like software to manage and more like a reliable teammate you can give real work to.</p>
          </div>

          <section className="launch-post-cta" aria-labelledby="launch-post-cta-title">
            <img src="/images/jentera-character-glossy-v1.webp" alt="" width={160} height={160} />
            <div><p className="launch-post-kicker">Jentera is ready</p><h2 id="launch-post-cta-title">What is the first job you would hand off?</h2><p>Start with 10 free chats. No credit card required.</p></div>
            <Link to={launchOffer.href}>Get started <ArrowRight size={18} /></Link>
          </section>
        </article>
      </main>
      <footer className="launch-post-footer">
        <div>
          <Link className="launch-post-brand" to="/" aria-label="Jentera home"><JenteraMark size={30} /><span>Jentera</span></Link>
          <span>Built in 🇲🇾.</span>
          <nav aria-label="Footer navigation"><Link to="/#lv3-pricing">Pricing</Link><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link></nav>
        </div>
      </footer>
    </div>
  );
}
