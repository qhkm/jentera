import { Link, useSearchParams } from 'react-router';
import { BookOpenText, Desktop, FileText, Globe } from '@phosphor-icons/react';
import { AutomationPlaybooks } from '@/components/AutomationPlaybooks';
import { ConnectorOptions } from '@/components/ConnectorOptions';
import { AUTOMATION_PLAYBOOKS } from '@/lib/routines/playbooks';
import type { RoutineConfig } from '@/lib/routines/types';
import type { ConnectionsState } from '@/hooks/useConnections';
import { useT } from '@/i18n/I18nProvider';
import '@/styles/routines.css';
import '@/styles/library.css';

const tabs = ['playbooks', 'skills', 'connectors'] as const;
const skills = [...new Set(AUTOMATION_PLAYBOOKS.flatMap(playbook => playbook.skills))];
const vmSkills = [
  { key: 'web', icon: Globe },
  { key: 'browser', icon: Desktop },
  { key: 'files', icon: FileText },
  { key: 'memory', icon: BookOpenText },
] as const;

export default function LibraryView({ canSchedule, onUse, connections }: {
  canSchedule: boolean;
  onUse: (config: RoutineConfig) => void;
  connections: ConnectionsState;
}) {
  const [params, setParams] = useSearchParams();
  const t = useT();
  const tab = tabs.find(value => value === params.get('tab')) ?? 'playbooks';
  return <section className="library-view" aria-labelledby="library-title">
    <header><h1 id="library-title">Library</h1></header>
    <nav className="library-tabs" aria-label="Library sections">
      {tabs.map(value => <Link key={value} to={`/app?view=library&tab=${value}`} aria-current={tab === value ? 'page' : undefined}>{value[0].toUpperCase() + value.slice(1)}</Link>)}
    </nav>
    {tab === 'playbooks' && <AutomationPlaybooks canUse={canSchedule} onUse={onUse} />}
    {tab === 'skills' && <section className="library-skills" aria-labelledby="skills-title">
      <header>
        <h2 id="skills-title">Skills</h2>
        <p className="library-description">What Jentera can use on its private computer, plus the instructions bundled into your playbooks.</p>
      </header>
      <section className="library-vm-skills" aria-labelledby="vm-skills-title">
        <header className="library-vm-skills-heading">
          <div>
            <span className="library-kicker">{t('biz.vmSkills.eyebrow')}</span>
            <h3 id="vm-skills-title">{t('biz.vmSkills.title')}</h3>
          </div>
          <span className="library-status available">{t('biz.vmSkills.managed')}</span>
        </header>
        <p>{t('biz.vmSkills.description')}</p>
        <ul>
          {vmSkills.map(({ key, icon: Icon }) => <li key={key}>
            <Icon size={18} weight="duotone" aria-hidden="true" />
            <span>
              <strong>{t(`biz.vmSkills.${key}.title`)}</strong>
              <small>{t(`biz.vmSkills.${key}.description`)}</small>
            </span>
          </li>)}
        </ul>
        <small className="library-vm-skills-note">{t('biz.vmSkills.note')}</small>
      </section>
      <section className="library-playbook-skills" aria-labelledby="playbook-skills-title">
        <h3 id="playbook-skills-title">Playbook instructions</h3>
        <p className="library-description">These instructions are included in playbooks; they are not separately installed or enabled. Custom skills and SOP editing are not available yet.</p>
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
      </section>
    </section>}
    {tab === 'connectors' && <section aria-labelledby="connectors-title">
      <h2 id="connectors-title">{t('connectors.title')}</h2><p className="library-description">{t('connectors.detail')}</p>
      <ConnectorOptions connections={connections} />
    </section>}
  </section>;
}
