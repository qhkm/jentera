import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, ArrowUpRight, BookOpen, Check, Lock } from '@phosphor-icons/react';
import { AUTOMATION_PLAYBOOKS, playbookConfig, type AutomationPlaybook } from '@/lib/routines/playbooks';
import type { RoutineConfig } from '@/lib/routines/types';

/** A guided draft builder: opening, choosing and reviewing never writes. */
export function AutomationPlaybooks({ canUse, onUse, onClose }: {
  canUse: boolean; onUse: (config: RoutineConfig) => void; onClose?: () => void;
}) {
  const [selected, setSelected] = useState<AutomationPlaybook | null>(null);
  const [brief, setBrief] = useState('');
  const [reviewed, setReviewed] = useState(false);
  return <section className="automation-playbooks" aria-labelledby="playbooks-heading">
    <div className="routine-section-heading"><div><h2 id="playbooks-heading">Automation Playbooks</h2><p>Choose a job. Review what it needs. Make it a routine.</p></div>
      {onClose && <button type="button" className="btn btn-outline" onClick={onClose}>Close library</button>}</div>
    {!selected ? <div className="automation-playbook-grid">{AUTOMATION_PLAYBOOKS.map(playbook => <button type="button" className="automation-playbook-card card" key={playbook.id} onClick={() => { setSelected(playbook); setBrief(''); setReviewed(false); }}>
      <span className="playbook-card-heading"><BookOpen size={20} className="text-brand" aria-hidden="true" /><strong>{playbook.name}</strong></span>
      <span>{playbook.description}</span>
      <small className="playbook-availability">{playbook.available ? 'Ready to use · No connection needed' : `Coming soon · Requires ${playbook.connections.join(' + ')}`}</small>
      <span className="playbook-card-action">{playbook.available ? 'Explore playbook' : 'View requirements'}<ArrowUpRight size={16} aria-hidden="true" /></span>
    </button>)}</div> : <div className="automation-playbook-detail card">
      <button type="button" className="routine-link" onClick={() => setSelected(null)}><ArrowLeft size={16} />All playbooks</button>
      <h3>{selected.name}</h3><p>{selected.description}</p>
      <h4>What Jentera will do</h4><ol>{selected.steps.map(step => <li key={step}>{step}</li>)}</ol>
      <h4>Skills used</h4><p className="routine-muted">{selected.skills.join(' · ')}</p>
      <small>These are the instructions included in this playbook, not separately installed apps.</small>
      <h4>Connections</h4>
      {selected.connections.length ? <ul>{selected.connections.map(name => <li key={name}><Lock size={15} aria-hidden="true" /> {name} — integration not available yet</li>)}</ul>
        : <p><Check size={15} aria-hidden="true" /> Uses Jentera’s recorded work{selected.kind === 'agent_task' ? ', business knowledge and computer' : ''}. No external login needed.</p>}
      <Link className="routine-link" to="/app?view=business&tab=connections">Manage connections<ArrowUpRight size={15} /></Link>
      {!selected.available ? <p role="status" className="routine-notice">This playbook cannot be enabled yet. Its required integrations must be implemented first.</p> : <form onSubmit={event => { event.preventDefault(); if (canUse && reviewed) onUse(playbookConfig(selected, brief)); }}>
        <h4>Business instructions</h4>
        {selected.kind === 'agent_task' ? <label className="flex flex-col gap-2">What should this focus on?
          <textarea className="input" value={brief} onChange={event => setBrief(event.target.value)} required maxLength={800} rows={4} placeholder={selected.id === 'research-brief' ? 'Topic, region, audience and questions to answer…' : 'Audience, channels, offers and tone…'} />
        </label> : <p>This report uses work recorded in Jentera. It does not read your email, accounts or sales systems.</p>}
        <Link className="routine-link" to="/app?view=business&tab=knows">Review business knowledge<ArrowUpRight size={15} /></Link>
        <h4>Approvals and delivery</h4>
        <p>Results stay in Jentera for review. This playbook does not send emails, publish posts, issue invoices or change external records. Existing action controls still apply.</p>
        <Link className="routine-link" to="/app?view=business&tab=permissions">Review action controls<ArrowUpRight size={15} /></Link>
        <label className="routine-checkbox"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} required />I have reviewed the steps, connections and approval boundaries.</label>
        {!canUse && <p role="status">Scheduling is unavailable or you do not have permission to add another routine.</p>}
        <button type="submit" className="btn" disabled={!canUse || !reviewed || (selected.kind === 'agent_task' && !brief.trim())}>Choose schedule</button>
        <p className="routine-muted">Nothing is enabled yet. Next, review the schedule and confirm. New playbooks start paused so you can test them first.</p>
      </form>}
    </div>}
  </section>;
}
