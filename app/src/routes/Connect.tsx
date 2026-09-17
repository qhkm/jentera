import { useState } from 'react';
import { Link } from 'react-router';
import {
  ArrowUpRight,
  ShieldCheck,
} from '@phosphor-icons/react';
import { LandingFooter, LandingHeader } from '@/components/landing/LandingChrome';
import { ConnectorCard } from '@/components/ConnectorCard';
import { CONNECTOR_CATEGORIES, getConnectorCatalogue, matchesConnector, type CatalogueEntry, type ConnectorCategory } from '@/lib/connector-catalogue';
import { CONNECTOR_PAGES } from '@/lib/connector-pages';

const CONNECTIONS: CatalogueEntry[] = [
  {
    id: 'web-workspace',
    name: 'Web workspace',
    icon: '🌐', availability: 'available', category: 'other',
    description: {
      en: 'Describe a task, review your business details, and see what Jentera has worked on. Your starting point, right in the browser.',
      bm: 'Terangkan tugasan, semak butiran perniagaan dan lihat kerja Jentera. Bermula terus dalam pelayar.',
    },
  },
  ...getConnectorCatalogue(),
  {
    id: 'local-accounting',
    name: 'Local accounting',
    icon: '🧾', availability: 'planned', category: 'accounting',
    description: {
      en: 'Local accounting connections are part of our direction. MyInvois submission and e-invoicing are not currently available.',
      bm: 'Sambungan perakaunan tempatan dalam perancangan. Penyerahan MyInvois dan e-invois belum tersedia.',
    },
  },
];

/* Only connections with a page of their own get a link. Naming one that
   does not exist would send a reader, and a crawler, to the 404. */
function pageFor(name: string): string | undefined {
  const page = CONNECTOR_PAGES.find(item => item.name === name);
  return page && `/connect/${page.slug}`;
}

type Filter = 'all' | 'available' | 'planned';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All connections' },
  { id: 'available', label: 'Available now' },
  { id: 'planned', label: 'Planned' },
];

export default function Connect() {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ConnectorCategory | 'all'>('all');
  const visible = CONNECTIONS.filter(
    connection => matchesConnector(connection, query) && (category === 'all' || connection.category === category)
      && (filter === 'all' || (connection.availability !== 'planned') === (filter === 'available')),
  );

  return (
    <div className="marketing-page min-h-dvh bg-bg text-text">
      <LandingHeader />
      <main id="main-content">
        <section className="connections-hero lp-container lp-section">
          <div className="lp-section-heading">
            <span className="lp-eyebrow">
              <span className="lp-dot" /> Connected to your business
            </span>
            <h1>
              Your business.
              <br />
              <span className="text-brand">Your familiar tools.</span>
            </h1>
            <p>
              Business here happens across chats, counters, and spreadsheets. We’re building Jentera
              around the tools you already use, starting with a private place to put it to work.
            </p>
          </div>
          <div className="connections-start">
            <ShieldCheck size={28} weight="duotone" className="text-brand" aria-hidden="true" />
            <span className="preview-kicker">Your first connection</span>
            <h2>You and Jentera.</h2>
            <p>
              Start in your web workspace. Pair your private Telegram chat when you’re ready. Your
              customers aren’t added to it.
            </p>
            <Link to="/signin?mode=signup" className="lp-text-link">
              Set up your business <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </section>

        <section id="connections" className="lp-container connections-directory">
          <div className="connections-directory-heading">
            <h2>What connects today.</h2>
            <div className="connections-filters" role="group" aria-label="Filter connections">
              {FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={filter === item.id}
                  onClick={() => setFilter(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="connector-toolbar">
            <label className="connector-search">Find an app<input className="input" type="search" value={query}
              onChange={event => setQuery(event.target.value)} placeholder="Search apps or categories…" /></label>
            <label className="connector-search">Category<select className="input" value={category} onChange={event => setCategory(event.target.value as typeof category)}>
              <option value="all">All categories</option>
              {Object.entries(CONNECTOR_CATEGORIES).map(([id, label]) => <option key={id} value={id}>{label.en}</option>)}
            </select></label>
          </div>
          <p className="connections-note" role="status">
            {filter === 'planned'
              ? 'These connections are planned. They are not available to connect yet.'
              : 'Telegram and the web workspace are available. Calendar is a pilot with Google permission verification pending. Planned connections are not live.'}
          </p>
          <div className="connector-grid">
            {visible.map(connection => <ConnectorCard key={connection.id} entry={connection} href={pageFor(connection.name)} />)}
          </div>
          {!visible.length && <p className="connector-empty">No apps match these filters. Try another search or choose All connections.</p>}
        </section>

        <section className="lp-container connections-request">
          <div>
            <span className="lp-eyebrow">Built around your everyday work</span>
            <h2>Missing something you use?</h2>
            <p>
              Tell us which tool matters to your business and what you’d like Jentera to help with.
              That helps us choose what to build next.
            </p>
          </div>
          <a
            className="btn btn-outline"
            href="mailto:hello@kitakodventures.com?subject=A%20connection%20for%20my%20business"
          >
            Tell us what you need <ArrowUpRight size={16} aria-hidden="true" />
          </a>
        </section>
      </main>
      <LandingFooter />
    </div>
  );
}
