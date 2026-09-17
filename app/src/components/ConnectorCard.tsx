import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { DataIcon } from '@/components/Icon';
import { CONNECTOR_CATEGORIES, type CatalogueEntry } from '@/lib/connector-catalogue';
import type { Lang } from '@/lib/types';
import { PAGE_MESSAGES } from '@/i18n/pages';
import '@/styles/connectors.css';

export function ConnectorCard({ entry, lang = 'en', status, connected = false, href, children }: {
  entry: CatalogueEntry;
  lang?: Lang;
  status?: string;
  connected?: boolean;
  /** Set only where a connector has its own page. The workspace passes
   * nothing, so nothing changes for a signed-in owner. */
  href?: string;
  children?: ReactNode;
}) {
  const availability = entry.availability === 'pilot' ? 'Pilot'
    : PAGE_MESSAGES[lang][entry.availability === 'planned' ? 'connectors.planned' : 'connectors.availableNow'];
  return <article className="connector-card" data-connector={entry.id}>
    <div className="connector-card-top">
      <span className={`connector-card-icon ${entry.availability !== 'planned' ? 'connector-card-icon-live' : ''}`} aria-hidden="true">
        <DataIcon emoji={entry.icon} size={26} />
      </span>
      <span className={`connector-availability connector-availability-${entry.availability}`}>{availability}</span>
    </div>
    <div className="connector-card-heading">
      <span className="connector-category">{CONNECTOR_CATEGORIES[entry.category][lang]}</span>
      <h3>{entry.name}</h3>
    </div>
    <p className="connector-card-description">{entry.description[lang]}</p>
    {href && <Link className="connector-card-link" to={href}>
      {lang === 'bm' ? `Tentang ${entry.name}` : `About ${entry.name}`} <span aria-hidden="true">↗</span>
    </Link>}
    {(status || children) && <div className="connector-card-footer">
      {status && <span className={`connector-status ${connected ? 'connector-status-connected' : ''}`}>{status}</span>}
      {children}
    </div>}
  </article>;
}
