import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { CONNECTORS } from '@/lib/data/connectors';
import { useRepository } from '@/lib/repo';
import type { ConnectionsState } from '@/hooks/useConnections';
import { DataIcon } from '@/components/Icon';
import TelegramConnect from '@/routes/views/TelegramConnect';
import TokenConnect from '@/routes/views/TokenConnect';

export function ConnectorOptions({ connections }: { connections: ConnectionsState }) {
  const repo = useRepository();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [tokens, setTokens] = useState<{ connector: string; label: string }[]>([]);
  const [catalogError, setCatalogError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setCatalogError(false);
    repo.tokenConnectors().then(rows => { if (active) setTokens(rows); }).catch(() => { if (active) setCatalogError(true); });
    return () => { active = false; };
  }, [repo, attempt]);
  const options = [
    ...Object.entries(CONNECTORS).map(([id, item]) => ({ id, name: item.n, icon: item.e })),
    ...tokens.filter(item => !CONNECTORS[item.connector]).map(item => ({ id: item.connector, name: item.label, icon: '🔗' })),
  ].sort((a, b) => Number(b.id === 'telegram' || tokens.some(t => t.connector === b.id)) - Number(a.id === 'telegram' || tokens.some(t => t.connector === a.id)) || a.name.localeCompare(b.name));
  const visible = options.filter(item => item.name.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="connector-options">
    <label className="connector-search">Find an app<input className="input" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search connectors…" /></label>
    {catalogError && <p role="alert">Additional connectors could not be loaded. <button className="routine-link" type="button" onClick={() => setAttempt(n => n + 1)}>Retry catalog</button></p>}
    {connections.mode === 'error' && <p role="alert">Connection status unavailable. <button className="routine-link" type="button" onClick={connections.retry}>Retry status check</button></p>}
    <ul className="connector-list">{visible.map(item => {
      const supported = item.id === 'telegram' || tokens.some(token => token.connector === item.id);
      const row = connections.rows?.find(connection => connection.connector === item.id);
      const paired = item.id !== 'telegram' || row?.paired;
      const status = !supported ? 'Not available yet' : connections.mode === 'pending' ? 'Checking connection…'
        : connections.mode === 'error' ? 'Status unavailable' : connections.mode === 'demo' ? 'Sign in to connect'
        : row?.status === 'connected' ? paired ? 'Connected' : 'Finish pairing' : row?.status === 'error' ? 'Needs attention' : 'Not connected';
      const open = selected === item.id;
      return <li key={item.id} className={open ? 'connector-option-open' : undefined}>
        <div className="connector-option-row">
          <span className="connector-option-icon" aria-hidden="true"><DataIcon emoji={item.icon} size={22} /></span>
          <div className="connector-option-info"><h3>{item.name}</h3><span className={row?.status === 'connected' && paired && connections.real ? 'text-brand' : ''}>{status}</span></div>
          {!supported ? <span className="connector-unavailable">Coming later</span> : connections.mode === 'demo' ? <Link className="btn btn-outline" to="/signin">Sign in</Link> :
            <button type="button" className="btn btn-outline" disabled={connections.mode !== 'real'} aria-expanded={open} aria-controls={`connector-${item.id}`} aria-label={`${open ? 'Close' : row ? 'Manage' : 'Connect'} ${item.name}`} onClick={() => setSelected(open ? null : item.id)}>{open ? 'Close' : row ? 'Manage' : 'Connect'}</button>}
        </div>
        {open && connections.mode === 'real' && <div className="connector-inline-setup" id={`connector-${item.id}`}>
          {item.id === 'telegram' ? <TelegramConnect rows={connections.rows} setRows={connections.setRows} /> : <TokenConnect connector={item.id} rows={connections.rows} setRows={connections.setRows} />}
        </div>}
      </li>;
    })}</ul>
    {!visible.length && <p role="status">No connectors match “{query}”.</p>}
  </div>;
}
