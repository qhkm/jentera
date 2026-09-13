import { Link, useSearchParams } from 'react-router';
import { AutomationPlaybooks } from '@/components/AutomationPlaybooks';
import { AUTOMATION_PLAYBOOKS } from '@/lib/routines/playbooks';
import type { RoutineConfig } from '@/lib/routines/types';
import type { ConnectionsState } from '@/hooks/useConnections';
import '@/styles/routines.css';
import '@/styles/library.css';

const tabs = ['playbooks', 'skills', 'connectors'] as const;
const skills = [...new Set(AUTOMATION_PLAYBOOKS.flatMap(playbook => playbook.skills))];

export default function LibraryView({ canSchedule, onUse, connections }: {
  canSchedule: boolean;
  onUse: (config: RoutineConfig) => void;
  connections: ConnectionsState;
}) {
  const [params, setParams] = useSearchParams();
  const tab = tabs.find(value => value === params.get('tab')) ?? 'playbooks';
  const telegram = connections.rows?.find(row => row.connector === 'telegram');
  const telegramStatus = connections.mode === 'pending' ? 'Checking connection…'
    : connections.mode === 'error' ? 'Connection status unavailable'
    : connections.mode === 'demo' ? 'Sign in to connect'
    : telegram?.status === 'connected' ? telegram.paired ? 'Connected' : 'Finish pairing'
    : 'Not connected';
  return <section className="library-view" aria-labelledby="library-title">
    <header><h1 id="library-title">Library</h1><p>Discover what Jentera can do. Your scheduled work stays in Routines.</p></header>
    <nav className="library-tabs" aria-label="Library sections">
      {tabs.map(value => <Link key={value} to={`/app?view=library&tab=${value}`} aria-current={tab === value ? 'page' : undefined}>{value[0].toUpperCase() + value.slice(1)}</Link>)}
    </nav>
    {tab === 'playbooks' && <AutomationPlaybooks canUse={canSchedule} onUse={onUse} />}
    {tab === 'skills' && <section aria-labelledby="skills-title">
      <h2 id="skills-title">Skills</h2><p className="library-description">How Jentera does a job. These instructions are included in playbooks; they are not separately installed or enabled. Custom skills and SOP editing are not available yet.</p>
      <div className="library-grid">{skills.map(name => {
        const usedBy = AUTOMATION_PLAYBOOKS.filter(playbook => playbook.skills.includes(name));
        const available = usedBy.some(playbook => playbook.available);
        return <article className="library-card card" key={name}>
          <span className={`library-status ${available ? 'available' : ''}`}>{available ? 'Included in playbooks' : 'Planned'}</span>
          <h3>{name}</h3>
          <p>Used by {usedBy.map(playbook => playbook.name).join(', ')}.</p>
          <details><summary>View instructions</summary>{usedBy.map(playbook => <div key={playbook.id}><h4>{playbook.name}</h4><p>{playbook.instructions ?? playbook.steps.join('. ') + '.'}</p></div>)}
            <button className="routine-link" type="button" onClick={() => setParams({ view: 'library', tab: 'playbooks' })}>Explore playbooks →</button>
          </details>
        </article>;
      })}</div>
    </section>}
    {tab === 'connectors' && <section aria-labelledby="connectors-title">
      <h2 id="connectors-title">Connectors</h2><p className="library-description">Apps Jentera can work with. Account access and permissions stay in My Business.</p>
      <div className="library-grid">
        <article className="library-card card"><span className="library-status available">Available</span><h3>Telegram</h3><p>Connect your private chat to Jentera.</p><p role="status">{telegramStatus}</p>
          {connections.mode === 'error' && <button type="button" className="routine-link" onClick={connections.retry}>Retry status check</button>}
          <Link className="routine-link" to="/app?view=business&tab=connections">Manage Telegram →</Link></article>
        {['Gmail', 'CRM', 'Accounting app'].map(name => <article className="library-card card" key={name}><span className="library-status">Not available yet</span><h3>{name}</h3><p>This integration is not implemented yet. Playbooks that need it cannot be enabled.</p></article>)}
      </div>
    </section>}
  </section>;
}
