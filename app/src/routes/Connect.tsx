import { useState } from 'react';
import { Link } from 'react-router';
import {
  ArrowUpRight,
  CalendarBlank,
  Globe,
  Receipt,
  ShieldCheck,
  TelegramLogo,
  WhatsappLogo,
} from '@phosphor-icons/react';
import { LandingFooter, LandingHeader } from '@/components/landing/LandingChrome';
import { isLive } from '@/lib/live-connectors';

const CONNECTIONS = [
  {
    name: 'Web workspace',
    icon: Globe,
    available: true,
    category: 'Your place to work',
    description:
      'Describe a task, review your business details, and see what Jentera has worked on. Your starting point, right in the browser.',
  },
  {
    name: 'Telegram',
    icon: TelegramLogo,
    available: isLive('Telegram'),
    category: 'Your private conversation',
    description:
      'Pair a private chat with your business. Ask Jentera for help and review its work from your phone. This is your owner channel.',
  },
  {
    name: 'WhatsApp',
    icon: WhatsappLogo,
    available: isLive('WhatsApp'),
    category: 'Where your customers are',
    description:
      'Customer enquiries and follow-ups through the channel businesses here depend on. This connection is planned and cannot be connected yet.',
  },
  {
    name: 'Calendars & bookings',
    icon: CalendarBlank,
    available: false,
    category: 'Keep the day organised',
    description:
      'Availability, bookings, and reminders in the tools you already use. Calendar connections and automatic bookings are planned.',
  },
  {
    name: 'Local accounting',
    icon: Receipt,
    available: false,
    category: 'The paperwork that matters here',
    description:
      'Local accounting connections are part of our direction. MyInvois submission and e-invoicing are not currently available.',
  },
] as const;

type Filter = 'all' | 'available' | 'planned';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All connections' },
  { id: 'available', label: 'Available now' },
  { id: 'planned', label: 'Planned' },
];

export default function Connect() {
  const [filter, setFilter] = useState<Filter>('all');
  const visible = CONNECTIONS.filter(
    (connection) => filter === 'all' || connection.available === (filter === 'available'),
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
          <p className="connections-note" role="status">
            {filter === 'planned'
              ? 'These connections are planned. They are not available to connect yet.'
              : 'Available means you can use it now. Planned connections are not live.'}
          </p>
          <div className="connections-list">
            {visible.map((connection) => {
              const Glyph = connection.icon;
              return (
                <article className="connection-row" key={connection.name}>
                  <span
                    className={`connection-glyph ${connection.available ? 'connection-glyph-live' : ''}`}
                  >
                    <Glyph size={27} weight="duotone" aria-hidden="true" />
                  </span>
                  <div>
                    <span className="connection-category">{connection.category}</span>
                    <h3>{connection.name}</h3>
                    <p>{connection.description}</p>
                  </div>
                  <span className={`tag ${connection.available ? 'tag-green' : ''}`}>
                    {connection.available ? 'Available now' : 'Planned'}
                  </span>
                </article>
              );
            })}
          </div>
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
