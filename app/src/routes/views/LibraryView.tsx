import { Link, useSearchParams } from 'react-router';
import { AutomationPlaybooks } from '@/components/AutomationPlaybooks';
import { ConnectorOptions } from '@/components/ConnectorOptions';
import type { RoutineConfig } from '@/lib/routines/types';
import type { ConnectionsState } from '@/hooks/useConnections';
import { useT } from '@/i18n/I18nProvider';
import '@/styles/routines.css';
import '@/styles/library.css';

const tabs = ['playbooks', 'connectors'] as const;

export default function LibraryView({ canSchedule, onUse, connections }: {
  canSchedule: boolean;
  onUse: (config: RoutineConfig) => void;
  connections: ConnectionsState;
}) {
  const [params] = useSearchParams();
  const t = useT();
  const tab = tabs.find(value => value === params.get('tab')) ?? 'playbooks';
  return <section className="library-view" aria-labelledby="library-title">
    <header><h1 id="library-title">Library</h1></header>
    <nav className="library-tabs" aria-label="Library sections">
      {tabs.map(value => <Link key={value} to={`/app?view=library&tab=${value}`} aria-current={tab === value ? 'page' : undefined}>{value[0].toUpperCase() + value.slice(1)}</Link>)}
    </nav>
    {tab === 'playbooks' && <AutomationPlaybooks canUse={canSchedule} onUse={onUse} />}
    {tab === 'connectors' && <section aria-labelledby="connectors-title">
      <h2 id="connectors-title">{t('connectors.title')}</h2><p className="library-description">{t('connectors.detail')}</p>
      <ConnectorOptions connections={connections} />
    </section>}
  </section>;
}
