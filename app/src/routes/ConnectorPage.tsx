import { Link, useParams } from 'react-router';
import { ArrowUpRight, Check, Prohibit, ShieldCheck } from '@phosphor-icons/react';
import { LandingFooter, LandingHeader } from '@/components/landing/LandingChrome';
import { connectorPage } from '@/lib/connector-pages';
import NotFound from '@/routes/NotFound';

/** One long-form page per working connection. Rendered at build time, so the
 * whole thing is readable without JavaScript — which is the only version a
 * crawler is guaranteed to see. */
export default function ConnectorPage() {
  const { slug } = useParams();
  const page = connectorPage(slug ?? '');
  if (!page) return <NotFound />;

  return (
    <div className="marketing-page min-h-dvh bg-bg text-text">
      <LandingHeader />
      <main id="main-content">
        <section className="connections-hero lp-container lp-section">
          <div className="lp-section-heading">
            <nav aria-label="Breadcrumb" className="mp-breadcrumb">
              <Link to="/connect">Connections</Link>
              <span aria-hidden="true">/</span>
              <span>{page.name}</span>
            </nav>
            <span className="lp-eyebrow">
              <span className="lp-dot" /> {page.eyebrow}
            </span>
            <h1>
              <span aria-hidden="true" className="mp-glyph">{page.icon}</span>
              {page.headline}
            </h1>
            <p>{page.lede}</p>
          </div>
          <div className="connections-start">
            <ShieldCheck size={28} weight="duotone" className="text-brand" aria-hidden="true" />
            <span className="preview-kicker">
              {page.availability === 'pilot' ? 'Pilot connection' : 'Available now'}
            </span>
            <h2>{page.name} and Jentera.</h2>
            <p>
              {page.availability === 'pilot'
                ? 'You can try this connection today. It is still a pilot, so what it does may change.'
                : 'Set up your business, then pair this connection from your workspace.'}
            </p>
            <Link to="/signin?mode=signup" className="lp-text-link">
              Set up your business <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </section>

        <section className="lp-container lp-section" aria-labelledby="connector-does">
          <div className="lp-section-heading">
            <h2 id="connector-does">What it does today.</h2>
          </div>
          <div className="lp-job-grid">
            {page.does.map((item) => (
              <article key={item.title} className="lp-work-row">
                <div className="lp-work-title">
                  <Check size={22} weight="bold" aria-hidden="true" className="text-brand" />
                  <div><h3>{item.title}</h3></div>
                </div>
                <div className="lp-work-description"><p>{item.body}</p></div>
              </article>
            ))}
          </div>
        </section>

        {/* Above the setup steps on purpose. Someone deciding whether this is
            for them needs the boundaries before the instructions. */}
        <section className="lp-container lp-section mp-limits" aria-labelledby="connector-limits">
          <div className="lp-section-heading">
            <h2 id="connector-limits">What it does not do.</h2>
            <p>Plainly, so nothing here surprises you later.</p>
          </div>
          <ul>
            {page.limits.map((limit) => (
              <li key={limit}>
                <Prohibit size={18} weight="bold" aria-hidden="true" />
                <span>{limit}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="lp-container lp-section" aria-labelledby="connector-steps">
          <div className="lp-section-heading">
            <h2 id="connector-steps">Setting it up.</h2>
          </div>
          <ol className="mp-steps">
            {page.steps.map((step, index) => (
              <li key={step.title}>
                <span className="lp-row-number">{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="lp-container connections-request">
          <div>
            <span className="lp-eyebrow">Keep reading</span>
            <h2>Related</h2>
            <ul className="mp-related">
              {page.related.map((link) => (
                <li key={link.href}>
                  <Link to={link.href} className="lp-text-link">
                    {link.label} <ArrowUpRight size={16} aria-hidden="true" />
                  </Link>
                </li>
              ))}
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
